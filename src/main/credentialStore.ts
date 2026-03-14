import { safeStorage, app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const DEBUG = process.env.NODE_ENV === 'development';
function dbg(...args: any[]) { if (DEBUG) console.log('[CredentialStore DEBUG]', ...args); }

interface StoredCredential {
  domain: string;
  username: string;
  password_encrypted: string; // base64 of safeStorage buffer
  updated_at: string;
}

interface CredentialFile {
  version: 1;
  checksum: string; // HMAC-SHA256 of the credentials array, keyed by a safeStorage-encrypted nonce
  credentials: StoredCredential[];
}

class CredentialStore {
  private static instance: CredentialStore;
  private filePath: string;

  private constructor() {
    this.filePath = path.join(app.getPath('userData'), 'credentials.enc.json');
  }

  static getInstance(): CredentialStore {
    if (!CredentialStore.instance) {
      CredentialStore.instance = new CredentialStore();
    }
    return CredentialStore.instance;
  }

  isAvailable(): boolean {
    const available = safeStorage.isEncryptionAvailable();
    dbg('isAvailable():', available);
    return available;
  }

  private load(): StoredCredential[] {
    dbg('load() reading file:', this.filePath);
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      dbg('load() file size:', data.length, 'bytes');
      const parsed = JSON.parse(data) as Partial<CredentialFile>;

      // Support legacy format (no version/checksum)
      if (!parsed.version) {
        dbg('load() legacy format detected (no version field)');
        const legacy = parsed as any;
        const creds = Array.isArray(legacy.credentials) ? legacy.credentials : [];
        dbg('load() legacy credentials count:', creds.length);
        return creds;
      }

      const credentials = Array.isArray(parsed.credentials) ? parsed.credentials : [];
      dbg('load() version:', parsed.version, 'credentials count:', credentials.length,
        'domains:', credentials.map(c => `${c.username}@${c.domain}`));

      // Verify integrity checksum if present
      if (parsed.checksum) {
        const computed = this.computeChecksum(credentials);
        const match = parsed.checksum === computed;
        dbg('load() checksum verification:', match ? 'PASS' : 'FAIL',
          '(stored:', parsed.checksum?.substring(0, 16) + '...',
          'computed:', computed.substring(0, 16) + '...)');
        if (!match) {
          console.error('[CredentialStore] Integrity check failed — file may have been tampered with');
          return [];
        }
      } else {
        dbg('load() no checksum in file, skipping verification');
      }

      return credentials;
    } catch (err) {
      dbg('load() failed to read/parse file:', err);
      return [];
    }
  }

  private persist(credentials: StoredCredential[]): void {
    dbg('persist() writing', credentials.length, 'credentials to', this.filePath);
    const fileData: CredentialFile = {
      version: 1,
      checksum: this.computeChecksum(credentials),
      credentials,
    };

    const json = JSON.stringify(fileData, null, 2);
    dbg('persist() JSON size:', json.length, 'bytes, checksum:', fileData.checksum.substring(0, 16) + '...');

    // Atomic write: write to temp file, then rename
    const tmpPath = this.filePath + '.tmp.' + crypto.randomBytes(4).toString('hex');
    try {
      fs.writeFileSync(tmpPath, json, { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmpPath, this.filePath);
      dbg('persist() atomic write succeeded');
    } catch (err) {
      dbg('persist() atomic write FAILED:', err);
      // Clean up temp file on failure
      try { fs.unlinkSync(tmpPath); } catch { /* noop */ }
      throw err;
    }

    // Ensure file permissions are correct (in case file already existed with wrong perms)
    try { fs.chmodSync(this.filePath, 0o600); } catch { /* noop on Windows */ }
  }

  /**
   * Compute HMAC-SHA256 over the credential entries.
   * Uses a deterministic key derived from safeStorage so the checksum
   * is tied to the current OS user and can't be recomputed externally.
   */
  private computeChecksum(credentials: StoredCredential[]): string {
    if (!this.isAvailable()) return '';
    try {
      // Derive a stable HMAC key: encrypt a fixed string, use its hash
      const keyMaterial = safeStorage.encryptString('credential-store-integrity-key');
      const hmacKey = crypto.createHash('sha256').update(keyMaterial).digest();

      const payload = JSON.stringify(
        credentials.map((c) => ({
          d: c.domain,
          u: c.username,
          p: c.password_encrypted,
        }))
      );

      return crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
    } catch {
      return '';
    }
  }

  save(domain: string, username: string, password: string): void {
    dbg('save() called for domain:', domain, 'username:', username, 'password length:', password?.length);
    if (!this.isAvailable()) {
      dbg('save() ABORTED: encryption not available');
      throw new Error('Encryption not available — OS keychain is unavailable');
    }

    // Input validation
    if (!domain || typeof domain !== 'string') { dbg('save() ABORTED: invalid domain:', typeof domain, domain); throw new Error('Invalid domain'); }
    if (!username || typeof username !== 'string') { dbg('save() ABORTED: invalid username:', typeof username, username); throw new Error('Invalid username'); }
    if (!password || typeof password !== 'string') { dbg('save() ABORTED: invalid password:', typeof password); throw new Error('Invalid password'); }

    const sanitizedDomain = domain.trim().toLowerCase();
    const sanitizedUsername = username.trim();
    dbg('save() sanitized domain:', sanitizedDomain, 'username:', sanitizedUsername);

    // Length limits
    if (sanitizedDomain.length > 253) throw new Error('Domain too long');
    if (sanitizedUsername.length > 256) throw new Error('Username too long');
    if (password.length > 10000) throw new Error('Password too long');

    const encrypted = safeStorage.encryptString(password).toString('base64');
    dbg('save() encrypted password length:', encrypted.length, 'chars');
    const now = new Date().toISOString();

    const credentials = this.load();
    const idx = credentials.findIndex(
      (c) => c.domain === sanitizedDomain && c.username === sanitizedUsername
    );

    if (idx !== -1) {
      dbg('save() updating existing credential at index', idx);
      credentials[idx].password_encrypted = encrypted;
      credentials[idx].updated_at = now;
    } else {
      dbg('save() adding new credential (total will be', credentials.length + 1, ')');
      credentials.push({
        domain: sanitizedDomain,
        username: sanitizedUsername,
        password_encrypted: encrypted,
        updated_at: now,
      });
    }

    this.persist(credentials);
    dbg('save() completed successfully');
  }

  get(domain: string): { username: string; password: string }[] {
    dbg('get() called for domain:', domain);
    if (!this.isAvailable()) { dbg('get() ABORTED: encryption not available'); return []; }
    if (!domain || typeof domain !== 'string') { dbg('get() ABORTED: invalid domain:', typeof domain, domain); return []; }

    const sanitizedDomain = domain.trim().toLowerCase();
    const credentials = this.load();
    dbg('get() searching', credentials.length, 'credentials for domain:', sanitizedDomain);
    const results: { username: string; password: string }[] = [];

    for (const c of credentials) {
      if (c.domain !== sanitizedDomain) {
        dbg('get() skipping non-matching domain:', c.domain);
        continue;
      }
      try {
        dbg('get() decrypting credential for', c.username, '@ ', c.domain,
          'encrypted length:', c.password_encrypted?.length);
        const password = safeStorage.decryptString(
          Buffer.from(c.password_encrypted, 'base64')
        );
        dbg('get() decrypted successfully, password length:', password.length);
        results.push({ username: c.username, password });
      } catch (err) {
        // Individual credential decryption failure — skip corrupted entry
        console.error(`[CredentialStore] Failed to decrypt credential for ${c.username}@${c.domain}:`, err);
        dbg('get() decryption FAILED for', c.username, '@', c.domain, ':', err);
      }
    }

    dbg('get() returning', results.length, 'credentials for', sanitizedDomain);
    return results;
  }

  delete(domain: string, username: string): void {
    dbg('delete() called for', username, '@', domain);
    if (!domain || typeof domain !== 'string') return;
    if (!username || typeof username !== 'string') return;

    const sanitizedDomain = domain.trim().toLowerCase();
    const sanitizedUsername = username.trim();

    const before = this.load();
    const credentials = before.filter(
      (c) => !(c.domain === sanitizedDomain && c.username === sanitizedUsername)
    );
    dbg('delete() removed', before.length - credentials.length, 'entries, remaining:', credentials.length);
    this.persist(credentials);
  }

  list(): { domain: string; username: string; updated_at: string }[] {
    return this.load().map((c) => ({
      domain: c.domain,
      username: c.username,
      updated_at: c.updated_at,
    }));
  }
}

export { CredentialStore };

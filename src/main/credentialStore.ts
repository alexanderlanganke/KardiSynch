import { safeStorage, app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

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
    return safeStorage.isEncryptionAvailable();
  }

  private load(): StoredCredential[] {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data) as Partial<CredentialFile>;

      // Support legacy format (no version/checksum)
      if (!parsed.version) {
        const legacy = parsed as any;
        return Array.isArray(legacy.credentials) ? legacy.credentials : [];
      }

      const credentials = Array.isArray(parsed.credentials) ? parsed.credentials : [];

      // Verify integrity checksum if present
      if (parsed.checksum) {
        const computed = this.computeChecksum(credentials);
        if (parsed.checksum !== computed) {
          console.error('[CredentialStore] Integrity check failed — file may have been tampered with');
          return [];
        }
      }

      return credentials;
    } catch {
      return [];
    }
  }

  private persist(credentials: StoredCredential[]): void {
    const fileData: CredentialFile = {
      version: 1,
      checksum: this.computeChecksum(credentials),
      credentials,
    };

    const json = JSON.stringify(fileData, null, 2);

    // Atomic write: write to temp file, then rename
    const tmpPath = this.filePath + '.tmp.' + crypto.randomBytes(4).toString('hex');
    try {
      fs.writeFileSync(tmpPath, json, { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
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
    if (!this.isAvailable()) {
      throw new Error('Encryption not available — OS keychain is unavailable');
    }

    // Input validation
    if (!domain || typeof domain !== 'string') throw new Error('Invalid domain');
    if (!username || typeof username !== 'string') throw new Error('Invalid username');
    if (!password || typeof password !== 'string') throw new Error('Invalid password');

    const sanitizedDomain = domain.trim().toLowerCase();
    const sanitizedUsername = username.trim();

    // Length limits
    if (sanitizedDomain.length > 253) throw new Error('Domain too long');
    if (sanitizedUsername.length > 256) throw new Error('Username too long');
    if (password.length > 10000) throw new Error('Password too long');

    const encrypted = safeStorage.encryptString(password).toString('base64');
    const now = new Date().toISOString();

    const credentials = this.load();
    const idx = credentials.findIndex(
      (c) => c.domain === sanitizedDomain && c.username === sanitizedUsername
    );

    if (idx !== -1) {
      credentials[idx].password_encrypted = encrypted;
      credentials[idx].updated_at = now;
    } else {
      credentials.push({
        domain: sanitizedDomain,
        username: sanitizedUsername,
        password_encrypted: encrypted,
        updated_at: now,
      });
    }

    this.persist(credentials);
  }

  get(domain: string): { username: string; password: string }[] {
    if (!this.isAvailable()) return [];
    if (!domain || typeof domain !== 'string') return [];

    const sanitizedDomain = domain.trim().toLowerCase();
    const credentials = this.load();
    const results: { username: string; password: string }[] = [];

    for (const c of credentials) {
      if (c.domain !== sanitizedDomain) continue;
      try {
        const password = safeStorage.decryptString(
          Buffer.from(c.password_encrypted, 'base64')
        );
        results.push({ username: c.username, password });
      } catch (err) {
        // Individual credential decryption failure — skip corrupted entry
        console.error(`[CredentialStore] Failed to decrypt credential for ${c.username}@${c.domain}:`, err);
      }
    }

    return results;
  }

  delete(domain: string, username: string): void {
    if (!domain || typeof domain !== 'string') return;
    if (!username || typeof username !== 'string') return;

    const sanitizedDomain = domain.trim().toLowerCase();
    const sanitizedUsername = username.trim();

    const credentials = this.load().filter(
      (c) => !(c.domain === sanitizedDomain && c.username === sanitizedUsername)
    );
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

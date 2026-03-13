import { safeStorage, app } from 'electron';
import path from 'path';
import fs from 'fs';

interface StoredCredential {
  domain: string;
  username: string;
  password_encrypted: string; // base64 of safeStorage buffer
  updated_at: string;
}

class CredentialStore {
  private static instance: CredentialStore;
  private filePath: string;
  private credentials: StoredCredential[] = [];

  private constructor() {
    this.filePath = path.join(app.getPath('userData'), 'credentials.enc.json');
    this.load();
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

  private load(): void {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.credentials = Array.isArray(parsed.credentials) ? parsed.credentials : [];
    } catch {
      this.credentials = [];
    }
  }

  private persist(): void {
    fs.writeFileSync(
      this.filePath,
      JSON.stringify({ credentials: this.credentials }, null, 2),
      'utf-8'
    );
  }

  save(domain: string, username: string, password: string): void {
    if (!this.isAvailable()) {
      throw new Error('Encryption not available — OS keychain is unavailable');
    }
    const encrypted = safeStorage.encryptString(password).toString('base64');
    const now = new Date().toISOString();

    const idx = this.credentials.findIndex(
      (c) => c.domain === domain && c.username === username
    );
    if (idx !== -1) {
      this.credentials[idx].password_encrypted = encrypted;
      this.credentials[idx].updated_at = now;
    } else {
      this.credentials.push({
        domain,
        username,
        password_encrypted: encrypted,
        updated_at: now,
      });
    }
    this.persist();
  }

  get(domain: string): { username: string; password: string }[] {
    if (!this.isAvailable()) return [];
    return this.credentials
      .filter((c) => c.domain === domain)
      .map((c) => ({
        username: c.username,
        password: safeStorage.decryptString(Buffer.from(c.password_encrypted, 'base64')),
      }));
  }

  delete(domain: string, username: string): void {
    this.credentials = this.credentials.filter(
      (c) => !(c.domain === domain && c.username === username)
    );
    this.persist();
  }

  list(): { domain: string; username: string; updated_at: string }[] {
    return this.credentials.map((c) => ({
      domain: c.domain,
      username: c.username,
      updated_at: c.updated_at,
    }));
  }
}

export { CredentialStore };

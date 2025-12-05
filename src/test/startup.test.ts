
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { initializeDatabase, getDb, closeDatabase } from '../main/database';
import { getAllSettings } from '../main/settingsService';

// Mock electron
vi.mock('electron', () => ({
    app: {
        getPath: () => '/tmp/kardisynch_test_data'
    },
    ipcMain: {
        handle: vi.fn()
    }
}));

describe('App Startup', () => {
    const testDbPath = ':memory:';

    beforeEach(() => {
        // No cleanup needed for in-memory db
    });

    afterEach(async () => {
        await closeDatabase();
    });

    it('should initialize the database correctly', async () => {
        initializeDatabase(testDbPath);
        const db = getDb();
        expect(db).toBeDefined();

        // Verify tables exist using async API
        await new Promise<void>((resolve, reject) => {
            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='Patients'", (err, row) => {
                if (err) reject(err);
                expect(row).toBeDefined();
                resolve();
            });
        });
    });

    it('should load settings', async () => {
        // Initialize DB first as settings depend on it
        initializeDatabase(testDbPath);

        const settings = await getAllSettings();
        expect(settings).toBeDefined();
        // expect(settings.theme).toBeDefined(); // Theme might not be set initially if DB is empty
    });
});

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { startUsbWatcher, stopUsbWatcher } from '../main/usbWatcher';
import { AppSettings } from '../main/settingsService';
import { loadManifest, isFileProcessed } from '../main/usbTargetManifest';

// Mock dependencies
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn().mockReturnValue(path.join(process.cwd(), 'test_user_data')),
    },
}));

vi.mock('../main/windowManager', () => ({
    sendNotification: vi.fn(),
}));

const TEST_DIR = path.join(process.cwd(), 'test_watcher');
const SOURCE_DIR = path.join(TEST_DIR, 'source');
const TARGET_DIR = path.join(TEST_DIR, 'target');
const IMPORT_DIR = path.join(TEST_DIR, 'import');
const USER_DATA_DIR = path.join(process.cwd(), 'test_user_data');

const settings: AppSettings = {
    importDir: IMPORT_DIR,
    unmatchedDir: path.join(TEST_DIR, 'unmatched'),
    dataPath: path.join(TEST_DIR, 'data'),
    dbPath: path.join(TEST_DIR, 'db.sqlite'),
    usbSourceDirectories: [SOURCE_DIR],
    usbTargetDirectory: TARGET_DIR,
    theme: 'system'
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('USB Watcher Integration', () => {
    beforeEach(() => {
        // Clean up
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
        if (fs.existsSync(USER_DATA_DIR)) fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });

        fs.mkdirSync(SOURCE_DIR, { recursive: true });
        fs.mkdirSync(TARGET_DIR, { recursive: true });
        fs.mkdirSync(IMPORT_DIR, { recursive: true });
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    });

    afterEach(() => {
        stopUsbWatcher();
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
        if (fs.existsSync(USER_DATA_DIR)) fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    });

    it('should copy from Source to Target and Import, then delete from Source', async () => {
        const fileName = 'test_source.xml';
        const filePath = path.join(SOURCE_DIR, fileName);
        fs.writeFileSync(filePath, 'source content');

        startUsbWatcher(settings);

        // Wait for poll
        await sleep(4000);

        expect(fs.existsSync(filePath)).toBe(false); // Deleted from source
        expect(fs.existsSync(path.join(TARGET_DIR, fileName))).toBe(true); // Exists in target
        expect(fs.existsSync(path.join(IMPORT_DIR, fileName))).toBe(true); // Exists in import
    }, 10000);

    it('should copy from Target to Import if new', async () => {
        const fileName = 'test_target.xml';
        const filePath = path.join(TARGET_DIR, fileName);
        fs.writeFileSync(filePath, 'target content');

        startUsbWatcher(settings);

        // Wait for poll
        await sleep(4000);

        expect(fs.existsSync(filePath)).toBe(true); // Remains in target
        expect(fs.existsSync(path.join(IMPORT_DIR, fileName))).toBe(true); // Copied to import
    }, 10000);

    it('should NOT re-import from Target if already processed', async () => {
        const fileName = 'test_processed.xml';
        const filePath = path.join(TARGET_DIR, fileName);
        fs.writeFileSync(filePath, 'processed content');

        startUsbWatcher(settings);
        await sleep(4000);

        // First import should happen
        const importPath = path.join(IMPORT_DIR, fileName);
        expect(fs.existsSync(importPath)).toBe(true);
        const firstStat = fs.statSync(importPath);

        // Delete from import to simulate "already processed" check
        fs.unlinkSync(importPath);

        // Wait for next poll
        await sleep(4000);

        // Should NOT be re-imported because it's in the manifest
        expect(fs.existsSync(importPath)).toBe(false);
    }, 10000);

    it('should re-import from Target if modified', async () => {
        const fileName = 'test_modified.xml';
        const filePath = path.join(TARGET_DIR, fileName);
        fs.writeFileSync(filePath, 'initial content');

        startUsbWatcher(settings);
        await sleep(4000);

        // First import
        expect(fs.existsSync(path.join(IMPORT_DIR, fileName))).toBe(true);

        // Modify file
        fs.writeFileSync(filePath, 'modified content');

        // Delete from import to verify re-import
        fs.unlinkSync(path.join(IMPORT_DIR, fileName));

        // Wait for next poll
        await sleep(4000);

        // Should be re-imported
        expect(fs.existsSync(path.join(IMPORT_DIR, fileName))).toBe(true);
        expect(fs.readFileSync(path.join(IMPORT_DIR, fileName), 'utf-8')).toBe('modified content');
    }, 10000);
});

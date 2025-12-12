import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { handleSourceFile, handleTargetFile, startUsbWatcher } from '../usbWatcher';
import * as usbTargetManifest from '../usbTargetManifest';
import * as windowManager from '../windowManager';

// Mock dependencies
vi.mock('fs');
vi.mock('path');
vi.mock('../usbTargetManifest');
vi.mock('../windowManager');

// Mock console to keep test output clean
const originalConsole = { ...console };
beforeEach(() => {
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
});
afterEach(() => {
    console = { ...originalConsole };
    vi.clearAllMocks();
});

describe('UsbWatcher Logic', () => {
    const mockSettings = {
        usbSourceDirectories: ['/usb/source'],
        usbTargetDirectory: '/app/target',
        importDir: '/app/import',
        // other settings...
    } as any;

    // Helper to setup the simpler mocks
    beforeEach(() => {
        // Reset mocks
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.statSync).mockReturnValue({ size: 100, mtimeMs: 1000 } as any);
        vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
        vi.mocked(fs.copyFileSync).mockReturnValue(undefined);
        vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

        // Mock path methods simple implementation for logic strings
        vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
        vi.mocked(path.dirname).mockImplementation((p) => p.split('/').slice(0, -1).join('/'));
        vi.mocked(path.relative).mockImplementation((from, to) => to.replace(from + '/', ''));
        vi.mocked(path.basename).mockImplementation((p) => p.split('/').pop() || '');

        // Initialize watcher with settings to set currentSettings variable
        startUsbWatcher(mockSettings);
    });

    describe('handleSourceFile (USB -> Target)', () => {
        it('should copy file to target and delete from source', async () => {
            const filePath = '/usb/source/subdir/test.txt';
            const sourceBase = '/usb/source';

            // Setup strict mocks for this test
            vi.mocked(fs.existsSync).mockReturnValue(true); // file exists
            // Stability check mocks (isFileStable calls statSync)
            vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as any);

            await handleSourceFile(filePath, sourceBase);

            // Expect copy to target (preserving structure)
            expect(fs.copyFileSync).toHaveBeenCalledWith(
                '/usb/source/subdir/test.txt',
                '/app/target/subdir/test.txt'
            );

            // Expect verification check (statSync called on target)
            expect(fs.statSync).toHaveBeenCalledWith('/app/target/subdir/test.txt');

            // Expect deletion from source
            expect(fs.unlinkSync).toHaveBeenCalledWith('/usb/source/subdir/test.txt');

            // Expect NO copy to import
            expect(fs.copyFileSync).not.toHaveBeenCalledWith(
                expect.anything(),
                expect.stringContaining('/app/import')
            );

            // Expect NO markFileProcessed
            expect(usbTargetManifest.markFileProcessed).not.toHaveBeenCalled();
        });

        it('should NOT delete from source if copy verification fails', async () => {
            const filePath = '/usb/source/fail.txt';
            const sourceBase = '/usb/source';

            vi.mocked(fs.statSync).mockImplementation((p) => {
                if (p === filePath) return { size: 100 } as any;
                if (p === '/app/target/fail.txt') return { size: 0 } as any; // Copy failed/corrupt
                return { size: 100 } as any;
            });

            await handleSourceFile(filePath, sourceBase);

            expect(fs.copyFileSync).toHaveBeenCalled();
            expect(fs.unlinkSync).not.toHaveBeenCalled();
            expect(windowManager.sendNotification).toHaveBeenCalledWith(expect.stringContaining('Verification failed'), 'error');
        });
    });

    describe('handleTargetFile (Target -> Import)', () => {
        it('should copy to import (preserving structure) if not processed', async () => {
            const filePath = '/app/target/subdir/doc.pdf';
            const targetBase = '/app/target';

            // Mock it is NOT processed yet
            vi.mocked(usbTargetManifest.isFileProcessed).mockReturnValue(false);

            // Mock directory does NOT exist so mkdirSync is called
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/app/import/subdir') return false;
                return true;
            });

            await handleTargetFile(filePath, targetBase);

            // Expect copy to import preserving structure
            expect(fs.copyFileSync).toHaveBeenCalledWith(
                '/app/target/subdir/doc.pdf',
                '/app/import/subdir/doc.pdf'
            );

            // Expect directory creation for import
            expect(fs.mkdirSync).toHaveBeenCalledWith('/app/import/subdir', { recursive: true });

            // Expect markFileProcessed TO BE called
            expect(usbTargetManifest.markFileProcessed).toHaveBeenCalled();

            // Expect NO DELETION from target
            expect(fs.unlinkSync).not.toHaveBeenCalled();
        });

        it('should skip if already processed', async () => {
            const filePath = '/app/target/old.pdf';
            const targetBase = '/app/target';

            vi.mocked(usbTargetManifest.isFileProcessed).mockReturnValue(true);

            await handleTargetFile(filePath, targetBase);

            expect(fs.copyFileSync).not.toHaveBeenCalled();
            expect(usbTargetManifest.markFileProcessed).not.toHaveBeenCalled();
        });
    });
});

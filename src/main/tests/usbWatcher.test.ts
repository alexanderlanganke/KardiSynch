import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { handleSourceFile, handleTargetFile, startUsbWatcher } from '../usbWatcher';
import * as usbTargetManifest from '../usbTargetManifest';
import * as windowManager from '../windowManager';

// Mock dependencies
vi.mock('fs/promises');
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
        // Reset mocks - use async equivalents
        vi.mocked(fs.access).mockResolvedValue(undefined);
        vi.mocked(fs.stat).mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);
        vi.mocked(fs.mkdir).mockResolvedValue(undefined);
        vi.mocked(fs.copyFile).mockResolvedValue(undefined);
        vi.mocked(fs.unlink).mockResolvedValue(undefined);
        vi.mocked(fs.rename).mockResolvedValue(undefined);

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

            // Stability check mocks (isFileStable calls stat)
            vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any);

            await handleSourceFile(filePath, sourceBase);

            // Expect copy to a temporary .part name in target (preserving structure)
            expect(fs.copyFile).toHaveBeenCalledWith(
                '/usb/source/subdir/test.txt',
                '/app/target/subdir/test.txt.part'
            );

            // Expect verification check (stat called on the partial file)
            expect(fs.stat).toHaveBeenCalledWith('/app/target/subdir/test.txt.part');

            // Expect rename to the final name after verification
            expect(fs.rename).toHaveBeenCalledWith(
                '/app/target/subdir/test.txt.part',
                '/app/target/subdir/test.txt'
            );

            // Expect deletion from source
            expect(fs.unlink).toHaveBeenCalledWith('/usb/source/subdir/test.txt');

            // Expect NO copy to import
            expect(fs.copyFile).not.toHaveBeenCalledWith(
                expect.anything(),
                expect.stringContaining('/app/import')
            );

            // Expect NO markFileProcessed
            expect(usbTargetManifest.markFileProcessed).not.toHaveBeenCalled();
        });

        it('should NOT delete from source if copy verification fails', async () => {
            const filePath = '/usb/source/fail.txt';
            const sourceBase = '/usb/source';

            vi.mocked(fs.stat).mockImplementation(async (p) => {
                if (p === filePath) return { size: 100 } as any;
                if (p === '/app/target/fail.txt.part') return { size: 0 } as any; // Copy failed/corrupt
                return { size: 100 } as any;
            });

            await handleSourceFile(filePath, sourceBase);

            expect(fs.copyFile).toHaveBeenCalled();
            // The truncated partial is cleaned up, the source is kept and the
            // final target name is never created.
            expect(fs.unlink).not.toHaveBeenCalledWith(filePath);
            expect(fs.unlink).toHaveBeenCalledWith('/app/target/fail.txt.part');
            expect(fs.rename).not.toHaveBeenCalled();
            expect(windowManager.sendNotification).toHaveBeenCalledWith(expect.stringContaining('Verification failed'), 'error');
        });
    });

    describe('handleTargetFile (Target -> Import)', () => {
        it('should copy to import (preserving structure) if not processed', async () => {
            const filePath = '/app/target/subdir/doc.pdf';
            const targetBase = '/app/target';

            // Mock it is NOT processed yet
            vi.mocked(usbTargetManifest.isFileProcessed).mockReturnValue(false);

            await handleTargetFile(filePath, targetBase);

            // Expect copy to a temporary .part name in import preserving structure
            expect(fs.copyFile).toHaveBeenCalledWith(
                '/app/target/subdir/doc.pdf',
                '/app/import/subdir/doc.pdf.part'
            );

            // Expect rename to the final name after verification
            expect(fs.rename).toHaveBeenCalledWith(
                '/app/import/subdir/doc.pdf.part',
                '/app/import/subdir/doc.pdf'
            );

            // Expect directory creation for import
            expect(fs.mkdir).toHaveBeenCalledWith('/app/import/subdir', { recursive: true });

            // Expect markFileProcessed TO BE called
            expect(usbTargetManifest.markFileProcessed).toHaveBeenCalled();

            // Expect NO DELETION from target
            expect(fs.unlink).not.toHaveBeenCalled();
        });

        it('should skip if already processed', async () => {
            const filePath = '/app/target/old.pdf';
            const targetBase = '/app/target';

            vi.mocked(usbTargetManifest.isFileProcessed).mockReturnValue(true);

            await handleTargetFile(filePath, targetBase);

            expect(fs.copyFile).not.toHaveBeenCalled();
            expect(usbTargetManifest.markFileProcessed).not.toHaveBeenCalled();
        });
    });
});

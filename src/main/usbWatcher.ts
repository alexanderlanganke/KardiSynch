import fs from 'fs/promises';
import path from 'path';
import { AppSettings } from './settingsService';
import { loadManifest, isFileProcessed, markFileProcessed } from './usbTargetManifest';
import { sendNotification } from './windowManager';

let isPolling = false;
let pollRunning = false;
let pollingInterval: NodeJS.Timeout | null = null;
let currentSettings: AppSettings | null = null;

/** Wrap a promise with a timeout so network/USB hangs don't block polling indefinitely. */
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
        promise.then(
            (val) => { clearTimeout(timer); resolve(val); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
};
const FS_TIMEOUT = 10000; // 10s for individual fs operations (stat, access, readdir)
const COPY_TIMEOUT = 120000; // 2min for file copies (large files on slow media)

export const startUsbWatcher = (settings: AppSettings) => {
    stopUsbWatcher();
    currentSettings = settings;

    // Load manifest on start
    loadManifest();

    const hasSource = settings.usbSourceDirectories && settings.usbSourceDirectories.length > 0;
    const hasTarget = !!settings.usbTargetDirectory;

    if (!hasSource && !hasTarget) {
        return;
    }

    console.log('[UsbWatcher] Starting watcher...');
    if (hasSource) {
        console.log('[UsbWatcher] Sources:', settings.usbSourceDirectories);
    }
    if (hasTarget) {
        console.log('[UsbWatcher] Target:', settings.usbTargetDirectory);
    }
    console.log('[UsbWatcher] Import:', settings.importDir);

    isPolling = true;
    // Initial poll
    poll();
    // Poll every 3 seconds (skips if previous poll is still running)
    pollingInterval = setInterval(poll, 3000);
};

export const stopUsbWatcher = () => {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    isPolling = false;
    console.log('[UsbWatcher] Stopped.');
};

const poll = async () => {
    if (!currentSettings || !isPolling) return;

    // Prevent concurrent polls — if a previous poll is still running, skip this cycle
    if (pollRunning) return;
    pollRunning = true;

    try {
        // Source → Target: only if both source directories and target directory are configured
        if (currentSettings.usbSourceDirectories && currentSettings.usbSourceDirectories.length > 0 && currentSettings.usbTargetDirectory) {
            for (const sourceDir of currentSettings.usbSourceDirectories) {
                if (!isPolling) break;
                try {
                    await withTimeout(fs.access(sourceDir), FS_TIMEOUT);
                    try {
                        await processSourceDirectory(sourceDir, sourceDir);
                    } catch (error) {
                        console.error(`[UsbWatcher] Error processing source ${sourceDir}:`, error);
                    }
                } catch {
                    // Source doesn't exist or timed out (removable/network drive)
                }
            }
        }

        // Target → Import: only if target directory is configured
        if (currentSettings.usbTargetDirectory && isPolling) {
            try {
                await withTimeout(fs.access(currentSettings.usbTargetDirectory), FS_TIMEOUT);
                try {
                    await processTargetDirectory(currentSettings.usbTargetDirectory, currentSettings.usbTargetDirectory);
                } catch (error) {
                    console.error(`[UsbWatcher] Error processing target ${currentSettings.usbTargetDirectory}:`, error);
                }
            } catch {
                // Target doesn't exist or timed out (directory not accessible)
            }
        }
    } finally {
        pollRunning = false;
    }
};

const processSourceDirectory = async (currentDir: string, sourceBase: string) => {
    let files: import('fs').Dirent[];
    try {
        files = await withTimeout(fs.readdir(currentDir, { withFileTypes: true }), FS_TIMEOUT);
    } catch (e) {
        console.warn(`[UsbWatcher] Cannot read source directory ${currentDir}:`, (e as Error).message);
        return;
    }

    for (const file of files) {
        if (!isPolling) break;
        const fullPath = path.join(currentDir, file.name);
        if (file.isDirectory()) {
            await processSourceDirectory(fullPath, sourceBase);
        } else if (file.isFile()) {
            await handleSourceFile(fullPath, sourceBase);
        }
    }
};

const processTargetDirectory = async (currentDir: string, targetBase: string) => {
    let files: import('fs').Dirent[];
    try {
        files = await withTimeout(fs.readdir(currentDir, { withFileTypes: true }), FS_TIMEOUT);
    } catch (e) {
        console.warn(`[UsbWatcher] Cannot read target directory ${currentDir}:`, (e as Error).message);
        return;
    }

    for (const file of files) {
        if (!isPolling) break;
        const fullPath = path.join(currentDir, file.name);
        if (file.isDirectory()) {
            await processTargetDirectory(fullPath, targetBase);
        } else if (file.isFile()) {
            await handleTargetFile(fullPath, targetBase);
        }
    }
};

const isFileStable = async (filePath: string, interval = 500, maxRetries = 10): Promise<boolean> => {
    let retries = 0;
    let lastSize = -1;

    while (retries < maxRetries) {
        if (!isPolling) return false;
        try {
            const stats = await withTimeout(fs.stat(filePath), FS_TIMEOUT);
            const currentSize = stats.size;

            if (currentSize === 0) {
                console.warn(`[UsbWatcher] Skipping zero-byte file: ${filePath}`);
                return false;
            }

            if (currentSize === lastSize) {
                return true; // Stable
            }

            lastSize = currentSize;
            await new Promise(resolve => setTimeout(resolve, interval));
            retries++;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return false;
            }
            console.warn(`[UsbWatcher] Error checking file stability for ${filePath}:`, error);
            return false;
        }
    }
    return false; // Timed out
};

/** Remove empty directories walking up from dir, stopping at (not removing) stopAt. */
const removeEmptyParents = async (dir: string, stopAt: string) => {
    const resolved = path.resolve(dir);
    const stopResolved = path.resolve(stopAt);
    if (resolved === stopResolved || !resolved.startsWith(stopResolved + path.sep)) return;
    try {
        const entries = await fs.readdir(resolved);
        if (entries.length === 0) {
            await fs.rmdir(resolved);
            await removeEmptyParents(path.dirname(resolved), stopAt);
        }
    } catch {
        // Directory not empty, doesn't exist, or permission error — stop
    }
};

export const handleSourceFile = async (filePath: string, sourceBase: string) => {
    if (!currentSettings) return;

    // Source→Target requires a configured target directory
    if (!currentSettings.usbTargetDirectory) {
        console.warn(`[UsbWatcher] Skipping source file ${filePath}: no target directory configured.`);
        return;
    }

    const stable = await isFileStable(filePath);
    if (!stable) {
        try {
            await fs.access(filePath);
            console.warn(`[UsbWatcher] Source file ${filePath} is not stable. Skipping.`);
        } catch {
            // File no longer exists (already processed or removed)
        }
        return;
    }

    const relativePath = path.relative(sourceBase, filePath);
    const targetPath = path.join(currentSettings.usbTargetDirectory, relativePath);

    try {
        const targetDir = path.dirname(targetPath);
        await withTimeout(fs.mkdir(targetDir, { recursive: true }), FS_TIMEOUT);
        await withTimeout(fs.copyFile(filePath, targetPath), COPY_TIMEOUT);

        const sourceStats = await withTimeout(fs.stat(filePath), FS_TIMEOUT);
        const targetStats = await withTimeout(fs.stat(targetPath), FS_TIMEOUT);

        if (targetStats.size === sourceStats.size) {
            await withTimeout(fs.unlink(filePath), FS_TIMEOUT);
            // Clean up empty parent directories up to sourceBase
            await removeEmptyParents(path.dirname(filePath), sourceBase);
            console.log(`[UsbWatcher] Moved source file ${relativePath} to Target.`);
            sendNotification(`Moved from USB to Target: ${path.basename(filePath)}`, 'info');
        } else {
            console.error(`[UsbWatcher] Copy verification failed for ${filePath}.`);
            sendNotification(`Failed to move ${path.basename(filePath)}: Verification failed`, 'error');
        }
    } catch (error) {
        console.error(`[UsbWatcher] Failed to process source file ${filePath}:`, error);
        sendNotification(`Error moving from USB: ${(error as Error).message}`, 'error');
    }
};

export const handleTargetFile = async (filePath: string, targetBase: string) => {
    if (!currentSettings) return;

    const relativePath = path.relative(targetBase, filePath);

    try {
        const stats = await withTimeout(fs.stat(filePath), FS_TIMEOUT);

        if (isFileProcessed(relativePath, stats)) {
            return;
        }

        const stable = await isFileStable(filePath);
        if (!stable) {
            return;
        }

        const stableStats = await withTimeout(fs.stat(filePath), FS_TIMEOUT);

        const importPath = path.join(currentSettings.importDir, relativePath);
        const importDir = path.dirname(importPath);

        await withTimeout(fs.mkdir(importDir, { recursive: true }), FS_TIMEOUT);
        await withTimeout(fs.copyFile(filePath, importPath), COPY_TIMEOUT);

        const importStats = await withTimeout(fs.stat(importPath), FS_TIMEOUT);
        if (importStats.size === stableStats.size) {
            console.log(`[UsbWatcher] Copied target file ${relativePath} to Import.`);
            markFileProcessed(relativePath, stableStats);
            sendNotification(`Copied to Import: ${path.basename(filePath)}`, 'info');
        } else {
            console.error(`[UsbWatcher] Copy verification failed for target file ${filePath}.`);
            sendNotification(`Failed to copy ${path.basename(filePath)}: Verification failed`, 'error');
        }
    } catch (error) {
        console.error(`[UsbWatcher] Failed to process target file ${filePath}:`, error);
        sendNotification(`Error copying to Import: ${(error as Error).message}`, 'error');
    }
};

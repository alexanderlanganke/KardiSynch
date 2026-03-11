import fs from 'fs/promises';
import path from 'path';
import { AppSettings } from './settingsService';
import { loadManifest, isFileProcessed, markFileProcessed } from './usbTargetManifest';
import { sendNotification } from './windowManager';

let isPolling = false;
let pollingInterval: NodeJS.Timeout | null = null;
let currentSettings: AppSettings | null = null;

export const startUsbWatcher = (settings: AppSettings) => {
    stopUsbWatcher();
    currentSettings = settings;

    // Load manifest on start
    loadManifest();

    if ((!settings.usbSourceDirectories || settings.usbSourceDirectories.length === 0) && !settings.usbTargetDirectory) {
        return;
    }

    console.log('[UsbWatcher] Starting watcher...');
    if (settings.usbSourceDirectories) {
        console.log('[UsbWatcher] Sources:', settings.usbSourceDirectories);
    }
    if (settings.usbTargetDirectory) {
        console.log('[UsbWatcher] Target:', settings.usbTargetDirectory);
    }
    console.log('[UsbWatcher] Import:', settings.importDir);

    isPolling = true;
    // Initial poll
    poll();
    // Poll every 3 seconds
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

    if (currentSettings.usbSourceDirectories) {
        for (const sourceDir of currentSettings.usbSourceDirectories) {
            try {
                await fs.access(sourceDir);
                try {
                    await processSourceDirectory(sourceDir, sourceDir);
                } catch (error) {
                    console.error(`[UsbWatcher] Error processing source ${sourceDir}:`, error);
                }
            } catch {
                // Source doesn't exist (removable drive)
            }
        }
    }

    if (currentSettings.usbTargetDirectory) {
        try {
            await fs.access(currentSettings.usbTargetDirectory);
            try {
                await processTargetDirectory(currentSettings.usbTargetDirectory, currentSettings.usbTargetDirectory);
            } catch (error) {
                console.error(`[UsbWatcher] Error processing target ${currentSettings.usbTargetDirectory}:`, error);
            }
        } catch {
            // Target doesn't exist
        }
    }
};

const processSourceDirectory = async (currentDir: string, sourceBase: string) => {
    let files: import('fs').Dirent[];
    try {
        files = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (e) {
        return;
    }

    for (const file of files) {
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
        files = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (e) {
        return;
    }

    for (const file of files) {
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
        try {
            const stats = await fs.stat(filePath);
            const currentSize = stats.size;

            if (currentSize === lastSize && currentSize > 0) {
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

export const handleSourceFile = async (filePath: string, sourceBase: string) => {
    if (!currentSettings) return;

    const stable = await isFileStable(filePath);
    if (!stable) {
        try {
            await fs.access(filePath);
            console.warn(`[UsbWatcher] Source file ${filePath} is not stable. Skipping.`);
        } catch {
            // File doesn't exist
        }
        return;
    }

    const relativePath = path.relative(sourceBase, filePath);
    const targetPath = path.join(currentSettings.usbTargetDirectory, relativePath);

    try {
        const targetDir = path.dirname(targetPath);
        await fs.mkdir(targetDir, { recursive: true });
        await fs.copyFile(filePath, targetPath);

        const sourceStats = await fs.stat(filePath);
        const targetStats = await fs.stat(targetPath);

        if (targetStats.size === sourceStats.size) {
            await fs.unlink(filePath);
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
        const stats = await fs.stat(filePath);

        if (isFileProcessed(relativePath, stats)) {
            return;
        }

        const stable = await isFileStable(filePath);
        if (!stable) {
            return;
        }

        const stableStats = await fs.stat(filePath);

        const importPath = path.join(currentSettings.importDir, relativePath);
        const importDir = path.dirname(importPath);

        await fs.mkdir(importDir, { recursive: true });
        await fs.copyFile(filePath, importPath);

        const importStats = await fs.stat(importPath);
        if (importStats.size === stableStats.size) {
            console.log(`[UsbWatcher] Copied target file ${relativePath} to Import.`);
            markFileProcessed(relativePath, stableStats);
        } else {
            console.error(`[UsbWatcher] Copy verification failed for target file ${filePath}.`);
        }
    } catch (error) {
        console.error(`[UsbWatcher] Failed to process target file ${filePath}:`, error);
    }
};


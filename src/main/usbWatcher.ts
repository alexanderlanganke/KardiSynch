import fs from 'fs';
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

    // 1. Process Source Directories (Move to Target & Import)
    if (currentSettings.usbSourceDirectories) {
        for (const sourceDir of currentSettings.usbSourceDirectories) {
            // Check if source exists (it might be a removable drive)
            if (fs.existsSync(sourceDir)) {
                try {
                    processSourceDirectory(sourceDir, sourceDir);
                } catch (error) {
                    console.error(`[UsbWatcher] Error processing source ${sourceDir}:`, error);
                }
            }
        }
    }

    // 2. Process Target Directory (Copy to Import if new)
    if (currentSettings.usbTargetDirectory && fs.existsSync(currentSettings.usbTargetDirectory)) {
        try {
            processTargetDirectory(currentSettings.usbTargetDirectory, currentSettings.usbTargetDirectory);
        } catch (error) {
            console.error(`[UsbWatcher] Error processing target ${currentSettings.usbTargetDirectory}:`, error);
        }
    }
};

const processSourceDirectory = (currentDir: string, sourceBase: string) => {
    let files: fs.Dirent[];
    try {
        files = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
        return;
    }

    for (const file of files) {
        const fullPath = path.join(currentDir, file.name);

        if (file.isDirectory()) {
            processSourceDirectory(fullPath, sourceBase);
        } else if (file.isFile()) {
            handleSourceFile(fullPath, sourceBase);
        }
    }
};

const processTargetDirectory = (currentDir: string, targetBase: string) => {
    let files: fs.Dirent[];
    try {
        files = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
        return;
    }

    for (const file of files) {
        const fullPath = path.join(currentDir, file.name);

        if (file.isDirectory()) {
            processTargetDirectory(fullPath, targetBase);
        } else if (file.isFile()) {
            handleTargetFile(fullPath, targetBase);
        }
    }
};

const isFileStable = async (filePath: string, interval = 500, maxRetries = 10): Promise<boolean> => {
    let retries = 0;
    let lastSize = -1;

    while (retries < maxRetries) {
        try {
            const stats = fs.statSync(filePath);
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

const handleSourceFile = async (filePath: string, sourceBase: string) => {
    if (!currentSettings) return;

    // Check stability first
    const stable = await isFileStable(filePath);
    if (!stable) {
        if (fs.existsSync(filePath)) {
            console.warn(`[UsbWatcher] Source file ${filePath} is not stable. Skipping.`);
        }
        return;
    }

    const relativePath = path.relative(sourceBase, filePath);
    const targetPath = path.join(currentSettings.usbTargetDirectory, relativePath);
    const importPath = path.join(currentSettings.importDir, path.basename(filePath));

    try {
        // 1. Copy to Target (Preserve Structure)
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.copyFileSync(filePath, targetPath);

        // 2. Copy to Import Directory (Flat)
        if (!fs.existsSync(currentSettings.importDir)) {
            fs.mkdirSync(currentSettings.importDir, { recursive: true });
        }
        fs.copyFileSync(filePath, importPath);

        // 3. Verify Copy Success before Deletion
        const sourceStats = fs.statSync(filePath);
        const targetStats = fs.statSync(targetPath);
        const importStats = fs.statSync(importPath);

        if (targetStats.size === sourceStats.size && importStats.size === sourceStats.size) {
            // 4. Delete from Source
            fs.unlinkSync(filePath);
            console.log(`[UsbWatcher] Moved source file ${relativePath} to Target and Import.`);
            sendNotification(`Imported from USB: ${path.basename(filePath)}`, 'info');

            // Mark as processed in manifest so we don't re-process it from target immediately
            markFileProcessed(relativePath, targetStats);
        } else {
            console.error(`[UsbWatcher] Copy verification failed for ${filePath}.`);
            sendNotification(`Failed to import ${path.basename(filePath)}: Verification failed`, 'error');
        }

    } catch (error) {
        console.error(`[UsbWatcher] Failed to process source file ${filePath}:`, error);
        sendNotification(`Error importing from USB: ${(error as Error).message}`, 'error');
    }
};

const handleTargetFile = async (filePath: string, targetBase: string) => {
    if (!currentSettings) return;

    const relativePath = path.relative(targetBase, filePath);

    try {
        const stats = fs.statSync(filePath);

        // Check if already processed
        if (isFileProcessed(relativePath, stats)) {
            return;
        }

        // Check stability
        const stable = await isFileStable(filePath);
        if (!stable) {
            return;
        }

        // Re-check stats after stability check to be sure
        const stableStats = fs.statSync(filePath);

        const importPath = path.join(currentSettings.importDir, path.basename(filePath));

        // Copy to Import Directory
        if (!fs.existsSync(currentSettings.importDir)) {
            fs.mkdirSync(currentSettings.importDir, { recursive: true });
        }
        fs.copyFileSync(filePath, importPath);

        // Verify
        const importStats = fs.statSync(importPath);
        if (importStats.size === stableStats.size) {
            console.log(`[UsbWatcher] Copied target file ${relativePath} to Import.`);
            // Mark as processed
            markFileProcessed(relativePath, stableStats);
        } else {
            console.error(`[UsbWatcher] Copy verification failed for target file ${filePath}.`);
        }

    } catch (error) {
        console.error(`[UsbWatcher] Failed to process target file ${filePath}:`, error);
    }
};


import fs from 'fs';
import path from 'path';
import { AppSettings } from './settingsService';

let isPolling = false;
let pollingInterval: NodeJS.Timeout | null = null;
let currentSettings: AppSettings | null = null;

export const startUsbWatcher = (settings: AppSettings) => {
    stopUsbWatcher();
    currentSettings = settings;

    if (!settings.usbSourceDirectories || settings.usbSourceDirectories.length === 0) {
        return;
    }
    if (!settings.usbTargetDirectory) {
        return;
    }

    console.log('[UsbWatcher] Starting watcher...');
    console.log('[UsbWatcher] Sources:', settings.usbSourceDirectories);
    console.log('[UsbWatcher] Target:', settings.usbTargetDirectory);
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

    for (const sourceDir of currentSettings.usbSourceDirectories) {
        // Check if source exists (it might be a removable drive)
        if (fs.existsSync(sourceDir)) {
            try {
                processDirectory(sourceDir, sourceDir);
            } catch (error) {
                console.error(`[UsbWatcher] Error processing ${sourceDir}:`, error);
            }
        }
    }
};

const processDirectory = (currentDir: string, sourceBase: string) => {
    let files: fs.Dirent[];
    try {
        files = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
        // Directory might have disappeared or access denied
        return;
    }

    for (const file of files) {
        const fullPath = path.join(currentDir, file.name);

        if (file.isDirectory()) {
            processDirectory(fullPath, sourceBase);
        } else if (file.isFile()) {
            handleFile(fullPath, sourceBase);
        }
    }
};

import { sendNotification } from './windowManager';

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
            // If file disappears (ENOENT), it's definitely not stable/ready.
            if (error.code === 'ENOENT') {
                return false;
            }
            console.warn(`[UsbWatcher] Error checking file stability for ${filePath}:`, error);
            return false;
        }
    }
    return false; // Timed out
};

const handleFile = async (filePath: string, sourceBase: string) => {
    if (!currentSettings) return;

    // Check stability first
    const stable = await isFileStable(filePath);
    if (!stable) {
        // Only warn if the file still exists (it might have been deleted/moved)
        if (fs.existsSync(filePath)) {
            console.warn(`[UsbWatcher] File ${filePath} is not stable (still writing?). Skipping.`);
        }
        return;
    }

    const relativePath = path.relative(sourceBase, filePath);
    const targetPath = path.join(currentSettings.usbTargetDirectory, relativePath);

    // For import directory, we flatten the structure to ensure it's picked up easily,
    // or we could preserve it. KardiSynch's main watcher usually handles files in the root of importDir.
    // To avoid collisions, we might want to prepend the source folder name or something, 
    // but for now let's just copy the file name.
    const importPath = path.join(currentSettings.importDir, path.basename(filePath));

    try {
        // 1. Copy to Target (Preserve Structure)
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // Use copyFileSync. If target exists, it will be overwritten.
        fs.copyFileSync(filePath, targetPath);

        // 2. Copy to Import Directory (Flat)
        // Ensure import dir exists
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
            console.log(`[UsbWatcher] Moved ${relativePath} to Target and Import.`);
            sendNotification(`Imported from USB: ${path.basename(filePath)}`, 'info');
        } else {
            console.error(`[UsbWatcher] Copy verification failed for ${filePath}. Sizes do not match.`);
            sendNotification(`Failed to import ${path.basename(filePath)}: Verification failed`, 'error');
        }

    } catch (error) {
        console.error(`[UsbWatcher] Failed to process ${filePath}:`, error);
        sendNotification(`Error importing from USB: ${(error as Error).message}`, 'error');
    }
};

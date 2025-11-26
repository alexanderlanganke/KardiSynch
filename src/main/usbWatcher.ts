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

const handleFile = (filePath: string, sourceBase: string) => {
    if (!currentSettings) return;

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

        // 3. Delete from Source
        fs.unlinkSync(filePath);

        console.log(`[UsbWatcher] Moved ${relativePath} to Target and Import.`);
    } catch (error) {
        console.error(`[UsbWatcher] Failed to process ${filePath}:`, error);
    }
};

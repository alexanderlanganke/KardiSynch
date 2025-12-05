import { app } from 'electron';
import path from 'path';
import fs from 'fs';

const MANIFEST_FILENAME = 'usb_target_manifest.json';

interface FileEntry {
    mtimeMs: number;
    size: number;
}

interface Manifest {
    [relativePath: string]: FileEntry;
}

let manifest: Manifest = {};
let manifestPath: string = '';

const getManifestPath = () => {
    if (!manifestPath) {
        const userDataPath = app.getPath('userData');
        manifestPath = path.join(userDataPath, MANIFEST_FILENAME);
    }
    return manifestPath;
};

export const loadManifest = () => {
    const p = getManifestPath();
    try {
        if (fs.existsSync(p)) {
            const data = fs.readFileSync(p, 'utf-8');
            manifest = JSON.parse(data);
        }
    } catch (error) {
        console.error('[UsbTargetManifest] Error loading manifest:', error);
        manifest = {};
    }
};

export const saveManifest = () => {
    const p = getManifestPath();
    try {
        fs.writeFileSync(p, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch (error) {
        console.error('[UsbTargetManifest] Error saving manifest:', error);
    }
};

export const isFileProcessed = (relativePath: string, stats: fs.Stats): boolean => {
    const entry = manifest[relativePath];
    if (!entry) return false;

    // Check if file has changed since last process
    return entry.size === stats.size && entry.mtimeMs === stats.mtimeMs;
};

export const markFileProcessed = (relativePath: string, stats: fs.Stats) => {
    manifest[relativePath] = {
        mtimeMs: stats.mtimeMs,
        size: stats.size
    };
    saveManifest();
};

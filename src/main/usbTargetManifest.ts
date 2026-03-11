import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import fsAsync from 'fs/promises';

const MANIFEST_FILENAME = 'usb_target_manifest.json';
const MAX_MANIFEST_ENTRIES = 5000;

interface FileEntry {
    mtimeMs: number;
    size: number;
}

interface Manifest {
    [relativePath: string]: FileEntry;
}

let manifest: Manifest = {};
let manifestPath: string = '';
let savePending = false;

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

const scheduleSave = () => {
    if (savePending) return;
    savePending = true;
    // Batch writes — flush on next tick instead of blocking synchronously per file
    setImmediate(async () => {
        savePending = false;
        const p = getManifestPath();
        try {
            await fsAsync.writeFile(p, JSON.stringify(manifest, null, 2), 'utf-8');
        } catch (error) {
            console.error('[UsbTargetManifest] Error saving manifest:', error);
        }
    });
};

/** Remove oldest entries when the manifest exceeds the size limit. */
const pruneManifest = () => {
    const keys = Object.keys(manifest);
    if (keys.length <= MAX_MANIFEST_ENTRIES) return;

    // Sort by mtimeMs ascending (oldest first), remove the oldest half over limit
    const sorted = keys.sort((a, b) => manifest[a].mtimeMs - manifest[b].mtimeMs);
    const toRemove = keys.length - MAX_MANIFEST_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
        delete manifest[sorted[i]];
    }
    console.log(`[UsbTargetManifest] Pruned ${toRemove} old entries (${Object.keys(manifest).length} remaining).`);
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
    pruneManifest();
    scheduleSave();
};

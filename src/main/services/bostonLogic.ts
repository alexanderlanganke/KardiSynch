import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { MRIStatusResult } from './mriLookupService';
import { BostonDeviceData } from './bostonScraper';

// Cache data in memory (optional, but good for perf)
let bostonDataCache: BostonDeviceData[] | null = null;
let lastLoadTime = 0;

const getBostonData = (): BostonDeviceData[] => {
    // Reload if cache is empty or old (e.g. > 1 hour)
    if (!bostonDataCache || Date.now() - lastLoadTime > 3600000) {
        try {
            const p = path.join(app.getPath('userData'), 'boston_data.json');
            if (fs.existsSync(p)) {
                bostonDataCache = JSON.parse(fs.readFileSync(p, 'utf8'));
                lastLoadTime = Date.now();
            } else {
                return [];
            }
        } catch (e) {
            console.error('[Boston Logic] Failed to load data:', e);
            return [];
        }
    }
    return bostonDataCache || [];
};

export async function checkBoston(model: string, leads: any[]): Promise<MRIStatusResult> {
    const data = getBostonData();
    if (data.length === 0) {
        return {
            manufacturer: 'Boston Scientific',
            status: 'unknown',
            details: 'Local database empty. Please run update.',
            timestamp: new Date().toISOString()
        };
    }

    const clean = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetModel = clean(model);

    // 1. Find Device
    const deviceMatch = data.find(d =>
        (d.type === 'generator' || d.type === 'sicd' || d.type === 'icm') &&
        d.modelNumbers.some(m => clean(m) === targetModel || targetModel.includes(clean(m)))
    );

    if (!deviceMatch) {
        return {
            manufacturer: 'Boston Scientific',
            status: 'unknown',
            details: `Device model '${model}' not found in MR-Conditional list.`,
            timestamp: new Date().toISOString()
        };
    }

    // 2. Leadless / S-ICD / ICM Checks
    if (deviceMatch.type === 'icm') {
        return {
            manufacturer: 'Boston Scientific',
            status: 'conditional',
            details: `System is MR Conditional (ICM). Device: ${deviceMatch.modelName} (${deviceMatch.mriModality}).`,
            timestamp: new Date().toISOString()
        };
    }

    if (deviceMatch.type === 'sicd') {
        // S-ICD usually conditional, check lead? S-ICD lead usually implies match if device is S-ICD.
        // Assuming Standard S-ICD lead (Embark/Icon).
        return {
            manufacturer: 'Boston Scientific',
            status: 'conditional',
            details: `System is MR Conditional (S-ICD). Device: ${deviceMatch.modelName} (${deviceMatch.mriModality}). Check local lead placement.`,
            timestamp: new Date().toISOString()
        };
    }

    // 3. Check Leads (for Pacemaker/ICD)
    if (leads.length === 0) {
        return {
            manufacturer: 'Boston Scientific',
            status: 'unknown',
            details: `Device (${deviceMatch.modelName}) found, but no leads recorded.`,
            timestamp: new Date().toISOString()
        };
    }

    const unknownLeads: string[] = [];
    const incompatibleLeads: string[] = [];
    let systemModality = deviceMatch.mriModality;

    // Helper to intersect modalities: "1.5T & 3T" vs "1.5T" -> "1.5T"
    // Heuristic: If one is "1.5T" (only), system becomes "1.5T".
    const intersect = (current: string, newMod: string) => {
        const c = current.toLowerCase();
        const n = newMod.toLowerCase();
        if (c.includes('3t') && n.includes('3t') && c.includes('1.5') && n.includes('1.5')) return '1.5T & 3T';
        if ((c.includes('3t') || n.includes('3t')) && (!c.includes('1.5') && !n.includes('1.5'))) return '3T Only'; // Rare?
        return '1.5T'; // Default fallback to lower
    };

    for (const l of leads) {
        const lModel = clean(l.model || l.name);
        const lMatch = data.find(d =>
            d.type === 'lead' &&
            d.modelNumbers.some(m => clean(m) === lModel || lModel.includes(clean(m)))
        );

        if (!lMatch) {
            unknownLeads.push(l.model || 'Unknown');
        } else {
            // Refine system modality
            // Use simple logic for now
            if (lMatch.mriModality.includes('1.5') && !lMatch.mriModality.includes('3T') && systemModality.includes('3T')) {
                systemModality = '1.5T';
            }
        }
    }

    if (unknownLeads.length > 0) {
        return {
            manufacturer: 'Boston Scientific',
            status: 'unsafe', // or unknown? Safest is unsafe/mismatch
            details: `Device is Conditional, but lead(s) [${unknownLeads.join(', ')}] not found in allowed list.`,
            timestamp: new Date().toISOString()
        };
    }

    return {
        manufacturer: 'Boston Scientific',
        status: 'conditional',
        details: `System is MR Conditional. Config: ${systemModality}. Device: ${deviceMatch.modelName}.`,
        timestamp: new Date().toISOString()
    };
}

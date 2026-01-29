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
    console.log(`[Boston Logic] Checking Boston Scientific device: ${model} with ${leads.length} leads.`);
    const data = getBostonData();
    console.log(`[Boston Logic] Loaded ${data.length} entries from database.`);

    if (data.length === 0) {
        console.warn('[Boston Logic] Database is empty.');
        return {
            manufacturer: 'Boston Scientific',
            status: 'unknown',
            details: 'Local database empty. Please run update.',
            timestamp: new Date().toISOString()
        };
    }

    const clean = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetModel = clean(model);

    // 1. Find Device with Fuzzy Matching
    // We want to find the BEST match. 
    // "Resonate VR" (input) should match "Resonate" (db).
    // "Resonate HF" (input) should match "Resonate HF" (db), NOT "Resonate".

    // Strategy:
    // 1. Filter candidates where:
    //    - DB model matches input model numbers
    //    - OR DB Name is substring of Input Name (e.g. DB: Resonate, Input: Resonate VR)
    //    - OR Input Name is substring of DB Name (e.g. DB: Resonate HF, Input: Resonate) - less likely but safe
    // 2. Sort candidates by name length (longest match first).

    const candidates = data.filter(d =>
        (d.type === 'generator' || d.type === 'sicd' || d.type === 'icm') && (
            // Model Number Match
            d.modelNumbers.some(m => clean(m) === targetModel || targetModel.includes(clean(m))) ||
            // Name Match (Loose)
            targetModel.includes(clean(d.modelName)) ||
            clean(d.modelName).includes(targetModel)
        )
    );

    // Sort candidates to prioritize the best match:
    // 1. Exact Name Match
    // 2. Input starts with DB Name (e.g. "Resonate VR" starts with "Resonate")
    // 3. Length of DB Name descending (Longer DB name is more specific match for input)

    candidates.sort((a, b) => {
        const nameA = clean(a.modelName);
        const nameB = clean(b.modelName);

        const exactA = nameA === targetModel;
        const exactB = nameB === targetModel;
        if (exactA && !exactB) return -1;
        if (!exactA && exactB) return 1;

        const startA = targetModel.startsWith(nameA);
        const startB = targetModel.startsWith(nameB);
        if (startA && !startB) return -1;
        if (!startA && startB) return 1;

        return nameB.length - nameA.length;
    });

    const deviceMatch = candidates.length > 0 ? candidates[0] : undefined;

    if (!deviceMatch) {
        console.log(`[Boston Logic] Device model '${model}' (Clean: ${targetModel}) not found in database.`);
        return {
            manufacturer: 'Boston Scientific',
            status: 'unknown',
            details: `Device model '${model}' not found in MR-Conditional list.`,
            timestamp: new Date().toISOString()
        };
    }

    console.log(`[Boston Logic] Device match found: ${deviceMatch.modelName} (Type: ${deviceMatch.type}, MRI: ${deviceMatch.mriModality})`);

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
        console.log(`[Boston Logic] Device (${deviceMatch.modelName}) found, but no leads recorded.`);
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

    console.log(`[Boston Logic] Checking ${leads.length} leads against ${data.filter(d => d.type === 'lead').length} known leads...`);

    for (const l of leads) {
        const lModel = clean(l.model || l.name);
        console.log(`[Boston Logic] Checking Lead: ${l.model || l.name} (Clean: ${lModel})`);
        const lMatch = data.find(d =>
            d.type === 'lead' &&
            d.type === 'lead' && (
                // Match by Model Number
                d.modelNumbers.some(m => clean(m) === lModel || lModel.includes(clean(m))) ||
                // Match by Name (Loose)
                // DB: "Endotak Reliance..." vs Input: "Endotak Reliance"
                clean(d.modelName).includes(lModel) ||
                lModel.includes(clean(d.modelName))
            )
        );

        if (!lMatch) {
            console.log(`[Boston Logic] Lead match NOT found for ${lModel}`);
            unknownLeads.push(l.model || 'Unknown');
        } else {
            console.log(`[Boston Logic] Lead match found: ${lMatch.modelName} (${lMatch.mriModality})`);
            // Refine system modality
            // Use simple logic for now
            if (lMatch.mriModality.includes('1.5') && !lMatch.mriModality.includes('3T') && systemModality.includes('3T')) {
                systemModality = '1.5T';
            }
        }
    }

    if (unknownLeads.length > 0) {
        console.log(`[Boston Logic] Unsafe. Unknown leads: ${unknownLeads.join(', ')}`);
        return {
            manufacturer: 'Boston Scientific',
            status: 'unsafe', // or unknown? Safest is unsafe/mismatch
            details: `Device is Conditional, but lead(s) [${unknownLeads.join(', ')}] not found in allowed list.`,
            timestamp: new Date().toISOString()
        };
    }

    console.log(`[Boston Logic] System is Conditional. Config: ${systemModality}`);
    return {
        manufacturer: 'Boston Scientific',
        status: 'conditional',
        details: `System is MR Conditional. Config: ${systemModality}. Device: ${deviceMatch.modelName}.`,
        timestamp: new Date().toISOString()
    };
}

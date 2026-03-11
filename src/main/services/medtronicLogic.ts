// MEDTRONIC CHECK (Local JSON)
// ----------------------------------------------------------------------

export interface MRIStatusResult {
    manufacturer: string;
    status: 'conditional' | 'unsafe' | 'unknown' | 'checking';
    details?: string;
    source?: string;
    timestamp: string;
    warning?: string;
}

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
// We import bundled data as fallback
import bundledData from '../assets/medtronic_data.json';

// Helper to get fresh data
const getMedtronicData = async () => {
    try {
        const userDataPath = path.join(app.getPath('userData'), 'medtronic_data.json');
        const data = await fs.promises.readFile(userDataPath, 'utf8');
        return JSON.parse(data);
    } catch (e: any) {
        if (e.code !== 'ENOENT') console.warn('Failed to load local medtronic data, using bundled fallback.', e);
        return bundledData;
    }
};

export async function checkMedtronic(model: string, leads: any[] = []): Promise<MRIStatusResult> {

    // Normalize Input Model
    const modelInput = String(model || '').toLowerCase().trim();
    const cleanModelInput = modelInput.replace(/[^a-z0-9]/g, '');

    // 1. Find Device Support
    // Use dynamic data source
    const data = await getMedtronicData();

    // We check if input is contained in JSON modelName/Number OR vice versa.
    const deviceMatch = data.find((d: any) => {
        const mName = (d.modelName || '').toLowerCase();
        const mNum = (d.modelNumber || '').toLowerCase();

        // Strict-ish match logic:
        const cleanName = mName.replace(/[^a-z0-9]/g, '');
        const cleanNum = mNum.replace(/[^a-z0-9]/g, '');

        // Match numbers strictly if present
        if (cleanNum && (cleanModelInput.includes(cleanNum) || cleanNum.includes(cleanModelInput))) return true;

        // Match names more loosely (e.g. Micra AV2 vs Micra AV 2)
        if (cleanName.includes(cleanModelInput) || cleanModelInput.includes(cleanName)) return true;

        return false;
    });

    if (!deviceMatch) {
        return {
            manufacturer: 'Medtronic',
            status: 'unknown',
            details: `Medtronic device model '${model}' not explicitly found in MRI database.`,
            timestamp: new Date().toISOString()
        };
    }

    // 2. Validate Leads
    // 2. Validate Leads
    const modelNameLower = deviceMatch.modelName.toLowerCase();

    // Check for Micra (Leadless Pacemaker)
    // Robust check: Check name, model number (MC1/MC2), or input string
    const isMicra = modelNameLower.includes('micra') ||
        (deviceMatch.modelNumber && (deviceMatch.modelNumber.startsWith('MC1') || deviceMatch.modelNumber.startsWith('MC2'))) ||
        modelInput.includes('micra');

    if (isMicra) {
        return {
            manufacturer: 'Medtronic',
            status: 'conditional',
            details: `System is MR Conditional (Micra TPS). Device: ${deviceMatch.modelName}.`,
            timestamp: new Date().toISOString()
        };
    }

    // Check for ILR (Insertable Cardiac Monitor)
    // Reveal LINQ, LINQ II, etc.
    const isILR = modelNameLower.includes('reveal') || modelNameLower.includes('linq');
    if (isILR) {
        return {
            manufacturer: 'Medtronic',
            status: 'conditional',
            details: `System is MR Conditional (Insertable Cardiac Monitor). Device: ${deviceMatch.modelName}.`,
            timestamp: new Date().toISOString()
        };
    }

    if (leads.length === 0) {
        return {
            manufacturer: 'Medtronic',
            status: 'unknown',
            details: `Device found (${deviceMatch.modelName}), but no lead data available to verify compatibility.`,
            timestamp: new Date().toISOString()
        };
    }

    // Gather all compatible lead strings for this device
    const compatibleText = [
        deviceMatch.pacingLeads,
        deviceMatch.pacing6725,
        deviceMatch.defibLeads,
        deviceMatch.crtPacingLeads
    ].filter(Boolean).join('\n').toLowerCase();

    const resultLeads: string[] = [];
    let allCompatible = true;

    for (const lead of leads) {
        const leadModel = String(lead.model || lead.name || '').trim().toLowerCase();
        if (!leadModel) continue;

        // Check if this lead model appears in the compatible text
        if (!compatibleText.includes(leadModel)) {
            allCompatible = false;
            resultLeads.push(`${lead.model} (Incompatible)`);
        } else {
            resultLeads.push(`${lead.model} (OK)`);
        }
    }

    if (!allCompatible) {
        return {
            manufacturer: 'Medtronic',
            status: 'unsafe',
            details: `Model ${deviceMatch.modelName} is MR Conditional, but detected lead(s) are not in the allowed list.`,
            warning: `Leads Checked: ${resultLeads.join(', ')}`,
            timestamp: new Date().toISOString()
        };
    }

    return {
        manufacturer: 'Medtronic',
        status: 'conditional',
        details: `System is MR Conditional. Device: ${deviceMatch.modelName}. Leads verified compatible.`,
        timestamp: new Date().toISOString()
    };
}

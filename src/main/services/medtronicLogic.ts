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
// We need to use require for the JSON to ensure it works in both Main process and potentially tests
// But since we are moving this to a TS file, we can try using import if resolveJsonModule is on.
// Given previous issues, distinct "require" is safer for data loading in this specific setup without checking deep config.
import medtronicData from '../assets/medtronic_data.json';

export async function checkMedtronic(model: string, leads: any[] = []): Promise<MRIStatusResult> {

    // Normalize Input Model
    const modelInput = model.toLowerCase().trim();
    const cleanModelInput = modelInput.replace(/[^a-z0-9]/g, '');

    // 1. Find Device Support
    // We check if input is contained in JSON modelName/Number OR vice versa.
    const deviceMatch = medtronicData.find((d: any) => {
        const mName = (d.modelName || '').toLowerCase();
        const mNum = (d.modelNumber || '').toLowerCase();

        // Strict-ish match logic:
        if (mNum && (cleanModelInput.includes(mNum.replace(/[^a-z0-9]/g, '')) || mNum.includes(modelInput))) return true;

        if (mName.includes(modelInput) || modelInput.includes(mName)) return true;

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
    // Gather all compatible lead strings for this device
    const compatibleText = [
        deviceMatch.pacingLeads,
        deviceMatch.pacing6725,
        deviceMatch.defibLeads,
        deviceMatch.crtPacingLeads
    ].filter(Boolean).join('\n').toLowerCase();

    const resultLeads: string[] = [];
    let allCompatible = true;

    if (leads.length === 0) {
        return {
            manufacturer: 'Medtronic',
            status: 'unknown',
            details: `Device found (${deviceMatch.modelName}), but no lead data available to verify compatibility.`,
            timestamp: new Date().toISOString()
        };
    }

    for (const lead of leads) {
        const leadModel = (lead.model || lead.name || '').trim().toLowerCase();
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

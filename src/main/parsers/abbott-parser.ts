import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { UnifiedReport, LeadData, BatteryData, Measurement } from '../reports';

/**
 * Extracts raw text from a DOCX (ZIP) file by reading word/document.xml
 */
function extractTextFromDocx(filePath: string): string | null {
    try {
        const zip = new AdmZip(filePath);
        const xmlContent = zip.readAsText('word/document.xml');
        if (!xmlContent) return null;

        // Fallback/Simpler method: Regex extract content between <w:t> tags
        const matches = xmlContent.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
        if (matches) {
            return matches.map(tag => tag.replace(/<[^>]+>/g, '')).join('\n');
        }

        return '';

    } catch (e) {
        console.warn('Failed to extract text from DOCX:', e);
        return null;
    }
}

/**
 * Parses the raw text content to extract Abbott specific data
 */
function parseAbbottText(text: string, filePath: string): UnifiedReport {
    // --- Regex Patterns ---

    const patterns = {
        patientName: /Patient Name\s+(.+)/i,
        sessionTimestamp: /Session Timestamp\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/i,
        model: /Model Number:?\s*(.+)/i,
        serial: /Serial Number\s+([A-Z0-9]+)/i,

        // Measurements
        batteryVoltage: /Unloaded Battery Voltage\s+([0-9.]+)\s*V/i,

        // Leads 
        atrialSerial: /Atrial Lead Serial Number\s+([A-Z0-9]+)/i,
        rvSerial: /RV Lead Serial Number\s+([A-Z0-9]+)/i,
        lvSerial: /LV Lead Serial Number\s+([A-Z0-9]+)/i,

        rvImp: /RV Pacing Lead Impedance\s+([0-9.]+)\s*Ohm/i,
        atrialSense: /Atrial Signal Amplitude\s+([0-9.]+)\s*mV/i,
        rvSense: /Ventricular Signal Amplitude\s+([0-9.]+)\s*mV/i,
    };

    // Extract Metadata
    const patientMatch = text.match(patterns.patientName);
    const nameParts = patientMatch ? patientMatch[1].trim().split(',') : [];
    const lastName = nameParts.length > 0 ? nameParts[0].trim() : '';
    const firstName = nameParts.length > 1 ? nameParts[1].trim() : '';

    console.log(`[Abbott Parser Debug] Extracted Name: ${lastName}, ${firstName}`);
    console.log(`[Abbott Parser Debug] Raw Text Start: ${text.substring(0, 500)}`);

    const dateMatch = text.match(patterns.sessionTimestamp);
    const interrogationDate = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();

    // Attempt to find DOB, regex might need adjustment
    // Pattern guess: "Date of Birth: 01/01/1980" or similar
    const dobMatch = text.match(/Date of Birth:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const dob = dobMatch ? new Date(dobMatch[1]).toISOString().split('T')[0] : '1900-01-01'; // Fallback

    // Device Info
    const modelMatch = text.match(patterns.model);
    const serialMatch = text.match(patterns.serial);

    // Battery
    const voltageMatch = text.match(patterns.batteryVoltage);

    // Leads
    const atrialSerial = text.match(patterns.atrialSerial)?.[1] || '';
    const rvSerial = text.match(patterns.rvSerial)?.[1] || '';

    const rvImp = text.match(patterns.rvImp);
    const rvSense = text.match(patterns.rvSense);
    const atrialSense = text.match(patterns.atrialSense);

    const leads: LeadData[] = [];

    // RV Lead Data
    if (rvSerial || rvImp || rvSense) {
        leads.push({
            name: 'RV',
            serial: rvSerial,
            impedance: rvImp ? { value: parseFloat(rvImp[1]), unit: 'Ohm' } : undefined,
            sensing: rvSense ? { value: parseFloat(rvSense[1]), unit: 'mV' } : undefined
        });
    }

    // Atrial Lead Data
    if (atrialSerial || atrialSense) {
        leads.push({
            name: 'Atrium',
            serial: atrialSerial,
            sensing: atrialSense ? { value: parseFloat(atrialSense[1]), unit: 'mV' } : undefined
        });
    }


    // --- Extract Session ID from Filename ---
    // Filename in temp dir: UUID_OriginalName.log e.g. "..._6805398.log"
    // We want "6805398".
    // Regex: Match digits preceding .log at the end of the string
    const filename = path.basename(filePath);
    const idMatch = filename.match(/_?(\d+)\.log$/i);
    const sessionId = idMatch ? idMatch[1] : undefined;

    return {
        manufacturer: 'Abbott',
        interrogation_date: interrogationDate,
        session_id: sessionId,
        patient: {
            first_name: firstName,
            last_name: lastName,
            dob: dob
        },
        device: {
            type: 'Pacemaker',
            model: modelMatch ? modelMatch[1].trim() : 'Unknown',
            serial_number: serialMatch ? serialMatch[1].trim() : 'Unknown'
        },
        battery: {
            voltage: voltageMatch ? { value: parseFloat(voltageMatch[1]), unit: 'V' } : undefined
        },
        leads: leads,
        raw_text: text,
        generatedFiles: [] // Linking handled by watcher via session_id
    };
}

/**
 * Main Entry Point
 */
export async function parseAbbottLog(filePath: string): Promise<UnifiedReport | null> {
    try {
        const buffer = fs.readFileSync(filePath);
        // PK \x03 \x04
        const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;

        let rawText = '';

        if (isZip) {
            console.log('Detected Abbott Log as ZIP/DOCX format.');
            const extracted = extractTextFromDocx(filePath);
            if (!extracted) {
                console.error('Failed to extract text from ZIP Abbott log');
                return null;
            }
            rawText = extracted;
        } else {
            console.log('Detected Abbott Log as Plain Text format.');
            rawText = buffer.toString('utf-8');
        }

        return parseAbbottText(rawText, filePath);

    } catch (e) {
        console.error('Error parsing Abbott log:', e);
        return null;
    }
}

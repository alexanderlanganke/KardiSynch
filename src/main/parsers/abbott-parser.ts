import * as fs from 'fs/promises';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { UnifiedReport, LeadData, hasLeadData } from '../reports';

/**
 * Extracts raw text from a DOCX (ZIP) file by reading word/document.xml
 */
function extractTextFromDocx(buffer: Buffer): string | null {
    try {
        const zip = new AdmZip(buffer);
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

// --- Abbott Coded Log Format ---
// Lines are: {numericCode}{Label}{Value}
// Known field codes for data extraction:

const ABBOTT_CODES: Record<string, string> = {
    '2430': 'PatientName',
    '2431': 'PatientDOB',
    '204':  'PatientID',
    '200':  'DeviceModelName',
    '201':  'DeviceModelNumber',
    '202':  'DeviceSerialNumber',
    '105':  'SessionTimestamp',
    '203':  'LastInterrogation',
    '519':  'BatteryVoltage',
    '533':  'LongevityEstimate',
    '520':  'BatteryCurrent',
    '512':  'AtrialLeadImpedance',
    '507':  'RVLeadImpedance',
    '2722': 'VentricularSignalAmplitude',
    '2721': 'AtrialSignalAmplitude',
    '2468': 'AtrialLeadSerial',
    '2470': 'RVLeadSerial',
    '2457': 'AtrialLeadModel',
    '2461': 'RVLeadModel',
    '2456': 'AtrialLeadManufacturer',
    '2460': 'RVLeadManufacturer',
    '2459': 'AtrialLeadImplantDate',
    '2463': 'RVLeadImplantDate',
    '2442': 'DeviceImplantDate',
    '301':  'Mode',
    '1610': 'AtrialCaptureThreshold',
    '1606': 'RVCaptureThreshold',
    '2440': 'EjectionFraction',
    '2441': 'IndicationsForImplant',
    '1611': 'AtrialCapturePulseWidth',
    '1607': 'RVCapturePulseWidth',
};

/**
 * Detect whether text is in the Abbott coded log format.
 * Coded logs have most lines starting with a numeric code.
 */
function isCodedFormat(text: string): boolean {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 10) return false;
    const codedLines = lines.filter(l => /^\d{2,5}[A-Z]/.test(l));
    return codedLines.length / lines.length > 0.7;
}

/**
 * Parse coded Abbott log into a field map.
 * Each line: {code}{LabelText}{Value}
 * We match known codes and extract the value after the known label.
 */
function parseCodedLog(text: string): Map<string, string> {
    const fields = new Map<string, string>();
    const lines = text.split('\n');

    // Build a lookup: code -> label text (for stripping)
    // We extract value by matching the code at line start, then taking everything
    // after the known label prefix
    const codeLabelPrefixes: Record<string, string> = {
        '2430': 'Patient Name',
        '2431': 'Patient Date of Birth',
        '204':  'Patient ID',
        '200':  'Device Model Name',
        '201':  'Device Model Number',
        '202':  'Device Serial Number',
        '105':  'Session Timestamp',
        '203':  'Device Last Interrogation Date and Time',
        '519':  'Unloaded Battery Voltage',
        '533':  'Longevity Estimate',
        '520':  'Battery Current',
        '512':  'Atrial Pacing Lead Impedance',
        '507':  'RV Pacing Lead Impedance',
        '2722': 'Ventricular Signal Amplitude',
        '2721': 'Atrial Signal Amplitude',
        '2468': 'Atrial Lead Serial Number',
        '2470': 'RV Lead Serial Number',
        '2457': 'Model Number: SJM Atrial Lead',
        '2461': 'Model Number: SJM RV Pace/Sense Lead',
        '2456': 'Manufacturer: Atrial Lead',
        '2460': 'Manufacturer: RV Lead',
        '2459': 'Implant Date: Atrial Lead',
        '2463': 'Implant Date: RV Lead',
        '2442': 'Implant Date: Device',
        '301':  'Mode',
        '1610': 'A. Capture Test Threshold Amplitude',
        '1606': 'RV. Capture Test Threshold Amplitude',
        '2440': 'Ejection Fraction',
        '2441': 'Indications for Implant: List',
        '1611': 'A. Capture Test Pulse Width',
        '1607': 'RV. Capture Test Pulse Width',
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        for (const [code, label] of Object.entries(codeLabelPrefixes)) {
            if (trimmed.startsWith(code + label)) {
                const value = trimmed.slice(code.length + label.length).trim();
                const fieldName = ABBOTT_CODES[code];
                if (fieldName && !fields.has(fieldName)) {
                    fields.set(fieldName, value);
                }
                break;
            }
        }
    }

    return fields;
}

/**
 * Parse an MM/DD/YYYY date string (with optional time) into ISO format.
 */
function parseAbbottDate(dateStr: string): string {
    const parts = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!parts) return '';
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${parts[3]}-${month}-${day}`;
}

/**
 * Parse MM/DD/YYYY HH:MM:SS into ISO datetime.
 */
function parseAbbottDateTime(dateStr: string): string {
    const parts = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (!parts) return '';
    const d = new Date(
        parseInt(parts[3]), parseInt(parts[1]) - 1, parseInt(parts[2]),
        parseInt(parts[4]), parseInt(parts[5]), parseInt(parts[6])
    );
    return d.toISOString();
}

/**
 * Extract a numeric value from a string like "375.0Ohm", "12.0mV", "3.008V"
 */
function extractNumeric(str: string): number | null {
    const m = str.match(/([0-9.]+)/);
    return m ? parseFloat(m[1]) : null;
}

/**
 * Build a UnifiedReport from the coded field map.
 */
function buildReportFromCodedLog(fields: Map<string, string>, filePath: string, rawText: string): UnifiedReport {
    // Patient
    const nameParts = (fields.get('PatientName') || '').split(',');
    const lastName = nameParts.length > 0 ? nameParts[0].trim() : '';
    const firstName = nameParts.length > 1 ? nameParts[1].trim() : '';
    const dob = parseAbbottDate(fields.get('PatientDOB') || '');

    // Date
    const interrogationDate = parseAbbottDateTime(
        fields.get('SessionTimestamp') || fields.get('LastInterrogation') || ''
    );

    // Device
    const modelName = fields.get('DeviceModelName') || '';
    const modelNumber = fields.get('DeviceModelNumber') || '';
    const deviceModel = modelName || modelNumber || 'Unknown';
    const deviceSerial = fields.get('DeviceSerialNumber') || 'Unknown';
    const deviceImplantDate = parseAbbottDate(fields.get('DeviceImplantDate') || '');

    // Infer device type
    let deviceType: string = 'Pacemaker';
    const modelUpper = deviceModel.toUpperCase();
    if (modelUpper.includes('CRT-D') || modelUpper.includes('QUADRA')) {
        deviceType = 'CRT-D';
    } else if (modelUpper.includes('CRT-P')) {
        deviceType = 'CRT-P';
    } else if (modelUpper.includes('ICD') || modelUpper.includes('FORTIFY') || modelUpper.includes('ELLIPSE') || modelUpper.includes('UNIFY')) {
        deviceType = 'ICD';
    }

    // Battery
    const batteryVoltageStr = fields.get('BatteryVoltage') || '';
    const batteryVoltage = extractNumeric(batteryVoltageStr);

    // Leads
    const leads: LeadData[] = [];

    // RV Lead
    const rvSerial = fields.get('RVLeadSerial') || '';
    const rvImpStr = fields.get('RVLeadImpedance') || '';
    const rvImp = extractNumeric(rvImpStr);
    const rvSenseStr = fields.get('VentricularSignalAmplitude') || '';
    const rvSense = extractNumeric(rvSenseStr);
    const rvThreshStr = fields.get('RVCaptureThreshold') || '';
    const rvThresh = extractNumeric(rvThreshStr);
    const rvPwStr = fields.get('RVCapturePulseWidth') || '';
    const rvPw = extractNumeric(rvPwStr);

    const rvLead: LeadData = {
        name: 'RV',
        serial: rvSerial || undefined,
        model: fields.get('RVLeadModel') || undefined,
        manufacturer: fields.get('RVLeadManufacturer') || undefined,
        implant_date: parseAbbottDate(fields.get('RVLeadImplantDate') || '') || undefined,
        impedance: rvImp != null ? { value: rvImp, unit: 'Ohm' } : undefined,
        sensing: rvSense != null ? { value: rvSense, unit: 'mV' } : undefined,
        pacing_threshold: rvThresh != null ? { value: rvPw != null ? `${rvThresh} @ ${rvPw}` : rvThresh, unit: rvPw != null ? 'V @ ms' : 'V' } : undefined,
    };
    if (hasLeadData(rvLead)) leads.push(rvLead);

    // Atrial Lead
    const atrialSerial = fields.get('AtrialLeadSerial') || '';
    const atrialImpStr = fields.get('AtrialLeadImpedance') || '';
    const atrialImp = extractNumeric(atrialImpStr);
    const atrialSenseStr = fields.get('AtrialSignalAmplitude') || '';
    const atrialSense = extractNumeric(atrialSenseStr);
    const atrialThreshStr = fields.get('AtrialCaptureThreshold') || '';
    const atrialThresh = extractNumeric(atrialThreshStr);
    const atrialPwStr = fields.get('AtrialCapturePulseWidth') || '';
    const atrialPw = extractNumeric(atrialPwStr);

    const atrialLead: LeadData = {
        name: 'Atrium',
        serial: atrialSerial || undefined,
        model: fields.get('AtrialLeadModel') || undefined,
        manufacturer: fields.get('AtrialLeadManufacturer') || undefined,
        implant_date: parseAbbottDate(fields.get('AtrialLeadImplantDate') || '') || undefined,
        impedance: atrialImp != null ? { value: atrialImp, unit: 'Ohm' } : undefined,
        sensing: atrialSense != null ? { value: atrialSense, unit: 'mV' } : undefined,
        pacing_threshold: atrialThresh != null ? { value: atrialPw != null ? `${atrialThresh} @ ${atrialPw}` : atrialThresh, unit: atrialPw != null ? 'V @ ms' : 'V' } : undefined,
    };
    if (hasLeadData(atrialLead)) leads.push(atrialLead);

    // Session ID from filename
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
            dob: dob,
            hospitalPatientId: fields.get('PatientID') || undefined,
        },
        device: {
            type: deviceType,
            model: deviceModel,
            serial_number: deviceSerial,
            implant_date: deviceImplantDate || undefined,
        },
        battery: {
            voltage: batteryVoltage != null ? { value: batteryVoltage, unit: 'V' } : undefined,
        },
        leads: leads,
        raw_text: rawText,
        generatedFiles: [],
    };
}

/**
 * Parses the raw text content using regex patterns (DOCX/freeform text fallback)
 */
function parseAbbottText(text: string, filePath: string): UnifiedReport {
    const patterns = {
        patientName: /Patient Name\s+(.+)/i,
        sessionTimestamp: /Session Timestamp\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/i,
        model: /Model Number:?\s*(.+)/i,
        serial: /Serial Number\s+([A-Z0-9]+)/i,
        batteryVoltage: /Unloaded Battery Voltage\s+([0-9.]+)\s*V/i,
        atrialSerial: /Atrial Lead Serial Number\s+([A-Z0-9]+)/i,
        rvSerial: /RV Lead Serial Number\s+([A-Z0-9]+)/i,
        lvSerial: /LV Lead Serial Number\s+([A-Z0-9]+)/i,
        rvImp: /RV Pacing Lead Impedance\s+([0-9.]+)\s*Ohm/i,
        atrialSense: /Atrial Signal Amplitude\s+([0-9.]+)\s*mV/i,
        rvSense: /Ventricular Signal Amplitude\s+([0-9.]+)\s*mV/i,
    };

    const patientMatch = text.match(patterns.patientName);
    const nameParts = patientMatch ? patientMatch[1].trim().split(',') : [];
    const lastName = nameParts.length > 0 ? nameParts[0].trim() : '';
    const firstName = nameParts.length > 1 ? nameParts[1].trim() : '';

    const dateMatch = text.match(patterns.sessionTimestamp);
    let interrogationDate = '';
    if (dateMatch) {
        interrogationDate = parseAbbottDateTime(dateMatch[1]);
    }

    const dobMatch = text.match(/Date of Birth:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const dob = dobMatch ? parseAbbottDate(dobMatch[1]) : '';

    const modelMatch = text.match(patterns.model);
    const serialMatch = text.match(patterns.serial);
    const voltageMatch = text.match(patterns.batteryVoltage);

    const atrialSerial = text.match(patterns.atrialSerial)?.[1] || '';
    const rvSerial = text.match(patterns.rvSerial)?.[1] || '';
    const lvSerial = text.match(patterns.lvSerial)?.[1] || '';
    const rvImp = text.match(patterns.rvImp);
    const rvSense = text.match(patterns.rvSense);
    const atrialSense = text.match(patterns.atrialSense);

    const leads: LeadData[] = [];

    if (rvSerial || rvImp || rvSense) {
        leads.push({
            name: 'RV',
            serial: rvSerial,
            impedance: rvImp ? { value: parseFloat(rvImp[1]), unit: 'Ohm' } : undefined,
            sensing: rvSense ? { value: parseFloat(rvSense[1]), unit: 'mV' } : undefined
        });
    }

    if (atrialSerial || atrialSense) {
        leads.push({
            name: 'Atrium',
            serial: atrialSerial,
            sensing: atrialSense ? { value: parseFloat(atrialSense[1]), unit: 'mV' } : undefined
        });
    }

    if (lvSerial) {
        leads.push({
            name: 'LV',
            serial: lvSerial,
        });
    }

    const filename = path.basename(filePath);
    const idMatch = filename.match(/_?(\d+)\.log$/i);
    const sessionId = idMatch ? idMatch[1] : undefined;

    let deviceType: string = 'Pacemaker';
    const modelStr = modelMatch ? modelMatch[1].trim().toUpperCase() : '';
    if (modelStr.includes('CRT-D') || modelStr.includes('QUADRA')) {
        deviceType = 'CRT-D';
    } else if (modelStr.includes('CRT-P')) {
        deviceType = 'CRT-P';
    } else if (modelStr.includes('ICD') || modelStr.includes('FORTIFY') || modelStr.includes('ELLIPSE') || modelStr.includes('UNIFY')) {
        deviceType = 'ICD';
    }

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
            type: deviceType,
            model: modelMatch ? modelMatch[1].trim() : 'Unknown',
            serial_number: serialMatch ? serialMatch[1].trim() : 'Unknown'
        },
        battery: {
            voltage: voltageMatch ? { value: parseFloat(voltageMatch[1]), unit: 'V' } : undefined
        },
        leads: leads,
        raw_text: text,
        generatedFiles: []
    };
}

/**
 * Main Entry Point
 */
export async function parseAbbottLog(filePath: string): Promise<UnifiedReport | null> {
    try {
        const buffer = await fs.readFile(filePath);
        const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;

        let rawText = '';

        if (isZip) {
            console.log('Detected Abbott Log as ZIP/DOCX format.');
            const extracted = extractTextFromDocx(buffer);
            if (!extracted) {
                console.error('Failed to extract text from ZIP Abbott log');
                return null;
            }
            rawText = extracted;
        } else {
            console.log('Detected Abbott Log as Plain Text format.');
            rawText = buffer.toString('utf-8');
        }

        // Try coded format first (numeric code per line)
        if (isCodedFormat(rawText)) {
            console.log('[Abbott] Parsing as coded log format.');
            const fields = parseCodedLog(rawText);
            console.log(`[Abbott] Extracted ${fields.size} fields from coded log.`);
            return buildReportFromCodedLog(fields, filePath, rawText);
        }

        // Fallback to regex-based parsing (DOCX/freeform text)
        return parseAbbottText(rawText, filePath);

    } catch (e) {
        console.error('Error parsing Abbott log:', e);
        return null;
    }
}

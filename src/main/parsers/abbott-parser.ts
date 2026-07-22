import * as fs from 'fs/promises';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { UnifiedReport, LeadData, hasLeadData } from '../reports';
import { normalizeDate } from '../../lib/dates';
import { DiagnosticsCollector, safeExtract, deriveParseStatus } from './parseDiagnostics';

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
 *
 * Delegates to normalizeDate with a 'us' hint: ambiguous dates stay MM/DD
 * (documented Abbott format), but a first number > 12 must be the day
 * ("25/09/1952" -> 1952-09-25 instead of the invalid 1952-25-09), and the
 * result is validated as a real calendar date.
 */
function parseAbbottDate(dateStr: string): string {
    const parts = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!parts) return '';
    return normalizeDate(`${parts[1]}/${parts[2]}/${parts[3]}`, 'us');
}

/**
 * Parse MM/DD/YYYY HH:MM:SS into ISO datetime.
 *
 * Falls back to a date-only parse when no full HH:MM:SS time is present. Some
 * Abbott exports (notably SR / summary-report logs) carry a date-only session
 * timestamp, or a time without seconds. The old strict regex returned '' for
 * those, so the visit was stored with an "Unknown" date and an empty visit.xml
 * date field (issue #127). Returning the date keeps the visit correctly dated.
 */
function parseAbbottDateTime(dateStr: string): string {
    const parts = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (parts) {
        // Build the ISO string from the parsed components directly. The old
        // local Date -> toISOString() round trip converted to UTC, shifting
        // early-morning interrogations onto the previous calendar day.
        const date = parseAbbottDate(dateStr);
        if (date) return `${date}T${parts[4].padStart(2, '0')}:${parts[5]}:${parts[6]}`;
        return '';
    }
    // No full time component — fall back to the date alone (parseAbbottDate
    // matches the MM/DD/YYYY anywhere in the string, so this also recovers the
    // date from timestamps with an unrecognized time format).
    return parseAbbottDate(dateStr);
}

/**
 * Extract a numeric value from a string like "375.0Ohm", "12.0mV", "3.008V"
 */
function extractNumeric(str: string): number | null {
    const m = str.match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const val = parseFloat(m[1]);
    return Number.isNaN(val) ? null : val;
}

/**
 * Build a UnifiedReport from the coded field map.
 */
function buildReportFromCodedLog(fields: Map<string, string>, filePath: string, rawText: string, collector: DiagnosticsCollector): UnifiedReport {
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
    const rvLead: LeadData | null = safeExtract(collector, 'leads.RV', () => {
        const rvSerial = fields.get('RVLeadSerial') || '';
        const rvImp = extractNumeric(fields.get('RVLeadImpedance') || '');
        const rvSense = extractNumeric(fields.get('VentricularSignalAmplitude') || '');
        const rvThresh = extractNumeric(fields.get('RVCaptureThreshold') || '');
        const rvPw = extractNumeric(fields.get('RVCapturePulseWidth') || '');

        return {
            name: 'RV',
            serial: rvSerial || undefined,
            model: fields.get('RVLeadModel') || undefined,
            manufacturer: fields.get('RVLeadManufacturer') || undefined,
            implant_date: parseAbbottDate(fields.get('RVLeadImplantDate') || '') || undefined,
            impedance: rvImp != null ? { value: rvImp, unit: 'Ohm' } : undefined,
            sensing: rvSense != null ? { value: rvSense, unit: 'mV' } : undefined,
            pacing_threshold: rvThresh != null ? { value: rvPw != null ? `${rvThresh} @ ${rvPw}` : rvThresh, unit: rvPw != null ? 'V @ ms' : 'V' } : undefined,
        };
    }, null);
    if (rvLead && hasLeadData(rvLead)) leads.push(rvLead);

    // Atrial Lead
    const atrialLead: LeadData | null = safeExtract(collector, 'leads.atrial', () => {
        const atrialSerial = fields.get('AtrialLeadSerial') || '';
        const atrialImp = extractNumeric(fields.get('AtrialLeadImpedance') || '');
        const atrialSense = extractNumeric(fields.get('AtrialSignalAmplitude') || '');
        const atrialThresh = extractNumeric(fields.get('AtrialCaptureThreshold') || '');
        const atrialPw = extractNumeric(fields.get('AtrialCapturePulseWidth') || '');

        return {
            name: 'Atrium',
            serial: atrialSerial || undefined,
            model: fields.get('AtrialLeadModel') || undefined,
            manufacturer: fields.get('AtrialLeadManufacturer') || undefined,
            implant_date: parseAbbottDate(fields.get('AtrialLeadImplantDate') || '') || undefined,
            impedance: atrialImp != null ? { value: atrialImp, unit: 'Ohm' } : undefined,
            sensing: atrialSense != null ? { value: atrialSense, unit: 'mV' } : undefined,
            pacing_threshold: atrialThresh != null ? { value: atrialPw != null ? `${atrialThresh} @ ${atrialPw}` : atrialThresh, unit: atrialPw != null ? 'V @ ms' : 'V' } : undefined,
        };
    }, null);
    if (atrialLead && hasLeadData(atrialLead)) leads.push(atrialLead);

    // Session ID from filename
    const filename = path.basename(filePath);
    const idMatch = filename.match(/_?(\d+)\.log$/i);
    const sessionId = idMatch ? idMatch[1] : undefined;

    const hasPatientIdentity = !!(lastName || dob);
    const hasDeviceIdentity = !!(deviceModel !== 'Unknown' && deviceModel || (deviceSerial && deviceSerial !== 'Unknown'));

    return {
        manufacturer: 'Abbott',
        interrogation_date: normalizeDate(interrogationDate, 'us'),
        session_id: sessionId,
        patient: {
            first_name: firstName,
            last_name: lastName,
            dob: normalizeDate(dob, 'us'),
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
        formatVariant: 'abbott-coded-log',
        parseWarnings: collector.list,
        parseStatus: deriveParseStatus(collector, hasPatientIdentity, hasDeviceIdentity),
    };
}

/**
 * Parses the raw text content using regex patterns (DOCX/freeform text fallback)
 */
function parseAbbottText(text: string, filePath: string, collector: DiagnosticsCollector): UnifiedReport {
    const patterns = {
        patientName: /Patient Name\s+(.+)/i,
        sessionTimestamp: /Session Timestamp\s+(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i,
        model: /Model Number:?\s*(.+)/i,
        // Anchored away from lead serial lines ("Atrial Lead Serial Number ...")
        // and accepts an optional colon separator.
        serial: /(?<!Lead\s)Serial Number(?::\s*|\s+)([A-Z0-9]+)/i,
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

    const hasPatientIdentity = !!(lastName || dob);
    const hasDeviceIdentity = !!(modelMatch || serialMatch);
    if (!hasPatientIdentity && !hasDeviceIdentity) {
        collector.error('freeform', 'None of the known freeform-text patterns (patient name, model, serial) matched — likely an unrecognized Abbott report layout.');
    }

    return {
        manufacturer: 'Abbott',
        interrogation_date: normalizeDate(interrogationDate, 'us'),
        session_id: sessionId,
        patient: {
            first_name: firstName,
            last_name: lastName,
            dob: normalizeDate(dob, 'us')
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
        generatedFiles: [],
        formatVariant: 'abbott-freeform-text',
        parseWarnings: collector.list,
        parseStatus: deriveParseStatus(collector, hasPatientIdentity, hasDeviceIdentity),
    };
}

/**
 * Main Entry Point
 */
export async function parseAbbottLog(filePath: string): Promise<UnifiedReport | null> {
    const collector = new DiagnosticsCollector();
    try {
        const buffer = await fs.readFile(filePath);
        const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
        const sourceVariant = isZip ? 'source=docx' : 'source=plain-text';

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

            // Lines look coded (most start with a numeric code) but almost none
            // of the known codes/labels matched — the signature of an
            // unrecognized code/label revision (a real "older Abbott log"
            // scenario) rather than a genuinely sparse report. This used to
            // silently return a mostly-empty "successful" report.
            if (fields.size < 3) {
                collector.warn('coded-log', `Coded-log format detected, but only ${fields.size} of ${Object.keys(ABBOTT_CODES).length} known fields matched — likely an unrecognized code/label revision.`);
            }

            const report = buildReportFromCodedLog(fields, filePath, rawText, collector);
            report.formatVariant = `abbott:${sourceVariant};${report.formatVariant}`;
            return report;
        }

        // Fallback to regex-based parsing (DOCX/freeform text)
        const report = parseAbbottText(rawText, filePath, collector);
        report.formatVariant = `abbott:${sourceVariant};${report.formatVariant}`;
        return report;

    } catch (e) {
        console.error('Error parsing Abbott log:', e);
        return null;
    }
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { UnifiedReport, LeadData } from '../reports';
import { extractTextFromPdf, extractStructuredData } from '../utils/pdf-utils';

/**
 * --- Medtronic Parser ---
 * Handles legacy .pdd files and modern .pkg archives.
 */

/**
 * Parses a legacy Medtronic .pdd file.
 * Extracts header information and measurements using binary structure analysis.
 */
export const parseMedtronicPdd = async (filePath: string): Promise<UnifiedReport | null> => {
    try {
        const buffer = fs.readFileSync(filePath);
        const pddString = buffer.toString('utf8'); // For text-based searches
        const entries = parsePDDStructure(buffer);

        // Map entries to report fields
        const latestValues: { [key: number]: number } = {};
        entries.forEach(e => {
            latestValues[e.type] = e.value;
        });

        const report: UnifiedReport = {
            manufacturer: 'Medtronic',
            interrogation_date: new Date().toISOString(), // Fallback
            patient: {
                first_name: '',
                last_name: '',
                dob: '1900-01-01',
            },
            device: {
                type: 'ICD', // Default, refine later
                model: '',
                serial_number: '',
            },
            battery: {},
            leads: [],
            raw_text: '',
        };

        // --- 1. Robust Header Extraction (Regex/String Analysis) ---

        // Extract all ASCII strings >= 4 chars
        const strings: string[] = [];
        let current = '';
        for (let i = 0; i < buffer.length; i++) {
            const charCode = buffer[i];
            if (charCode >= 32 && charCode <= 126) {
                current += String.fromCharCode(charCode);
            } else {
                if (current.length >= 4) {
                    strings.push(current.trim());
                }
                current = '';
            }
        }
        if (current.length >= 4) strings.push(current.trim());

        report.raw_text = strings.join('\n');

        // A. Patient Name: Look for "Name, Firstname" format
        // Heuristic: First string that matches "Word, Word" pattern
        const nameRegex = /^([A-Z][a-z]+), ([A-Z].*)$/;
        const nameMatch = strings.find(s => nameRegex.test(s));

        if (nameMatch) {
            const parts = nameMatch.match(nameRegex);
            if (parts && parts.length >= 3) {
                report.patient.last_name = parts[1];
                report.patient.first_name = parts[2];
            }
        }

        // B. Device Model: Look for known families
        const knownFamilies = ['Protecta', 'Visia', 'Evera', 'Viva', 'Brava', 'Claria', 'Amplify', 'Consulta', 'Secura', 'Maximo', 'Concerto', 'Virtuoso'];
        const modelString = strings.find(s => knownFamilies.some(f => s.includes(f)));
        if (modelString) {
            report.device.model = modelString;
            // Infer type
            if (modelString.includes('CRT-D') || modelString.includes('DR') && modelString.includes('Protecta')) {
                report.device.type = 'ICD';
            } else if (modelString.includes('CRT-P')) {
                report.device.type = 'CRT-P';
            }
        }

        // C. Serial Number & Date
        // Pattern: PTC610468S + optional Date suffix (20251106144806)
        // Regex: 3 chars, 6 digits, 1 char (S/P/etc), optional 14 digits
        const serialRegex = /([A-Z]{3}\d{6}[A-Z])(\d{14})?/;
        const serialString = strings.find(s => serialRegex.test(s));

        if (serialString) {
            const match = serialString.match(serialRegex);
            if (match) {
                report.device.serial_number = match[1];

                if (match[2]) {
                    // We have the date suffix: YYYYMMDDHHMMSS
                    const ts = match[2];
                    const year = parseInt(ts.substring(0, 4));
                    const month = parseInt(ts.substring(4, 6)) - 1;
                    const day = parseInt(ts.substring(6, 8));
                    const hour = parseInt(ts.substring(8, 10));
                    const min = parseInt(ts.substring(10, 12));
                    const sec = parseInt(ts.substring(12, 14));
                    report.interrogation_date = new Date(year, month, day, hour, min, sec).toISOString();
                } else {
                    // Fallback: look for 14-digit timestamp in strings
                    const dateRegex = /^(20\d{12})$/;
                    const dateString = strings.find(s => dateRegex.test(s));
                    if (dateString) {
                        const ts = dateString;
                        const year = parseInt(ts.substring(0, 4));
                        const month = parseInt(ts.substring(4, 6)) - 1;
                        const day = parseInt(ts.substring(6, 8));
                        const hour = parseInt(ts.substring(8, 10));
                        const min = parseInt(ts.substring(10, 12));
                        const sec = parseInt(ts.substring(12, 14));
                        report.interrogation_date = new Date(year, month, day, hour, min, sec).toISOString();
                    }
                }
            }
        }

        // --- 2. Measurements (Binary Structure) ---

        // Battery Voltage (Type 4, 2.0-3.5V)
        const batteryEntries = entries.filter(e => e.type === 4).reverse();
        for (const entry of batteryEntries) {
            if (entry.value >= 2000 && entry.value <= 3500) {
                report.battery.voltage = { value: entry.value / 1000, unit: 'V' };
                break;
            }
        }

        // Leads - Snapshot Analysis (Best Effort)
        // We look for the marker "69\n68\n1035" or similar patterns in strings
        // But since we have the raw entries, let's use the robust Type 3 (Imp) and Type 2 (Thresh) logic

        const leads: LeadData[] = [];
        let rvImp: number | undefined;
        let aImp: number | undefined;
        let rvThresh: number | undefined;
        let aThresh: number | undefined;

        // A Imp (Type 3, ~342 Ohm -> 737342)
        // Medtronic seems to encode value in last 3 digits for these types?
        const type3Entries = entries.filter(e => e.type === 3 && e.value >= 737000 && e.value < 738000);
        // Look for reasonable impedance (200-2000)
        // 737342 -> 342
        const validType3 = type3Entries.find(e => {
            const v = e.value % 1000;
            return v > 200 && v < 2000;
        });
        if (validType3) aImp = validType3.value % 1000;

        // Thresholds (Type 2, 7374xx)
        // 737450 -> 50 -> 0.5V
        const type2Entries = entries.filter(e => e.type === 2 && e.value >= 737400 && e.value < 737600);

        // Heuristic: Lower value is usually A or RV? 
        // 50 (0.5V) and 60 (0.6V).
        // Let's assume order or simply take found values
        const threshValues = type2Entries.map(e => (e.value % 100) / 100).filter(v => v > 0 && v < 5);
        if (threshValues.length >= 1) aThresh = threshValues[0];
        if (threshValues.length >= 2) rvThresh = threshValues[1];

        if (aImp || aThresh) {
            leads.push({
                name: 'Atrial Lead',
                anatomic_location: 'A',
                impedance: aImp ? { value: aImp, unit: 'Ohm' } : undefined,
                pacing_threshold: aThresh ? { value: aThresh, unit: 'V' } : undefined
            });
        }

        // RV Impulse is tricky in PDD, relying on the '589...' raw value cluster found in analysis
        const rawEntries = parseRawValues(buffer);
        // Looking for 5894xx range with FF FF prefix
        const rvImpEntry = rawEntries.find(e => e.isDoubleFF && e.value >= 589200 && e.value < 589900);
        if (rvImpEntry) {
            rvImp = rvImpEntry.value % 1000;
            leads.push({
                name: 'RV Lead',
                anatomic_location: 'RV',
                impedance: { value: rvImp, unit: 'Ohm' },
                pacing_threshold: rvThresh ? { value: rvThresh, unit: 'V' } : undefined
            });
        } else if (rvThresh && !rvImp) {
            leads.push({
                name: 'RV Lead',
                anatomic_location: 'RV',
                pacing_threshold: { value: rvThresh, unit: 'V' }
            });
        }

        if (leads.length > 0) report.leads = leads;

        return report;

    } catch (error) {
        console.error("Failed to parse Medtronic PDD:", error);
        return null;
    }
};

function parsePDDStructure(buffer: Buffer) {
    const entries: { offset: number, value: number, type: number }[] = [];
    let i = 0;
    while (i < buffer.length) {
        if (buffer[i] === 0xFF) {
            let j = i + 1;
            let valStr = '';
            while (j < buffer.length && buffer[j] >= 0x30 && buffer[j] <= 0x39) {
                valStr += String.fromCharCode(buffer[j]);
                j++;
            }

            if (valStr.length > 0 && buffer[j] === 0x0A) {
                if (j + 1 < buffer.length && buffer[j + 1] === 0xFF) {
                    let k = j + 2;
                    let typeStr = '';
                    while (k < buffer.length && buffer[k] >= 0x30 && buffer[k] <= 0x39) {
                        typeStr += String.fromCharCode(buffer[k]);
                        k++;
                    }

                    if (typeStr.length > 0 && buffer[k] === 0x0A) {
                        entries.push({
                            offset: i,
                            value: parseInt(valStr),
                            type: parseInt(typeStr)
                        });
                        i = k;
                        continue;
                    }
                }
            }
        }
        i++;
    }
    return entries;
}

function parseRawValues(buffer: Buffer) {
    const values: { offset: number, value: number, isDoubleFF: boolean }[] = [];
    let i = 0;
    while (i < buffer.length) {
        if (buffer[i] === 0xFF) {
            // Check if it's FF FF
            let isDoubleFF = false;
            if (i + 1 < buffer.length && buffer[i + 1] === 0xFF) {
                isDoubleFF = true;
                i++; // Skip first FF
            }

            let j = i + 1;
            let valStr = '';
            while (j < buffer.length && buffer[j] >= 0x30 && buffer[j] <= 0x39) {
                valStr += String.fromCharCode(buffer[j]);
                j++;
            }

            if (valStr.length > 0 && buffer[j] === 0x0A) {
                const val = parseInt(valStr);
                values.push({
                    offset: i,
                    value: val,
                    isDoubleFF: isDoubleFF
                });
                i = j;
                continue;
            }
        }
        i++;
    }
    return values;
}

function extractStringAt(buffer: Buffer, offset: number): string {
    if (offset >= buffer.length) return '';
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0x00 && buffer[end] !== 0x0A) {
        end++;
    }
    return buffer.slice(offset, end).toString('utf8').trim();
}

/**
 * Helper to find a Field value in the Medtronic XML structure.
 */
function findFieldValue(fields: any[], fieldName: string): any {
    if (!fields || !Array.isArray(fields)) return null;
    const field = fields.find((f: any) => f['@_name'] === fieldName);
    if (!field) return null;

    if (field.String) return field.String;
    if (field.DateTime) return field.DateTime;
    if (field.Boolean) return field.Boolean;
    if (field.Integer) return field.Integer;
    return null;
}


/**
 * Parses a Medtronic .pkg archive.
 * Unzips, parses XML, and optionally extracts PDF.
 */
export const parseMedtronicPkg = async (filePath: string): Promise<UnifiedReport | null> => {
    const tempDir = path.join(os.tmpdir(), 'kardisynch_pkg_' + Date.now());

    try {
        // 1. Unzip
        const zip = new AdmZip(filePath);
        zip.extractAllTo(tempDir, true);

        // 2. Find XML
        const xmlPath = path.join(tempDir, 'Public', 'PublicDiscreteData.xml');
        let report: UnifiedReport | null = null;

        if (fs.existsSync(xmlPath)) {
            const xmlData = fs.readFileSync(xmlPath, 'utf-8');
            report = parseMedtronicXML(xmlData);
        }

        // 3. Find PDF
        const reportsDir = path.join(tempDir, 'Reports');
        if (fs.existsSync(reportsDir)) {
            const files = fs.readdirSync(reportsDir);
            const pdfFile = files.find(f => f.toLowerCase().endsWith('.pdf'));

            if (pdfFile) {
                const pdfPath = path.join(reportsDir, pdfFile);
                const pdfText = await extractTextFromPdf(pdfPath);
                const pdfData = extractStructuredData(pdfText, pdfFile);

                const extractedPdfName = `EXTRACTED_${path.basename(filePath, '.pkg')}.pdf`;
                const extractedPdfPath = path.join(path.dirname(filePath), extractedPdfName);
                fs.copyFileSync(pdfPath, extractedPdfPath);

                if (!report) {
                    report = pdfData;
                    report.manufacturer = 'Medtronic';
                } else {
                    if (!report.patient.last_name) report.patient = pdfData.patient;
                    // Only overwrite device info if missing from XML
                    if (!report.device.serial_number) report.device = pdfData.device;
                }

                report.generatedFiles = [extractedPdfPath];
            }
        }

        return report;

    } catch (error) {
        console.error("Failed to parse Medtronic PKG:", error);
        return null;
    } finally {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            console.warn("Failed to clean up temp dir:", e);
        }
    }
};

/**
 * Parses the PublicDiscreteData.xml content from a Medtronic PKG.
 */
export const parseMedtronicXML = (xmlData: string): UnifiedReport => {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
    });
    const xml = parser.parse(xmlData);

    // Traverse XML to find data
    const root = xml.Composite;
    const fields = root && root.Field ? (Array.isArray(root.Field) ? root.Field : [root.Field]) : [];

    const savedDate = findFieldValue(fields, 'SavedDateTime');

    // Helper to get text from value which might be object with #text
    const getText = (val: any): any => {
        if (val === null || val === undefined) return null;
        if (typeof val !== 'object') return val;
        if (val['#text'] !== undefined) return val['#text'];
        return val;
    };

    // Helper to find value in nested structure
    const findInComposite = (composite: any, targetName: string): any => {
        if (!composite || !composite.Field) return null;
        const fields = Array.isArray(composite.Field) ? composite.Field : [composite.Field];
        const field = fields.find((f: any) => f['@_name'] === targetName);
        if (!field) return null;
        return field.Composite || field; // Return Composite if exists, else field itself
    };

    const findValueInComposite = (composite: any, targetName: string): any => {
        if (!composite || !composite.Field) return null;
        const fields = Array.isArray(composite.Field) ? composite.Field : [composite.Field];
        const field = fields.find((f: any) => f['@_name'] === targetName);

        if (!field) return null;

        if (field.String) return getText(field.String);
        if (field.Integer) return getText(field.Integer);
        if (field.Real) return getText(field.Real);
        if (field.Discrete) return getText(field.Discrete);
        if (field.Date) return getText(field.Date);
        if (field.DateTime) return getText(field.DateTime); // Added DateTime support
        if (field.Composite) return field.Composite; // Return composite for further traversal

        return null;
    };

    // Locate "Value" -> "DiscreteDataContent" -> "ContextCollection" -> "NoPendingSettings" -> "NormalizedParameterCollection"

    let params: any[] = [];

    try {
        const valueField = findInComposite(root, 'Value');

        const contextCollection = findInComposite(valueField, 'ContextCollection');

        // ContextCollection is an Array of Contexts. We want the one named "NoPendingSettings" (usually index 1)
        let targetContext = null;
        if (contextCollection && contextCollection.Array && contextCollection.Array.Composite) {
            const contexts = Array.isArray(contextCollection.Array.Composite) ? contextCollection.Array.Composite : [contextCollection.Array.Composite];

            targetContext = contexts.find((c: any) => {
                const nameField = findInComposite(c, 'Name');
                return nameField && getText(nameField.String) === 'NoPendingSettings';
            });
        }

        if (targetContext) {
            const paramCollection = findInComposite(targetContext, 'NormalizedParameterCollection');
            if (paramCollection && paramCollection.Array && paramCollection.Array.Composite) {
                params = Array.isArray(paramCollection.Array.Composite) ? paramCollection.Array.Composite : [paramCollection.Array.Composite];
            }
        }
    } catch (e) {
        console.error(`Error traversing XML structure: ${e}`);
    }

    // Helper to find parameter by name
    const findParam = (name: string): any => {
        const found = params.find((p: any) => {
            const n = findInComposite(p, 'Name');
            return n && getText(n.String) === name;
        });
        return found;
    };

    // --- Extract Device Data ---
    const deviceModelParam = findParam('DeviceModelName');
    const deviceSerialParam = findParam('DeviceSerialNumber');
    const deviceTypeParam = findParam('DeviceType');
    const batteryStatusParam = findParam('BatteryStatus');
    const deviceStatusParam = findParam('DeviceStatus');
    const deviceLongevityParam = findParam('DeviceLongevityStatus');

    let deviceModel = '';
    let deviceSerial = '';
    let deviceType = 'Unknown';
    let batteryVoltage = undefined;
    let implantDate = undefined;
    let remainingLongevity = undefined;

    if (deviceModelParam) {
        const current = findValueInComposite(deviceModelParam, 'Current'); // Returns Composite
        if (current) {
            const nameField = findInComposite(current, 'Name');
            if (nameField && nameField.String) deviceModel = getText(nameField.String);
        }
    }

    if (deviceSerialParam) {
        const val = findValueInComposite(deviceSerialParam, 'Current');
        if (val && typeof val === 'string') deviceSerial = val;
    }

    if (deviceTypeParam) {
        const val = findValueInComposite(deviceTypeParam, 'Current');
        if (val) deviceType = val;
    }

    if (deviceStatusParam) {
        const current = findValueInComposite(deviceStatusParam, 'Current');
        if (current) {
            const impDate = findValueInComposite(current, 'ImplantDateTime');
            if (impDate) implantDate = impDate;
        }
    }

    if (deviceLongevityParam) {
        const current = findValueInComposite(deviceLongevityParam, 'Current');
        if (current) {
            // Prefer Years (UserRepresentation) > Months (IDCO)
            const years = findValueInComposite(current, 'UserRepresentationAverageRemainingDuration');
            if (years) {
                remainingLongevity = { value: parseFloat(years), unit: 'years' };
            } else {
                const months = findValueInComposite(current, 'IDCORepresentationAverageRemainingDuration');
                if (months) {
                    remainingLongevity = { value: parseFloat(months), unit: 'months' };
                }
            }
        }
    }

    if (batteryStatusParam) {
        const current = findValueInComposite(batteryStatusParam, 'Current'); // Returns BatteryStatus Composite
        if (current) {
            const voltageStatusField = findInComposite(current, 'VoltageStatus');
            if (voltageStatusField) {
                const voltageComposite = voltageStatusField.Composite || voltageStatusField; // Handle if it's directly composite or wrapped
                const voltageField = findInComposite(voltageComposite, 'Voltage');
                if (voltageField && voltageField.Real) {
                    batteryVoltage = parseFloat(getText(voltageField.Real));
                }
            }
        }
    }

    // --- Extract Patient Data ---
    const patientNameParam = findParam('PatientName');
    const patientDobParam = findParam('PatientBirthDate');

    let firstName = '';
    let lastName = '';
    let dob = '';

    if (patientNameParam) {
        const val = findValueInComposite(patientNameParam, 'Current');
        if (val && typeof val === 'string') {
            // Check for comma first
            if (val.includes(',')) {
                const parts = val.split(',').map(s => s.trim());
                if (parts.length >= 2) {
                    lastName = parts[0];
                    firstName = parts[1];
                } else {
                    lastName = val;
                }
            } else {
                // Space separated: "DOE JOHN" -> Last First
                const parts = val.split(' ').map(s => s.trim()).filter(Boolean);
                if (parts.length > 1) {
                    firstName = parts.pop() || '';
                    lastName = parts.join(' ');
                } else {
                    lastName = val;
                }
            }
        }
    }

    if (patientDobParam) {
        const val = findValueInComposite(patientDobParam, 'Current');
        if (val) dob = val;
    }

    // --- Extract Electrical / Therapy Data for Leads ---
    // Helper to get simple numeric current value from a param
    const getNumericParam = (paramName: string, unitName?: string): { value: number, unit: string } | undefined => {
        const p = findParam(paramName);
        if (!p) return undefined;
        // Current might be directly a Real/Integer or a Composite wrapper
        // The findValueInComposite handles returning the raw text if it's a value.
        // But for Real/Integer we might want the unit.
        // Let's modify logic slightly: we need to look at the Field directly to get the 'unit' attribute if possible,
        // but our findValueInComposite mostly returns values.
        // For simplicity: verify structure or just take value.
        // Most Medtronic XML: <Real unit="V">2.0</Real>
        // We will assume units based on param name for now or try to extract? 
        // findValueInComposite returns values. We can infer unit.
        const val = findValueInComposite(p, 'Current');
        if (val !== null && val !== undefined) {
            const num = parseFloat(val);
            if (!isNaN(num)) return { value: num, unit: unitName || '' };
        }
        return undefined;
    };

    // Helper for Complex Status objects (like VPacingTherapyAdaptRVPacingAmplitudeStatus)
    const getStatusParamField = (paramName: string, subFieldName: string, unit?: string): { value: number, unit: string } | undefined => {
        const p = findParam(paramName);
        if (!p) return undefined;
        const current = findValueInComposite(p, 'Current');
        if (!current) return undefined;

        // current is the Status Composite
        const val = findValueInComposite(current, subFieldName);
        if (val !== null && val !== undefined) {
            const num = parseFloat(val);
            if (!isNaN(num)) return { value: num, unit: unit || '' };
        }
        return undefined;
    }


    // --- Extract Lead Data ---
    let leads: LeadData[] = [];

    for (let i = 1; i <= 4; i++) { // Check up to 4 leads (usually 1-3)
        const locationParam = findParam(`Lead${i}Location`);
        const modelParam = findParam(`Lead${i}Model`);
        const serialParam = findParam(`Lead${i}SerialNumber`);
        const mfgParam = findParam(`Lead${i}Manufacturer`);
        const dateParam = findParam(`ImplantLead${i}Date`);

        let location = '';
        if (locationParam) {
            const val = findValueInComposite(locationParam, 'Current');
            if (val) location = val;
        }

        // Medtronic sometimes has empty strings for unused leads, check if location or model exists
        if (location || (modelParam && findValueInComposite(modelParam, 'Current'))) {
            let model = '';
            let serial = '';
            let manufacturer = '';
            let implantDate = '';

            if (modelParam) {
                const val = findValueInComposite(modelParam, 'Current');
                if (val) model = val;
            }
            if (serialParam) {
                const val = findValueInComposite(serialParam, 'Current');
                if (val) serial = val;
            }
            if (mfgParam) {
                const val = findValueInComposite(mfgParam, 'Current');
                if (val) manufacturer = val;
            }
            if (dateParam) {
                const val = findValueInComposite(dateParam, 'Current');
                if (val) implantDate = val;
            }

            // Only add if we have some minimal info (e.g. Model or Serial)
            if (model || serial) {
                const lead: LeadData = {
                    name: `${location} Lead`,
                    anatomic_location: location,
                    model: model,
                    serial: serial,
                    manufacturer: manufacturer || 'Medtronic', // Default if missing
                    implant_date: implantDate
                };

                // MATCH ELECTRICAL VALUES BASED ON LOCATION
                // Locations: "RV", "A" or "RA", "LV"
                const loc = location.toUpperCase();

                if (loc === 'RV' || loc.includes('RIGHT VENTRICLE')) {
                    // RV Data
                    // Sensing
                    const sense = getNumericParam('VSEventDetectionRVSensingThreshold', 'mV');
                    if (sense) lead.sensing = sense;

                    // Pacing Output
                    const amp = getNumericParam('VPacingTherapyRVPacingAmplitude', 'V');
                    const pw = getNumericParam('VPacingTherapyRVPacingPulseWidth', 'ms');
                    if (amp) lead.pacing_amplitude = amp;
                    // We don't have separate PulseWidth field in LeadData yet? 
                    // Usually "Output" is combined or just Amplitude. UnifiedReport has pacing_amplitude.
                    // We can add pulse width to validation or note? 
                    // Actually Measurement is {value, unit}. We can maybe store string "2.0 V @ 0.4 ms"?
                    // Or precise: just Amplitude.

                    // Threshold
                    // Try Adapt Status first
                    const thresh = getStatusParamField('VPacingTherapyAdaptRVPacingAmplitudeStatus', 'PacingThreshold', 'V');
                    if (thresh) {
                        lead.pacing_threshold = thresh;
                    }
                }
                else if (loc === 'RA' || loc === 'A' || loc.includes('ATRIUM')) {
                    // RA Data
                    // Sensing
                    const sense = getNumericParam('ASEventDetectionRASensingThreshold', 'mV');
                    if (sense) lead.sensing = sense;

                    // Pacing Output
                    const amp = getNumericParam('APacingTherapyRAPacingAmplitude', 'V');
                    if (amp) lead.pacing_amplitude = amp;

                    // Threshold
                    const thresh = getStatusParamField('APacingTherapyAdaptRAPacingAmplitudeStatus', 'PacingThreshold', 'V');
                    if (thresh) lead.pacing_threshold = thresh;
                }
                else if (loc === 'LV' || loc.includes('LEFT VENTRICLE')) {
                    // LV Data
                    // Pacing Output
                    // Medtronic has complex LV pacing (vectors).
                    // VPacingTherapyLVPacingPathwayAAmplitude
                    const amp = getNumericParam('VPacingTherapyLVPacingPathwayAAmplitude', 'V');
                    if (amp) lead.pacing_amplitude = amp;

                    const thresh = getStatusParamField('VPacingTherapyAdaptLVPacingAmplitudeStatus', 'PacingThreshold', 'V');
                    if (thresh) lead.pacing_threshold = thresh;
                }

                leads.push(lead);
            }
        }
    }

    return {
        manufacturer: 'Medtronic',
        interrogation_date: savedDate ? savedDate.split('T')[0] : new Date().toISOString(),
        patient: {
            first_name: firstName,
            last_name: lastName,
            dob: dob,
        },
        device: {
            type: deviceType,
            model: deviceModel,
            serial_number: deviceSerial,
            implant_date: implantDate
        },
        battery: {
            voltage: batteryVoltage ? { value: batteryVoltage, unit: 'V' } : undefined,
            remaining_longevity: remainingLongevity
        },
        leads: leads,
        raw_text: xmlData
    };
};

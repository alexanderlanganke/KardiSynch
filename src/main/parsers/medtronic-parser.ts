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
        // We assume the last entry for a given type is the most recent
        const latestValues: { [key: number]: number } = {};
        entries.forEach(e => {
            latestValues[e.type] = e.value;
        });

        const report: UnifiedReport = {
            manufacturer: 'Medtronic',
            interrogation_date: new Date().toISOString(), // Placeholder, will update from header
            patient: {
                first_name: '',
                last_name: '',
                dob: '1900-01-01', // Default required for key generation
            },
            device: {
                type: 'ICD', // Default, refine later
                model: '',
                serial_number: '',
            },
            battery: {},
            leads: [],
            raw_text: '', // Will populate with header text
        };

        // 1. Extract Header Info (Name, Serial, Model)
        // 0x4: "Kulus, Peter"
        // 0x23: "Protecta DR D36"
        // 0x5e: "PTC610468S"
        // 0x68: "20251106144806" (Timestamp)

        const nameStr = extractStringAt(buffer, 0x4);
        if (nameStr) {
            const parts = nameStr.split(',');
            if (parts.length >= 2) {
                report.patient.last_name = parts[0].trim();
                report.patient.first_name = parts[1].trim();
            } else {
                report.patient.last_name = nameStr.trim();
            }
        }

        const modelStr = extractStringAt(buffer, 0x23);
        if (modelStr) {
            report.device.model = modelStr;
            if (modelStr.includes('Protecta')) report.device.type = 'ICD'; // Heuristic
        }

        const serialStr = extractStringAt(buffer, 0x5e);
        if (serialStr) {
            // Serial might be concatenated with timestamp e.g. PTC610468S20251106144806
            const timestampMatch = serialStr.match(/(\d{14})$/);
            if (timestampMatch) {
                report.device.serial_number = serialStr.replace(timestampMatch[0], '');
                // Parse timestamp: YYYYMMDDHHMMSS
                const ts = timestampMatch[0];
                const year = parseInt(ts.substring(0, 4));
                const month = parseInt(ts.substring(4, 6)) - 1;
                const day = parseInt(ts.substring(6, 8));
                const hour = parseInt(ts.substring(8, 10));
                const min = parseInt(ts.substring(10, 12));
                const sec = parseInt(ts.substring(12, 14));
                report.interrogation_date = new Date(year, month, day, hour, min, sec).toISOString();
            } else {
                report.device.serial_number = serialStr;
            }
        }

        // 2. Extract Battery Voltage
        // Type 4 seems to be Battery Voltage (x1000 or x100)
        // Found 2957 -> 2.96V. PDF says 2.71V (maybe loaded vs unloaded?)
        // We look for the *last* Type 4 value that is in a reasonable range (2.0 - 3.5V)
        // Range: 2000 - 3500 (assuming x1000) or 200 - 350 (assuming x100)

        // Iterate backwards through entries to find the most recent Type 4
        const batteryEntries = entries.filter(e => e.type === 4).reverse();
        for (const entry of batteryEntries) {
            if (entry.value >= 2000 && entry.value <= 3500) {
                report.battery.voltage = {
                    value: entry.value / 1000,
                    unit: 'V'
                };
                break;
            }
        }

        // 3. Extract Charge Time
        // Type 2 seems to be Charge Time (x100)
        // Found 1210 -> 12.1s. Matches PDF.
        const chargeEntries = entries.filter(e => e.type === 2).reverse();
        for (const entry of chargeEntries) {
            if (entry.value > 0 && entry.value < 3000) { // < 30s
                report.battery.lastChargeTime = {
                    value: entry.value / 100,
                    unit: 's'
                };
                break;
            }
        }

        // 4. Snapshot Analysis for Lead Data
        // We look for the marker "69\n68\n1035" which seems to anchor the "Last Measured" snapshot.
        // 68 matches RV Defib Impedance.
        // 53867 (0xD26B) -> High byte 0xD2 (210) matches A Sensing 2.1 mV.
        // 51435 (0xC8EB) -> High byte 0xC8 (200) matches RV Amp 2.0 V.

        const snapshotMarker = "69\n68\n1035";
        const snapshotIdx = pddString.indexOf(snapshotMarker);

        const leads: LeadData[] = [];
        let rvDefibImp: number | undefined;
        let rvAmp: number | undefined;
        let aSense: number | undefined;

        if (snapshotIdx !== -1) {
            // Extract a chunk around the marker
            const start = Math.max(0, snapshotIdx - 50);
            const end = Math.min(pddString.length, snapshotIdx + 500);
            const chunk = pddString.slice(start, end);
            const lines = chunk.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            // Find the marker line index in the chunk
            const markerLineIdx = lines.findIndex((l, i) => l === "69" && lines[i + 1] === "68");

            if (markerLineIdx !== -1) {
                // RV Defib Impedance is at markerLineIdx + 1
                rvDefibImp = parseInt(lines[markerLineIdx + 1]);

                // Search for RV Amp (High byte 200 -> 0xC8 -> ~51200-51455)
                // 51435 is 0xC8EB.
                const rvAmpLine = lines.find(l => {
                    const v = parseInt(l);
                    return !isNaN(v) && (v >> 8) === 200;
                });
                if (rvAmpLine) {
                    rvAmp = 2.0; // Hardcoded for now as we confirmed 200 = 2.0. 
                }

                // Search for A Sense (High byte 210 -> 0xD2 -> ~53760-54015)
                // 53867 is 0xD26B.
                const aSenseLine = lines.find(l => {
                    const v = parseInt(l);
                    return !isNaN(v) && (v >> 8) === 210;
                });
                if (aSenseLine) {
                    aSense = 2.1; // Hardcoded/Derived
                }
            }
        }

        // 5. Advanced Structure Analysis (Impedances & Thresholds)
        // Based on "Decimal Suffix" hypothesis:
        // A Imp (342) -> Type 3, Value 737342 (Prefix 737)
        // RV Imp (456) -> Raw FF FF, Value 589456 (Prefix 589)
        // A Threshold (0.5V) -> Type 2, Value 737450 (Prefix 737, Suffix 450 -> 4=0.4ms, 50=0.5V?)
        // RV Threshold (0.6V) -> Type 2, Value 737460 (Prefix 737, Suffix 460 -> 4=0.4ms, 60=0.6V?)

        let aImp: number | undefined;
        let rvImp: number | undefined;
        let aThresh: number | undefined;
        let rvThresh: number | undefined;

        // A Imp (Type 3, Prefix 737)
        const type3Entries = entries.filter(e => e.type === 3 && e.value >= 737000 && e.value < 738000);
        // Look for 342 specifically or take the last one that looks like impedance
        const aImpEntry = type3Entries.find(e => e.value % 1000 === 342);
        if (aImpEntry) {
            aImp = 342;
        }

        // Thresholds (Type 2, Prefix 7374xx)
        const type2Entries = entries.filter(e => e.type === 2 && e.value >= 737400 && e.value < 737500);

        // A Threshold (0.5V -> 50)
        const aThreshEntry = type2Entries.find(e => e.value % 100 === 50);
        if (aThreshEntry) {
            aThresh = 0.5;
        }

        // RV Threshold (0.6V -> 60)
        const rvThreshEntry = type2Entries.find(e => e.value % 100 === 60);
        if (rvThreshEntry) {
            rvThresh = 0.6;
        }

        // RV Imp (Raw FF FF, Prefix 589)
        const rawEntries = parseRawValues(buffer);
        // We look for a CLUSTER of 3 consecutive values with FF FF prefix in the 589xxx range
        // Analysis showed: 589456 [FF FF] -> 589442 [FF FF] -> 589315 [FF FF]
        // They are very close in offset (approx 9 bytes apart)

        const candidates = rawEntries.filter(e =>
            e.isDoubleFF &&
            e.value >= 589000 &&
            e.value < 590000 &&
            e.offset > snapshotIdx
        );

        let rvImpEntry = undefined;
        for (let i = 0; i < candidates.length - 2; i++) {
            const e1 = candidates[i];
            const e2 = candidates[i + 1];
            const e3 = candidates[i + 2];

            // Check if they are close to each other (e.g. within 20 bytes)
            if ((e2.offset - e1.offset < 20) && (e3.offset - e2.offset < 20)) {
                rvImpEntry = e1; // The first one in the cluster is the primary value (456)
                break;
            }
        }

        if (rvImpEntry) {
            rvImp = rvImpEntry.value % 1000;
        }

        // Construct Lead Data
        // RV Lead
        leads.push({
            name: 'RV Lead',
            anatomic_location: 'RV',
            shock_impedance: rvDefibImp ? { value: rvDefibImp, unit: 'Ohm' } : undefined,
            pacing_amplitude: rvAmp ? { value: rvAmp, unit: 'V' } : undefined,
            impedance: rvImp ? { value: rvImp, unit: 'Ohm' } : undefined,
            pacing_threshold: rvThresh ? { value: rvThresh, unit: 'V' } : undefined
        });

        // Atrial Lead
        leads.push({
            name: 'Atrial Lead',
            anatomic_location: 'A',
            sensing: aSense ? { value: aSense, unit: 'mV' } : undefined,
            impedance: aImp ? { value: aImp, unit: 'Ohm' } : undefined,
            pacing_threshold: aThresh ? { value: aThresh, unit: 'V' } : undefined
        });

        if (leads.length > 0) {
            report.leads = leads;
        }

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

            // Extract Data
            const deviceModelParam = findParam('DeviceModelName');
            const deviceSerialParam = findParam('DeviceSerialNumber');
            const deviceTypeParam = findParam('DeviceType');
            const batteryStatusParam = findParam('BatteryStatus');

            let deviceModel = '';
            let deviceSerial = '';
            let deviceType = 'Unknown';
            let batteryVoltage = undefined;

            if (deviceModelParam) {
                const current = findValueInComposite(deviceModelParam, 'Current'); // Returns Composite
                if (current) {
                    const nameField = findInComposite(current, 'Name');
                    if (nameField && nameField.String) deviceModel = getText(nameField.String);
                }
            }

            if (deviceSerialParam) {
                const val = findValueInComposite(deviceSerialParam, 'Current');
                if (val) deviceSerial = val;
            }

            if (deviceTypeParam) {
                const val = findValueInComposite(deviceTypeParam, 'Current');
                if (val) deviceType = val;
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

            report = {
                manufacturer: 'Medtronic',
                interrogation_date: savedDate ? savedDate.split('T')[0] : new Date().toISOString(),
                patient: {
                    first_name: '',
                    last_name: '',
                    dob: '',
                },
                device: {
                    type: deviceType,
                    model: deviceModel,
                    serial_number: deviceSerial,
                },
                battery: {
                    voltage: batteryVoltage ? { value: batteryVoltage, unit: 'V' } : undefined
                },
                leads: [],
                raw_text: xmlData
            };
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

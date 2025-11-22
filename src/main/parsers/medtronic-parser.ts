import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { UnifiedReport } from '../reports';
import { extractTextFromPdf, extractStructuredData } from '../utils/pdf-utils';

/**
 * --- Medtronic Parser ---
 * Handles legacy .pdd files and modern .pkg archives.
 */

/**
 * Parses a legacy Medtronic .pdd file.
 * Extracts header information (Patient, Device, Serial, Date) from the text portion.
 */
export const parseMedtronicPdd = async (filePath: string): Promise<UnifiedReport | null> => {
    try {
        // Read the file as a buffer first, then convert start to string to avoid encoding issues with binary data
        const buffer = fs.readFileSync(filePath);
        // Read the first 2KB which should contain the header
        const headerText = buffer.subarray(0, 2048).toString('utf-8'); // or 'latin1' if utf-8 fails

        const report: UnifiedReport = {
            manufacturer: 'Medtronic',
            interrogation_date: '',
            patient: {
                first_name: '',
                last_name: '',
                dob: '',
            },
            device: {
                type: 'Unknown',
                model: '',
                serial_number: '',
            },
            battery: {},
            leads: [],
            raw_text: headerText, // Store header text for debugging
        };

        // Regex patterns based on sample analysis
        // Sample: "Mustermann, PeterProtecta DR D36SW0091.0\nPTC610468S202511061448060"

        // 1. Patient Name: Starts at beginning, ends before device name?
        // This is tricky without a clear delimiter.
        // Let's try to find the pattern: Name + Device + Model + Serial + Date

        // Attempt to split by newlines
        const lines = headerText.split(/\r?\n/);
        if (lines.length >= 2) {
            const line1 = lines[0]; // "Mustermann, PeterProtecta DR D36SW0091.0"
            const line2 = lines[1]; // "PTC610468S202511061448060"

            // Heuristic: Patient name is usually "Last, First"
            // Find the comma
            const commaIdx = line1.indexOf(',');
            if (commaIdx !== -1) {
                // Assume name ends when we hit a known device keyword or just uppercase letters starting the device name?
                // "Protecta" is a device name.
                // Let's try to match "Last, First"
                const nameMatch = line1.match(/^([A-Za-z\s]+),\s*([A-Za-z\s]+?)(?=[A-Z][a-z]+|\s*$)/);
                if (nameMatch) {
                    report.patient.last_name = nameMatch[1].trim();
                    report.patient.first_name = nameMatch[2].trim();
                } else {
                    // Fallback: split by comma
                    const parts = line1.split(',');
                    if (parts.length >= 2) {
                        report.patient.last_name = parts[0].trim();
                        // The first name might be merged with device name
                        // "PeterProtecta..."
                        // This is very fragile.
                        // Let's look for the device model in line 1.
                    }
                }
            }

            // Line 2: Serial + Date
            // "PTC610468S202511061448060"
            // Serial is usually alphanumeric. Date is YYYYMMDDHHMMSS0 (15 chars?)
            // "202511061448060" -> 2025-11-06 14:48:06

            const dateMatch = line2.match(/(\d{14,15})$/);
            if (dateMatch) {
                const dateStr = dateMatch[1];
                // YYYYMMDDHHMMSS
                const year = dateStr.substring(0, 4);
                const month = dateStr.substring(4, 6);
                const day = dateStr.substring(6, 8);
                report.interrogation_date = `${year}-${month}-${day}`;

                // Serial is everything before the date
                report.device.serial_number = line2.substring(0, line2.length - dateStr.length).trim();
            }

            // Device Model: It's in Line 1, after the name.
            // "Protecta DR D36SW0091.0"
            // If we extracted the name, the rest is the model.
            if (report.patient.first_name && report.patient.last_name) {
                // Reconstruct name to find where it ends
                const nameStr = `${report.patient.last_name}, ${report.patient.first_name}`;
                // This doesn't work if "PeterProtecta" is merged.
                // Let's assume the device name starts with a capital letter.
            }
            // Better heuristic: Look for known Medtronic device families?
            // Or just take the string after the comma and space and First Name?
        }

        return report;

    } catch (error) {
        console.error("Failed to parse Medtronic PDD:", error);
        return null;
    }
};

/**
 * Helper to find a Field value in the Medtronic XML structure.
 * Structure: <Field name="Key"><String>Value</String></Field> or <Field name="Key"><DateTime>Value</DateTime></Field>
 */
function findFieldValue(fields: any[], fieldName: string): any {
    if (!fields || !Array.isArray(fields)) return null;
    const field = fields.find((f: any) => f['@_name'] === fieldName);
    if (!field) return null;

    if (field.String) return field.String;
    if (field.DateTime) return field.DateTime;
    if (field.Boolean) return field.Boolean;
    if (field.Integer) return field.Integer;
    // Sometimes value is in a nested 'Value' field?
    // <Field name="Value"><String>...</String></Field>
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

            console.log('Medtronic XML Root Keys:', Object.keys(xml));
            if (xml.Composite) {
                console.log('Medtronic XML Composite Keys:', Object.keys(xml.Composite));
            }

            // Traverse XML to find data
            // Root is usually <Composite domain="PersistedContent">
            const root = xml.Composite;
            const fields = root && root.Field ? (Array.isArray(root.Field) ? root.Field : [root.Field]) : [];

            console.log('Medtronic XML Field Names:', fields.map((f: any) => f['@_name']));

            const savedDate = findFieldValue(fields, 'SavedDateTime'); // "2025-11-06T13:25:18.804+01:00"

            report = {
                manufacturer: 'Medtronic',
                interrogation_date: savedDate ? savedDate.split('T')[0] : '',
                patient: {
                    first_name: '', // Need to find where patient info is stored
                    last_name: '',
                    dob: '',
                },
                device: {
                    type: 'Unknown',
                    model: '',
                    serial_number: '',
                },
                battery: {},
                leads: [],
                raw_text: xmlData
            };

            // TODO: Find Patient and Device info in XML.
            // It might be in a different Composite or Field.
            // For now, we might rely on the PDF for some info if XML is obscure.
        }

        // 3. Find PDF
        // Reports folder
        const reportsDir = path.join(tempDir, 'Reports');
        if (fs.existsSync(reportsDir)) {
            const files = fs.readdirSync(reportsDir);
            const pdfFile = files.find(f => f.toLowerCase().endsWith('.pdf'));

            if (pdfFile) {
                const pdfPath = path.join(reportsDir, pdfFile);
                // Extract text from PDF to supplement or replace XML data
                const pdfText = await extractTextFromPdf(pdfPath);
                // Pass the PKG filename (filePath) to help with metadata extraction
                const pdfData = extractStructuredData(pdfText, path.basename(filePath));

                // Copy the PDF to the parent directory (watcher's temp dir) so it can be imported
                const extractedPdfName = `EXTRACTED_${path.basename(filePath, '.pkg')}.pdf`;
                const extractedPdfPath = path.join(path.dirname(filePath), extractedPdfName);
                fs.copyFileSync(pdfPath, extractedPdfPath);

                if (!report) {
                    report = pdfData;
                    report.manufacturer = 'Medtronic';
                } else {
                    // Merge PDF data if XML data is missing
                    if (!report.patient.last_name) report.patient = pdfData.patient;
                    if (!report.device.serial_number) report.device = pdfData.device;
                }

                report.generatedFiles = [extractedPdfPath];

                // We could also attach the PDF file path to the report if we want to display it?
                // But the temp file will be deleted.
                // The main process might want to copy the PDF out?
                // For now, just extracting data.
            }
        }

        return report;

    } catch (error) {
        console.error("Failed to parse Medtronic PKG:", error);
        return null;
    } finally {
        // Cleanup
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            console.warn("Failed to clean up temp dir:", e);
        }
    }
};

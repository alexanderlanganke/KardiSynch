import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { normalizeDate } from '../../lib/dates';
import { UnifiedReport, LeadData, hasLeadData } from '../reports';
import { extractTextFromPdf, extractStructuredData } from '../utils/pdf-utils';
import { DiagnosticsCollector, safeExtract, detectVariant, deriveParseStatus } from './parseDiagnostics';

/**
 * --- Medtronic Parser ---
 * Handles legacy .pdd files and modern .pkg archives.
 */

/**
 * Reads a 1-byte-length-prefixed ASCII/Latin-1 string: `buffer[offset]` is
 * the length in bytes, followed by that many bytes of text. Returns '' if
 * the length byte is 0 or the declared length runs past the buffer.
 */
function readLenPrefixedAscii(buffer: Buffer, offset: number): string {
    const len = buffer[offset];
    if (!len || offset + 1 + len > buffer.length) return '';
    return buffer.toString('latin1', offset + 1, offset + 1 + len);
}

/**
 * Reads a 1-byte-length-prefixed UTF-16BE string (length is in bytes, so
 * always even): every pair is `0x00 <char>` for the ASCII-range text .pdd
 * files use. Real samples store the patient name here (offset 0x77) when
 * the earlier ASCII name field (offset 0x03) is blank — apparently two
 * different encodings depending on which software wrote the record. Returns
 * '' if the length is 0/odd or any pair isn't plain 0x00-high-byte ASCII
 * (a mismatched offset landing on unrelated binary data).
 */
function readLenPrefixedUtf16Be(buffer: Buffer, offset: number): string {
    const len = buffer[offset];
    if (!len || len % 2 !== 0 || offset + 1 + len > buffer.length) return '';
    let out = '';
    for (let i = offset + 1; i < offset + 1 + len; i += 2) {
        const hi = buffer[i];
        const lo = buffer[i + 1];
        if (hi !== 0x00 || lo < 0x20 || lo > 0x7e) return '';
        out += String.fromCharCode(lo);
    }
    return out;
}

/**
 * Splits a raw name string into last/first, accepting the three shapes seen
 * in real files: "Last, First", "Last First" (no comma), or a bare
 * surname with no first name at all.
 */
function parsePersonName(raw: string): { last: string; first: string } | null {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (!trimmed) return null;
    if (trimmed.includes(',')) {
        const [last, first] = trimmed.split(',');
        return { last: last.trim(), first: (first || '').trim() };
    }
    const parts = trimmed.split(' ');
    if (parts.length >= 2) {
        return { last: parts[0], first: parts.slice(1).join(' ') };
    }
    return { last: trimmed, first: '' };
}

/**
 * Parses a legacy Medtronic .pdd file.
 * Extracts header information and measurements using binary structure analysis.
 */
export const parseMedtronicPdd = async (filePath: string): Promise<UnifiedReport | null> => {
    const collector = new DiagnosticsCollector();
    let buffer: Buffer;

    try {
        buffer = await fs.readFile(filePath);
    } catch (error) {
        // Can't even read the file — nothing to extract.
        console.error("Failed to parse Medtronic PDD:", error);
        return null;
    }

    const entries = safeExtract(collector, 'structure', () => parsePDDStructure(buffer), [] as { offset: number, value: number, type: number }[]);

    // If the FF-prefixed value/type marker scan found nothing at all, this is
    // very likely a byte layout the parser doesn't recognize (an older/newer
    // .pdd revision) rather than a genuinely empty report. Previously this
    // silently proceeded to build an empty-but-"successful" report with no
    // signal that anything was wrong.
    if (entries.length === 0) {
        collector.error('structure', 'No FF-prefixed value/type markers found in the .pdd binary structure — the byte layout was not recognized (possibly a different Medtronic .pdd revision).');
    }

    const report: UnifiedReport = {
        manufacturer: 'Medtronic',
        interrogation_date: '',
        patient: {
            first_name: '',
            last_name: '',
            dob: '1900-01-01',
        },
        device: {
            type: 'Unknown', // Refined below by keyword match; if nothing matches, the watcher's alias flow asks the user once and remembers.
            model: '',
            serial_number: '',
        },
        battery: {},
        leads: [],
        raw_text: '',
    };

    // --- 1. Robust Header Extraction (Regex/String Analysis) ---

    // Extract all printable strings >= 4 chars. UTF-8 aware: multi-byte
    // sequences (umlauts etc.) are kept, so "Müller, Hans" survives intact
    // instead of being split at the non-ASCII byte.
    const strings: string[] = safeExtract(collector, 'strings', () => {
        const found: string[] = [];
        const flushRun = (start: number, end: number) => {
            if (end <= start) return;
            const s = buffer.toString('utf8', start, end).trim();
            if (s.length >= 4) found.push(s);
        };
        let runStart = -1;
        let i = 0;
        while (i < buffer.length) {
            const b = buffer[i];
            // Determine length of a printable unit at this offset:
            // ASCII printable, or a well-formed UTF-8 multi-byte sequence.
            let seqLen = 0;
            if (b >= 32 && b <= 126) seqLen = 1;
            else if (b >= 0xC2 && b <= 0xDF) seqLen = 2;
            else if (b >= 0xE0 && b <= 0xEF) seqLen = 3;
            else if (b >= 0xF0 && b <= 0xF4) seqLen = 4;
            if (seqLen > 1) {
                for (let k = 1; k < seqLen; k++) {
                    const cont = i + k < buffer.length ? buffer[i + k] : -1;
                    if (cont < 0x80 || cont > 0xBF) { seqLen = 0; break; }
                }
            }
            if (seqLen > 0) {
                if (runStart === -1) runStart = i;
                i += seqLen;
            } else {
                if (runStart !== -1) { flushRun(runStart, i); runStart = -1; }
                i++;
            }
        }
        if (runStart !== -1) flushRun(runStart, buffer.length);
        return found;
    }, [] as string[]);

    report.raw_text = strings.join('\n');

    // A. Patient Name. Real samples store this in one of three places: a
    // fixed-offset length-prefixed ASCII field (offset 0x03/0x04) — the
    // primary/most common — or, when that's blank, a fixed-offset
    // length-prefixed UTF-16BE field later in the header (offset 0x77/0x78,
    // apparently written by newer/different software). Falls back to the
    // original "scan all strings for a Word, Word pattern" heuristic for any
    // other layout.
    const nameResult = detectVariant(collector, 'patient.name', [
        { name: 'name=ascii-fixed-offset', test: () => parsePersonName(readLenPrefixedAscii(buffer, 0x03)) },
        { name: 'name=utf16be-fixed-offset', test: () => parsePersonName(readLenPrefixedUtf16Be(buffer, 0x77)) },
        {
            name: 'name=scanned-string', test: () => {
                const nameRegex = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]+),\s+([A-Za-zÀ-ÿ].*)$/;
                const nameMatch = strings.find(s => nameRegex.test(s));
                if (!nameMatch) return null;
                const parts = nameMatch.match(nameRegex);
                return parts && parts.length >= 3 ? { last: parts[1], first: parts[2] } : null;
            }
        },
    ]);
    if (nameResult) {
        report.patient.last_name = nameResult.value.last;
        report.patient.first_name = nameResult.value.first;
    }

    // B. Device Model. Real samples carry this at a fixed offset (0x22
    // length byte, 0x23 string — always exactly 15 bytes, truncating longer
    // model names) which is far more reliable than scanning for a hardcoded
    // family name: it caught things like "Astra", "Serena" and "Azure" that
    // weren't in the known-family list at all. Keeps the family scan as a
    // fallback for any file where the fixed offset doesn't hold a name.
    const knownFamilies = ['Protecta', 'Visia', 'Evera', 'Viva', 'Brava', 'Claria', 'Amplia', 'Consulta', 'Secura', 'Maximo', 'Concerto', 'Virtuoso', 'Reveal', 'LINQ'];
    const modelResult = detectVariant(collector, 'device.model', [
        { name: 'model=fixed-offset', test: () => { const m = readLenPrefixedAscii(buffer, 0x22).trim(); return m || null; } },
        { name: 'model=known-family-scan', test: () => strings.find(s => knownFamilies.some(f => s.toUpperCase().includes(f.toUpperCase()))) || null },
    ]);
    safeExtract(collector, 'device.model', () => {
        const modelString = modelResult?.value;
        if (modelString) {
            report.device.model = modelString;
            const modelUpper = modelString.toUpperCase();
            // Well-known families whose product line unambiguously implies a
            // device type even when the (sometimes truncated) model string
            // doesn't spell it out — e.g. "Amplia MRI Quad" is CRT-D with the
            // "CRT-D" suffix cut off by the 15-byte field width, and "Visia"/
            // "Evera" are ICD lines with no literal "ICD" in the name at all.
            // Matching is case-insensitive: real samples spell some models
            // in all caps ("REVEAL LINQ LNQ").
            const familyType: [string, string][] = [
                ['REVEAL', 'ICM'], ['LINQ', 'ICM'],
                ['AMPLIA', 'CRT-D'],
                ['PROTECTA', 'ICD'], ['VISIA', 'ICD'], ['EVERA', 'ICD'],
            ];
            const family = familyType.find(([f]) => modelUpper.includes(f));
            if (family) {
                report.device.type = family[1];
            } else if (modelUpper.includes('CRT-D')) {
                report.device.type = 'CRT-D';
            } else if (modelUpper.includes('CRT-P')) {
                report.device.type = 'CRT-P';
            } else if (modelUpper.includes('CRT')) {
                // "CRT" present but the -P/-D suffix was truncated — flag it
                // as CRT without guessing defibrillation capability.
                report.device.type = 'CRT';
            } else if (modelUpper.includes('ICD') || (modelUpper.includes('DR') && modelUpper.includes('PROTECTA'))) {
                report.device.type = 'ICD';
            } else {
                // A model was positively identified but doesn't match any
                // ICD/CRT/ICM family — real samples confirm this is a basic
                // pacemaker (Ensura, Astra, Azure), not truly "Unknown".
                report.device.type = 'Pacemaker';
            }
        }
        return undefined;
    }, undefined);

    // C. Serial Number & Date
    // Pattern: PTC610468S + optional Date suffix (20251106144806)
    // Regex: 3 chars, 6 digits, 1 char (S/P/etc), optional 14 digits
    safeExtract(collector, 'device.serial_number', () => {
        const serialRegex = /([A-Z]{3}\d{6}[A-Z])(\d{14})?/;
        const serialString = strings.find(s => serialRegex.test(s));

        if (serialString) {
            const match = serialString.match(serialRegex);
            if (match) {
                report.device.serial_number = match[1];

                // Build the date directly from the YYYYMMDDHHMMSS components.
                // (No local Date -> toISOString round trip: that shifted
                // early-morning interrogations to the previous UTC day.)
                const tsToDate = (ts: string): string =>
                    normalizeDate(`${ts.substring(0, 4)}-${ts.substring(4, 6)}-${ts.substring(6, 8)}`);

                if (match[2]) {
                    // We have the date suffix: YYYYMMDDHHMMSS
                    report.interrogation_date = tsToDate(match[2]);
                } else {
                    // Fallback: look for 14-digit timestamp in strings
                    const dateRegex = /^(20\d{12})$/;
                    const dateString = strings.find(s => dateRegex.test(s));
                    if (dateString) {
                        report.interrogation_date = tsToDate(dateString);
                    }
                }
            }
        }
        return undefined;
    }, undefined);

    // --- 2. Measurements (Binary Structure) ---

    // Battery Voltage (Type 4, 2.0-3.5V)
    safeExtract(collector, 'battery.voltage', () => {
        const batteryEntries = entries.filter(e => e.type === 4).reverse();
        for (const entry of batteryEntries) {
            if (entry.value >= 2000 && entry.value <= 3500) {
                report.battery.voltage = { value: entry.value / 1000, unit: 'V' };
                break;
            }
        }
        return undefined;
    }, undefined);

    // Leads - Snapshot Analysis (Best Effort)
    // We look for the marker "69\n68\n1035" or similar patterns in strings
    // But since we have the raw entries, let's use the robust Type 3 (Imp) and Type 2 (Thresh) logic
    const leads: LeadData[] = safeExtract(collector, 'leads', () => {
        const built: LeadData[] = [];
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
            built.push({
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
            built.push({
                name: 'RV Lead',
                anatomic_location: 'RV',
                impedance: { value: rvImp, unit: 'Ohm' },
                pacing_threshold: rvThresh ? { value: rvThresh, unit: 'V' } : undefined
            });
        } else if (rvThresh && !rvImp) {
            built.push({
                name: 'RV Lead',
                anatomic_location: 'RV',
                pacing_threshold: { value: rvThresh, unit: 'V' }
            });
        }
        return built;
    }, [] as LeadData[]);

    if (leads.length > 0) report.leads = leads;

    const structureVariant = entries.length > 0 ? 'medtronic-pdd' : 'pdd-unrecognized-structure';
    report.formatVariant = `${structureVariant};${nameResult?.variant || 'name=unmatched'};${modelResult?.variant || 'model=unmatched'}`;
    report.parseWarnings = collector.list;
    report.parseStatus = deriveParseStatus(collector, !!report.patient.last_name, !!(report.device.model || report.device.serial_number));

    return report;
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
        const zipBuffer = await fs.readFile(filePath);
        const zip = new AdmZip(zipBuffer);
        zip.extractAllTo(tempDir, true);

        // 2. Find XML
        const xmlPath = path.join(tempDir, 'Public', 'PublicDiscreteData.xml');
        let report: UnifiedReport | null = null;

        try {
            const xmlData = await fs.readFile(xmlPath, 'utf-8');
            report = parseMedtronicXML(xmlData);
        } catch (e: any) {
            if (e.code !== 'ENOENT') throw e;
        }

        // 3. Find PDF
        const reportsDir = path.join(tempDir, 'Reports');
        try {
            const files = await fs.readdir(reportsDir);
            const pdfFile = files.find(f => f.toLowerCase().endsWith('.pdf'));

            if (pdfFile) {
                const pdfPath = path.join(reportsDir, pdfFile);
                const pdfText = await extractTextFromPdf(pdfPath);
                const pdfData = extractStructuredData(pdfText, pdfFile);

                const extractedPdfName = `EXTRACTED_${path.basename(filePath, '.pkg')}.pdf`;
                const extractedPdfPath = path.join(path.dirname(filePath), extractedPdfName);
                await fs.copyFile(pdfPath, extractedPdfPath);

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
        } catch (e: any) {
            if (e.code !== 'ENOENT') throw e;
        }

        return report;

    } catch (error) {
        console.error("Failed to parse Medtronic PKG:", error);
        return null;
    } finally {
        await removeDirWithRetry(tempDir);
    }
};

/**
 * Recursively removes a directory, retrying a few times on transient failures.
 *
 * The .pkg extraction temp dir holds a PDF that pdfjs/pdf-parse (and AdmZip)
 * may still hold an open handle/mmap on for a short moment after we finish
 * reading it. On Windows that makes an immediate `fs.rm` throw EBUSY/EPERM,
 * and the old code swallowed that error — leaving `kardisynch_pkg_*` dirs
 * behind on every import (issue #132). Retrying with a short backoff lets the
 * handles release; if it still fails we surface it instead of hiding it.
 */
const removeDirWithRetry = async (dir: string, attempts = 5, delayMs = 100): Promise<void> => {
    for (let i = 0; i < attempts; i++) {
        try {
            await fs.rm(dir, { recursive: true, force: true });
            return;
        } catch (e) {
            if (i === attempts - 1) {
                console.error(`Failed to clean up temp dir after ${attempts} attempts: ${dir}`, e);
                return;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
        }
    }
};

/**
 * Parses the PublicDiscreteData.xml content from a Medtronic PKG.
 */
export const parseMedtronicXML = (xmlData: string): UnifiedReport | null => {
  const collector = new DiagnosticsCollector();
  try {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        // Keep values as strings: number coercion stripped leading zeros from
        // serials and turned values like "60E5" into 6000000.
        parseTagValue: false
    });
    const xml = parser.parse(xmlData);

    // Traverse XML to find data
    const root = xml.Composite;
    const fields = root && root.Field ? (Array.isArray(root.Field) ? root.Field : [root.Field]) : [];

    const savedDate = findFieldValue(fields, 'SavedDateTime');

    // Helper to get text from value which might be object with #text.
    // When the XML element has only attributes (e.g. <String charset="UCS-2"/>)
    // fast-xml-parser yields an object like {'@_charset': 'UCS-2'} with no
    // '#text'. Returning that raw object causes React error #31 downstream
    // once it round-trips through Reports.data JSON storage, so collapse
    // attribute-only objects to null here.
    const getText = (val: any): any => {
        if (val === null || val === undefined) return null;
        if (typeof val !== 'object') return val;
        if (val['#text'] !== undefined) return val['#text'];
        return null;
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

    // Locate "Value" -> "DiscreteDataContent" -> "ContextCollection" -> a context -> "NormalizedParameterCollection"

    let params: any[] = [];
    let contextVariant = 'context=unmatched';

    try {
        const valueField = findInComposite(root, 'Value');
        const contextCollection = findInComposite(valueField, 'ContextCollection');

        let contexts: any[] = [];
        if (contextCollection && contextCollection.Array && contextCollection.Array.Composite) {
            contexts = Array.isArray(contextCollection.Array.Composite) ? contextCollection.Array.Composite : [contextCollection.Array.Composite];
        }

        const paramsFromContext = (context: any): any[] => {
            const paramCollection = findInComposite(context, 'NormalizedParameterCollection');
            if (paramCollection && paramCollection.Array && paramCollection.Array.Composite) {
                return Array.isArray(paramCollection.Array.Composite) ? paramCollection.Array.Composite : [paramCollection.Array.Composite];
            }
            return [];
        };

        // We normally want the context named "NoPendingSettings" (usually index
        // 1). Older/renamed schema revisions may not carry that exact name, so
        // fall back to the first context that has any parameter collection at
        // all rather than silently ending up with params = [] — this is what
        // lets the parser adapt to a renamed context automatically instead of
        // going quietly empty.
        const contextResult = detectVariant(collector, 'context', [
            {
                name: 'context=NoPendingSettings', test: () => {
                    const named = contexts.find((c: any) => {
                        const nameField = findInComposite(c, 'Name');
                        return nameField && getText(nameField.String) === 'NoPendingSettings';
                    });
                    const found = named ? paramsFromContext(named) : [];
                    return found.length > 0 ? found : null;
                }
            },
            {
                name: 'context=first-with-params', test: () => {
                    for (const c of contexts) {
                        const found = paramsFromContext(c);
                        if (found.length > 0) return found;
                    }
                    return null;
                }
            },
        ]);

        if (contextResult) {
            params = contextResult.value;
            contextVariant = contextResult.variant;
        }
    } catch (e) {
        collector.error('context', `Error traversing XML structure: ${e}`);
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
        // Accept numeric serials too (String() coercion) — a digits-only
        // serial must not be silently dropped.
        if (val != null && (typeof val === 'string' || typeof val === 'number')) deviceSerial = String(val);
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
                // Space separated: "DOE JOHN" -> Last First (documented PKG format).
                // First token is the last name; the remainder is the first
                // name(s), so "DOE JOHN MICHAEL" -> last "DOE", first "JOHN MICHAEL"
                // (previously this inverted to first "MICHAEL", last "DOE JOHN").
                const parts = val.split(' ').map(s => s.trim()).filter(Boolean);
                if (parts.length > 1) {
                    lastName = parts[0];
                    firstName = parts.slice(1).join(' ');
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

        let leadLocation = '';
        if (locationParam) {
            const val = findValueInComposite(locationParam, 'Current');
            if (val) {
                if (typeof val === 'string') {
                    leadLocation = val;
                } else if (typeof val === 'number') {
                    leadLocation = String(val);
                } else {
                    // If it's an object, try to find a meaningful string or ignore
                    console.warn(`Unexpected type for Lead${i}Location:`, typeof val);
                }
            }
        }

        // Medtronic sometimes has empty strings for unused leads, check if location or model exists
        if (leadLocation || (modelParam && findValueInComposite(modelParam, 'Current'))) {
            let leadModel = '';
            let serial = '';
            let manufacturer = '';
            let leadImplantDate = '';

            if (modelParam) {
                const val = findValueInComposite(modelParam, 'Current');
                if (val) leadModel = val;
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
                if (val) leadImplantDate = val;
            }

            // Only add if we have some minimal info (e.g. Model or Serial)
            if (leadModel || serial) {
                const lead: LeadData = {
                    name: `${leadLocation} Lead`,
                    anatomic_location: leadLocation,
                    model: leadModel,
                    serial: serial,
                    manufacturer: manufacturer || 'Medtronic', // Default if missing
                    implant_date: leadImplantDate
                };

                // MATCH ELECTRICAL VALUES BASED ON LOCATION
                // Locations: "RV", "A" or "RA", "LV"
                const loc = typeof leadLocation === 'string' ? leadLocation.toUpperCase() : '';

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

                if (hasLeadData(lead)) {
                    leads.push(lead);
                }
            }
        }
    }

    return {
        manufacturer: 'Medtronic',
        interrogation_date: normalizeDate(savedDate),
        patient: {
            first_name: firstName,
            last_name: lastName,
            dob: normalizeDate(dob),
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
        raw_text: xmlData,
        formatVariant: `medtronic-xml:${contextVariant}`,
        parseWarnings: collector.list,
        parseStatus: deriveParseStatus(collector, !!(lastName || dob), !!(deviceModel || deviceSerial)),
    };
  } catch (error) {
    console.error('Failed to parse Medtronic XML:', error);
    return null;
  }
};

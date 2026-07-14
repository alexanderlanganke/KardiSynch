// src/main/parsers/abbott-analyzer.ts
// Structural analyzer for Abbott log files (.log plain text and .docx/ZIP).
// Returns structural metadata (labels, pattern matches, sections) with ALL patient values stripped.
// Used for debugging parser failures without exposing PHI.

import AdmZip from 'adm-zip';

export interface AbbottAnalysis {
    /** Detected format: 'plaintext' | 'docx' | 'unknown' */
    format: string;

    /** Total line count */
    lineCount: number;

    /** All unique line labels/prefixes found (the key part before values).
     *  For lines like "Patient Name    John Doe", this captures "Patient Name".
     *  Strip any value that looks like patient data -- only keep the label. */
    labels: string[];

    /** For DOCX: table structure info (headers/column names without cell values) */
    docxStructure?: {
        /** Whether word/document.xml was found */
        hasDocumentXml: boolean;
        /** Number of tables found (<w:tbl> elements) */
        tableCount: number;
        /** Number of <w:t> text elements found */
        textElementCount: number;
        /** Unique paragraph styles found (e.g. "Heading1", "TableHeader") */
        paragraphStyles: string[];
    };

    /** Which of the current parser's regex patterns matched */
    parserPatternMatches: {
        patientName: boolean;
        sessionTimestamp: boolean;
        model: boolean;
        serial: boolean;
        batteryVoltage: boolean;
        atrialSerial: boolean;
        rvSerial: boolean;
        lvSerial: boolean;
        rvImp: boolean;
        atrialSense: boolean;
        rvSense: boolean;
        dob: boolean;
    };

    /** Lines/labels that look like they contain extractable data but aren't captured by current patterns.
     *  These are "missed opportunities" -- labels followed by what looks like a value.
     *  Values are replaced with type indicators like "<number>", "<date>", "<text>" */
    uncapturedFields: { label: string; valueType: string }[];

    /** Section headers or major structural dividers found in the text */
    sections: string[];

    /** Summary stats */
    stats: {
        totalLabels: number;
        matchedByParser: number;
        coveragePercent: number;
    };
}

/**
 * The parser's regex patterns, exactly as defined in abbott-parser.ts.
 * We keep them here so we can test which ones match against arbitrary text.
 */
const PARSER_PATTERNS: Record<string, RegExp> = {
    patientName: /Patient Name\s+(.+)/i,
    sessionTimestamp: /Session Timestamp\s+(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i,
    model: /Model Number:?\s*(.+)/i,
    serial: /(?<!Lead\s)Serial Number(?::\s*|\s+)([A-Z0-9]+)/i,
    batteryVoltage: /Unloaded Battery Voltage\s+([0-9.]+)\s*V/i,
    atrialSerial: /Atrial Lead Serial Number\s+([A-Z0-9]+)/i,
    rvSerial: /RV Lead Serial Number\s+([A-Z0-9]+)/i,
    lvSerial: /LV Lead Serial Number\s+([A-Z0-9]+)/i,
    rvImp: /RV Pacing Lead Impedance\s+([0-9.]+)\s*Ohm/i,
    atrialSense: /Atrial Signal Amplitude\s+([0-9.]+)\s*mV/i,
    rvSense: /Ventricular Signal Amplitude\s+([0-9.]+)\s*mV/i,
    dob: /Date of Birth:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
};

/**
 * Medical/clinical keywords that suggest a field contains extractable device data.
 */
const CLINICAL_KEYWORDS = [
    'impedance', 'threshold', 'amplitude', 'sensing', 'voltage', 'battery',
    'lead', 'pacing', 'shock', 'episode', 'rate', 'interval', 'burden',
    'capture', 'resistance', 'energy', 'pulse', 'width', 'sensitivity',
    'magnet', 'longevity', 'eri', 'eol', 'capacitor', 'charge', 'time',
    'mode', 'chamber', 'output', 'frequency', 'duration', 'therapy',
    'detection', 'zone', 'tachycardia', 'fibrillation', 'bradycardia',
    'atrial', 'ventricular', 'biventricular',
];

/**
 * Classify a value string into a type indicator without exposing the actual value.
 */
function classifyValue(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '<empty>';

    // Date patterns: MM/DD/YYYY, YYYY-MM-DD, DD.MM.YYYY, DD-Mon-YYYY, with optional time
    if (/^\d{1,2}\/\d{1,2}\/\d{4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(trimmed)) return '<date>';
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(trimmed)) return '<date>';
    if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(trimmed)) return '<date>';
    if (/^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(trimmed)) return '<date>';

    // Number with optional unit
    if (/^[0-9]+(\.[0-9]+)?(\s*(V|mV|Ohm|ohm|ms|bpm|Hz|J|%|sec|min|hr))?$/.test(trimmed)) return '<number>';

    return '<text>';
}

/**
 * Extract labels from lines that have a label-value structure.
 * Returns an array of { label, value } where value is the raw value (will be classified later).
 */
function extractLabelValuePairs(text: string): { label: string; value: string }[] {
    const lines = text.split(/\r?\n/);
    const pairs: { label: string; value: string }[] = [];
    const seenLabels = new Set<string>();

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let label: string | null = null;
        let value: string | null = null;

        // Pattern 1: "Label    Value" (multiple spaces as separator, at least 2)
        const multiSpaceMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9 /()\-]*?)\s{2,}(.+)$/);
        if (multiSpaceMatch) {
            label = multiSpaceMatch[1].trim();
            value = multiSpaceMatch[2].trim();
        }

        // Pattern 2: "Label: Value" (colon separator)
        if (!label) {
            const colonMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9 /()\-]*?):\s+(.+)$/);
            if (colonMatch) {
                label = colonMatch[1].trim();
                value = colonMatch[2].trim();
            }
        }

        // Pattern 3: "Label\tValue" (tab separator)
        if (!label) {
            const tabMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9 /()\-]*?)\t+(.+)$/);
            if (tabMatch) {
                label = tabMatch[1].trim();
                value = tabMatch[2].trim();
            }
        }

        if (label && value && label.length >= 2 && !/^\d+$/.test(label)) {
            if (!seenLabels.has(label)) {
                seenLabels.add(label);
                pairs.push({ label, value });
            }
        }
    }

    return pairs;
}

/**
 * Known Abbott section names for fuzzy matching.
 */
const KNOWN_SECTIONS = [
    'Device Information', 'Patient Information', 'Battery Status',
    'Lead Measurements', 'Lead Parameters', 'Brady Parameters',
    'Tachy Parameters', 'Episode Summary', 'Diagnostics',
    'Stored Electrograms', 'Programmed Parameters', 'Test Results',
    'Rate Histogram', 'Sensor Parameters', 'AT/AF Summary',
    'Heart Failure Management', 'Quick Notes', 'Session Summary',
    'Measured Data', 'Threshold Test', 'Impedance Trend',
];

/**
 * Detect section headers from the text.
 * Looks for:
 * - Lines that are ALL CAPS (at least 3 alpha chars)
 * - Lines followed by a line of dashes or equals
 * - Common Abbott section names
 */
function detectSections(text: string): string[] {
    const lines = text.split(/\r?\n/);
    const sections: string[] = [];
    const seenSections = new Set<string>();

    const addSection = (s: string) => {
        const normalized = s.trim();
        if (normalized && !seenSections.has(normalized)) {
            seenSections.add(normalized);
            sections.push(normalized);
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;

        // ALL CAPS lines (at least 3 alpha chars, no lowercase)
        if (trimmed.length >= 3 && /^[A-Z][A-Z0-9 /\-&]{2,}$/.test(trimmed)) {
            const letterCount = (trimmed.match(/[A-Z]/g) || []).length;
            if (letterCount >= 3) {
                addSection(trimmed);
                continue;
            }
        }

        // Line followed by dashes or equals
        if (i + 1 < lines.length) {
            const nextTrimmed = lines[i + 1].trim();
            if (nextTrimmed.length >= 3 && /^[-=]{3,}$/.test(nextTrimmed)) {
                addSection(trimmed);
                continue;
            }
        }

        // Common Abbott section names (case-insensitive)
        for (const section of KNOWN_SECTIONS) {
            if (trimmed.toLowerCase() === section.toLowerCase()) {
                addSection(trimmed);
                break;
            }
        }
    }

    return sections;
}

/**
 * Analyze DOCX XML structure without extracting patient values.
 */
function analyzeDocxXml(xmlContent: string): AbbottAnalysis['docxStructure'] {
    const tableMatches = xmlContent.match(/<w:tbl[\s>]/g);
    const tableCount = tableMatches ? tableMatches.length : 0;

    const textMatches = xmlContent.match(/<w:t[\s>]/g);
    const textElementCount = textMatches ? textMatches.length : 0;

    // Extract paragraph styles
    const styleMatches = xmlContent.match(/<w:pStyle\s+w:val="([^"]+)"/g);
    const styles = new Set<string>();
    if (styleMatches) {
        for (const match of styleMatches) {
            const valMatch = match.match(/w:val="([^"]+)"/);
            if (valMatch) {
                styles.add(valMatch[1]);
            }
        }
    }

    return {
        hasDocumentXml: true,
        tableCount,
        textElementCount,
        paragraphStyles: [...styles].sort(),
    };
}

/**
 * Extract text from a DOCX buffer (same approach as abbott-parser.ts).
 */
function extractTextFromDocx(buffer: Buffer): { text: string | null; xmlContent: string | null } {
    try {
        const zip = new AdmZip(buffer);
        const xmlContent = zip.readAsText('word/document.xml');
        if (!xmlContent) return { text: null, xmlContent: null };

        const matches = xmlContent.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
        if (matches) {
            const text = matches.map(tag => tag.replace(/<[^>]+>/g, '')).join('\n');
            return { text, xmlContent };
        }

        return { text: '', xmlContent };
    } catch {
        return { text: null, xmlContent: null };
    }
}

/**
 * Determine which parser patterns matched against the text.
 */
function checkParserPatterns(text: string): AbbottAnalysis['parserPatternMatches'] {
    return {
        patientName: PARSER_PATTERNS.patientName.test(text),
        sessionTimestamp: PARSER_PATTERNS.sessionTimestamp.test(text),
        model: PARSER_PATTERNS.model.test(text),
        serial: PARSER_PATTERNS.serial.test(text),
        batteryVoltage: PARSER_PATTERNS.batteryVoltage.test(text),
        atrialSerial: PARSER_PATTERNS.atrialSerial.test(text),
        rvSerial: PARSER_PATTERNS.rvSerial.test(text),
        lvSerial: PARSER_PATTERNS.lvSerial.test(text),
        rvImp: PARSER_PATTERNS.rvImp.test(text),
        atrialSense: PARSER_PATTERNS.atrialSense.test(text),
        rvSense: PARSER_PATTERNS.rvSense.test(text),
        dob: PARSER_PATTERNS.dob.test(text),
    };
}

/**
 * Find labels that contain clinical keywords but are NOT matched by any parser pattern.
 * These represent "missed opportunities" for data extraction.
 */
function findUncapturedFields(
    labelPairs: { label: string; value: string }[],
    text: string
): { label: string; valueType: string }[] {
    // Build set of labels that ARE captured by parser patterns
    const capturedLabels = new Set<string>();
    for (const [, pattern] of Object.entries(PARSER_PATTERNS)) {
        const match = text.match(pattern);
        if (match) {
            // Find which extracted label this pattern corresponds to
            const fullMatch = match[0];
            for (const pair of labelPairs) {
                if (fullMatch.toLowerCase().includes(pair.label.toLowerCase())) {
                    capturedLabels.add(pair.label);
                }
            }
        }
    }

    const uncaptured: { label: string; valueType: string }[] = [];
    const seenLabels = new Set<string>();

    for (const pair of labelPairs) {
        if (capturedLabels.has(pair.label)) continue;
        if (seenLabels.has(pair.label)) continue;

        // Check if label contains any clinical keyword
        const labelLower = pair.label.toLowerCase();
        const hasClinicalKeyword = CLINICAL_KEYWORDS.some(kw => labelLower.includes(kw));

        if (hasClinicalKeyword) {
            seenLabels.add(pair.label);
            uncaptured.push({
                label: pair.label,
                valueType: classifyValue(pair.value),
            });
        }
    }

    return uncaptured;
}

/**
 * Main analyzer function. Takes a raw Abbott log buffer, returns structural analysis with no patient data.
 */
export function analyzeAbbottLog(data: Buffer): AbbottAnalysis {
    // 1. Detect format
    const isZip = data.length > 4
        && data[0] === 0x50
        && data[1] === 0x4B
        && data[2] === 0x03
        && data[3] === 0x04;

    let format: string;
    let rawText = '';
    let docxStructure: AbbottAnalysis['docxStructure'] | undefined;

    if (isZip) {
        format = 'docx';
        const { text, xmlContent } = extractTextFromDocx(data);
        if (text !== null) {
            rawText = text;
            if (xmlContent) {
                docxStructure = analyzeDocxXml(xmlContent);
            }
        } else {
            // ZIP but could not extract text
            format = 'unknown';
        }
    } else {
        // Try to parse as UTF-8 text
        const textContent = data.toString('utf-8');
        // Check if it looks like text (has printable chars and newlines)
        if (textContent.length > 0 && /[\x20-\x7E\r\n\t]/.test(textContent)) {
            format = 'plaintext';
            rawText = textContent;
        } else {
            format = 'unknown';
        }
    }

    // 2. Count lines
    const lines = rawText.split(/\r?\n/);
    const lineCount = lines.length;

    // 3. Extract labels
    const labelPairs = extractLabelValuePairs(rawText);
    const labels = labelPairs.map(p => p.label).sort();

    // 4. Check parser patterns
    const parserPatternMatches = checkParserPatterns(rawText);

    // 5. Find uncaptured fields
    const uncapturedFields = findUncapturedFields(labelPairs, rawText);

    // 6. Detect sections
    const sections = detectSections(rawText);

    // 7. Calculate stats
    const matchedCount = Object.values(parserPatternMatches).filter(Boolean).length;
    const totalLabels = labels.length;
    const coveragePercent = totalLabels > 0
        ? Math.round((matchedCount / totalLabels) * 100)
        : 0;

    return {
        format,
        lineCount,
        labels,
        docxStructure,
        parserPatternMatches,
        uncapturedFields,
        sections,
        stats: {
            totalLabels,
            matchedByParser: matchedCount,
            coveragePercent,
        },
    };
}

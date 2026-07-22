import { createWorker } from 'tesseract.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { UnifiedReport } from '../reports';
import { normalizeDate } from '../../lib/dates';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

/**
 * Extracts text from a PDF file, using pdf-parse, then pdfjs-dist, then OCR as a fallback.
 *
 * @param filePath The path to the PDF file.
 * @returns A promise that resolves with the extracted text.
 */
export const extractTextFromPdf = async (filePath: string): Promise<string> => {
    let dataBuffer: Buffer;
    try {
        dataBuffer = await fs.readFile(filePath);
    } catch (e) {
        console.warn(`Failed to read PDF file ${filePath}:`, e);
        return '';
    }

    // 1. Try pdf-parse
    try {
        console.log('Attempting pdf-parse...');
        let data;
        if (typeof pdfParse === 'function') {
            data = await pdfParse(dataBuffer);
        } else if (pdfParse.default && typeof pdfParse.default === 'function') {
            data = await pdfParse.default(dataBuffer);
        }

        if (data && data.text && data.text.trim().length > 0) {
            console.log('pdf-parse success');
            return data.text;
        }
    } catch (e) {
        console.warn('pdf-parse failed:', e);
    }

    // 2. Try pdfjs-dist (Legacy/Standard approach)
    try {
        console.log('Attempting pdfjs-dist...');
        // Dynamic import for ESM-only package in CommonJS environment
        // Using new Function to bypass TypeScript transpilation of dynamic import to require()
        const pdfjsLib = await (new Function('return import("pdfjs-dist/legacy/build/pdf.mjs")'))();

        const uint8Array = new Uint8Array(dataBuffer);
        const loadingTask = pdfjsLib.getDocument(uint8Array);
        const pdfDocument = await loadingTask.promise;
        let fullText = '';

        for (let i = 1; i <= pdfDocument.numPages; i++) {
            const page = await pdfDocument.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n';
        }

        if (fullText.trim().length > 0) {
            console.log('pdfjs-dist success');
            return fullText;
        }
    } catch (e) {
        console.warn('pdfjs-dist failed:', e);
    }

    // 3. Fallback to OCR (Tesseract)
    console.warn('Text extraction failed. Tesseract OCR for PDF is not supported directly in this environment without image conversion.');
    return '';
};

/**
 * Extracts structured data from the raw text extracted from a PDF using regex.
 * This is a best-effort parser to identify key information for grouping and storage.
 * Also attempts to parse metadata from the filename if provided, which is common for Medtronic exports.
 *
 * @param text The raw text from the PDF.
 * @param filename Optional filename to parse for metadata.
 * @returns A structured data object conforming to the UnifiedReport interface.
 */
export const extractStructuredData = (text: string, filename?: string): UnifiedReport => {
    const report: UnifiedReport = {
        manufacturer: 'Unknown',
        interrogation_date: '',
        patient: {
            first_name: 'Unknown',
            last_name: 'Unknown',
            dob: '',
        },
        device: {
            type: 'Unknown',
            model: 'Unknown',
            serial_number: 'Unknown',
        },
        battery: {},
        leads: [],
        raw_text: text,
    };

    // Helper: pipe extracted day/month/year parts through normalizeDate so the
    // result is validated and month>12 inputs are disambiguated ("10/27/2023"
    // -> 2023-10-27). Alpha months (incl. German "Mär", "Okt", "Dez") are
    // handled by normalizeDate's month-name branch. Returns '' when invalid.
    const buildDate = (month: string, day: string, year: string): string => {
        if (isNaN(parseInt(month))) {
            // Month-name form, e.g. "06 Nov 2025"
            return normalizeDate(`${day} ${month} ${year}`);
        }
        // Numeric: default to day-first (German user base); normalizeDate swaps
        // when the "month" part is > 12 and validates the final date.
        return normalizeDate(`${day}.${month}.${year}`, 'eu');
    };

    // 1. Try to parse from Filename first (High confidence for Medtronic)
    // Format: UUID_LASTNAME_FIRSTNAME-SERIAL-TYPE-DD_MMM_YYYY_...
    // Example: ...Doe_John-DEV123456-SmartSyncPDF-06_Nov_2025...
    // New Format: Prefix_Lastname,_Firstname-Serial-Type-Date...
    // Example: De_Silva,_Elisabeth-RSH604898S-SmartSyncPDF-24_Jul_2024...
    if (filename) {
        // Try original format
        let filenameMatch = filename.match(/_(?<last>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff]+)(?:_|, ?)(?<first>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff]+)-(?<serial>[A-Z0-9]+)-(?<type>[A-Za-z0-9]+)-(?<day>\d{2})_(?<month>[A-Za-z]{3})_(?<year>\d{4})/);

        // Try new format (Lastname,_Firstname) - Handle comma+underscore separator
        if (!filenameMatch) {
            filenameMatch = filename.match(/(?:^|_)(?<last>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff]+)(?:_|, ?_?)(?<first>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff]+)-(?<serial>[A-Z0-9]+)-(?<type>[A-Za-z0-9]+)-(?<day>\d{2})_(?<month>[A-Za-z]{3})_(?<year>\d{4})/);
        }

        if (filenameMatch?.groups) {
            console.log('Filename metadata matched (Medtronic format).');
            report.patient.last_name = filenameMatch.groups.last;
            report.patient.first_name = filenameMatch.groups.first;
            report.device.serial_number = filenameMatch.groups.serial;
            report.manufacturer = 'Medtronic'; // Safe assumption for this format
            report.interrogation_date = buildDate(filenameMatch.groups.month, filenameMatch.groups.day, filenameMatch.groups.year);
        } else {
            // Check for Biotronik Format: BIOSTD_YYYY-MM-DD_HH-MM-SS_Lastname_Firstname_Serial.PDF
            // Example: BIOSTD_2025-11-03_14-21-46_Doe_John_8763967
            const bioMatch = filename.match(/BIOSTD_(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})_(?<hour>\d{2})-(?<minute>\d{2})-(?<second>\d{2})_(?<last>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff]+)_(?<first>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff]+)_(?<serial>[A-Z0-9]+)/);

            if (bioMatch?.groups) {
                console.log('Filename metadata matched (Biotronik format).');
                report.patient.last_name = bioMatch.groups.last;
                report.patient.first_name = bioMatch.groups.first;
                report.device.serial_number = bioMatch.groups.serial;
                report.manufacturer = 'Biotronik';
                report.interrogation_date = `${bioMatch.groups.year}-${bioMatch.groups.month}-${bioMatch.groups.day}T${bioMatch.groups.hour}:${bioMatch.groups.minute}:${bioMatch.groups.second}`;
            }
        }
    }

    // 2. Regex for Patient Name
    // Support: "Patient: DOE, JOHN", "Name: Max Mustermann", "Patient Name: Mustermann, Max"
    if (report.patient.last_name === 'Unknown' || report.patient.last_name === '') {
        // Blocklist for invalid names (system text that looks like names)
        const invalidNames = ['NA', 'Software', 'Cardiac', 'Patient', 'Arztes', 'Enaktivität', 'Enidentifikation', 'Analyse', 'Bericht', 'Report', 'Device', 'Model', 'Serial'];

        // Helper to validate name
        const isValidName = (last: string, first: string) => {
            if (!last || !first) return false;
            if (invalidNames.includes(last) || invalidNames.includes(first)) return false;
            if (last.length < 2 || first.length < 2) return false;
            return true;
        };

        // Format: Last, First (e.g. "Patient: Mustermann, Max")
        // We use a stricter regex to avoid matching random text
        const lastFirstMatch = text.match(/(?:Patient(?: Name)?|Name|Patientenname):?\s*(?<lastName>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)[,]\s*(?<firstName>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)/i);

        if (lastFirstMatch?.groups && isValidName(lastFirstMatch.groups.lastName, lastFirstMatch.groups.firstName)) {
            report.patient.first_name = lastFirstMatch.groups.firstName;
            report.patient.last_name = lastFirstMatch.groups.lastName;
        } else {
            // Format: First Last (less common in headers, but possible)
            // Be careful not to match "Patient Name" as the name
            const firstLastMatch = text.match(/(?:Patient(?: Name)?|Name|Patientenname):?\s*(?!Name)(?<firstName>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)\s+(?<lastName>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)/i);
            if (firstLastMatch?.groups && isValidName(firstLastMatch.groups.lastName, firstLastMatch.groups.firstName)) {
                report.patient.first_name = firstLastMatch.groups.firstName;
                report.patient.last_name = firstLastMatch.groups.lastName;
            }
        }
    }

    // Regex for Date of Birth (e.g., "DOB: 01/23/1945" or "Geburtsdatum: 15.05.1950")
    // Support German format dd.mm.yyyy
    const dobMatch = text.match(/(?:DOB|Date of Birth|Geburtsdatum|Born):?\s*(?<part1>\d{1,2})(?<sep>[\.\/-])(?<part2>\d{1,2})\k<sep>(?<year>\d{2,4})/i);
    if (dobMatch?.groups) {
        // normalizeDate disambiguates (>12 must be the day), validates, and
        // windows 2-digit years (52 -> 1952). Day-first default for ambiguous
        // dotted/dashed dates; slashes default to US per its 'auto' hint.
        report.patient.dob = normalizeDate(
            `${dobMatch.groups.part1}${dobMatch.groups.sep}${dobMatch.groups.part2}${dobMatch.groups.sep}${dobMatch.groups.year}`
        );
    }

    // Regex for Interrogation Date and Time
    // Support: "Interrogation Date: 10/27/2023 14:30", "Unters.datum: 06.Nov.2025 09:15"
    if (!report.interrogation_date) {
        // Combined Date and Time regex
        // Looks for Date followed optionally by Time
        const dateRegex = /(?:Interrogation Date|Session Date|Unters\.datum|Untersuchungsdatum|Messdatum|Report Date|Date):?\s*(?:(?<day>\d{1,2})[\.\/-](?<month>[A-Za-z]{3}|\d{1,2})[\.\/-](?<year>\d{4}))(?:\s+(?:at\s+)?(?<hour>\d{1,2})[:.](?<minute>\d{2})(?:[:.](?<second>\d{2}))?\s*(?<ampm>AM|PM)?)?/i;

        const match = text.match(dateRegex);

        if (match?.groups) {
            let dateStr = buildDate(match.groups.month, match.groups.day, match.groups.year);

            // Append time if found (only when the date itself validated)
            if (dateStr && match.groups.hour && match.groups.minute) {
                let hour = parseInt(match.groups.hour);
                const minute = match.groups.minute;
                const second = match.groups.second || '00';

                if (match.groups.ampm) {
                    if (match.groups.ampm.toUpperCase() === 'PM' && hour < 12) hour += 12;
                    if (match.groups.ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
                }

                const timeStr = `T${hour.toString().padStart(2, '0')}:${minute}:${second}`;
                dateStr += timeStr;
            } else {
                // Default to noon if no time found, or keep just date?
                // ISO format requires T for time. If we just have date, that's valid too.
                // But for ordering, maybe T12:00:00 is safer? 
                // Let's leave it as just date if no time found, standard ISO allows YYYY-MM-DD
            }
            report.interrogation_date = dateStr;
        }
    }

    // Regex for Serial Number
    // "SN" needs a word boundary and at least one separator so words that merely
    // contain "sn" (e.g. "Hausnummer") can never produce a bogus serial.
    if (report.device.serial_number === 'Unknown') {
        const serialMatch = text.match(/(?:Serial Number|Seriennummer|Serial No\.?|\bSN)(?::\s*|\s+)(?<serial>[A-Z0-9]+)/i);
        if (serialMatch?.groups) {
            report.device.serial_number = serialMatch.groups.serial;
        }
    }

    // Regex for Device Model (single-line capture; stops at a line break or a
    // run of 2+ whitespace so it cannot swallow the following lines)
    const modelMatch = text.match(/(?:Device Model|Model|Gerät|Device):?[ \t]*(?<model>[A-Za-z0-9 \t\-\.]+?)(?=\s{2,}|\r|\n|$)/i);
    if (modelMatch?.groups) {
        report.device.model = modelMatch.groups.model.trim();
    }

    // Manufacturer Detection (Simple Keyword Search)
    if (report.manufacturer === 'Unknown') {
        const lowerText = text.toLowerCase();
        if (lowerText.includes('medtronic')) report.manufacturer = 'Medtronic';
        else if (lowerText.includes('boston scientific') || lowerText.includes('bostonscientific')) report.manufacturer = 'Boston Scientific';
        else if (lowerText.includes('biotronik')) report.manufacturer = 'Biotronik';
        else if (lowerText.includes('abbott') || lowerText.includes('st. jude')) report.manufacturer = 'Abbott';
        else if (lowerText.includes('microport')) report.manufacturer = 'Microport';
    }

    // Fallback for missing DOB
    if (!report.patient.dob && report.patient.last_name !== 'Unknown' && report.device.serial_number !== 'Unknown') {
        console.warn('DOB missing for patient. Assigning default 1900-01-01.');
        report.patient.dob = '1900-01-01';
    }

    return report;
};

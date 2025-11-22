import { createWorker } from 'tesseract.js';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { UnifiedReport } from '../reports';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');
import * as pdfjsLib from 'pdfjs-dist';

/**
 * Extracts text from a PDF file, using pdf-parse, then pdfjs-dist, then OCR as a fallback.
 *
 * @param filePath The path to the PDF file.
 * @returns A promise that resolves with the extracted text.
 */
export const extractTextFromPdf = async (filePath: string): Promise<string> => {
    const dataBuffer = fs.readFileSync(filePath);

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

    console.log('Extracted PDF Text Preview (First 500 chars):', text.substring(0, 500));

    // Helper to format date strings to YYYY-MM-DD
    const formatDate = (month: string, day: string, year: string): string => {
        const monthMap: { [key: string]: string } = {
            'Jan': '01', 'Feb': '02', 'Mär': '03', 'Mar': '03', 'Apr': '04', 'Mai': '05', 'May': '05', 'Jun': '06',
            'Jul': '07', 'Aug': '08', 'Sep': '09', 'Okt': '10', 'Oct': '10', 'Nov': '11', 'Dez': '12', 'Dec': '12'
        };

        let m = month;
        if (isNaN(parseInt(month))) {
            const shortM = month.substring(0, 3);
            if (monthMap[shortM]) m = monthMap[shortM];
        }
        return `${year.padStart(4, '20')}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
    };

    // 1. Try to parse from Filename first (High confidence for Medtronic)
    // Format: UUID_LASTNAME_FIRSTNAME-SERIAL-TYPE-DD_MMM_YYYY_...
    // Example: ..._KOLKENBROCK_RALF-PMZ629976S-SmartSyncPDF-06_Nov_2025...
    if (filename) {
        const filenameMatch = filename.match(/_(?<last>[A-Z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff]+)_(?<first>[A-Z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff]+)-(?<serial>[A-Z0-9]+)-(?<type>[A-Za-z0-9]+)-(?<day>\d{2})_(?<month>[A-Za-z]{3})_(?<year>\d{4})/);
        if (filenameMatch?.groups) {
            console.log('Filename metadata match:', filenameMatch.groups);
            report.patient.last_name = filenameMatch.groups.last;
            report.patient.first_name = filenameMatch.groups.first;
            report.device.serial_number = filenameMatch.groups.serial;
            report.manufacturer = 'Medtronic'; // Safe assumption for this format
            report.interrogation_date = formatDate(filenameMatch.groups.month, filenameMatch.groups.day, filenameMatch.groups.year);
        }
    }

    // 2. Regex for Patient Name (e.g., "Patient: DOE, JOHN")
    // Only override if "Unknown" or empty
    if (report.patient.last_name === 'Unknown' || report.patient.last_name === '') {
        const nameMatch = text.match(/(?:Patient(?: Name)?|Name):?\s*(?<lastName>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)[, ]\s*(?<firstName>[A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)/i);
        if (nameMatch?.groups) {
            report.patient.first_name = nameMatch.groups.firstName;
            report.patient.last_name = nameMatch.groups.lastName;
        }
    }

    // Regex for Date of Birth (e.g., "DOB: 01/23/1945")
    const dobMatch = text.match(/(?:DOB|Date of Birth|Geburtsdatum):?\s*(?<month>\d{1,2})[/-](?<day>\d{1,2})[/-](?<year>\d{2,4})/i);
    if (dobMatch?.groups) {
        report.patient.dob = formatDate(dobMatch.groups.month, dobMatch.groups.day, dobMatch.groups.year);
    }

    // Regex for Interrogation Date (e.g., "Interrogation Date: 10/27/2023", "Unters.datum: 06.Nov.2025")
    // German date format: DD.MMM.YYYY or DD.MM.YYYY
    if (!report.interrogation_date) {
        const interrogationDateMatch = text.match(/(?:Interrogation Date|Session Date|Unters\.datum|Messdatum):?\s*(?:(?<day>\d{1,2})[\.\/-](?<month>[A-Za-z]{3}|\d{1,2})[\.\/-](?<year>\d{4}))/i);

        if (interrogationDateMatch?.groups) {
            report.interrogation_date = formatDate(interrogationDateMatch.groups.month, interrogationDateMatch.groups.day, interrogationDateMatch.groups.year);
        }
    }

    // Regex for Serial Number
    if (report.device.serial_number === 'Unknown') {
        const serialMatch = text.match(/(?:Serial Number|Seriennummer|SN):?\s*(?<serial>[A-Z0-9]+)/i);
        if (serialMatch?.groups) {
            report.device.serial_number = serialMatch.groups.serial;
        }
    }

    // Regex for Device Model
    const modelMatch = text.match(/(?:Device Model|Model|Gerät|Device):?\s*(?<model>[A-Za-z0-9\s\-\.]+?)(?=\s{2,}|$)/i);
    if (modelMatch?.groups) {
        report.device.model = modelMatch.groups.model.trim();
    }

    // Fallback for missing DOB
    // If we have a valid Patient Name and Serial Number (strong identifiers), but no DOB,
    // we assign a default DOB to allow the system to process the file.
    // The user can update this later.
    if (!report.patient.dob && report.patient.last_name !== 'Unknown' && report.device.serial_number !== 'Unknown') {
        console.warn('DOB missing for patient. Assigning default 1900-01-01.');
        report.patient.dob = '1900-01-01';
    }

    return report;
};

const pdf = require('pdf-parse');
import { createWorker } from 'tesseract.js';
import * as fs from 'fs';
import * as path from 'path';
import { UnifiedReport } from './reports';
import { parseBiotronikXML } from './parsers/biotronik-parser';
import { parseBostonScientificBnk } from './parsers/boston-scientific-parser';

/**
 * Extracts text from a PDF file, using OCR as a fallback if no text layer is present.
 *
 * @param filePath The path to the PDF file.
 * @returns A promise that resolves with the extracted text.
 */
export const extractTextFromPdf = async (filePath: string): Promise<string> => {
  const dataBuffer = fs.readFileSync(filePath);

  // First, try to extract a text layer using pdf-parse.
  const data = await pdf(dataBuffer);

  // If a text layer is found, return it.
  if (data.text && data.text.trim().length > 0) {
    return data.text;
  }

  // If no text layer is present, fall back to OCR with Tesseract.
  const worker = await createWorker('eng');
  const ret = await worker.recognize(dataBuffer);
  await worker.terminate();
  return ret.data.text;
};

/**
 * Extracts structured data from the raw text extracted from a PDF using regex.
 * This is a best-effort parser to identify key information for grouping and storage.
 *
 * @param text The raw text from the PDF.
 * @returns A structured data object conforming to the UnifiedReport interface.
 */
export const extractStructuredData = (text: string): UnifiedReport => {
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

  // Helper to format date strings to YYYY-MM-DD
  const formatDate = (month: string, day: string, year: string): string => {
    return `${year.padStart(4, '20')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  // Regex for Patient Name (e.g., "Patient: DOE, JOHN")
  const nameMatch = text.match(/Patient(?: Name)?:?\s*(?<lastName>[A-Za-z'-]+),\s*(?<firstName>[A-Za-z'-]+)/i);
  if (nameMatch?.groups) {
    report.patient.first_name = nameMatch.groups.firstName;
    report.patient.last_name = nameMatch.groups.lastName;
  }

  // Regex for Date of Birth (e.g., "DOB: 01/23/1945")
  const dobMatch = text.match(/(?:DOB|Date of Birth):?\s*(?<month>\d{1,2})[/-](?<day>\d{1,2})[/-](?<year>\d{2,4})/i);
  if (dobMatch?.groups) {
    report.patient.dob = formatDate(dobMatch.groups.month, dobMatch.groups.day, dobMatch.groups.year);
  }

  // Regex for Interrogation Date (e.g., "Interrogation Date: 10/27/2023")
  const interrogationDateMatch = text.match(/(?:Interrogation Date|Session Date):?\s*(?<month>\d{1,2})[/-](?<day>\d{1,2})[/-](?<year>\d{2,4})/i);
  if (interrogationDateMatch?.groups) {
    report.interrogation_date = formatDate(interrogationDateMatch.groups.month, interrogationDateMatch.groups.day, interrogationDateMatch.groups.year);
  }

  return report;
};

/**
 * Acts as a dispatcher, routing files to the appropriate parser based on their
 * file type and naming conventions. It handles PDFs (with OCR fallback),
 * Biotronik XML files, and Boston Scientific .bnk files.
 * @param filePath The path to the file to be parsed.
 * @returns A promise that resolves with a UnifiedReport object, or null if the
 * file type is not supported.
 */
export const parseFile = async (filePath: string): Promise<UnifiedReport | null> => {
  console.log(`Parsing file: ${filePath}`);
  const fileExtension = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);

  if (fileExtension === '.pdf') {
    const rawText = await extractTextFromPdf(filePath);
    return extractStructuredData(rawText);
  } else if (fileExtension === '.xml' && filename.startsWith('BIOSTD_')) {
    const xmlData = fs.readFileSync(filePath, 'utf-8');
    return parseBiotronikXML(xmlData);
  } else if (fileExtension === '.bnk') {
    const bnkData = fs.readFileSync(filePath, 'utf-8');
    return parseBostonScientificBnk(bnkData);
  } else {
    console.warn(`Unsupported file type: ${fileExtension}`);
    return null;
  }
};

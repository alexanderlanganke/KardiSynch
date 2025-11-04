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
 * Extracts structured data from the raw text extracted from a PDF.
 * This function serves as a placeholder for manufacturer-specific parsing logic.
 *
 * @param text The raw text from the PDF.
 * @returns A structured data object conforming to the UnifiedReport interface.
 */
export const extractStructuredData = (text: string): UnifiedReport => {
  console.log('Extracting structured data from text...');

  // This is a placeholder implementation. In a real-world scenario, this function
  // would contain complex logic to parse the text and populate the fields of a
  // UnifiedReport object.
  const placeholderReport: UnifiedReport = {
    manufacturer: 'Unknown',
    interrogation_date: new Date().toISOString().split('T')[0], // Today's date as a placeholder
    patient: {
      first_name: 'Unknown',
      last_name: 'Unknown',
      dob: '1900-01-01', // Placeholder DOB
    },
    device: {
      type: 'Unknown',
      model: 'Unknown',
      serial_number: 'Unknown',
    },
    battery: {
      // Empty placeholder
    },
    leads: [], // Default to an empty array
    raw_text: text, // Store the full raw text
  };

  return placeholderReport;
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

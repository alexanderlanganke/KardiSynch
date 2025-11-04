// src/main/pdf-merger.ts

import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs';
import pdf from 'pdf-parse';

/**
 * Extracts text from a PDF file.
 *
 * @param filePath The path to the PDF file.
 * @returns A promise that resolves with the extracted text.
 */
export const extractTextFromPdf = async (filePath: string): Promise<string> => {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
};

import { UnifiedReport } from './reports';

/**
 * Verifies that a PDF's content matches the metadata from a primary report.
 *
 * @param pdfText The text extracted from the PDF.
 * @param reportData The UnifiedReport object containing the metadata to verify against.
 * @returns A boolean indicating whether the PDF content matches the report data.
 */
export const verifyPdfMatch = (pdfText: string, reportData: UnifiedReport): boolean => {
  const { patient, interrogation_date, device } = reportData;

  // Normalize all text to lowercase for case-insensitive matching
  const lowerPdfText = pdfText.toLowerCase();

  // Check for patient's first and last name
  if (!lowerPdfText.includes(patient.first_name.toLowerCase()) || !lowerPdfText.includes(patient.last_name.toLowerCase())) {
    return false;
  }

  // Check for the interrogation date
  // This can be tricky due to different date formats. For now, we'll do a simple includes check.
  // A more robust solution might involve regex and date parsing.
  if (!lowerPdfText.includes(interrogation_date.split('T')[0])) {
    return false;
  }

  // Check for device model and serial number
  if (!lowerPdfText.includes(device.model.toLowerCase()) || !lowerPdfText.includes(device.serial_number.toLowerCase())) {
    return false;
  }

  return true;
};


/**
 * Merges multiple PDF files into a single PDF.
 *
 * @param filePaths An array of paths to the PDF files to merge.
 * @returns A promise that resolves with the merged PDF as a Uint8Array.
 */
export const mergePdfs = async (filePaths: string[]): Promise<Uint8Array> => {
  const mergedPdf = await PDFDocument.create();
  for (const filePath of filePaths) {
    const pdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
    copiedPages.forEach((page) => {
      mergedPdf.addPage(page);
    });
  }
  return await mergedPdf.save();
};

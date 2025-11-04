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

/**
 * Verifies that a PDF belongs to the correct patient.
 *
 * @param pdfText The text extracted from the PDF.
 * @param patientFirstName The patient's first name.
 * @param patientLastName The patient's last name.
 * @returns A boolean indicating whether the PDF is verified.
 */
export const verifyPdf = (pdfText: string, patientFirstName: string, patientLastName: string): boolean => {
    // This is a simple verification logic. In a real scenario, this would be more robust.
    return pdfText.includes(patientFirstName) && pdfText.includes(patientLastName);
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdf = require('pdf-parse');
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { UnifiedReport } from './reports';
import { parseBiotronikXML } from './parsers/biotronik-parser';
import { parseBostonScientificBnk } from './parsers/boston-scientific-parser';
import { parseMedtronicPdd, parseMedtronicPkg } from './parsers/medtronic-parser';
import { extractTextFromPdf, extractStructuredData } from './utils/pdf-utils';

/**
 * Acts as a dispatcher, routing files to the appropriate parser based on their
 * file type and naming conventions. It handles PDFs (with OCR fallback),
 * Biotronik XML files, Boston Scientific .bnk files, and Medtronic .pdd/.pkg files.
 * @param filePath The path to the file to be parsed.
 * @returns A promise that resolves with a UnifiedReport object, or null if the
 * file type is not supported.
 */
export const parseFile = async (filePath: string): Promise<UnifiedReport | null> => {
  console.log(`Parsing file: ${filePath}`);
  const fileExtension = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);
  console.log(`File extension: '${fileExtension}', Filename: '${filename}', Includes BIOSTD_: ${filename.includes('BIOSTD_')}`);

  if (fileExtension === '.pdf') {
    const rawText = await extractTextFromPdf(filePath);
    return extractStructuredData(rawText, filename);
  } else if (fileExtension === '.xml' && filename.includes('BIOSTD_')) {
    const xmlData = fs.readFileSync(filePath, 'utf-8');
    return parseBiotronikXML(xmlData);
  } else if (fileExtension === '.bnk') {
    const bnkData = fs.readFileSync(filePath, 'utf-8');
    return parseBostonScientificBnk(bnkData);
  } else if (fileExtension === '.pdd') {
    return parseMedtronicPdd(filePath);
  } else if (fileExtension === '.pkg') {
    return parseMedtronicPkg(filePath);
  } else {
    console.warn(`Unsupported file type: ${fileExtension}`);
    return null;
  }
};


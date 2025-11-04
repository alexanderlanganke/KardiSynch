import { parseFile } from './parser';
import { mergePdfs, extractTextFromPdf, verifyPdfMatch } from './pdf-merger';
import * as fs from 'fs';
import * as path from 'path';
import { UnifiedReport } from './reports';

/**
 * Processes a visit-specific directory from the _IMPORT folder. It orchestrates
 * file verification, merges PDFs, and coordinates parsing of various file types
 * for a single patient visit.
 * @param directoryPath The path to the visit-specific directory.
 */
export const routeFiles = async (directoryPath: string) => {
  console.log(`Routing files in directory: ${directoryPath}`);

  const files = fs.readdirSync(directoryPath);
  const bnkFile = files.find(file => path.extname(file).toLowerCase() === '.bnk');
  const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');

  if (bnkFile && pdfFiles.length > 0) {
    // Parse the BNK file first to get patient information
    const bnkData = await parseFile(path.join(directoryPath, bnkFile));

    if (!bnkData) {
        console.error(`Failed to parse BNK file: ${bnkFile}`);
        return;
    }

    // Verify each PDF to ensure it belongs to the same patient.
    const verifiedPdfPaths = [];
    for (const pdfFile of pdfFiles) {
        const pdfPath = path.join(directoryPath, pdfFile);
        const pdfText = await extractTextFromPdf(pdfPath);
        if (verifyPdfMatch(pdfText, bnkData)) {
            verifiedPdfPaths.push(pdfPath);
        } else {
            console.warn(`PDF file ${pdfFile} does not seem to belong to patient ${bnkData.patient.first_name} ${bnkData.patient.last_name}.`);
        }
    }

    if (verifiedPdfPaths.length === 0) {
        console.error(`No verified PDFs found for patient ${bnkData.patient.first_name} ${bnkData.patient.last_name}.`);
        return;
    }

    // Merge all verified PDFs into a single file.
    const mergedPdf = await mergePdfs(verifiedPdfPaths);
    const mergedPdfPath = path.join(directoryPath, 'merged.pdf');
    fs.writeFileSync(mergedPdfPath, mergedPdf);

    // Parse the merged PDF to extract its data.
    const pdfData = await parseFile(mergedPdfPath);

    // Combine the data from the BNK file and the merged PDF into a single report.
    const combinedData: UnifiedReport = {
        ...bnkData,
        ...pdfData,
        raw_text: `${bnkData.raw_text}\n\n--- MERGED PDF ---\n\n${pdfData?.raw_text}`,
    };

    console.log('Combined data:', combinedData);

  } else {
    console.warn(`Could not find a BNK file and/or PDF files in ${directoryPath}`);
  }
};

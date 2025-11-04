import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { sendUnmatchedFiles } from './main';
import { routeFiles } from './router';
import { parseFile } from './parser';
import { UnifiedReport } from './reports';
import { extractTextFromPdf, verifyPdfMatch } from './pdf-merger';

const importDir = path.join(__dirname, '..', '..', '_IMPORT');
const unmatchedDir = path.join(__dirname, '..', '..', '_UNMATCHED');

const processFiles = async () => {
  fs.readdir(importDir, async (err, files) => {
    if (err) {
      console.error(`Error reading import directory: ${err}`);
      return;
    }

    const patientFileGroups = files.reduce((acc, file) => {
      const patientId = path.basename(file, path.extname(file)).split('_')[0];
      if (!acc[patientId]) acc[patientId] = [];
      acc[patientId].push(file);
      return acc;
    }, {} as Record<string, string[]>);

    const allUnmatchedFiles: string[] = [];

    for (const patientId in patientFileGroups) {
      const patientFiles = patientFileGroups[patientId];
      const potentialPrimaryFiles = patientFiles.filter(file => path.extname(file).toLowerCase() !== '.pdf');
      const primaryReports: { file: string; data: UnifiedReport }[] = [];

      for (const file of potentialPrimaryFiles) {
        const reportData = await parseFile(path.join(importDir, file));
        if (reportData) {
          primaryReports.push({ file, data: reportData });
        }
      }
      const pdfFiles = patientFiles.filter(file => path.extname(file).toLowerCase() === '.pdf');
      const matchedFiles = new Set<string>();

      if (primaryReports.length === 0) {
        console.warn(`No primary report found for patient ${patientId}. Moving all associated files to _UNMATCHED.`);
        for (const file of patientFiles) {
          const oldPath = path.join(importDir, file);
          const newPath = path.join(unmatchedDir, file);
          fs.renameSync(oldPath, newPath);
          allUnmatchedFiles.push(file);
        }
        continue;
      }

      const visits: { reportFile: string; reportData: UnifiedReport; pdfs: string[] }[] = [];
      for (const report of primaryReports) {
        visits.push({ reportFile: report.file, reportData: report.data, pdfs: [] });
        matchedFiles.add(report.file);
      }

      for (const pdfFile of pdfFiles) {
        const pdfPath = path.join(importDir, pdfFile);
        const pdfText = await extractTextFromPdf(pdfPath);
        for (const visit of visits) {
          if (verifyPdfMatch(pdfText, visit.reportData)) {
            visit.pdfs.push(pdfFile);
            matchedFiles.add(pdfFile);
            break;
          }
        }
      }

      for (const visit of visits) {
        const visitId = `${patientId}_${visit.reportData.interrogation_date.split('T')[0]}_${uuidv4()}`;
        const visitDir = path.join(importDir, visitId);
        fs.mkdirSync(visitDir, { recursive: true });

        const allVisitFiles = [visit.reportFile, ...visit.pdfs];
        for (const file of allVisitFiles) {
          const oldPath = path.join(importDir, file);
          const newPath = path.join(visitDir, file);
          fs.renameSync(oldPath, newPath);
        }
        routeFiles(visitDir);
      }

      patientFiles.forEach(file => {
        if (!matchedFiles.has(file)) {
          const oldPath = path.join(importDir, file);
          const newPath = path.join(unmatchedDir, file);
          fs.renameSync(oldPath, newPath);
          allUnmatchedFiles.push(file);
          console.warn(`Moved unmatched file to _UNMATCHED: ${file}`);
        }
      });
    }

    if (allUnmatchedFiles.length > 0) {
      sendUnmatchedFiles(allUnmatchedFiles);
    }
  });
};

export const initializeWatcher = () => {
  [importDir, unmatchedDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  console.log(`Watching for file changes on ${importDir}`);
  processFiles();

  fs.watch(importDir, (eventType, filename) => {
    if (filename && eventType === 'rename') {
      console.log(`File added: ${filename}`);
      processFiles();
    }
  });
};

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { sendUnmatchedFiles, sendNotification } from './main';
import { routeFiles } from './router';
import { parseFile } from './parser';
import { UnifiedReport } from './reports';
import { extractTextFromPdf, verifyPdfMatch } from './pdf-merger';

let importDir: string;
let unmatchedDir: string;

/**
 * Recursively gets all files in a directory.
 * @param dir The directory to scan.
 * @returns A list of full file paths.
 */
const getAllFiles = (dir: string): string[] => {
  return fs.readdirSync(dir).reduce((files, file) => {
    const name = path.join(dir, file);
    try {
      const isDirectory = fs.statSync(name).isDirectory();
      return isDirectory ? [...files, ...getAllFiles(name)] : [...files, name];
    } catch (error) {
      console.error(`Error processing file ${name}:`, error);
      sendNotification(`Error processing file ${name}: ${error.message}`, 'error');
      return files;
    }
  }, [] as string[]);
};

/**
 * Processes files in the _IMPORT directory, grouping them by patient,
 * identifying primary reports, matching them with PDFs, and creating
 * visit-specific directories.
 */
const processFiles = async () => {
  const files = getAllFiles(importDir);
  const patientFileGroups = files.reduce((acc, file) => {
    const patientId = path.basename(file, path.extname(file)).split('_')[0];
    if (!acc[patientId]) acc[patientId] = [];
    acc[patientId].push(file);
    return acc;
  }, {} as Record<string, string[]>);

  const allUnmatchedFiles: string[] = [];
  const processedDirs = new Set<string>();

  for (const patientId in patientFileGroups) {
    const patientFiles = patientFileGroups[patientId];
    patientFiles.forEach(file => processedDirs.add(path.dirname(file)));

    const potentialPrimaryFiles = patientFiles.filter(file => path.extname(file).toLowerCase() !== '.pdf');
    const primaryReports: { file: string; data: UnifiedReport }[] = [];

    for (const file of potentialPrimaryFiles) {
      const reportData = await parseFile(file);
      if (reportData) {
        primaryReports.push({ file, data: reportData });
      }
    }

    const pdfFiles = patientFiles.filter(file => path.extname(file).toLowerCase() === '.pdf');
    const matchedFiles = new Set<string>();

    if (primaryReports.length === 0) {
      console.warn(`No primary report found for patient ${patientId}. Moving all associated files to _UNMATCHED.`);
      for (const file of patientFiles) {
        try {
          const newPath = path.join(unmatchedDir, path.basename(file));
          fs.renameSync(file, newPath);
          allUnmatchedFiles.push(path.basename(file));
        } catch (error) {
          console.error(`Error moving unmatched file ${file}:`, error);
          sendNotification(`Error moving unmatched file ${file}: ${error.message}`, 'error');
        }
      }
      continue;
    }

    const visits: { reportFile: string; reportData: UnifiedReport; pdfs: string[] }[] = [];
    for (const report of primaryReports) {
      visits.push({ reportFile: report.file, reportData: report.data, pdfs: [] });
      matchedFiles.add(report.file);
    }

    for (const pdfFile of pdfFiles) {
      const pdfText = await extractTextFromPdf(pdfFile);
      for (const visit of visits) {
        if (verifyPdfMatch(pdfText, visit.reportData)) {
          visit.pdfs.push(pdfFile);
          matchedFiles.add(pdfFile);
          break;
        }
      }
    }

    for (const visit of visits) {
      try {
        const visitId = `${patientId}_${visit.reportData.interrogation_date.split('T')[0]}_${uuidv4()}`;
        const visitDir = path.join(importDir, visitId);
        fs.mkdirSync(visitDir, { recursive: true });

        const allVisitFiles = [visit.reportFile, ...visit.pdfs];
        for (const file of allVisitFiles) {
          const newPath = path.join(visitDir, path.basename(file));
          fs.renameSync(file, newPath);
        }
        routeFiles(visitDir);
      } catch (error) {
        console.error(`Error creating visit directory for patient ${patientId}:`, error);
        sendNotification(`Error creating visit directory for patient ${patientId}: ${error.message}`, 'error');
      }
    }

    patientFiles.forEach(file => {
      if (!matchedFiles.has(file)) {
        try {
          const newPath = path.join(unmatchedDir, path.basename(file));
          fs.renameSync(file, newPath);
          allUnmatchedFiles.push(path.basename(file));
          console.warn(`Moved unmatched file to _UNMATCHED: ${path.basename(file)}`);
        } catch (error) {
          console.error(`Error moving unmatched file ${file}:`, error);
          sendNotification(`Error moving unmatched file ${file}: ${error.message}`, 'error');
        }
      }
    });
  }

  if (allUnmatchedFiles.length > 0) {
    sendUnmatchedFiles(allUnmatchedFiles);
  }

  // Clean up empty directories
  processedDirs.forEach(dir => {
    try {
      if (fs.readdirSync(dir).length === 0 && dir !== importDir) {
        fs.rmdirSync(dir);
        console.log(`Removed empty directory: ${dir}`);
      }
    } catch (error) {
      console.error(`Error removing empty directory ${dir}:`, error);
      sendNotification(`Error removing empty directory ${dir}: ${error.message}`, 'error');
    }
  });
};

/**
 * Initializes the file watcher, which monitors the _IMPORT directory for new files.
 */
export const initializeWatcher = (appImportDir: string, appUnmatchedDir: string) => {
  importDir = appImportDir;
  unmatchedDir = appUnmatchedDir;
  [importDir, unmatchedDir].forEach(dir => {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (error) {
      console.error(`Error creating directory ${dir}:`, error);
      sendNotification(`Error creating directory ${dir}: ${error.message}`, 'error');
    }
  });

  console.log(`Watching for file changes on ${importDir}`);
  processFiles();

  fs.watch(importDir, { recursive: true }, (eventType, filename) => {
    if (filename && eventType === 'rename') {
      console.log(`File added: ${filename}`);
      processFiles();
    }
  });
};

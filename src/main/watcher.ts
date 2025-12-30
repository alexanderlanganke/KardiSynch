import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { sendUnmatchedFiles, sendNotification, sendProcessStatus } from './windowManager';
import { parseFile } from './parser';
import { UnifiedReport } from './reports';
import { getDb, findPatient, findReportByDate, findPatientBySerial } from './database';
import { storeReport, storeFile } from './storage';


let importDir: string;
let unmatchedDir: string;
let dataDir: string;
let watcherTimeout: NodeJS.Timeout | null = null;
let currentWatcher: fs.FSWatcher | null = null;

/**
 * Creates a temporary directory for processing a batch of files.
 * @returns The path to the newly created temporary directory.
 */
const createTempDirectory = (): string => {
  const tempDir = path.join(importDir, `_TEMP_${uuidv4()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
};

/**
 * Moves a file, handling cross-device moves (EXDEV) by falling back to copy+unlink.
 */
const moveFile = (src: string, dest: string) => {
  try {
    fs.renameSync(src, dest);
  } catch (error: any) {
    if (error.code === 'EXDEV') {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw error;
    }
  }
};

/**
 * Recursively finds all files in a directory, excluding temporary directories.
 */
const getFilesRecursively = (dir: string): string[] => {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      // Skip temp directories and system files
      if (file.startsWith('_TEMP_') || file.startsWith('.')) continue;

      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
          results = results.concat(getFilesRecursively(filePath));
        } else {
          results.push(filePath);
        }
      } catch (e) {
        // Ignore errors accessing specific files/dirs
      }
    }
  } catch (e) {
    console.error(`Error reading directory ${dir}:`, e);
  }
  return results;
};

/**
 * Moves all files from the import directory (and subdirectories) to a temporary directory.
 * @param tempDir The destination temporary directory.
 */
const stageFilesToTempDir = (tempDir: string) => {
  const allFiles = getFilesRecursively(importDir);

  for (const filePath of allFiles) {
    // Generate a unique filename to prevent collisions when flattening directories
    const originalName = path.basename(filePath);
    const uniqueName = `${uuidv4()}_${originalName}`;
    const newPath = path.join(tempDir, uniqueName);

    try {
      moveFile(filePath, newPath);
    } catch (error) {
      console.error(`Error moving file ${filePath} to temp directory:`, error);
      sendNotification(`Error staging file ${originalName}: ${(error as Error).message}`, 'error');
    }
  }
};

/**
 * Extracts key identifiers from a report for matching purposes.
 * @param report The UnifiedReport object.
 * @returns A string with key identifiers or null if insufficient data.
 */
const getReportKey = (report: UnifiedReport): string | null => {
  const { patient, interrogation_date } = report;
  if (patient && patient.last_name && patient.dob && interrogation_date) {
    return `${patient.last_name}_${patient.dob}_${interrogation_date.split('T')[0]}`;
  }
  return null;
}

/**
 * The core processing logic for files within a temporary directory.
 * @param tempDir The temporary directory containing the files to process.
 */
const processTempDirectory = async (tempDir: string) => {
  console.log(`Processing files in temporary directory: ${tempDir}`);
  const allFiles = fs.readdirSync(tempDir).map(f => path.join(tempDir, f));
  const unmatchedFiles: string[] = [];

  sendProcessStatus({ type: 'start', message: `Processing ${allFiles.length} files...` });

  // Filter out unsupported files early
  const supportedFiles = allFiles.filter(file => {
    const ext = path.extname(file).toLowerCase();
    if (['.docx', '.zip', '.jar', '.bat', '.bak'].includes(ext)) {
      console.log(`Skipping unsupported file type: ${ext} (${path.basename(file)})`);
      unmatchedFiles.push(file);
      return false;
    }
    return true;
  });

  // Categorize files
  const structuredFiles = supportedFiles.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ext === '.xml' || ext === '.pkg' || ext === '.log';
  });

  const pdfFiles = supportedFiles.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ext === '.pdf';
  });

  // Track active visits created in this batch
  // Key: "Last_First_DOB_Date" -> { reportId, patientId, patient, date, serial?, sessionId? }
  const activeVisits = new Map<string, { reportId: string, patientId: string, patient: any, date: string, serial?: string, sessionId?: string }>();

  // --- STEP 1: Process Structured Reports (.pkg, .xml) ---
  console.log('--- STEP 1: Processing Structured Reports ---');
  for (const file of structuredFiles) {
    console.log(`Processing structured file: ${path.basename(file)}`);
    sendProcessStatus({ type: 'progress', message: `Importing ${path.basename(file)}...`, file: path.basename(file) });

    try {
      const report = await parseFile(file);
      if (!report) {
        console.warn(`Failed to parse structured file ${path.basename(file)}`);
        unmatchedFiles.push(file);
        continue;
      }

      // Store the report (creates patient/visit if needed)
      const { reportId, patient } = await storeReport(report);

      // Store the structured file itself
      await storeFile(file, reportId, patient.id, `${patient.last_name}_${patient.first_name}`, report.interrogation_date, patient, report);

      // Generate a key for this visit
      const key = getReportKey(report);
      if (key) {
        activeVisits.set(key, {
          reportId,
          patientId: patient.id,
          patient,
          date: report.interrogation_date,
          serial: report.device?.serial_number,
          sessionId: report.session_id
        });
      }

      // --- STEP 2: Handle Internal PDFs (extracted from .pkg) ---
      if (report.generatedFiles && report.generatedFiles.length > 0) {
        console.log(`Processing ${report.generatedFiles.length} internal PDFs for ${path.basename(file)}`);
        for (const genFile of report.generatedFiles) {
          await storeFile(genFile, reportId, patient.id, `${patient.last_name}_${patient.first_name}`, report.interrogation_date, patient, report);
        }
      }

    } catch (e) {
      console.error(`Error processing structured file ${path.basename(file)}:`, e);
      unmatchedFiles.push(file);
    }
  }

  // --- STEP 3: Match Associated PDFs ---
  console.log('--- STEP 3: Matching Associated PDFs ---');
  const remainingPdfs: string[] = [];

  for (const file of pdfFiles) {
    try {
      const report = await parseFile(file);
      if (!report) {
        remainingPdfs.push(file);
        continue;
      }

      let matched = false;

      // Try to match with active visits
      for (const [key, visit] of activeVisits.entries()) {
        // Match Logic:
        // 1. Serial Number Match (Strongest)
        if (visit.serial && report.device?.serial_number && visit.serial === report.device.serial_number) {
          console.log(`Matched PDF ${path.basename(file)} to visit ${key} by Serial Number`);
          // Pass undefined for report to PREVENT overwriting valid XML data with PDF data
          await storeFile(file, visit.reportId, visit.patientId, `${visit.patient.last_name}_${visit.patient.first_name}`, visit.date, visit.patient, undefined);
          matched = true;
          break;
        }

        // 2. Session ID Match
        if (visit.sessionId && path.basename(file).includes(visit.sessionId)) {
          console.log(`Matched PDF ${path.basename(file)} to visit ${key} by Session ID (${visit.sessionId})`);
          await storeFile(file, visit.reportId, visit.patientId, `${visit.patient.last_name}_${visit.patient.first_name}`, visit.date, visit.patient, undefined);
          matched = true;
          break;
        }

        // 3. Name + DOB + Date Match
        const pdfKey = getReportKey(report);
        if (pdfKey && pdfKey === key) {
          console.log(`Matched PDF ${path.basename(file)} to visit ${key} by Name/DOB/Date`);
          // Pass undefined for report to PREVENT overwriting valid XML data with PDF data
          await storeFile(file, visit.reportId, visit.patientId, `${visit.patient.last_name}_${visit.patient.first_name}`, visit.date, visit.patient, undefined);
          matched = true;
          break;
        }
      }

      if (!matched) {
        remainingPdfs.push(file);
      }

    } catch (e) {
      console.error(`Error analyzing PDF ${path.basename(file)}:`, e);
      remainingPdfs.push(file);
    }
  }

  // --- STEP 4: Process Standalone PDFs ---
  console.log('--- STEP 4: Processing Standalone PDFs ---');
  for (const file of remainingPdfs) {
    console.log(`Processing standalone PDF: ${path.basename(file)}`);
    sendProcessStatus({ type: 'progress', message: `Analyzing ${path.basename(file)}...`, file: path.basename(file) });

    try {
      const report = await parseFile(file);
      if (!report) {
        console.warn(`Could not parse PDF ${path.basename(file)}. Moving to unmatched.`);
        unmatchedFiles.push(file);
        continue;
      }

      // Check for existing patient in DB
      let patient = null;

      // 1. Try by Name + DOB
      if (report.patient.last_name !== 'Unknown' && report.patient.dob) {
        patient = await findPatient(report.patient.last_name, report.patient.dob);
      }

      // 2. Try by Serial Number
      if (!patient && report.device?.serial_number && report.device.serial_number !== 'Unknown') {
        patient = await findPatientBySerial(report.device.serial_number);
      }

      if (patient) {
        console.log(`Found existing patient for PDF ${path.basename(file)}: ${patient.last_name}, ${patient.first_name}`);

        // Check for existing visit on this date
        const datePrefix = report.interrogation_date.split('T')[0];
        const existingReport = await findReportByDate(patient.id, datePrefix);

        if (existingReport) {
          console.log(`Merging PDF into existing visit for ${patient.last_name} on ${datePrefix}`);
          // Pass undefined for report to PREVENT overwriting valid XML data with PDF data
          await storeFile(file, existingReport.id, patient.id, `${patient.last_name}_${patient.first_name}`, report.interrogation_date, patient, undefined);
        } else {
          console.log(`Creating new visit for existing patient ${patient.last_name}`);
          // Ensure patient_id is set
          report.patient_id = patient.id;
          const { reportId } = await storeReport(report);
          await storeFile(file, reportId, patient.id, `${patient.last_name}_${patient.first_name}`, report.interrogation_date, patient, report);
        }
      } else {
        // Patient not found
        if (report.device?.serial_number && report.device.serial_number !== 'Unknown') {
          console.log(`Creating NEW patient from PDF ${path.basename(file)} (Serial: ${report.device.serial_number})`);
          const { reportId, patient: newPatient } = await storeReport(report);
          await storeFile(file, reportId, newPatient.id, `${newPatient.last_name}_${newPatient.first_name}`, report.interrogation_date, newPatient, report);
        } else {
          // No match, no serial -> Unmatched
          if (report.patient.last_name !== 'Unknown') {
            console.warn(`No match and no serial for ${path.basename(file)}. Moving to unmatched.`);
            unmatchedFiles.push(file);
          } else {
            console.warn(`No identifiers for ${path.basename(file)}. Moving to unmatched.`);
            unmatchedFiles.push(file);
          }
        }
      }

    } catch (e) {
      console.error(`Error processing standalone PDF ${path.basename(file)}:`, e);
      unmatchedFiles.push(file);
    }
  }

  // Move unmatched files
  for (const file of unmatchedFiles) {
    // Check if file still exists (it might have been moved if we messed up logic)
    if (fs.existsSync(file)) {
      const newPath = path.join(unmatchedDir, path.basename(file));
      try {
        moveFile(file, newPath);
      } catch (e) {
        console.error(`Error moving unmatched file ${file}:`, e);
      }
    }
  }

  if (unmatchedFiles.length > 0) {
    sendUnmatchedFiles(unmatchedFiles.map(f => path.basename(f)));
  }

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`Successfully removed temporary directory: ${tempDir}`);
    sendProcessStatus({ type: 'complete', message: 'Processing complete.' });
  } catch (error) {
    console.error(`Error removing temporary directory ${tempDir}:`, error);
    sendNotification(`Error cleaning up temp directory: ${(error as Error).message}`, 'error');
  }
};

/**
 * Initializes the file watcher, which monitors the _IMPORT directory for new files.
 */
export const initializeWatcher = (appImportDir: string, appUnmatchedDir: string, appDataDir: string) => {
  importDir = appImportDir;
  unmatchedDir = appUnmatchedDir;
  dataDir = appDataDir;

  [importDir, unmatchedDir, dataDir].forEach(dir => {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (error) {
      console.error(`Error creating directory ${dir}:`, error);
      sendNotification(`Error creating directory ${dir}: ${(error as Error).message}`, 'error');
    }
  });


  console.log(`Watching for file changes on ${importDir}`);

  // DEBUG: Polling fallback
  setInterval(() => {
    try {
      const files = fs.readdirSync(importDir);
      if (files.length > 0) {
        console.log(`POLLING: Found ${files.length} files in ${importDir}: ${files.join(', ')}`);
        // Trigger processing if files exist but watcher didn't fire
        if (!watcherTimeout) {
          console.log('POLLING: Triggering processing fallback...');
          watcherTimeout = setTimeout(() => {
            const currentFiles = getFilesRecursively(importDir);
            if (currentFiles.length > 0) {
              const tempDir = createTempDirectory();
              stageFilesToTempDir(tempDir);
              processTempDirectory(tempDir);
            }
            watcherTimeout = null;
          }, 1000);
        }
      }
    } catch (e) {
      console.error('POLLING ERROR:', e);
    }
  }, 5000);

  // Check for existing files on startup
  try {
    const existingFiles = getFilesRecursively(importDir);
    if (existingFiles.length > 0) {
      console.log(`Found ${existingFiles.length} existing files in import directory. Processing...`);
      // We use a timeout to allow the app to fully initialize before heavy processing
      setTimeout(() => {
        const tempDir = createTempDirectory();
        stageFilesToTempDir(tempDir);
        processTempDirectory(tempDir);
      }, 3000);
    }
  } catch (error) {
    console.error('Error checking for existing files:', error);
  }

  try {
    currentWatcher = fs.watch(importDir, { recursive: true }, (eventType, filename) => {
      console.log(`Watcher event: ${eventType} for file: ${filename}`);
      if (filename) {
        if (watcherTimeout) {
          clearTimeout(watcherTimeout);
        }
        watcherTimeout = setTimeout(() => {
          console.log('Watcher timeout triggered. Checking for files...');
          const currentFiles = getFilesRecursively(importDir);
          console.log(`Found ${currentFiles.length} files in import directory.`);
          if (currentFiles.length === 0) {
            console.log('No files found, skipping processing.');
            return;
          }
          console.log('File changes stabilized. Starting processing...');
          const tempDir = createTempDirectory();
          stageFilesToTempDir(tempDir);
          processTempDirectory(tempDir);
          watcherTimeout = null;
        }, 2000);
      }
    });
  } catch (error) {
    console.error(`Error starting watcher on ${importDir}:`, error);
    sendNotification(`Error starting watcher: ${(error as Error).message}`, 'error');
  }
};

export const stopWatcher = () => {
  if (currentWatcher) {
    currentWatcher.close();
    currentWatcher = null;
    console.log('File watcher stopped.');
  }
};

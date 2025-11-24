import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { sendUnmatchedFiles, sendNotification, sendProcessStatus } from './windowManager';
import { parseFile } from './parser';
import { UnifiedReport } from './reports';
import { getDb, findPatient, findReportByDate } from './database';
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
      // We use copy+unlink instead of rename to handle cross-device moves if necessary,
      // and to ensure we don't leave broken empty directories immediately (though we aren't cleaning them up yet)
      fs.renameSync(filePath, newPath);
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
  let filesToProcess = fs.readdirSync(tempDir).map(f => path.join(tempDir, f));
  const unmatchedFiles = [];

  sendProcessStatus({ type: 'start', message: `Processing ${filesToProcess.length} files...` });

  // Sort files to prioritize potential trigger files (XML, PDF) over images
  filesToProcess.sort((a, b) => {
    const extA = path.extname(a).toLowerCase();
    const extB = path.extname(b).toLowerCase();

    // Prioritize XML over PDF, and both over everything else
    if (extA === '.xml' && extB !== '.xml') return -1;
    if (extB === '.xml' && extA !== '.xml') return 1;

    const isTriggerA = extA === '.pdf';
    const isTriggerB = extB === '.pdf';
    if (isTriggerA && !isTriggerB) return -1;
    if (!isTriggerA && isTriggerB) return 1;
    return 0;
  });

  while (filesToProcess.length > 0) {
    const triggerFile = filesToProcess.shift();
    if (!triggerFile) continue;

    console.log(`Processing trigger file: ${path.basename(triggerFile)}`);
    sendProcessStatus({ type: 'progress', message: `Analyzing ${path.basename(triggerFile)}...`, file: path.basename(triggerFile) });
    const triggerReport = await parseFile(triggerFile);
    if (!triggerReport) {
      console.warn(`Could not parse trigger file ${path.basename(triggerFile)}. Moving to unmatched.`);
      unmatchedFiles.push(triggerFile);
      continue;
    }

    const triggerKey = getReportKey(triggerReport);
    if (!triggerKey) {
      console.warn(`Could not generate a key for trigger file ${path.basename(triggerFile)}. Moving to unmatched.`);
      unmatchedFiles.push(triggerFile);
      continue;
    }

    const visitPackage = [triggerFile];
    const remainingFiles = [];

    const triggerBasename = path.basename(triggerFile);
    const timestampMatch = triggerBasename.match(/BIOSTD_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
    const timestamp = timestampMatch ? timestampMatch[1] : null;

    // Add any generated files (e.g. extracted PDFs) to the package
    if (triggerReport.generatedFiles && triggerReport.generatedFiles.length > 0) {
      visitPackage.push(...triggerReport.generatedFiles);
    }

    for (const file of filesToProcess) {
      const report = await parseFile(file);
      if (report && getReportKey(report) === triggerKey) {
        visitPackage.push(file);
      } else if (!report && timestamp && path.basename(file).includes(timestamp)) {
        // If parsing failed (e.g. image) but it shares the timestamp, include it in the package
        visitPackage.push(file);
      } else {
        remainingFiles.push(file);
      }
    }

    filesToProcess = remainingFiles;
    console.log(`Created visit package with ${visitPackage.length} files for key: ${triggerKey}`);

    const combinedReport: Partial<UnifiedReport> = {};
    for (const file of visitPackage) {
      const report = await parseFile(file);
      if (report) {
        // A real implementation would have a more sophisticated merge strategy.
        Object.assign(combinedReport, report);
      }
    }


    if (Object.keys(combinedReport).length > 0) {
      try {
        // Check for duplicates
        if (combinedReport.patient && combinedReport.interrogation_date) {
          const patient = await findPatient(combinedReport.patient.last_name, combinedReport.patient.dob);
          if (patient) {
            const existingReport = await findReportByDate(patient.id, combinedReport.interrogation_date.split('T')[0]);
            if (existingReport) {
              console.warn(`Duplicate report found for patient ${patient.id} on ${combinedReport.interrogation_date}. Skipping import.`);
              unmatchedFiles.push(...visitPackage);
              continue;
            }
          }
        }

        const { reportId, patient: storedPatient } = await storeReport(combinedReport as UnifiedReport);
        const patientName = combinedReport.patient ? `${combinedReport.patient.last_name}_${combinedReport.patient.first_name}` : undefined;

        // Get patient ID from database to use in directory structure
        const fetchedPatient = combinedReport.patient ? await findPatient(combinedReport.patient.last_name, combinedReport.patient.dob) : null;
        const patientId = fetchedPatient?.id || '';
        const interrogationDate = combinedReport.interrogation_date;

        for (const file of visitPackage) {
          await storeFile(file, reportId, patientId, patientName, interrogationDate, storedPatient, combinedReport as UnifiedReport);
        }
        console.log(`Successfully stored report and ${visitPackage.length} files.`);
        sendProcessStatus({ type: 'complete', message: `Imported visit for ${combinedReport.patient?.last_name}` });
      } catch (e) {
        console.error('Error storing report or files', e);
        sendNotification(`Error storing report: ${(e as Error).message}`, 'error');
        unmatchedFiles.push(...visitPackage);
      }
    } else {
      unmatchedFiles.push(...visitPackage);
    }
  }

  for (const file of unmatchedFiles) {
    const newPath = path.join(unmatchedDir, path.basename(file));
    try {
      fs.renameSync(file, newPath);
    } catch (e) {
      console.error(`Error moving unmatched file ${file}:`, e);
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

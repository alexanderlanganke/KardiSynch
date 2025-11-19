import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { sendUnmatchedFiles, sendNotification } from './windowManager';
import { parseFile } from './parser';
import { UnifiedReport } from './reports';
import { getDb } from './database';
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
 * Moves all files from the import directory to a temporary directory for safe processing.
 * @param tempDir The destination temporary directory.
 */
const stageFilesToTempDir = (tempDir: string) => {
  const files = fs.readdirSync(importDir).filter(file => !file.startsWith('_TEMP_'));
  for (const file of files) {
    const oldPath = path.join(importDir, file);
    const newPath = path.join(tempDir, file);
    try {
      if (fs.statSync(oldPath).isFile()) {
        fs.renameSync(oldPath, newPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EISDIR') {
        console.error(`Error moving file ${oldPath} to temp directory:`, error);
        sendNotification(`Error staging file ${file}: ${(error as Error).message}`, 'error');
      }
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

  while (filesToProcess.length > 0) {
    const triggerFile = filesToProcess.shift();
    if (!triggerFile) continue;

    console.log(`Processing trigger file: ${path.basename(triggerFile)}`);
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

    for (const file of filesToProcess) {
      const report = await parseFile(file);
      if (report && getReportKey(report) === triggerKey) {
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
        const reportId = await storeReport(combinedReport as UnifiedReport);
        for (const file of visitPackage) {
          await storeFile(file, reportId);
        }
        console.log(`Successfully stored report and ${visitPackage.length} files.`);
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

  try {
    currentWatcher = fs.watch(importDir, { recursive: false }, (eventType, filename) => {
      if (filename) {
        if (watcherTimeout) {
          clearTimeout(watcherTimeout);
        }
        watcherTimeout = setTimeout(() => {
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

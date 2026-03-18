import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { sendUnmatchedFiles, sendNotification, sendProcessStatus, sendManualSortingRequest, sendImportSessionUpdate, sendPatientListUpdate } from './windowManager';
import { parseFile } from './parser';
import { UnifiedReport } from './reports';
import { getDb, findPatient, findReportByDate, findPatientBySerial, createImportSession, updateImportSessionStatus, logImportEvent, getPatientById, createPatient, getReportById } from './database';
import { storeReport, storeFile } from './storage';

let importDir: string;
let unmatchedDir: string;
let dataDir: string;
let watcherTimeout: NodeJS.Timeout | null = null;
let startupTimeout: NodeJS.Timeout | null = null;
let currentWatcher: import('fs').FSWatcher | null = null;
let pollingFallbackInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

// interactive mode globals
let pendingManualSortRequest: { resolve: (value: any) => void, reject: (reason?: any) => void } | null = null;
let pendingDeviceSelectionRequest: { resolve: (value: any) => void, reject: (reason?: any) => void } | null = null;

const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => {
      console.warn(`[Watcher] Promise timed out after ${ms}ms, using fallback`);
      resolve(fallback);
    }, ms))
  ]);
};

export const resolveManualSorting = (response: any) => {
  if (pendingManualSortRequest) {
    pendingManualSortRequest.resolve(response);
    pendingManualSortRequest = null;
  }
};

export const resolveDeviceSelection = (response: any) => {
  if (pendingDeviceSelectionRequest) {
    pendingDeviceSelectionRequest.resolve(response);
    pendingDeviceSelectionRequest = null;
  }
};

export const getUnmatchedFilePath = (filename: string) => {
  if (!unmatchedDir) return null;
  return path.join(unmatchedDir, filename);
};

/**
 * Creates a temporary directory for processing a batch of files.
 * @returns The path to the newly created temporary directory.
 */
const createTempDirectory = async (): Promise<string> => {
  const tempDir = path.join(importDir, `_TEMP_${uuidv4()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
};

/**
 * Moves a file, handling cross-device moves (EXDEV) by falling back to copy+unlink.
 */
const moveFile = async (src: string, dest: string) => {
  try {
    await fs.rename(src, dest);
  } catch (error: any) {
    if (error.code === 'EXDEV') {
      await fs.copyFile(src, dest);
      const srcStats = await fs.stat(src);
      const destStats = await fs.stat(dest);
      if (destStats.size !== srcStats.size) {
        throw new Error(`Cross-device copy verification failed for ${src} (expected ${srcStats.size} bytes, got ${destStats.size})`);
      }
      await fs.unlink(src);
    } else {
      throw error;
    }
  }
};

/**
 * Recursively finds all files in a directory, excluding temporary directories.
 */
const getFilesRecursively = async (dir: string): Promise<string[]> => {
  let results: string[] = [];
  try {
    const list = await fs.readdir(dir);
    for (const file of list) {
      if (file.startsWith('_TEMP_') || file.startsWith('.')) continue;
      const filePath = path.join(dir, file);
      try {
        const stat = await fs.stat(filePath);
        if (stat && stat.isDirectory()) {
          results = results.concat(await getFilesRecursively(filePath));
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
const stageFilesToTempDir = async (tempDir: string) => {
  const allFiles = await getFilesRecursively(importDir);
  for (const filePath of allFiles) {
    const originalName = path.basename(filePath);
    const uniqueName = `${uuidv4()}_${originalName}`;
    const newPath = path.join(tempDir, uniqueName);
    try {
      await moveFile(filePath, newPath);
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
  const sessionId = uuidv4();
  await createImportSession(sessionId);

  const allFiles = (await fs.readdir(tempDir)).map(f => path.join(tempDir, f));
  const unmatchedFiles: string[] = [];

  // Stats for session summary
  const sessionSummary = {
    total: allFiles.length,
    processed: 0,
    imported: 0,
    unmatched: 0,
    errors: 0,
    manuallySorted: 0,
    warnings: [] as string[]
  };

  // Collect unique patient IDs for post-import automation checks
  const importedPatientIds = new Set<string>();

  try {

    sendProcessStatus({ type: 'start', message: `Processing ${allFiles.length} files...` });

    // Filter out unsupported files early
    const supportedFiles = allFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      if (['.docx', '.zip', '.jar', '.bat', '.bak'].includes(ext)) {
        console.log(`Skipping unsupported file type: ${ext} (${path.basename(file)})`);
        unmatchedFiles.push(file);
        logImportEvent({
          id: uuidv4(),
          session_id: sessionId,
          file_path: file,
          status: 'skipped',
          message: 'Unsupported file type'
        });
        sessionSummary.warnings.push(`Skipped ${path.basename(file)} (unsupported type)`);
        return false;
      }
      return true;
    });

    // Categorize files
    const structuredFiles = supportedFiles.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ext === '.xml' || ext === '.pkg' || ext === '.log' || ext === '.pdd' || ext === '.bnk';


    });

    const pdfFiles = supportedFiles.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ext === '.pdf';
    });

    // Track active visits created in this batch
    // Key: "Last_First_DOB_Date" -> { reportId, patientId, patient, date, serial?, sessionId? }
    const activeVisits = new Map<string, { reportId: string, patientId: string, patient: any, date: string, serial?: string, sessionId?: string }>();

    // Track all visits affected during this import batch for post-import aggregation
    const affectedVisits = new Map<string, { patient: any }>();

    // --- STEP 1: Process Structured Reports (.pkg, .xml) ---
    console.log('--- STEP 1: Processing Structured Reports ---');
    for (const file of structuredFiles) {
      console.log(`Processing structured file: ${path.basename(file)}`);
      sendProcessStatus({ type: 'progress', message: `Importing ${path.basename(file)}...`, file: path.basename(file) });
      sessionSummary.processed++;

      try {
        const report = await parseFile(file);
        if (!report) {
          console.warn(`Failed to parse structured file ${path.basename(file)}`);
          unmatchedFiles.push(file);
          logImportEvent({
            id: uuidv4(),
            session_id: sessionId,
            file_path: file,
            status: 'error',
            message: 'Failed to parse structured file'
          });
          sessionSummary.errors++;
          continue;
        }

        // 1. CHECK FOR DEVICE AMBIGUITY (Autodetection Failure)
        // If manufacturer is unknown or the device model is unknown, prompt the user.
        if (
          report.manufacturer === 'Unknown' ||
          !report.device ||
          report.device.model === 'Unknown' ||
          (report.manufacturer === 'Biotronik' && report.device.type === 'Unknown')
        ) {
          console.log(`Device ambiguity detected for ${path.basename(file)}. Requesting manual device info...`);

          const { sendDeviceSelectionRequest } = await import('./windowManager');

          const userDeviceResult: any = await withTimeout(
            new Promise((resolve) => {
              pendingDeviceSelectionRequest = { resolve, reject: () => resolve({ action: 'skip' }) };
              sendDeviceSelectionRequest({
                filename: path.basename(file),
                previewData: {
                  manufacturer: report.manufacturer,
                  device: report.device,
                  leads: report.leads // Pass leads for context
                }
              });
            }),
            5 * 60 * 1000,
            { action: 'skip' }
          );

          if (userDeviceResult.action === 'save' && userDeviceResult.deviceData) {
            const d = userDeviceResult.deviceData;
            report.manufacturer = d.manufacturer;
            report.device = {
              type: d.type,
              model: d.model || 'Unknown',
              serial_number: d.serial || 'Unknown'
            };

            if (d.leads && Array.isArray(d.leads)) {
              report.leads = d.leads.map((l: any) => ({
                name: l.name,
                model: l.model,
                serial: l.serial,
                manufacturer: d.manufacturer
              }));
            }

            console.log('Applied manual device details:', report.device);
          } else {
            console.log('User skipped device selection. proceeding with Unknowns.');
          }
        }

        // CHECK FOR INCOMPLETE PATIENT DATA (Common in some Abbott logs)
        if (!report.patient.last_name || !report.patient.dob || report.patient.last_name === 'Unknown') {
          console.warn(`Structured file ${path.basename(file)} lacks patient identity. Attempting recovery...`);

          let targetPatient = null;

          // 1. Try matching by Serial Number
          if (report.device && report.device.serial_number && report.device.serial_number !== 'Unknown') {
            try {
              const { findPatientBySerial } = await import('./database');
              const existing = await findPatientBySerial(report.device.serial_number);
              if (existing) {
                console.log(`Recovered patient identity via Serial Number for ${path.basename(file)}.`);
                targetPatient = existing;
              }
            } catch (e) {
              console.error('Error lookup by serial:', e);
            }
          }

          // 2. If still unknown, Manual Sort
          if (!targetPatient) {
            console.log(`No clear match for unnamed file ${path.basename(file)}. Requesting manual input...`);

            // Ask user what to do
            const userDecision: any = await withTimeout(
              new Promise((resolve) => {
                pendingManualSortRequest = { resolve, reject: () => resolve({ action: 'unmatched' }) };
                sendManualSortingRequest({
                  filename: path.basename(file),
                  tempPath: file,
                  previewData: {
                    patientName: "UNKNOWN (Missing in Log)",
                    dob: report.patient.dob || "Unknown",
                    date: report.interrogation_date,
                    serial: report.device?.serial_number || "Unknown",
                    manufacturer: report.manufacturer,
                    deviceModel: report.device?.model,
                    leads: report.leads
                  }
                });
              }),
              5 * 60 * 1000,
              { action: 'unmatched' }
            );

            if (userDecision.action === 'assign-patient') {
              const { getPatientById } = await import('./database');
              targetPatient = await getPatientById(userDecision.patientId);
            } else if (userDecision.action === 'create-patient') {
              const { createPatient, getPatientById } = await import('./database');
              const newId = uuidv4();
              await createPatient({
                id: newId,
                first_name: userDecision.patientData.first_name,
                last_name: userDecision.patientData.last_name,
                dob: userDecision.patientData.dob,
                hospitalPatientId: userDecision.patientData.hospitalPatientId || null
              });
              targetPatient = await getPatientById(newId);
            } else {
              // Skipped
              unmatchedFiles.push(file);
              logImportEvent({
                id: uuidv4(),
                session_id: sessionId,
                file_path: file,
                status: 'unmatched',
                message: 'User skipped unnamed logfile'
              });
              sessionSummary.unmatched++;
              continue; // Skip processing this file
            }
          }

          // Apply recovered identity to the report object
          if (targetPatient) {
            report.patient.first_name = targetPatient.first_name;
            report.patient.last_name = targetPatient.last_name;
            report.patient.dob = targetPatient.dob;
            report.patient.hospitalPatientId = targetPatient.hospitalPatientId;
            // IMPORTANT: If duplicate report text, checking might still happen in storeReport, 
            // but at least we have a valid patient now.
          }
        }

        // Defined here to be accessible for internal PDF processing
        let reportId: string;
        let patient: any;

        // Check if we already have an active visit for this patient/date/serial in this batch
        const key = getReportKey(report);
        const existingVisit = key ? activeVisits.get(key) : null;

        if (existingVisit) {
          console.log(`[Watcher] Merging file ${path.basename(file)} into existing visit ${existingVisit.reportId}`);

          // Reuse existing IDs
          reportId = existingVisit.reportId;
          patient = existingVisit.patient;

          // Store file and MERGE data (storeFile now handles additive visit.xml)
          await storeFile(file, reportId, patient.id, `${patient.last_name}_${patient.first_name}`, report.interrogation_date, patient, report);

          logImportEvent({
            id: uuidv4(),
            session_id: sessionId,
            file_path: file,
            status: 'imported',
            patient_id: patient.id,
            report_id: reportId,
            message: 'Merged into active visit'
          });
          sessionSummary.imported++;
          affectedVisits.set(reportId, { patient });

        } else {
          // New Visit Case
          // Store the report (creates patient/visit if needed)
          const result = await storeReport(report);
          reportId = result.reportId;
          patient = result.patient;

          // Store the structured file itself
          await storeFile(file, reportId, patient.id, `${patient.last_name}_${patient.first_name}`, report.interrogation_date, patient, report);

          logImportEvent({
            id: uuidv4(),
            session_id: sessionId,
            file_path: file,
            status: 'imported',
            patient_id: patient.id,
            report_id: reportId
          });
          sessionSummary.imported++;
          importedPatientIds.add(patient.id);
          affectedVisits.set(reportId, { patient });

          // Register as active visit
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
        }

        // --- STEP 2: Handle Internal PDFs (extracted from .pkg) ---
        if (report.generatedFiles && report.generatedFiles.length > 0) {
          console.log(`Processing ${report.generatedFiles.length} internal PDFs for ${path.basename(file)}`);
          for (const genFile of report.generatedFiles) {
            await storeFile(genFile, reportId, patient.id, `${patient.last_name}_${patient.first_name}`, report.interrogation_date, patient, report);

            logImportEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: genFile,
              status: 'imported',
              patient_id: patient.id,
              report_id: reportId,
              message: 'Extracted from PKG'
            });
          }
        }

      } catch (e) {
        console.error(`Error processing structured file ${path.basename(file)}:`, e);
        unmatchedFiles.push(file);
        logImportEvent({
          id: uuidv4(),
          session_id: sessionId,
          file_path: file,
          status: 'error',
          message: (e as Error).message
        });
        sessionSummary.errors++;
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

            logImportEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'imported',
              patient_id: visit.patientId,
              report_id: visit.reportId,
              message: 'Matched by Serial'
            });
            sessionSummary.imported++;
            sessionSummary.processed++;
            affectedVisits.set(visit.reportId, { patient: visit.patient });
            matched = true;
            break;
          }

          // 2. Session ID Match
          if (visit.sessionId && path.basename(file).includes(visit.sessionId)) {
            console.log(`Matched PDF ${path.basename(file)} to visit ${key} by Session ID (${visit.sessionId})`);
            await storeFile(file, visit.reportId, visit.patientId, `${visit.patient.last_name}_${visit.patient.first_name}`, visit.date, visit.patient, undefined);

            logImportEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'imported',
              patient_id: visit.patientId,
              report_id: visit.reportId,
              message: 'Matched by Session ID'
            });
            sessionSummary.imported++;
            sessionSummary.processed++;
            affectedVisits.set(visit.reportId, { patient: visit.patient });

            matched = true;
            break;
          }

          // 3. Name + DOB + Date Match
          const pdfKey = getReportKey(report);
          if (pdfKey && pdfKey === key) {
            console.log(`Matched PDF ${path.basename(file)} to visit ${key} by Name/DOB/Date`);
            // Pass undefined for report to PREVENT overwriting valid XML data with PDF data
            await storeFile(file, visit.reportId, visit.patientId, `${visit.patient.last_name}_${visit.patient.first_name}`, visit.date, visit.patient, undefined);

            logImportEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'imported',
              patient_id: visit.patientId,
              report_id: visit.reportId,
              message: 'Matched by Demographics'
            });
            sessionSummary.imported++;
            sessionSummary.processed++;
            affectedVisits.set(visit.reportId, { patient: visit.patient });

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
      sessionSummary.processed++;

      try {
        const report = await parseFile(file); // This is just reading metadata
        if (!report) {
          // Should have been caught earlier, but safe fallback
          unmatchedFiles.push(file);
          logImportEvent({ id: uuidv4(), session_id: sessionId, file_path: file, status: 'error', message: 'Parse failed' });
          sessionSummary.errors++;
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
          console.log(`Found existing patient for PDF ${path.basename(file)}.`);

          // AUTO MATCHED
          const datePrefix = report.interrogation_date.split('T')[0];
          const existingReport = await findReportByDate(patient.id, datePrefix);

          if (existingReport) {
            await storeFile(file, existingReport.id, patient.id, `${patient.last_name}_${patient.first_name}`, report.interrogation_date, patient, undefined);
            logImportEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'imported',
              patient_id: patient.id,
              report_id: existingReport.id,
              message: 'Auto-matched to existing visit'
            });
            affectedVisits.set(existingReport.id, { patient });
          } else {
            // Patient found but NO visit found for this date. Trigger Manual Sorting.
            console.log(`Patient found but no matching visit for ${path.basename(file)}. Requesting manual confirmation...`);

            const userDecision: any = await withTimeout(
              new Promise((resolve) => {
                pendingManualSortRequest = { resolve, reject: () => resolve({ action: 'unmatched' }) };
                sendManualSortingRequest({
                  filename: path.basename(file),
                  tempPath: file,
                  previewData: {
                    patientName: `${patient.first_name} ${patient.last_name}`,
                    dob: patient.dob,
                    date: report.interrogation_date,
                    serial: report.device?.serial_number,
                    manufacturer: report.manufacturer,
                    deviceModel: report.device?.model,
                    leads: report.leads
                  }
                });
              }),
              5 * 60 * 1000,
              { action: 'unmatched' }
            );

            console.log(`User decision for ${path.basename(file)}:`, userDecision);

            if (userDecision.action === 'assign-patient') {
              // Assign to existing patient
              try {
                const { getPatientById } = await import('./database');
                const targetPatient = await getPatientById(userDecision.patientId);
                let targetVisitId: string | undefined = undefined;

                if (userDecision.visitMode === 'existing' && userDecision.visitId) {
                  // User explicitly selected a visit
                  targetVisitId = userDecision.visitId;
                  console.log(`[Watcher] Manually assigning to selected visit ID: ${targetVisitId}`);
                } else if (userDecision.visitMode === 'new') {
                  // User explicitly requested NEW visit
                  console.log(`[Watcher] Manually creating NEW visit with date: ${userDecision.visitDate}`);
                  targetVisitId = undefined; // Force new 
                  report.interrogation_date = userDecision.visitDate || report.interrogation_date;
                } else {
                  // Auto-resolve by date (fallback)
                  const datePrefix = report.interrogation_date.split('T')[0];
                  const { findReportByDate } = await import('./database');
                  const existingReportByUser = await findReportByDate(targetPatient.id, datePrefix);
                  if (existingReportByUser) {
                    targetVisitId = existingReportByUser.id;
                  }
                }

                let storedVisitId: string;
                if (targetVisitId) {
                  await storeFile(file, targetVisitId, targetPatient.id, `${targetPatient.last_name}_${targetPatient.first_name}`, report.interrogation_date, targetPatient, undefined);
                  storedVisitId = targetVisitId;
                } else {
                  // Ensure report has valid patient data from the target patient
                  report.patient = {
                    first_name: targetPatient.first_name,
                    last_name: targetPatient.last_name,
                    dob: targetPatient.dob
                  };
                  report.patient_id = targetPatient.id;
                  // If visit mode is new, use the specific date
                  if (userDecision.visitMode === 'new' && userDecision.visitDate) {
                    report.interrogation_date = userDecision.visitDate;
                  }

                  const { storeReport } = await import('./storage');
                  const { reportId } = await storeReport(report);
                  await storeFile(file, reportId, targetPatient.id, `${targetPatient.last_name}_${targetPatient.first_name}`, report.interrogation_date, targetPatient, report);
                  storedVisitId = reportId;
                }
                logImportEvent({
                  id: uuidv4(),
                  session_id: sessionId,
                  file_path: file,
                  status: 'manually_sorted',
                  patient_id: targetPatient.id,
                  message: 'Manually assigned by user'
                });
                sessionSummary.manuallySorted++;
                affectedVisits.set(storedVisitId, { patient: targetPatient });
                // sessionSummary.imported++ is handled outside
              } catch (e) {
                console.error('Error in manual assignment', e);
                unmatchedFiles.push(file);
              }

            } else if (userDecision.action === 'create-patient') {
              // Create brand new patient
              try {
                const { getPatientById, createPatient } = await import('./database');
                const newPatientData = userDecision.patientData;
                const newId = uuidv4();
                await createPatient({
                  id: newId,
                  first_name: newPatientData.first_name,
                  last_name: newPatientData.last_name,
                  dob: newPatientData.dob,
                  hospitalPatientId: newPatientData.hospitalPatientId || null
                });
                const newPatient = await getPatientById(newId);

                // Ensure report has valid patient data
                report.patient = {
                  first_name: newPatient.first_name,
                  last_name: newPatient.last_name,
                  dob: newPatient.dob
                };
                report.patient_id = newPatient.id;
                const { storeReport } = await import('./storage');
                const { reportId } = await storeReport(report);
                await storeFile(file, reportId, newPatient.id, `${newPatient.last_name}_${newPatient.first_name}`, report.interrogation_date, newPatient, report);

                logImportEvent({
                  id: uuidv4(),
                  session_id: sessionId,
                  file_path: file,
                  status: 'manually_sorted',
                  patient_id: newPatient.id,
                  message: 'Manually created patient'
                });
                sessionSummary.manuallySorted++;
                affectedVisits.set(reportId, { patient: newPatient });
                // sessionSummary.imported++ is handled outside
              } catch (e) {
                console.error('Error in manual creation', e);
                unmatchedFiles.push(file);
              }
            } else {
              unmatchedFiles.push(file);
              logImportEvent({
                id: uuidv4(),
                session_id: sessionId,
                file_path: file,
                status: 'unmatched',
                message: 'User skipped or sent to unmatched'
              });
              sessionSummary.unmatched++;
              // Decrement imported because it will be incremented outside by default logic structure in previous code?
              // Wait, previous code had `sessionSummary.imported++` valid for both branches of logic (auto-matched or new visit).
              // Now "Unmatched" case should NOT count as imported.
              sessionSummary.imported--;
            }
          }
          sessionSummary.imported++;

        } else {
          // Patient not found - AMBIGUITY, TRY INTERACTIVE MODE
          console.log(`No clear match for ${path.basename(file)}. Requesting manual input...`);

          // Ask user what to do
          const userDecision: any = await withTimeout(
            new Promise((resolve) => {
              pendingManualSortRequest = { resolve, reject: () => resolve({ action: 'unmatched' }) };
              sendManualSortingRequest({
                filename: path.basename(file),
                tempPath: file,
                previewData: {
                  patientName: `${report.patient.first_name} ${report.patient.last_name}`,
                  dob: report.patient.dob,
                  date: report.interrogation_date,
                  serial: report.device?.serial_number,
                  manufacturer: report.manufacturer,
                  deviceModel: report.device?.model,
                  leads: report.leads
                }
              });
            }),
            5 * 60 * 1000,
            { action: 'unmatched' }
          );

          console.log(`User decision for ${path.basename(file)}:`, userDecision);

          if (userDecision.action === 'assign-patient') {
            // Assign to existing patient
            try {
              const targetPatient = await getPatientById(userDecision.patientId);

              let targetReportId = null;
              let targetDate = report.interrogation_date;

              // Check if user selected a specific visit or date
              if (userDecision.visitMode === 'existing' && userDecision.visitId) {
                const r = await getReportById(userDecision.visitId);
                if (r) {
                  targetReportId = r.id;
                  targetDate = r.interrogation_date;
                }
              } else if (userDecision.visitMode === 'new' && userDecision.visitDate) {
                targetDate = userDecision.visitDate;
                // Force report date update
                report.interrogation_date = userDecision.visitDate;
                // targetReportId is null -> Create New
              } else {
                // Fallback: match by date
                const datePrefix = report.interrogation_date.split('T')[0];
                const existingReport = await findReportByDate(targetPatient.id, datePrefix);
                if (existingReport) {
                  targetReportId = existingReport.id;
                  targetDate = existingReport.interrogation_date;
                }
              }

              let storedVisitId: string;
              if (targetReportId) {
                await storeFile(file, targetReportId, targetPatient.id, `${targetPatient.last_name}_${targetPatient.first_name}`, targetDate, targetPatient, undefined);
                storedVisitId = targetReportId;
              } else {
                // Ensure report has valid patient data from the target patient
                report.patient = {
                  first_name: targetPatient.first_name,
                  last_name: targetPatient.last_name,
                  dob: targetPatient.dob
                };
                report.patient_id = targetPatient.id;

                const { storeReport } = await import('./storage');
                const { reportId } = await storeReport(report);
                await storeFile(file, reportId, targetPatient.id, `${targetPatient.last_name}_${targetPatient.first_name}`, report.interrogation_date, targetPatient, report);
                storedVisitId = reportId;
              }
              logImportEvent({
                id: uuidv4(),
                session_id: sessionId,
                file_path: file,
                status: 'manually_sorted',
                patient_id: targetPatient.id,
                message: targetReportId ? 'Manually assigned to existing visit' : 'Manually assigned to new visit'
              });
              sessionSummary.manuallySorted++;
              sessionSummary.imported++;
              affectedVisits.set(storedVisitId, { patient: targetPatient });
            } catch (e) {
              console.error('Error in manual assignment', e);
              unmatchedFiles.push(file);
            }

          } else if (userDecision.action === 'create-patient') {
            // Create brand new patient
            const newPatientData = userDecision.patientData; // expect { firstName, lastName, dob, id? }
            const newId = uuidv4();
            await createPatient({
              id: newId,
              first_name: newPatientData.first_name,
              last_name: newPatientData.last_name,
              dob: newPatientData.dob,
              hospitalPatientId: newPatientData.hospitalPatientId || null
            });
            const newPatient = await getPatientById(newId);

            // Update report date if provided by user
            if (userDecision.visitDate) {
              report.interrogation_date = userDecision.visitDate;
            }

            // Ensure report has valid patient data
            report.patient = {
              first_name: newPatient.first_name,
              last_name: newPatient.last_name,
              dob: newPatient.dob
            };
            report.patient_id = newPatient.id;
            const { storeReport } = await import('./storage');
            const { reportId: newReportId } = await storeReport(report);
            await storeFile(file, newReportId, newPatient.id, `${newPatient.last_name}_${newPatient.first_name}`, report.interrogation_date, newPatient, report);

            logImportEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'manually_sorted',
              patient_id: newPatient.id,
              message: 'Manually created patient'
            });
            sessionSummary.manuallySorted++;
            sessionSummary.imported++;
            affectedVisits.set(newReportId, { patient: newPatient });

          } else {
            // Unmatched
            unmatchedFiles.push(file);
            logImportEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'unmatched',
              message: 'User skipped or sent to unmatched'
            });
            sessionSummary.unmatched++;
          }
        }

      } catch (e) {
        console.error(`Error processing standalone PDF ${path.basename(file)}:`, e);
        unmatchedFiles.push(file);
        logImportEvent({
          id: uuidv4(),
          session_id: sessionId,
          file_path: file,
          status: 'error',
          message: (e as Error).message
        });
        sessionSummary.errors++;
      }
    }

    // --- Post-import aggregation: refresh visit.xml + patient.xml for all affected visits ---
    if (affectedVisits.size > 0) {
      console.log(`[Watcher] Running post-import aggregation for ${affectedVisits.size} affected visit(s)...`);
      const { refreshVisitMetadata } = await import('./storage');
      for (const [visitReportId, { patient: visitPatient }] of affectedVisits) {
        try {
          const visitPath = await findVisitPath(visitReportId);
          if (visitPath) {
            await refreshVisitMetadata(visitPath, visitReportId, visitPatient);
          }
        } catch (e) {
          console.warn(`[Watcher] Post-import aggregation failed for visit ${visitReportId}:`, e);
        }
      }
    }

    // Move unmatched files
    for (const file of unmatchedFiles) {
      try {
        await fs.access(file);
        const newPath = path.join(unmatchedDir, path.basename(file));
        try {
          await moveFile(file, newPath);
        } catch (e) {
          console.error(`Error moving unmatched file ${file}:`, e);
        }
      } catch {
        // File doesn't exist, skip
      }
    }

    if (unmatchedFiles.length > 0) {
      sendUnmatchedFiles(unmatchedFiles.map(f => path.basename(f)));
    }

  } finally {
    // ALWAYS Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      console.log(`Successfully removed temporary directory: ${tempDir}`);
    } catch (error) {
      console.error(`Error removing temporary directory ${tempDir}:`, error);
      sendNotification(`Error cleaning up temp directory: ${(error as Error).message}`, 'error');
    }

    // Clean up any empty directories left in the Import folder
    try {
      await cleanEmptyDirectories(importDir);
    } catch (e) {
      console.error('Error cleaning up empty directories in import folder:', e);
    }
  }

  // Send status updates (after cleanup)
  try {
    await updateImportSessionStatus(sessionId, 'completed', sessionSummary);
    sendImportSessionUpdate({ id: sessionId, ...sessionSummary });
    sendProcessStatus({ type: 'complete', message: 'Processing complete.' });
    sendPatientListUpdate();
  } catch (e) {
    console.error('Error sending session updates:', e);
  }

  // Queue imported patients for immediate MRI/warning checks
  if (importedPatientIds.size > 0) {
    try {
      const { AutomationManager } = await import('./services/AutomationManager');
      const automation = AutomationManager.getInstance();
      for (const pid of importedPatientIds) {
        automation.queuePatient(pid);
      }
      console.log(`[Watcher] Queued ${importedPatientIds.size} patients for automation checks.`);
    } catch (e) {
      console.error('[Watcher] Failed to queue patients for automation:', e);
    }
  }
};

/**
 * Recursively removes empty directories.
 */
async function cleanEmptyDirectories(dir: string) {
  if (path.basename(dir).startsWith('_TEMP_')) return;

  let items: string[];
  try {
    items = await fs.readdir(dir);
  } catch { return; }

  if (items.length > 0) {
    for (const item of items) {
      const fullPath = path.join(dir, item);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await cleanEmptyDirectories(fullPath);
        }
      } catch { /* ignore */ }
    }
    try {
      items = await fs.readdir(dir);
    } catch { return; }
  }

  if (items.length === 0 && dir !== importDir) {
    try {
      await fs.rmdir(dir);
      console.log(`Removed empty directory: ${dir}`);
    } catch (e) {
      console.error(`Failed to remove empty dir ${dir}:`, e);
    }
  }
}

/**
 * Initializes the file watcher, which monitors the _IMPORT directory for new files.
 */
export const initializeWatcher = (appImportDir: string, appUnmatchedDir: string, appDataDir: string) => {
  importDir = appImportDir;
  unmatchedDir = appUnmatchedDir;
  dataDir = appDataDir;

  // Helper for safe batch processing (with re-entrance guard)
  const executeBatchProcessing = async () => {
    if (isProcessing) {
      console.log('[Watcher] Batch processing already in progress, skipping.');
      return;
    }
    isProcessing = true;
    let tempDir: string | null = null;
    try {
      tempDir = await createTempDirectory();
      await stageFilesToTempDir(tempDir);
      await processTempDirectory(tempDir);
    } catch (e) {
      console.error('Error during batch processing:', e);
      // Fallback cleanup if processTempDirectory didn't run or failed catastrophically
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        } catch (cleanupErr) {
          console.error('Failed to cleanup temp dir after error:', cleanupErr);
        }
      }
    } finally {
      isProcessing = false;
    }
  };

  (async () => {
    for (const dir of [importDir, unmatchedDir, dataDir]) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        console.error(`Error creating directory ${dir}:`, error);
        sendNotification(`Error creating directory ${dir}: ${(error as Error).message}`, 'error');
      }
    }
  })();


  console.log(`Watching for file changes on ${importDir}`);

  // Polling fallback — catches files missed by fs.watch (e.g. network drives with no inotify)
  if (pollingFallbackInterval) clearInterval(pollingFallbackInterval);
  pollingFallbackInterval = setInterval(async () => {
    if (isProcessing) return;
    try {
      try {
        await fs.access(importDir);
      } catch { return; }

      const files = await fs.readdir(importDir);
      if (files.length > 0) {
        const allFiles = await getFilesRecursively(importDir);

        if (allFiles.length > 0) {
          console.log(`POLLING: Found ${allFiles.length} files in ${importDir}`);
          if (!watcherTimeout) {
            if (!pendingManualSortRequest && !pendingDeviceSelectionRequest) {
              console.log('POLLING: Triggering processing fallback...');
              watcherTimeout = setTimeout(async () => {
                watcherTimeout = null;
                await executeBatchProcessing();
              }, 1000);
            }
          }
        }
      }
    } catch (e) {
      console.error('POLLING ERROR:', e);
    }
  }, 5000);

  // Check for existing files on startup
  (async () => {
    try {
      const existingFiles = await getFilesRecursively(importDir);
      if (existingFiles.length > 0) {
        console.log(`Found ${existingFiles.length} existing files in import directory. Processing...`);
        startupTimeout = setTimeout(async () => {
          startupTimeout = null;
          await executeBatchProcessing();
        }, 3000);
      }
    } catch (error) {
      console.error('Error checking for existing files:', error);
    }
  })();

  try {
    currentWatcher = fsSync.watch(importDir, { recursive: true }, (eventType, filename) => {
      // Ignore events from temp processing directories
      if (filename && filename.includes('_TEMP_')) return;
      console.log(`Watcher event: ${eventType} for file: ${filename}`);
      if (filename) {
        if (watcherTimeout) {
          clearTimeout(watcherTimeout);
        }
        // Don't interrupt manual sorting
        if (!pendingManualSortRequest && !pendingDeviceSelectionRequest) {
          (async () => {
            const currentFiles = await getFilesRecursively(importDir);
            const hasPdf = currentFiles.some(f => f.toLowerCase().endsWith('.pdf'));

            // Medtronic programmers write PDFs in "waves", taking >10s to finalize.
            // If a PDF is present, we wait 15s. Otherwise 2s is enough.
            const stabilizationTime = hasPdf ? 15000 : 2000;

            console.log(`Watcher: File event. PDF detected: ${hasPdf}. Waiting ${stabilizationTime}ms...`);

            watcherTimeout = setTimeout(async () => {
              watcherTimeout = null;
              console.log('Watcher timeout triggered. Checking for files...');
              const finalFiles = await getFilesRecursively(importDir);
              console.log(`Found ${finalFiles.length} files in import directory.`);
              if (finalFiles.length === 0) {
                console.log('No files found, skipping processing.');
                return;
              }
              console.log('File changes stabilized. Starting processing...');
              await executeBatchProcessing();
            }, stabilizationTime);
          })();
        }
      }
    });
    currentWatcher.on('error', (err) => {
      console.error(`Watcher error on ${importDir}:`, err);
      sendNotification('File watcher lost connection. Polling fallback still active.', 'warning');
    });
  } catch (error) {
    console.error(`Error starting watcher on ${importDir}:`, error);
    sendNotification(`Error starting watcher: ${(error as Error).message}`, 'error');
  }
};

export const stopWatcher = () => {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  if (watcherTimeout) {
    clearTimeout(watcherTimeout);
    watcherTimeout = null;
  }
  if (pollingFallbackInterval) {
    clearInterval(pollingFallbackInterval);
    pollingFallbackInterval = null;
  }
  if (currentWatcher) {
    currentWatcher.close();
    currentWatcher = null;
  }
  console.log('File watcher stopped.');
};

/**
 * Locates the visit directory on the filesystem based on the Visit ID.
 * @param visitId The ID of the visit (report).
 * @returns The full path to the visit directory, or null if not found.
 */
export const findVisitPath = async (visitId: string): Promise<string | null> => {
  try {
    const report = await getReportById(visitId);
    if (!report) return null;

    // Find Patient Directory
    const reportsDir = path.join(dataDir, 'Reports');
    let patientDirs: string[];
    try {
      patientDirs = await fs.readdir(reportsDir);
    } catch { return null; }

    const patientDirName = patientDirs.find(d => d.startsWith(report.patient_id));

    if (!patientDirName) return null;

    const patientDirPath = path.join(reportsDir, patientDirName);

    // Find Visit Directory (ends with visitId)
    const visitDirs = await fs.readdir(patientDirPath);
    const visitDirName = visitDirs.find(d => d.endsWith(`_${visitId}`) || d === visitId);

    if (visitDirName) {
      return path.join(patientDirPath, visitDirName);
    }
    return null;

  } catch (error) {
    console.error('[findVisitPath] Error:', error);
    return null;
  }
};

/**
 * Rescans a specific visit directory, aggregates data from all files,
 * persists the result to visit.xml + patient.xml, and returns aggregated data.
 * @param visitPath Full path to the visit directory
 * @param visitId Report ID for this visit (used to look up patient and persist metadata)
 * @returns Object containing status and extracted data
 */
export const rescanVisitDirectory = async (visitPath: string, visitId?: string) => {
  try {
    console.log(`[Rescan] Scanning directory: ${visitPath}`);
    try {
      await fs.access(visitPath);
    } catch {
      throw new Error(`Directory not found: ${visitPath}`);
    }

    const { aggregateVisitFiles, refreshVisitMetadata } = await import('./storage');
    const aggregated = await aggregateVisitFiles(visitPath);

    if (!aggregated) {
      return { status: 'empty', message: 'No parseable files found.' };
    }

    const files = (await fs.readdir(visitPath)).filter(f => !f.startsWith('.'));

    const aggregatedData = {
      patient: aggregated.patient,
      device: aggregated.device,
      leads: aggregated.leads || [],
      interrogation_date: aggregated.interrogation_date
    };

    // Persist aggregated data to visit.xml + patient.xml
    if (visitId) {
      try {
        const report = await getReportById(visitId);
        if (report) {
          const patient = await getPatientById(report.patient_id);
          if (patient) {
            await refreshVisitMetadata(visitPath, visitId, patient);
          }
        }
      } catch (e) {
        console.warn(`[Rescan] Failed to persist aggregated metadata for ${visitId}:`, e);
      }
    }

    return {
      status: 'success',
      scannedData: aggregatedData,
      fileCount: files.length
    };

  } catch (error) {
    console.error('[Rescan] Error:', error);
    throw error;
  }
};

/**
 * Moves a visit directory to a different patient's folder.
 * @param sourceVisitPath Full path to the current visit directory
 * @param targetPatientId ID of the patient to move to
 * @returns Result object
 */
export const moveVisit = async (visitId: string, targetPatientId: string) => {
  try {
    // 1. Resolve Source Path
    const sourceVisitPath = await findVisitPath(visitId);
    if (!sourceVisitPath) throw new Error('Source visit path not found');

    console.log(`[MoveVisit] Moving ${sourceVisitPath} to patient ${targetPatientId}`);

    // 2. Prepare Target Directory
    const patientDirs = await fs.readdir(path.join(dataDir, 'Reports'));
    const targetDirName = patientDirs.find(d => d.startsWith(targetPatientId));
    let targetDirPath = '';

    if (!targetDirName) {
      // Create target patient directory if missing
      const patient = await getPatientById(targetPatientId);
      if (!patient) throw new Error('Target patient not found in database');

      const safeName = (patient.name || 'Unknown').replace(/[^a-z0-9]/gi, '_');
      const safeDob = (patient.dob || 'NoDOB').replace(/[^a-z0-9]/gi, '_');
      const newDirName = `${targetPatientId}_${safeName}_${safeDob}`;
      targetDirPath = path.join(dataDir, 'Reports', newDirName);
      await fs.mkdir(targetDirPath, { recursive: true });
    } else {
      targetDirPath = path.join(dataDir, 'Reports', targetDirName);
    }

    return performMove(sourceVisitPath, targetDirPath, targetPatientId, visitId);

  } catch (error) {
    console.error('[MoveVisit] Failed:', error);
    throw error;
  }
};

const performMove = async (sourcePath: string, targetParentPath: string, targetPatientId: string, visitId: string) => {
  const dirName = path.basename(sourcePath);
  const destPath = path.join(targetParentPath, dirName);

  // Check collision
  try {
    await fs.access(destPath);
    throw new Error(`Target patient already has a visit folder named ${dirName}`);
  } catch (e: any) {
    if (e.message?.includes('already has')) throw e;
    // ENOENT means no collision, which is good
  }

  // Move Directory
  try {
    await fs.rename(sourcePath, destPath);
  } catch (e: any) {
    if (e.code === 'EXDEV') {
      throw new Error('Cross-device move not supported yet');
    }
    throw e;
  }

  // Update Database
  // Only update patient_id for the report(s) associated with this visit. 
  // We assume the visit ID corresponds to a report ID.
  const db = getDb();

  // Update the specific report
  db.run(`UPDATE Reports SET patient_id = ? WHERE id = ?`, [targetPatientId, visitId], (err: any) => {
    if (err) console.error('[MoveVisit] DB Update failed:', err);
  });

  // Also update any other reports that might have been linking to this visit? 
  // (Usually 1:1, but if multiple reports shared a folder, we might miss them if we only update by visitId.
  // However, findVisitPath assumes folder mapping.
  // Ideally we should update all reports where patient_id was OLD and now should be NEW, but scoping to this visit is hard without file paths in DB used for lookup.
  // Since we don't store file paths, we rely on the ID.
  // A deeper scan might be needed if multiple reports exist in one folder, but current architecture seems 1 Visit Dir = 1 Main Report ID).

  console.log(`[MoveVisit] Moved visit ${visitId} to ${targetPatientId}`);
  return { success: true, newPath: destPath };
};

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { sendUnmatchedFiles, sendNotification, sendProcessStatus, sendManualSortingRequest, sendImportSessionUpdate } from './windowManager';
import { parseFile } from './parser';
import { UnifiedReport } from './reports';
import { getDb, findPatient, findReportByDate, findPatientBySerial, createImportSession, updateImportSessionStatus, logImportEvent, getPatientById, createPatient, getReportById } from './database';
import { storeReport, storeFile } from './storage';

let importDir: string;
let unmatchedDir: string;
let dataDir: string;
let watcherTimeout: NodeJS.Timeout | null = null;
let currentWatcher: fs.FSWatcher | null = null;

// interactive mode globals
let pendingManualSortRequest: { resolve: (value: any) => void, reject: (reason?: any) => void } | null = null;
let pendingDeviceSelectionRequest: { resolve: (value: any) => void, reject: (reason?: any) => void } | null = null;


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
  const sessionId = uuidv4();
  await createImportSession(sessionId);

  const allFiles = fs.readdirSync(tempDir).map(f => path.join(tempDir, f));
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

        const userDeviceResult: any = await new Promise((resolve) => {
          pendingDeviceSelectionRequest = { resolve, reject: () => resolve({ action: 'skip' }) };
          sendDeviceSelectionRequest({
            filename: path.basename(file),
            previewData: {
              manufacturer: report.manufacturer,
              device: report.device
            }
          });
        });

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
              console.log(`Recovered patient identity via Serial Number: ${existing.last_name}, ${existing.first_name}`);
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
          const userDecision: any = await new Promise((resolve) => {
            pendingManualSortRequest = { resolve, reject: () => resolve({ action: 'unmatched' }) };
            sendManualSortingRequest({
              filename: path.basename(file),
              tempPath: file,
              previewData: {
                patientName: "UNKNOWN (Missing in Log)",
                dob: report.patient.dob || "Unknown",
                date: report.interrogation_date,
                serial: report.device?.serial_number || "Unknown"
              }
            });
          });

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

      // Store the report (creates patient/visit if needed)
      const { reportId, patient } = await storeReport(report);

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
        console.log(`Found existing patient for PDF ${path.basename(file)}: ${patient.last_name}, ${patient.first_name}`);

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
        } else {
          // Patient found but NO visit found for this date. Trigger Manual Sorting.
          console.log(`Patient found but no matching visit for ${path.basename(file)}. Requesting manual confirmation...`);

          const userDecision: any = await new Promise((resolve) => {
            pendingManualSortRequest = { resolve, reject: () => resolve({ action: 'unmatched' }) };
            sendManualSortingRequest({
              filename: path.basename(file),
              tempPath: file,
              previewData: {
                patientName: `${patient.first_name} ${patient.last_name}`,
                dob: patient.dob,
                date: report.interrogation_date,
                serial: report.device?.serial_number
              }
            });
          });

          console.log(`User decision for ${path.basename(file)}:`, userDecision);

          if (userDecision.action === 'assign-patient') {
            // Assign to existing patient
            try {
              const { getPatientById } = await import('./database');
              const targetPatient = await getPatientById(userDecision.patientId);
              const datePrefix = report.interrogation_date.split('T')[0];
              const { findReportByDate } = await import('./database');
              const existingReportByUser = await findReportByDate(targetPatient.id, datePrefix);

              if (existingReportByUser) {
                await storeFile(file, existingReportByUser.id, targetPatient.id, `${targetPatient.last_name}_${targetPatient.first_name}`, report.interrogation_date, targetPatient, undefined);
              } else {
                report.patient_id = targetPatient.id;
                const { storeReport } = await import('./storage');
                const { reportId } = await storeReport(report);
                await storeFile(file, reportId, targetPatient.id, `${targetPatient.last_name}_${targetPatient.first_name}`, report.interrogation_date, targetPatient, report);
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
        const userDecision: any = await new Promise((resolve) => {
          pendingManualSortRequest = { resolve, reject: () => resolve({ action: 'unmatched' }) };
          sendManualSortingRequest({
            filename: path.basename(file), // Only send filename, not full path which might be in temp
            tempPath: file, // Keep track if needed by renderer for preview (might be tricky with temp) -> Actually renderer can't access temp easily if sandboxed? 
            // Renderer is local file access allowed usually in Electron if webSecurity is managed? 
            // KardiSynch seems to be open.
            previewData: {
              patientName: `${report.patient.first_name} ${report.patient.last_name}`,
              dob: report.patient.dob,
              date: report.interrogation_date,
              serial: report.device?.serial_number
            }
          });
        });

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

            if (targetReportId) {
              await storeFile(file, targetReportId, targetPatient.id, `${targetPatient.last_name}_${targetPatient.first_name}`, targetDate, targetPatient, undefined);
            } else {
              report.patient_id = targetPatient.id;
              const { storeReport } = await import('./storage');
              const { reportId } = await storeReport(report);
              await storeFile(file, reportId, targetPatient.id, `${targetPatient.last_name}_${targetPatient.first_name}`, report.interrogation_date, targetPatient, report);
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
          sessionSummary.imported++;

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

  // Move unmatched files
  for (const file of unmatchedFiles) {
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

    await updateImportSessionStatus(sessionId, 'completed', sessionSummary);
    sendImportSessionUpdate({ id: sessionId, ...sessionSummary });
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
          // Also check if we are NOT waiting for user input
          if (!pendingManualSortRequest) {
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
        if (!pendingManualSortRequest) {
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
          }, 10000);
        }
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

/**
 * Rescans a specific visit directory and extracts data without modifying the database.
 * @param visitPath Full path to the visit directory
 * @returns Object containing status and extracted data
 */
export const rescanVisitDirectory = async (visitPath: string) => {
  try {
    console.log(`[Rescan] Scanning directory: ${visitPath}`);
    if (!fs.existsSync(visitPath)) {
      throw new Error(`Directory not found: ${visitPath}`);
    }

    const files = fs.readdirSync(visitPath).filter(f => !f.startsWith('.'));
    const parsedReports: UnifiedReport[] = [];

    // Prioritize PDF and XML
    for (const file of files) {
      // Skip unwanted files
      if (['.pdf', '.xml', '.txt', '.log'].every(ext => !file.toLowerCase().endsWith(ext))) continue;

      const filePath = path.join(visitPath, file);
      try {
        const result = await parseFile(filePath);
        if (result) {
          parsedReports.push(result);
        }
      } catch (e) {
        console.warn(`[Rescan] Failed to parse file ${file}:`, e);
      }
    }

    if (parsedReports.length === 0) {
      return { status: 'empty', message: 'No parseable files found.' };
    }

    // Merge strategy: Take the most complete data
    // For now, we return the first valid report's patient/device data, or a merge if we want to be fancy
    // Let's assume the first valid report is representative for demographics/device.
    // We can collect all unique leads found.

    // Sort reports by priority: XML > PDF > Text ? parseFile doesn't give type easily, but we can assume order
    // Let's just aggregate data.

    const aggregatedData = {
      patient: parsedReports.find(r => r.patient?.last_name)?.patient || parsedReports[0].patient,
      device: parsedReports.find(r => r.device?.model)?.device || parsedReports[0].device,
      leads: parsedReports.flatMap(r => r.leads || []),
      interrogation_date: parsedReports.find(r => r.interrogation_date)?.interrogation_date
    };

    // Deduplicate leads by serial
    const uniqueLeads = Array.from(new Map(aggregatedData.leads.map(l => [l.serial || l.model, l])).values());
    aggregatedData.leads = uniqueLeads;

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
export const moveVisit = async (sourceVisitPath: string, targetPatientId: string) => {
  try {
    console.log(`[MoveVisit] Moving ${sourceVisitPath} to patient ${targetPatientId}`);

    // 1. Verify Source
    if (!fs.existsSync(sourceVisitPath)) throw new Error('Source visit not found');

    // 2. Prepare Target
    // We need to resolve the target patient's directory.
    // The structure is _DATA/Reports/<PatientID_Name_DOB>/...
    // But we might only have ID. We need to find the directory pattern.

    // Helper to find patient directory by ID prefix
    const patientDirs = fs.readdirSync(path.join(dataDir, 'Reports'));
    const targetDirName = patientDirs.find(d => d.startsWith(targetPatientId));

    if (!targetDirName) {
      // Ideally we should look up the patient to create the folder if it doesn't exist?
      // But assuming the patient exists in DB, we should handle this.
      // For now, fail if folder not found (meaning patient has no visits yet? We should support that).

      // Fallback: If no directory exists, we need to create one.
      // We need patient details to name it correctly (ID_Name_DOB).
      const patient = await getPatientById(targetPatientId);
      if (!patient) throw new Error('Target patient not found in database');

      const safeName = (patient.name || 'Unknown').replace(/[^a-z0-9]/gi, '_');
      const safeDob = (patient.dob || 'NoDOB').replace(/[^a-z0-9]/gi, '_');
      const newDirName = `${targetPatientId}_${safeName}_${safeDob}`;
      const newDirPath = path.join(dataDir, 'Reports', newDirName);
      fs.mkdirSync(newDirPath, { recursive: true });
      return performMove(sourceVisitPath, newDirPath, targetPatientId);
    }

    const targetDirPath = path.join(dataDir, 'Reports', targetDirName);
    return performMove(sourceVisitPath, targetDirPath, targetPatientId);

  } catch (error) {
    console.error('[MoveVisit] Failed:', error);
    throw error;
  }
};

const performMove = async (sourcePath: string, targetParentPath: string, targetPatientId: string) => {
  const dirName = path.basename(sourcePath);
  const destPath = path.join(targetParentPath, dirName);

  // Check collision
  if (fs.existsSync(destPath)) {
    throw new Error(`Target patient already has a visit folder named ${dirName}`);
  }

  // Move Directory
  try {
    fs.renameSync(sourcePath, destPath);
  } catch (e: any) {
    if (e.code === 'EXDEV') {
      // Cross-device move not supported for directories simply by rename in some cases? 
      // Actually node fs.rename usually handles it or fails. 
      // If EXDEV, we need recursive copy + remove.
      // keeping it simple for now, assuming same volume.
      throw new Error('Cross-device move not supported yet');
    }
    throw e;
  }

  // Update Database
  // We need to update all reports that pointed to the old path or belonged to the source visit.
  // Actually, reports in DB rely on `patient_id`. We just need to update `patient_id` for all reports in this visit.
  // How do we identify them? By file path?
  // The DB stores `file_path`. We need to update `file_path` and `patient_id`.

  // 1. Find reports where file_path starts with sourcePath
  // We don't have a direct "find by path prefix" utility exported easily, 
  // but maybe we can query by the old patient ID (which we didn't pass, but can infer?)
  // Easier: The caller should trigger a DB refresh/scan for the target patient?
  // Or we manually SQL update.

  const db = getDb();
  // Getting raw SQLite is cleaner here

  // We need to update:
  // UPDATE reports SET patient_id = ?, file_path = REPLACE(file_path, ?, ?) WHERE file_path LIKE ?

  // SQLite doesn't have robust REPLACE for paths easily if not careful, but:
  const updateStmt = db.prepare(`
        UPDATE reports 
        SET patient_id = @targetId, 
            file_path = REPLACE(file_path, @oldPath, @newPath)
        WHERE file_path LIKE @likePath
    `);

  updateStmt.run({
    targetId: targetPatientId,
    oldPath: sourcePath,
    newPath: destPath,
    likePath: `${sourcePath}%`
  });

  console.log(`[MoveVisit] Updated database records for moved visit.`);
  return { success: true, newPath: destPath };
};

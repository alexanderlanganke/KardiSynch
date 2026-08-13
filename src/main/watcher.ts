import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { sendUnmatchedFiles, sendNotification, sendProcessStatus, sendImportSessionUpdate, sendPatientListUpdate, sendPendingSortUpdate } from './windowManager';
import { parseFile } from './parser';
import { UnifiedReport } from './reports';
import { getDb, findPatient, findReportsByDate, findPatientBySerial, createImportSession, updateImportSessionStatus, logImportEvent, getPatientById, createPatient, getReportById } from './database';
import { pickSameDayReport } from './services/visitMatch';
import { storeReport, storeFile } from './storage';
import { lookupAlias, setAlias } from './deviceTypeAliases';
import { logInfo, logError } from './logger';
import { initPendingSort, isPendingSortReady, enqueuePendingSort, listPendingSortTasks } from './services/pendingSortService';
import { moveFileSafe, uniqueDestPath } from './utils/fileMove';
import { normalizeNameKey } from '../lib/names';

let importDir: string;
let unmatchedDir: string;
let dataDir: string;
let pendingSortDir: string = '';
let watcherTimeout: NodeJS.Timeout | null = null;
let startupTimeout: NodeJS.Timeout | null = null;
let currentWatcher: import('fs').FSWatcher | null = null;
let pollingFallbackInterval: NodeJS.Timeout | null = null;
let isProcessing = false;
// Last serialized file snapshot seen by each polling fallback — processing is
// only triggered once the same snapshot is observed on two consecutive polls.
let pollingStableSnapshot: string | null = null;
let intraopPollingStableSnapshot: string | null = null;

/**
 * True while an import batch is being staged/processed. Maintenance operations
 * that rewrite the DB or move visit directories (rebuild, dedup, merge, orphan
 * repair) must not run concurrently with an import.
 */
export const isImportProcessing = (): boolean => isProcessing;

/**
 * Serializes name+size+mtime of a file list so the polling fallback can require
 * the set to be identical across two consecutive polls (files still being
 * written by a programmer change size/mtime between polls) before triggering.
 */
const serializeFileSnapshot = async (files: string[]): Promise<string> => {
  const parts: string[] = [];
  for (const file of [...files].sort()) {
    try {
      const stat = await fs.stat(file);
      parts.push(`${file}|${stat.size}|${stat.mtimeMs}`);
    } catch { /* file vanished between listing and stat */ }
  }
  return parts.join('\n');
};

// Parallel state for the intraoperative-import watcher (separate source dir,
// shares unmatchedDir + dataDir + activeVisits + isProcessing with the primary watcher).
let intraopImportDir: string = '';
let intraopWatcherTimeout: NodeJS.Timeout | null = null;
let intraopStartupTimeout: NodeJS.Timeout | null = null;
let intraopCurrentWatcher: import('fs').FSWatcher | null = null;
let intraopPollingFallbackInterval: NodeJS.Timeout | null = null;

const INTRAOP_PREFIX = 'INTRAOP__';

// Cross-batch visit memory — persists across import batches so files arriving
// in separate batches can still be matched to visits created by earlier batches.
// Cleared after 2 minutes of no import directory activity (no new files, no file changes).
const activeVisits = new Map<string, { reportId: string, patientId: string, patient: any, date: string, serial?: string, sessionId?: string, manufacturer?: string }>();
let lastImportActivity = 0;
let lastFileSnapshot = new Map<string, { size: number, mtimeMs: number }>();
const ACTIVE_VISITS_QUIET_PERIOD = 2 * 60 * 1000; // 2 minutes

/**
 * Snapshots the import directory's file sizes and mtimes.
 * Updates lastImportActivity if any file is new or changed.
 */
const updateImportActivityFromSnapshot = async () => {
  if (!importDir) return;
  try {
    await fs.access(importDir);
  } catch { return; }

  try {
    const files = await getFilesRecursively(importDir);
    if (intraopImportDir) {
      try {
        await fs.access(intraopImportDir);
        const intraopFiles = await getFilesRecursively(intraopImportDir);
        for (const f of intraopFiles) files.push(f);
      } catch { /* intraop dir missing — fine */ }
    }
    let changed = false;

    const newSnapshot = new Map<string, { size: number, mtimeMs: number }>();
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        newSnapshot.set(file, { size: stat.size, mtimeMs: stat.mtimeMs });

        const prev = lastFileSnapshot.get(file);
        if (!prev || prev.size !== stat.size || prev.mtimeMs !== stat.mtimeMs) {
          changed = true;
        }
      } catch {
        // File may have been moved/deleted between readdir and stat
      }
    }

    // Also detect removed files as activity
    if (newSnapshot.size !== lastFileSnapshot.size) {
      changed = true;
    }

    lastFileSnapshot = newSnapshot;
    if (changed) {
      lastImportActivity = Date.now();
    }
  } catch {
    // Import dir not accessible, ignore
  }
};

/**
 * Clears activeVisits if the import directory has been quiet for the configured period.
 */
const sweepActiveVisitsIfQuiet = () => {
  if (activeVisits.size > 0 && Date.now() - lastImportActivity > ACTIVE_VISITS_QUIET_PERIOD) {
    console.log(`[Watcher] No import activity for ${ACTIVE_VISITS_QUIET_PERIOD / 1000}s, clearing ${activeVisits.size} cached visit(s).`);
    activeVisits.clear();
  }
};

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

/**
 * Non-blocking replacement for the old blocking manual-sort modal (issue #136).
 *
 * Rather than staging the file into its own pending-sort task immediately,
 * this queues it into the current run's batch (see `pendingSortBatch` in
 * `processTempDirectory`) so every file left unmatched by one import run is
 * flushed as a SINGLE task at the end of the run — companion files that
 * arrived together stay together for the user to resolve (#156, #157, #158).
 *
 * Returns true if the file was added to the batch. Falls back to false
 * (caller then routes the file to the unmatched dir) if the queue isn't ready.
 */
const queueForManualSort = (
  batch: import('./services/pendingSortService').PendingSortEntry[],
  file: string,
  previewData: any,
  isIntraop: boolean
): boolean => {
  if (!isPendingSortReady()) return false;
  batch.push({ sourcePath: file, previewData, isIntraop });
  return true;
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
 * @param parentDir Directory under which the temp dir is created.
 * @returns The path to the newly created temporary directory.
 */
const createTempDirectory = async (parentDir: string): Promise<string> => {
  const tempDir = path.join(parentDir, `_TEMP_${uuidv4()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
};

/**
 * Moves a file, handling cross-device moves (EXDEV) by falling back to copy+unlink.
 * (Shared implementation in utils/fileMove so main.ts uses the same semantics.)
 */
const moveFile = (src: string, dest: string) => moveFileSafe(src, dest);

/**
 * Fire-and-forget import-event logging with an attached error handler — the
 * bare `logImportEvent(...)` calls below return promises nobody awaits, so a
 * DB error would otherwise surface as an unhandled rejection and the missing
 * history entry would go unnoticed.
 */
const logEvent = (event: Parameters<typeof logImportEvent>[0]): void => {
  logImportEvent(event).catch(e => console.warn('[Watcher] Failed to log import event:', e));
};

/**
 * Serializes a parsed report's diagnostics (format variant, warnings, status)
 * into the ImportEvents.details column, so Import History can show *why* a
 * file needed manual sorting or came back partial instead of just that it
 * did. Returns undefined when the report carries no diagnostics worth
 * persisting (the common, fully-clean-parse case).
 */
const buildEventDetails = (report: UnifiedReport | null | undefined): string | undefined => {
  if (!report) return undefined;
  const { formatVariant, parseWarnings, parseStatus } = report;
  if (!formatVariant && (!parseWarnings || parseWarnings.length === 0) && (!parseStatus || parseStatus === 'ok')) {
    return undefined;
  }
  return JSON.stringify({ formatVariant, parseStatus, warnings: parseWarnings });
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
 * Lists ALL files under a directory recursively — unlike getFilesRecursively it
 * skips nothing (no dotfile / _TEMP_ filtering), because it is used to recover
 * every last original from a temp processing dir.
 */
const listAllFiles = async (dir: string): Promise<string[]> => {
  let results: string[] = [];
  let entries: import('fs').Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(await listAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
};

/**
 * Safely disposes of a temp processing dir: any files still inside (files a
 * failed batch never processed, or files that couldn't be moved to the
 * unmatched dir) are swept back into the watched source dir under
 * collision-safe names so the next batch retries them. The temp dir itself is
 * only deleted once it is empty — a temp dir must NEVER be rm -rf'd while it
 * may still hold unprocessed originals, because staging MOVED them out of the
 * import dir and deleting the temp dir would destroy the only copy.
 *
 * Returns the number of files swept back.
 */
const recoverTempDirFiles = async (tempDir: string, sourceDir: string): Promise<number> => {
  let recovered = 0;
  const files = await listAllFiles(tempDir);
  for (const file of files) {
    try {
      const dest = await uniqueDestPath(path.join(sourceDir, path.basename(file)));
      await moveFile(file, dest);
      recovered++;
    } catch (e) {
      console.error(`[Watcher] Failed to recover ${file} from temp dir:`, e);
    }
  }

  const remaining = await listAllFiles(tempDir);
  if (remaining.length === 0) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  } else {
    console.error(`[Watcher] ${remaining.length} file(s) could not be recovered from ${tempDir}; leaving the temp dir in place to avoid data loss.`);
    sendNotification(`Some import files could not be recovered and remain in ${tempDir}`, 'error');
  }
  return recovered;
};

/**
 * Recovers files stranded in leftover _TEMP_* dirs (e.g. after a crash or
 * hard kill mid-batch) back into the watched dir so they get re-processed.
 */
const recoverLeftoverTempDirs = async (sourceDir: string): Promise<void> => {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch { return; }

  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('_TEMP_')) {
      total += await recoverTempDirFiles(path.join(sourceDir, entry.name), sourceDir);
    }
  }
  if (total > 0) {
    console.warn(`[Watcher] Recovered ${total} file(s) from interrupted import batch(es) in ${sourceDir}.`);
    sendNotification(`Recovered ${total} file(s) from an interrupted import. They will be re-processed.`, 'warning');
  }
};

/**
 * Moves all files from a source directory (and subdirectories) to a temporary directory.
 * When `isIntraop` is true, staged filenames carry the INTRAOP_PREFIX so the
 * intraoperative origin survives later parsing and (if matching fails) the
 * unmatched-dir round trip into the manual assignment flow.
 */
const stageFilesToTempDir = async (tempDir: string, sourceDir: string, isIntraop = false) => {
  const allFiles = await getFilesRecursively(sourceDir);
  for (const filePath of allFiles) {
    const originalName = path.basename(filePath);
    const prefix = isIntraop ? INTRAOP_PREFIX : '';
    const uniqueName = `${prefix}${uuidv4()}_${originalName}`;
    const newPath = path.join(tempDir, uniqueName);
    try {
      await moveFile(filePath, newPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        // Source file vanished between listing the import dir and renaming
        // it — most likely another KardiSynch instance watching the same
        // (often network-shared, e.g. UNC) import folder already claimed
        // and staged it first. The file isn't lost, just picked up
        // elsewhere, so surfacing this as a user-facing error is misleading.
        console.warn(`[Watcher] Skipped staging ${originalName}: file no longer present (likely already claimed by another watcher instance).`);
        continue;
      }
      console.error(`Error moving file ${filePath} to temp directory:`, error);
      sendNotification(`Error staging file ${originalName}: ${(error as Error).message}`, 'error');
    }
  }
};

/**
 * Attaches intraoperative visit metadata to a parsed report when the staged
 * filename starts with INTRAOP_PREFIX. The prefix is set in stageFilesToTempDir
 * and is preserved on files that get bounced to the unmatched dir, so this also
 * tags files that are later resolved through manual assignment.
 */
const applyIntraopTagIfNeeded = (report: UnifiedReport, file: string) => {
  if (!path.basename(file).startsWith(INTRAOP_PREFIX)) return;
  (report as any)._remoteSource = {
    visit_type: 'intraoperative',
    source_manufacturer: report.manufacturer || undefined,
  };
};

/**
 * Extracts key identifiers from a report for matching purposes.
 * @param report The UnifiedReport object.
 * @returns A string with key identifiers or null if insufficient data.
 */
const getReportKey = (report: UnifiedReport): string | null => {
  const { patient, interrogation_date } = report;
  if (patient && patient.last_name && patient.dob && interrogation_date) {
    // Normalized last-name key so "Müller"/"müller"/"MULLER " from different
    // manufacturers' files map to the same in-batch visit.
    return `${normalizeNameKey(patient.last_name)}_${patient.dob}_${interrogation_date.split('T')[0]}`;
  }
  return null;
}

/**
 * The core processing logic for files within a temporary directory.
 * @param tempDir The temporary directory containing the files to process.
 * @param sourceDir The watched source directory the temp dir was created under (used for cleanup).
 */
const processTempDirectory = async (tempDir: string, sourceDir: string) => {
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
    pendingSort: 0,
    warnings: [] as string[]
  };

  // Collect unique patient IDs for post-import automation checks
  const importedPatientIds = new Set<string>();

  // Files that couldn't be auto-matched during this run, collected across all
  // steps and enqueued as ONE pending-sort task at the end (instead of one
  // task per file) so companion files that arrived together — a PDF and its
  // logfile, a multi-PDF export, duplicate raw-data exports — surface as a
  // single batch the user can resolve together (#156, #157, #158).
  const pendingSortBatch: import('./services/pendingSortService').PendingSortEntry[] = [];

  try {

    sendProcessStatus({ type: 'start', message: `Processing ${allFiles.length} files...` });

    // Filter out unsupported files early
    const supportedFiles = allFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      if (['.docx', '.zip', '.jar', '.bat', '.bak'].includes(ext)) {
        console.log(`Skipping unsupported file type: ${ext} (${path.basename(file)})`);
        unmatchedFiles.push(file);
        logEvent({
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

    // Sweep stale visit memory if import directory has been quiet
    sweepActiveVisitsIfQuiet();
    // Mark this batch as activity
    lastImportActivity = Date.now();

    // Track all visits affected during this import batch for post-import aggregation
    const affectedVisits = new Map<string, { patient: any }>();

    // --- STEP 1: Process Structured Reports (.pkg, .xml) ---
    console.log('--- STEP 1: Processing Structured Reports ---');
    for (const file of structuredFiles) {
      console.log(`Processing structured file: ${path.basename(file)}`);
      sendProcessStatus({ type: 'progress', message: `Importing ${path.basename(file)}...`, file: path.basename(file) });
      sessionSummary.processed++;

      try {
        let report = await parseFile(file);
        // A structured file that can't be parsed used to be moved straight to
        // the unmatched dir with no UI — a Medtronic .pkg that fails extraction
        // "vanished" silently (issue #133). Instead, build a minimal skeleton
        // report and route it through the manual-sorting modal below so the user
        // can still assign it to a patient/visit. The raw file is preserved
        // either way; if the user skips, it still ends up in unmatched.
        let isUnparsedStructured = false;
        if (!report) {
          console.warn(`Failed to parse structured file ${path.basename(file)} — routing to manual sorting (#133).`);
          const ext = path.extname(file).toLowerCase();
          const manufacturerByExt: Record<string, string> = {
            '.pkg': 'Medtronic', '.pdd': 'Medtronic', '.bnk': 'Boston Scientific', '.log': 'Abbott'
          };
          report = {
            manufacturer: manufacturerByExt[ext] || 'Unknown',
            interrogation_date: '',
            patient: { first_name: '', last_name: '', dob: '' },
            device: { type: '', model: '', serial_number: '' },
            battery: {},
            leads: [],
            raw_text: '',
          };
          isUnparsedStructured = true;
        }

        applyIntraopTagIfNeeded(report, file);

        // Analyzer-only intraoperative sessions carry no implanted device: the
        // Medtronic analyzer produces lead measurements but no DeviceModelName /
        // DeviceSerialNumber. Forcing the device-selection modal here made every
        // such import "enter" a phantom Medtronic device (issue #134). Detect the
        // signature (intraop tag + no model + no serial) and skip the device
        // prompt entirely — the visit is stored as an analyzer session without a
        // device (patient.xml device history is already serial-guarded).
        const isIntraop = (report as any)._remoteSource?.visit_type === 'intraoperative';
        const noDeviceModel = !report.device?.model || report.device.model === 'Unknown';
        const noDeviceSerial = !report.device?.serial_number || report.device.serial_number === 'Unknown';
        const isIntraopAnalyzerOnly = isIntraop && noDeviceModel && noDeviceSerial;
        if (isIntraopAnalyzerOnly) {
          console.log(`[Watcher] ${path.basename(file)} looks like an intraoperative analyzer-only session (no device model/serial). Skipping device entry.`);
          // Blank the leftover 'Unknown' device type so visit.xml records no
          // device rather than a phantom "Unknown" Medtronic device.
          report.device = { type: '', model: '', serial_number: '' };
        }

        // 1. CHECK FOR DEVICE AMBIGUITY (Autodetection Failure)
        // First try to auto-resolve an unknown device type from the shared
        // (manufacturer, model) alias file — one user's curation benefits the
        // whole clinic. Only after this auto-resolve do we decide whether to
        // prompt: the modal fires for any manufacturer where model is known
        // but type is still Unknown, not just Biotronik.
        if (
          report.manufacturer && report.manufacturer !== 'Unknown' &&
          report.device?.model && report.device.model !== 'Unknown' &&
          (!report.device.type || report.device.type === 'Unknown')
        ) {
          try {
            const aliasType = await lookupAlias(report.manufacturer, report.device.model);
            if (aliasType && aliasType !== 'Unknown') {
              report.device.type = aliasType;
              console.log(`[Watcher] Auto-resolved device type from alias: ${report.manufacturer} ${report.device.model} → ${aliasType}`);
            }
          } catch (e) {
            console.warn('[Watcher] Failed to look up device type alias:', e);
          }
        }

        if (
          !isIntraopAnalyzerOnly && !isUnparsedStructured && (
            report.manufacturer === 'Unknown' ||
            !report.device ||
            report.device.model === 'Unknown' ||
            !report.device.type ||
            report.device.type === 'Unknown'
          )
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
          // Always clear the pending marker: if the timeout fallback fired, a
          // stale non-null value would gate the fs.watch + polling triggers
          // forever and permanently stall all future imports (W3).
          pendingDeviceSelectionRequest = null;

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

            // Persist (manufacturer, model) → type so future imports of this
            // device auto-resolve without prompting the user again. Skip
            // persists nothing — the user can correct via Settings.
            if (d.manufacturer && d.model && d.model !== 'Unknown' && d.type && d.type !== 'Unknown') {
              try {
                await setAlias(d.manufacturer, d.model, d.type);
                logInfo('Watcher', `Persisted device type alias: ${d.manufacturer} / ${d.model} → ${d.type}`);
              } catch (e: any) {
                logError('Watcher', `Failed to persist device type alias for ${d.manufacturer} / ${d.model} → ${d.type}: ${e?.message || e}`, e?.stack);
              }
            } else {
              logInfo('Watcher', `Skipping alias persist — guard failed. manufacturer="${d.manufacturer}" model="${d.model}" type="${d.type}"`);
            }
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
              // Scope by manufacturer when known — serials are only unique per manufacturer.
              const existing = await findPatientBySerial(
                report.device.serial_number,
                report.manufacturer && report.manufacturer !== 'Unknown' ? report.manufacturer : undefined
              );
              if (existing) {
                console.log(`Recovered patient identity via Serial Number for ${path.basename(file)}.`);
                targetPatient = existing;
              }
            } catch (e) {
              console.error('Error lookup by serial:', e);
            }
          }

          // 2. Hand off to the non-blocking manual-sort queue (issue #136)
          //    instead of force-opening a modal. The file is staged to its own
          //    pending task dir; the user resolves it on demand from the
          //    notification area (assign/create patient + visit, or move to
          //    the unmatched dir) via the pending-sort IPC handlers.
          //
          //    Note: a serial-number match here is NEVER auto-applied, even
          //    though it was in earlier versions of this code. This report
          //    has no name/DOB at all to corroborate against — that's exactly
          //    why we're in this recovery branch — so a serial match is
          //    fundamentally uncorroborated. A device explanted from patient A
          //    and reimplanted in patient B would otherwise silently misfile
          //    B's report under A's chart with no human review. Instead, pre-
          //    fill the serial match as a suggested candidate (same
          //    suggestedPatientId/note convention used by the near-match
          //    ladder below) so the user confirms it with one click rather
          //    than it being applied blind.
          const isIntraopFile = (report as any)._remoteSource?.visit_type === 'intraoperative';
          const queued = queueForManualSort(pendingSortBatch, file, {
            patientName: targetPatient
              ? `${targetPatient.first_name} ${targetPatient.last_name}`
              : (isUnparsedStructured ? "UNKNOWN (could not read file)" : "UNKNOWN (Missing in Log)"),
            dob: targetPatient?.dob || report.patient.dob || "Unknown",
            date: report.interrogation_date,
            serial: report.device?.serial_number || "Unknown",
            manufacturer: report.manufacturer,
            deviceModel: report.device?.model,
            leads: report.leads,
            note: targetPatient
              ? `Device serial matches ${targetPatient.last_name}, ${targetPatient.first_name} on file, but this report has no name/DOB of its own to confirm it's the same patient (e.g. device explant/reimplant). Confirm or reassign before importing.`
              : undefined,
            suggestedPatientId: targetPatient ? targetPatient.id : undefined
          }, isIntraopFile);
          if (queued) {
            sessionSummary.pendingSort++;
          } else {
            unmatchedFiles.push(file);
            logEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'unmatched',
              message: 'Could not queue for manual sorting',
              details: buildEventDetails(report)
            });
            sessionSummary.unmatched++;
          }
          continue; // handled (queued or unmatched) — nothing to store now
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

          logEvent({
            id: uuidv4(),
            session_id: sessionId,
            file_path: file,
            status: 'imported',
            patient_id: patient.id,
            report_id: reportId,
            message: 'Merged into active visit',
            details: buildEventDetails(report)
          });
          sessionSummary.imported++;
          affectedVisits.set(reportId, { patient });

        } else {
          // New Visit Case
          //
          // Before storeReport can auto-create a patient, resolve identity
          // conservatively (issue #143): a generator change hands us an
          // unknown serial, often together with a name/DOB spelling variant
          // from the new programmer — auto-creating then silently duplicates
          // the patient. Ladder:
          //   1. exact last-name+DOB match → proceed (storeReport reuses it)
          //   2. serial+manufacturer match that shares DOB or last name →
          //      adopt the stored identity (this is what lets autoimport
          //      proceed after the new generator was sorted manually once)
          //   3. any near-match (same DOB or same last name) → manual sort
          //      with the candidate suggested, instead of creating a double
          //   4. no similar patient at all → genuinely new, create as before
          const exactMatch = await findPatient(report.patient.last_name, report.patient.dob, report.patient.first_name);
          // Tracks the patient ID once we KNOW this isn't a brand-new patient
          // (exact match, or an adopted identity below) — used after the
          // ladder to check for a same-day visit to merge into instead of
          // minting a duplicate (issue #151).
          let resolvedPatientId: string | null = exactMatch?.id || null;
          if (!exactMatch) {
            const serial = report.device?.serial_number;
            const serialKnown = serial && serial !== 'Unknown';
            let suggested: any = null;
            let identityAdopted = false;

            if (serialKnown) {
              const bySerial = await findPatientBySerial(
                serial,
                report.manufacturer && report.manufacturer !== 'Unknown' ? report.manufacturer : undefined
              );
              if (bySerial) {
                const sharesDob = bySerial.dob === report.patient.dob;
                const sharesName = normalizeNameKey(bySerial.last_name) === normalizeNameKey(report.patient.last_name);
                if (sharesDob || sharesName) {
                  console.log(`[Watcher] Adopting identity of ${bySerial.last_name}, ${bySerial.first_name} (${bySerial.id}) for ${path.basename(file)} — known device serial ${serial} with matching ${sharesDob ? 'DOB' : 'last name'}.`);
                  report.patient.first_name = bySerial.first_name;
                  report.patient.last_name = bySerial.last_name;
                  report.patient.dob = bySerial.dob;
                  report.patient.hospitalPatientId = bySerial.hospitalPatientId;
                  identityAdopted = true;
                  resolvedPatientId = bySerial.id;
                } else {
                  // Serial says patient X, demographics say someone else
                  // entirely — never guess; let the user decide.
                  suggested = bySerial;
                }
              }
            }

            if (!suggested && !identityAdopted) {
              const { findNearMatchPatients } = await import('./database');
              const near = await findNearMatchPatients(report.patient.last_name, report.patient.dob);
              if (near.length > 0) suggested = near[0];
            }

            if (suggested) {
              const isIntraopFile = (report as any)._remoteSource?.visit_type === 'intraoperative';
              const queued = queueForManualSort(pendingSortBatch, file, {
                patientName: `${report.patient.first_name} ${report.patient.last_name}`,
                dob: report.patient.dob,
                date: report.interrogation_date,
                serial: report.device?.serial_number || 'Unknown',
                manufacturer: report.manufacturer,
                deviceModel: report.device?.model,
                leads: report.leads,
                note: `Similar patient on file: ${suggested.last_name}, ${suggested.first_name} (DOB ${suggested.dob}). Possible generator change or spelling variant — assign to the existing patient or confirm this is a new one.`,
                suggestedPatientId: suggested.id
              }, isIntraopFile);
              if (queued) {
                sessionSummary.pendingSort++;
              } else {
                unmatchedFiles.push(file);
                logEvent({
                  id: uuidv4(),
                  session_id: sessionId,
                  file_path: file,
                  status: 'unmatched',
                  message: 'Near-match patient found; could not queue for manual sorting',
                  details: buildEventDetails(report)
                });
                sessionSummary.unmatched++;
              }
              continue; // handled — the user decides, nothing is stored now
            }
          }

          // A known patient (exact match, or identity adopted above) may
          // already have a matching visit for this date — e.g. a resumed/
          // retried import of the same file after the in-batch activeVisits
          // cache above has expired (2 minutes of import-dir quiet). Mirrors
          // STEP 4's standalone-PDF same-day reuse (pickSameDayReport,
          // issue #145's serial/timestamp guards against merging genuinely
          // distinct same-day visits), which structured files never had
          // (issue #151) — so reprocessing silently minted a duplicate visit
          // instead of merging into the existing one.
          let existingSameDayReport: any = null;
          if (resolvedPatientId && report.interrogation_date) {
            const datePrefix = report.interrogation_date.split('T')[0];
            const sameDayReports = await findReportsByDate(resolvedPatientId, datePrefix);
            existingSameDayReport = pickSameDayReport(sameDayReports, report, false);
          }

          if (existingSameDayReport) {
            console.log(`[Watcher] Matched existing same-day visit ${existingSameDayReport.id} for ${path.basename(file)} — merging instead of creating a duplicate.`);
            reportId = existingSameDayReport.id;
            patient = await getPatientById(resolvedPatientId!);
          } else {
            // Store the report (creates patient/visit if needed)
            const result = await storeReport(report);
            reportId = result.reportId;
            patient = result.patient;
          }

          // Store the structured file itself
          await storeFile(file, reportId, patient.id, `${patient.last_name}_${patient.first_name}`, report.interrogation_date, patient, report);

          logEvent({
            id: uuidv4(),
            session_id: sessionId,
            file_path: file,
            status: 'imported',
            patient_id: patient.id,
            report_id: reportId,
            message: existingSameDayReport ? 'Matched existing same-day visit' : undefined,
            details: buildEventDetails(report)
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
              sessionId: report.session_id,
              manufacturer: report.manufacturer
            });
          }
        }

        // --- STEP 2: Handle Internal PDFs (extracted from .pkg) ---
        if (report.generatedFiles && report.generatedFiles.length > 0) {
          console.log(`Processing ${report.generatedFiles.length} internal PDFs for ${path.basename(file)}`);
          for (const genFile of report.generatedFiles) {
            await storeFile(genFile, reportId, patient.id, `${patient.last_name}_${patient.first_name}`, report.interrogation_date, patient, report);

            logEvent({
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
        logEvent({
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

        applyIntraopTagIfNeeded(report, file);

        let matched = false;

        // Try to match with active visits
        for (const [key, visit] of activeVisits.entries()) {
          // Match Logic:
          // 1. Serial Number Match (Strongest)
          if (visit.serial && report.device?.serial_number && visit.serial === report.device.serial_number) {
            console.log(`Matched PDF ${path.basename(file)} to visit ${key} by Serial Number`);
            // Pass undefined for report to PREVENT overwriting valid XML data with PDF data
            await storeFile(file, visit.reportId, visit.patientId, `${visit.patient.last_name}_${visit.patient.first_name}`, visit.date, visit.patient, undefined);

            logEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'imported',
              patient_id: visit.patientId,
              report_id: visit.reportId,
              message: 'Matched by Serial',
              details: buildEventDetails(report)
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

            logEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'imported',
              patient_id: visit.patientId,
              report_id: visit.reportId,
              message: 'Matched by Session ID',
              details: buildEventDetails(report)
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

            logEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'imported',
              patient_id: visit.patientId,
              report_id: visit.reportId,
              message: 'Matched by Demographics',
              details: buildEventDetails(report)
            });
            sessionSummary.imported++;
            sessionSummary.processed++;
            affectedVisits.set(visit.reportId, { patient: visit.patient });

            matched = true;
            break;
          }
        }

        if (!matched) {
          // Fallback for a companion PDF whose own identity extraction (from
          // filename or text content) came up completely empty — e.g. a
          // Biotronik standalone PDF whose name doesn't fit the expected
          // BIOSTD_ filename convention (#166). Serial/session/demographics
          // matching above can't help when there's simply no identity to
          // match with, and the PDF would otherwise be routed to manual
          // sorting even though the sibling XML in this exact batch already
          // created its visit. When exactly one visit of the same
          // manufacturer was opened in this batch, attach the PDF there
          // instead of losing the association.
          const hasNoIdentity =
            (!report.patient?.last_name || report.patient.last_name === 'Unknown') &&
            (!report.device?.serial_number || report.device.serial_number === 'Unknown');

          if (hasNoIdentity && report.manufacturer && report.manufacturer !== 'Unknown') {
            const sameManufacturerVisits = [...activeVisits.entries()].filter(
              ([, v]) => v.manufacturer === report.manufacturer
            );
            if (sameManufacturerVisits.length === 1) {
              const [key, visit] = sameManufacturerVisits[0];
              console.log(`Matched PDF ${path.basename(file)} to visit ${key} as the sole same-manufacturer visit in this batch (no identity extracted from the PDF itself)`);
              await storeFile(file, visit.reportId, visit.patientId, `${visit.patient.last_name}_${visit.patient.first_name}`, visit.date, visit.patient, undefined);

              logEvent({
                id: uuidv4(),
                session_id: sessionId,
                file_path: file,
                status: 'imported',
                patient_id: visit.patientId,
                report_id: visit.reportId,
                message: 'Matched by sole same-manufacturer batch visit',
                details: buildEventDetails(report)
              });
              sessionSummary.imported++;
              sessionSummary.processed++;
              affectedVisits.set(visit.reportId, { patient: visit.patient });
              matched = true;
            }
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
          logEvent({ id: uuidv4(), session_id: sessionId, file_path: file, status: 'error', message: 'Parse failed' });
          sessionSummary.errors++;
          continue;
        }

        applyIntraopTagIfNeeded(report, file);

        // Check for existing patient in DB
        let patient = null;

        // 1. Try by Name + DOB (first name passed as a conservative guard so
        //    two people sharing last name + DOB are never fused)
        if (report.patient.last_name !== 'Unknown' && report.patient.dob) {
          patient = await findPatient(report.patient.last_name, report.patient.dob, report.patient.first_name);
        }

        // 2. Try by Serial Number (scoped by manufacturer when known)
        if (!patient && report.device?.serial_number && report.device.serial_number !== 'Unknown') {
          patient = await findPatientBySerial(
            report.device.serial_number,
            report.manufacturer && report.manufacturer !== 'Unknown' ? report.manufacturer : undefined
          );
        }

        if (patient) {
          console.log(`Found existing patient for PDF ${path.basename(file)}.`);

          // AUTO MATCHED. A same-day report is only reused when its device
          // serial and interrogation timestamp don't contradict this PDF —
          // a patient can have several distinct visits on one day (issue
          // #145); ambiguous files fall through to the manual-sort queue.
          const datePrefix = (report.interrogation_date || '').split('T')[0];
          const sameDayReports = datePrefix ? await findReportsByDate(patient.id, datePrefix) : [];
          const existingReport = pickSameDayReport(sameDayReports, report, false);

          if (existingReport) {
            await storeFile(file, existingReport.id, patient.id, `${patient.last_name}_${patient.first_name}`, report.interrogation_date, patient, undefined);
            logEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'imported',
              patient_id: patient.id,
              report_id: existingReport.id,
              message: 'Auto-matched to existing visit',
              details: buildEventDetails(report)
            });
            affectedVisits.set(existingReport.id, { patient });

            // Register in cross-batch visit memory for subsequent batches
            const pdfKey = getReportKey(report);
            if (pdfKey) {
              activeVisits.set(pdfKey, {
                reportId: existingReport.id,
                patientId: patient.id,
                patient,
                date: report.interrogation_date,
                serial: report.device?.serial_number,
                sessionId: report.session_id
              });
            }
          } else {
            // Patient found but no visit matched — hand off to the non-blocking
            // manual-sort queue (issue #136) so the user can confirm the visit
            // (or create a new one) on demand instead of being interrupted by a
            // modal mid-import.
            const isIntraopFile = (report as any)._remoteSource?.visit_type === 'intraoperative';
            const queued = queueForManualSort(pendingSortBatch, file, {
              patientName: `${patient.first_name} ${patient.last_name}`,
              dob: patient.dob,
              date: report.interrogation_date,
              serial: report.device?.serial_number,
              manufacturer: report.manufacturer,
              deviceModel: report.device?.model,
              leads: report.leads
            }, isIntraopFile);
            if (queued) {
              sessionSummary.pendingSort++;
            } else {
              unmatchedFiles.push(file);
              logEvent({
                id: uuidv4(),
                session_id: sessionId,
                file_path: file,
                status: 'unmatched',
                message: 'Could not queue for manual sorting',
                details: buildEventDetails(report)
              });
              sessionSummary.unmatched++;
            }
            continue; // handled (queued or unmatched) — nothing to store now
          }
          sessionSummary.imported++;

        } else {
          // Patient not found — hand off to the non-blocking manual-sort queue
          // (issue #136) instead of force-opening a modal. The user assigns or
          // creates a patient/visit on demand from the notification area.
          const isIntraopFile = (report as any)._remoteSource?.visit_type === 'intraoperative';
          const queued = queueForManualSort(pendingSortBatch, file, {
            patientName: `${report.patient.first_name} ${report.patient.last_name}`,
            dob: report.patient.dob,
            date: report.interrogation_date,
            serial: report.device?.serial_number,
            manufacturer: report.manufacturer,
            deviceModel: report.device?.model,
            leads: report.leads
          }, isIntraopFile);
          if (queued) {
            sessionSummary.pendingSort++;
          } else {
            unmatchedFiles.push(file);
            logEvent({
              id: uuidv4(),
              session_id: sessionId,
              file_path: file,
              status: 'unmatched',
              message: 'Could not queue for manual sorting',
              details: buildEventDetails(report)
            });
            sessionSummary.unmatched++;
          }
        }

      } catch (e) {
        console.error(`Error processing standalone PDF ${path.basename(file)}:`, e);
        unmatchedFiles.push(file);
        logEvent({
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

    // Flush this run's batched manual-sort files as ONE pending-sort task
    // (#156, #157, #158) instead of one task per file.
    if (pendingSortBatch.length > 0) {
      try {
        await enqueuePendingSort(pendingSortBatch, { sessionId });
        for (const entry of pendingSortBatch) {
          logEvent({
            id: uuidv4(),
            session_id: sessionId,
            file_path: entry.sourcePath,
            status: 'pending_manual_sort',
            message: 'Queued for manual sorting'
          });
        }
        sendPendingSortUpdate(listPendingSortTasks());
        const fileNames = pendingSortBatch.map(e => path.basename(e.sourcePath).replace(/^INTRAOP__/, ''));
        sendNotification(
          pendingSortBatch.length === 1
            ? `${fileNames[0]} needs manual sorting`
            : `${pendingSortBatch.length} files need manual sorting`,
          'warning'
        );
      } catch (e) {
        console.error(`[Watcher] Failed to enqueue manual sort batch (${pendingSortBatch.length} file(s)):`, e);
        for (const entry of pendingSortBatch) {
          unmatchedFiles.push(entry.sourcePath);
          sessionSummary.pendingSort--;
          sessionSummary.unmatched++;
          logEvent({
            id: uuidv4(),
            session_id: sessionId,
            file_path: entry.sourcePath,
            status: 'unmatched',
            message: 'Could not queue for manual sorting'
          });
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
    // ALWAYS clean up the temp directory — but never delete unprocessed
    // originals: anything still inside (e.g. files whose move to the unmatched
    // dir failed) is swept back into the source dir first.
    try {
      const recovered = await recoverTempDirFiles(tempDir, sourceDir);
      if (recovered > 0) {
        console.warn(`[Watcher] Swept ${recovered} leftover file(s) from ${tempDir} back to ${sourceDir} for re-processing.`);
        sendNotification(`${recovered} file(s) could not be fully processed and were returned to the import folder.`, 'warning');
      } else {
        console.log(`Successfully removed temporary directory: ${tempDir}`);
      }
    } catch (error) {
      console.error(`Error cleaning up temporary directory ${tempDir}:`, error);
      sendNotification(`Error cleaning up temp directory: ${(error as Error).message}`, 'error');
    }

    // Clean up any empty directories left in the source folder
    try {
      await cleanEmptyDirectories(sourceDir, sourceDir);
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

};

/**
 * Recursively removes empty directories.
 */
async function cleanEmptyDirectories(dir: string, rootDir: string) {
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
          await cleanEmptyDirectories(fullPath, rootDir);
        }
      } catch { /* ignore */ }
    }
    try {
      items = await fs.readdir(dir);
    } catch { return; }
  }

  if (items.length === 0 && dir !== rootDir) {
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

  // Initialize the pending manual-sort queue (issue #136) in a dir beside the
  // unmatched dir. Idempotent across re-inits; reconciles persisted tasks.
  pendingSortDir = path.join(path.dirname(appUnmatchedDir), '_PENDING_SORT_');
  initPendingSort(pendingSortDir)
    .then(() => sendPendingSortUpdate(listPendingSortTasks()))
    .catch(e => console.error('[Watcher] Failed to init pending-sort queue:', e));

  // Helper for safe batch processing (with re-entrance guard)
  const executeBatchProcessing = async () => {
    if (isProcessing) {
      console.log('[Watcher] Batch processing already in progress, skipping.');
      return;
    }
    isProcessing = true;
    let tempDir: string | null = null;
    try {
      tempDir = await createTempDirectory(importDir);
      await stageFilesToTempDir(tempDir, importDir, false);
      await processTempDirectory(tempDir, importDir);
    } catch (e) {
      console.error('Error during batch processing:', e);
      // Fallback cleanup if processTempDirectory didn't run or failed
      // catastrophically. NEVER rm -rf here: the temp dir holds the ONLY copy
      // of the staged originals — sweep them back into the import dir instead.
      if (tempDir) {
        try {
          const recovered = await recoverTempDirFiles(tempDir, importDir);
          if (recovered > 0) {
            sendNotification(`Import batch failed; ${recovered} file(s) were returned to the import folder for retry.`, 'warning');
          }
        } catch (cleanupErr) {
          console.error('Failed to recover temp dir after error:', cleanupErr);
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
  // Also tracks file size/mtime changes for cross-batch visit memory expiry.
  if (pollingFallbackInterval) clearInterval(pollingFallbackInterval);
  pollingFallbackInterval = setInterval(async () => {
    // Always update file snapshot for activity tracking (even while processing)
    await updateImportActivityFromSnapshot();

    if (isProcessing) return;
    try {
      try {
        await fs.access(importDir);
      } catch { return; }

      const files = await fs.readdir(importDir);
      if (files.length > 0) {
        const allFiles = await getFilesRecursively(importDir);

        if (allFiles.length > 0) {
          // Stability gate: only trigger once the exact same set of files
          // (names + sizes + mtimes) is seen on two consecutive polls, so a
          // programmer still writing PDFs isn't cut off mid-export — mirrors
          // the stabilization delay of the fs.watch path.
          const snapshot = await serializeFileSnapshot(allFiles);
          if (snapshot !== pollingStableSnapshot) {
            pollingStableSnapshot = snapshot;
            return;
          }
          console.log(`POLLING: Found ${allFiles.length} files in ${importDir}`);
          if (!watcherTimeout) {
            if (!pendingManualSortRequest && !pendingDeviceSelectionRequest) {
              console.log('POLLING: Triggering processing fallback...');
              pollingStableSnapshot = null;
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
      // Recover files stranded in _TEMP_* dirs by a crash mid-batch before
      // scanning — they are moved back to the import root and re-processed.
      await recoverLeftoverTempDirs(importDir);

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
      // Track activity for cross-batch visit memory expiry
      lastImportActivity = Date.now();
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

            // Re-clear: another event may have armed a new timer while we were
            // awaiting the directory listing above — overwriting it would leak
            // the old timer and double-trigger processing (W5).
            if (watcherTimeout) clearTimeout(watcherTimeout);
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
  activeVisits.clear();
  lastFileSnapshot.clear();
  lastImportActivity = 0;
  pollingStableSnapshot = null;
  console.log('File watcher stopped.');
};

/**
 * Initializes a parallel watcher on the intraoperative import directory.
 * Files dropped here go through the same parse/match/store pipeline as the
 * primary watcher, but are tagged with visit_type='intraoperative' in visit.xml.
 * The INTRAOP__ staging-filename prefix carries the tag through unmatched-dir
 * round trips so the manual assignment flow also tags the resulting visit.
 */
export const initializeIntraopWatcher = (appIntraopDir: string, appUnmatchedDir: string, appDataDir: string) => {
  intraopImportDir = appIntraopDir;
  // unmatchedDir + dataDir are shared with the primary watcher; only update if not already set.
  if (!unmatchedDir) unmatchedDir = appUnmatchedDir;
  if (!dataDir) dataDir = appDataDir;

  const executeIntraopBatchProcessing = async () => {
    if (isProcessing) {
      console.log('[IntraopWatcher] Batch processing already in progress, skipping.');
      return;
    }
    isProcessing = true;
    let tempDir: string | null = null;
    try {
      tempDir = await createTempDirectory(intraopImportDir);
      await stageFilesToTempDir(tempDir, intraopImportDir, true);
      await processTempDirectory(tempDir, intraopImportDir);
    } catch (e) {
      console.error('Error during intraop batch processing:', e);
      // Same as the primary watcher: sweep unprocessed originals back instead
      // of deleting them with the temp dir.
      if (tempDir) {
        try {
          const recovered = await recoverTempDirFiles(tempDir, intraopImportDir);
          if (recovered > 0) {
            sendNotification(`Intraop import batch failed; ${recovered} file(s) were returned to the intraop folder for retry.`, 'warning');
          }
        } catch (cleanupErr) {
          console.error('Failed to recover intraop temp dir after error:', cleanupErr);
        }
      }
    } finally {
      isProcessing = false;
    }
  };

  (async () => {
    try {
      await fs.mkdir(intraopImportDir, { recursive: true });
    } catch (error) {
      console.error(`Error creating intraop directory ${intraopImportDir}:`, error);
      sendNotification(`Error creating intraop directory: ${(error as Error).message}`, 'error');
    }
  })();

  console.log(`Watching for intraoperative file changes on ${intraopImportDir}`);

  if (intraopPollingFallbackInterval) clearInterval(intraopPollingFallbackInterval);
  intraopPollingFallbackInterval = setInterval(async () => {
    if (isProcessing) return;
    try {
      try {
        await fs.access(intraopImportDir);
      } catch { return; }

      const files = await fs.readdir(intraopImportDir);
      if (files.length > 0) {
        const allFiles = await getFilesRecursively(intraopImportDir);
        if (allFiles.length > 0) {
          // Stability gate — see the primary watcher's polling fallback.
          const snapshot = await serializeFileSnapshot(allFiles);
          if (snapshot !== intraopPollingStableSnapshot) {
            intraopPollingStableSnapshot = snapshot;
            return;
          }
          console.log(`POLLING (intraop): Found ${allFiles.length} files in ${intraopImportDir}`);
          if (!intraopWatcherTimeout) {
            if (!pendingManualSortRequest && !pendingDeviceSelectionRequest) {
              console.log('POLLING (intraop): Triggering processing fallback...');
              intraopPollingStableSnapshot = null;
              intraopWatcherTimeout = setTimeout(async () => {
                intraopWatcherTimeout = null;
                await executeIntraopBatchProcessing();
              }, 1000);
            }
          }
        }
      }
    } catch (e) {
      console.error('POLLING ERROR (intraop):', e);
    }
  }, 5000);

  (async () => {
    try {
      // Recover files stranded in _TEMP_* dirs by a crash mid-batch.
      await recoverLeftoverTempDirs(intraopImportDir);

      const existingFiles = await getFilesRecursively(intraopImportDir);
      if (existingFiles.length > 0) {
        console.log(`Found ${existingFiles.length} existing files in intraop directory. Processing...`);
        intraopStartupTimeout = setTimeout(async () => {
          intraopStartupTimeout = null;
          await executeIntraopBatchProcessing();
        }, 3000);
      }
    } catch (error) {
      console.error('Error checking for existing intraop files:', error);
    }
  })();

  try {
    intraopCurrentWatcher = fsSync.watch(intraopImportDir, { recursive: true }, (eventType, filename) => {
      if (filename && filename.includes('_TEMP_')) return;
      console.log(`Intraop watcher event: ${eventType} for file: ${filename}`);
      lastImportActivity = Date.now();
      if (filename) {
        if (intraopWatcherTimeout) {
          clearTimeout(intraopWatcherTimeout);
        }
        if (!pendingManualSortRequest && !pendingDeviceSelectionRequest) {
          (async () => {
            const currentFiles = await getFilesRecursively(intraopImportDir);
            const hasPdf = currentFiles.some(f => f.toLowerCase().endsWith('.pdf'));
            const stabilizationTime = hasPdf ? 15000 : 2000;

            console.log(`Intraop watcher: File event. PDF detected: ${hasPdf}. Waiting ${stabilizationTime}ms...`);

            // Re-clear to avoid leaking a timer armed while awaiting above (W5).
            if (intraopWatcherTimeout) clearTimeout(intraopWatcherTimeout);
            intraopWatcherTimeout = setTimeout(async () => {
              intraopWatcherTimeout = null;
              const finalFiles = await getFilesRecursively(intraopImportDir);
              if (finalFiles.length === 0) {
                console.log('Intraop: No files found, skipping processing.');
                return;
              }
              console.log('Intraop file changes stabilized. Starting processing...');
              await executeIntraopBatchProcessing();
            }, stabilizationTime);
          })();
        }
      }
    });
    intraopCurrentWatcher.on('error', (err) => {
      console.error(`Intraop watcher error on ${intraopImportDir}:`, err);
      sendNotification('Intraop file watcher lost connection. Polling fallback still active.', 'warning');
    });
  } catch (error) {
    console.error(`Error starting intraop watcher on ${intraopImportDir}:`, error);
    sendNotification(`Error starting intraop watcher: ${(error as Error).message}`, 'error');
  }
};

export const stopIntraopWatcher = () => {
  if (intraopStartupTimeout) {
    clearTimeout(intraopStartupTimeout);
    intraopStartupTimeout = null;
  }
  if (intraopWatcherTimeout) {
    clearTimeout(intraopWatcherTimeout);
    intraopWatcherTimeout = null;
  }
  if (intraopPollingFallbackInterval) {
    clearInterval(intraopPollingFallbackInterval);
    intraopPollingFallbackInterval = null;
  }
  if (intraopCurrentWatcher) {
    intraopCurrentWatcher.close();
    intraopCurrentWatcher = null;
  }
  intraopImportDir = '';
  intraopPollingStableSnapshot = null;
  console.log('Intraop file watcher stopped.');
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
 * Walks every patient/visit directory on disk and re-runs rescanVisitDirectory
 * on each one, so retroactive parser improvements (new fields, fixed gates)
 * reach visits that were imported before the fix shipped. Fails soft per
 * visit — one bad directory doesn't abort the rest of the run.
 */
export const reparseEverything = async (
  onProgress?: (status: any) => void
): Promise<{
  visitsTotal: number;
  visitsSucceeded: number;
  visitsEmpty: number;
  visitsFailed: number;
  failures: { patientDir: string; visitDir: string; error: string }[];
}> => {
  if (onProgress) onProgress({ type: 'start', title: 'Reparsing All Visits', message: 'Scanning patient directories...', progress: 0 });

  const { getSettings } = await import('./database');
  const settings = await getSettings();
  const { app } = await import('electron');
  const resolvedDataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  const reportsDir = path.join(resolvedDataDir, 'Reports');

  let patientDirNames: string[] = [];
  try {
    const entries = await fs.readdir(reportsDir, { withFileTypes: true });
    patientDirNames = entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    if (onProgress) onProgress({ type: 'complete', message: 'No data directory found.', progress: 100 });
    return { visitsTotal: 0, visitsSucceeded: 0, visitsEmpty: 0, visitsFailed: 0, failures: [] };
  }

  // Collect every visit directory up front so the progress percentage (and
  // the "N visits" summary) reflects the true total, not a running guess.
  const visits: { patientDir: string; visitDir: string; visitPath: string }[] = [];
  for (const patientDirName of patientDirNames) {
    const patientPath = path.join(reportsDir, patientDirName);
    let visitEntries: any[];
    try {
      visitEntries = await fs.readdir(patientPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const vDir of visitEntries) {
      if (!vDir.isDirectory()) continue;
      visits.push({ patientDir: patientDirName, visitDir: vDir.name, visitPath: path.join(patientPath, vDir.name) });
    }
  }

  let succeeded = 0;
  let empty = 0;
  let failed = 0;
  const failures: { patientDir: string; visitDir: string; error: string }[] = [];

  for (let i = 0; i < visits.length; i++) {
    const { patientDir, visitDir, visitPath } = visits[i];
    const progress = Math.round(((i + 1) / visits.length) * 100);
    if (onProgress) onProgress({ type: 'progress', message: `Reparsing ${patientDir}/${visitDir}...`, progress });

    // Resolve the report ID for this visit — the directory-name suffix
    // ("YYYY_MM_DD_<reportId>") is the normal case; fall back to visit.xml's
    // own report_id for older/irregular directory names.
    let visitId = visitDir.split('_').pop();
    try {
      const xmlContent = await fs.readFile(path.join(visitPath, 'visit.xml'), 'utf-8');
      const { XMLParser } = await import('fast-xml-parser');
      const parsed = new XMLParser().parse(xmlContent);
      if (parsed.visit?.report_id) visitId = String(parsed.visit.report_id);
    } catch {
      // No visit.xml (or unreadable) — keep the directory-derived id.
    }

    try {
      const result = await rescanVisitDirectory(visitPath, visitId);
      if (result.status === 'success') succeeded++;
      else empty++;
    } catch (e: any) {
      failed++;
      const message = e?.message || String(e);
      failures.push({ patientDir, visitDir, error: message });
      console.warn(`[ReparseEverything] Failed to reparse ${patientDir}/${visitDir}:`, e);
    }
  }

  const summaryMessage = `Reparsed ${visits.length} visit${visits.length === 1 ? '' : 's'}: ${succeeded} updated, ${empty} empty, ${failed} failed.`;
  if (onProgress) onProgress({ type: 'complete', message: summaryMessage, progress: 100 });

  return { visitsTotal: visits.length, visitsSucceeded: succeeded, visitsEmpty: empty, visitsFailed: failed, failures };
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

  // Update the specific report. The write is awaited and, on failure, the
  // directory move is rolled back — otherwise the visit's files would live
  // under the target patient while the DB still points at the source patient,
  // and the renderer would be told the move succeeded.
  try {
    await new Promise<void>((resolve, reject) => {
      db.run(`UPDATE Reports SET patient_id = ? WHERE id = ?`, [targetPatientId, visitId], (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (err: any) {
    console.error('[MoveVisit] DB Update failed, rolling back directory move:', err);
    try {
      await fs.rename(destPath, sourcePath);
    } catch (rollbackErr) {
      console.error('[MoveVisit] Rollback of directory move failed:', rollbackErr);
    }
    throw new Error(`Failed to update database for moved visit: ${err?.message || err}`);
  }

  // Also update any other reports that might have been linking to this visit? 
  // (Usually 1:1, but if multiple reports shared a folder, we might miss them if we only update by visitId.
  // However, findVisitPath assumes folder mapping.
  // Ideally we should update all reports where patient_id was OLD and now should be NEW, but scoping to this visit is hard without file paths in DB used for lookup.
  // Since we don't store file paths, we rely on the ID.
  // A deeper scan might be needed if multiple reports exist in one folder, but current architecture seems 1 Visit Dir = 1 Main Report ID).

  console.log(`[MoveVisit] Moved visit ${visitId} to ${targetPatientId}`);
  return { success: true, newPath: destPath };
};

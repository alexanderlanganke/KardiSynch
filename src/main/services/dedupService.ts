import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { findDuplicateReports, getReportById, deleteReport, getSettings } from '../database';
import { app } from 'electron';

export interface DedupResult {
  groupsFound: number;
  reportsRemoved: number;
  directoriesRemoved: number;
}

/**
 * Score a report by data richness — higher is better.
 * Prefers reports with more fields populated and more raw text.
 */
function scoreReport(row: any): number {
  let score = 0;
  if (row.manufacturer) score += 1;
  if (row.device_type) score += 1;
  if (row.device_model) score += 1;
  if (row.device_serial_number) score += 1;
  if (row.hospitalVisitId) score += 1;
  if (row.raw_text) score += Math.min(row.raw_text.length / 1000, 5); // up to 5 points for text length
  if (row.data) {
    try {
      const parsed = JSON.parse(row.data);
      if (parsed.leads && parsed.leads.length > 0) score += 2;
      if (parsed.device) score += 1;
      if (parsed.generatedFiles && parsed.generatedFiles.length > 0) score += 1;
    } catch { /* ignore */ }
  }
  return score;
}

/**
 * Count files in a visit directory (ignoring .xml metadata files).
 */
async function countVisitFiles(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.filter(e => !e.endsWith('.xml')).length;
  } catch {
    return 0;
  }
}

/**
 * Find the visit directory for a given report ID under a patient directory.
 * Visit dirs are named: {YYYY_MM_DD}_{reportId}
 */
async function findVisitDir(patientDir: string, reportId: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(patientDir);
    const match = entries.find(e => e.includes(reportId));
    return match ? path.join(patientDir, match) : null;
  } catch {
    return null;
  }
}

/**
 * SHA-256 of a file's content, or null if it cannot be read.
 */
async function hashFile(p: string): Promise<string | null> {
  try {
    const data = await fs.readFile(p);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Move all non-metadata files from src directory into dest directory.
 * Name collisions are resolved by content hash: verified-identical files are
 * dropped from src, different content is kept under a suffixed name.
 * Returns per-file counts so callers can verify the merge fully succeeded
 * before removing the source directory.
 */
async function mergeFiles(srcDir: string, destDir: string): Promise<{ merged: number; failed: number }> {
  let merged = 0;
  let failed = 0;

  let entries: string[];
  try {
    entries = await fs.readdir(srcDir);
  } catch (err) {
    console.warn('[Dedup] Error reading directory to merge:', err);
    return { merged: 0, failed: 1 };
  }

  for (const entry of entries) {
    // Skip metadata XML files — the keeper's metadata is authoritative
    if (entry === 'visit.xml' || entry === 'patient.xml') continue;

    const srcPath = path.join(srcDir, entry);
    let destPath = path.join(destDir, entry);

    try {
      // Handle collision
      if (await fileExists(destPath)) {
        // Only treat the files as identical when their CONTENT matches —
        // same name + same size is not enough (fixed-layout reports can
        // differ while being byte-count equal).
        const [srcHash, destHash] = await Promise.all([hashFile(srcPath), hashFile(destPath)]);
        if (srcHash && srcHash === destHash) {
          // Verified identical — drop the duplicate copy.
          await fs.unlink(srcPath);
          merged++;
          continue;
        }

        // Different (or unreadable) content — keep both, suffix the incoming name
        const ext = path.extname(entry);
        const base = path.basename(entry, ext);
        let i = 2;
        do {
          destPath = path.join(destDir, `${base}_${i}${ext}`);
          i++;
        } while (await fileExists(destPath));
      }

      try {
        await fs.rename(srcPath, destPath);
      } catch (err: any) {
        // EXDEV: cross-device — fallback to copy+unlink
        if (err.code === 'EXDEV') {
          await fs.copyFile(srcPath, destPath);
          await fs.unlink(srcPath);
        } else {
          throw err;
        }
      }
      merged++;
    } catch (err: any) {
      failed++;
      console.warn(`[Dedup] Failed to move ${entry}:`, err.message);
    }
  }

  return { merged, failed };
}

/**
 * A merged-away visit directory may only be removed when nothing but metadata
 * XML files (whose keeper copies are authoritative) is left inside it.
 */
async function isDirSafeToRemove(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.every(e => e === 'visit.xml' || e === 'patient.xml');
  } catch (err: any) {
    return err.code === 'ENOENT';
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a directory and clean up empty parent directories up to stopAt.
 */
async function removeDirectoryAndCleanup(dir: string, stopAt: string): Promise<boolean> {
  try {
    await fs.rm(dir, { recursive: true, force: true });

    // Clean empty parent dirs up to stopAt
    let parent = path.dirname(dir);
    const stopResolved = path.resolve(stopAt);
    while (path.resolve(parent) !== stopResolved && path.resolve(parent).startsWith(stopResolved + path.sep)) {
      const entries = await fs.readdir(parent);
      if (entries.length === 0) {
        await fs.rmdir(parent);
        parent = path.dirname(parent);
      } else {
        break;
      }
    }
    return true;
  } catch (err) {
    console.warn('[Dedup] Failed to remove directory:', dir, err);
    return false;
  }
}

/**
 * Extract the date prefix from a visit directory name.
 * Visit dirs are named: {YYYY_MM_DD}_{reportId}
 * Returns the date portion (e.g., "2024_01_15") or null.
 */
function getVisitDatePrefix(dirName: string): string | null {
  const match = dirName.match(/^(\d{4}_\d{2}_\d{2})_/);
  return match ? match[1] : null;
}

/**
 * Resolve the report UUID a visit directory name refers to.
 * Visit dirs are named {YYYY_MM_DD}_{reportId}, optionally with a numeric
 * collision suffix ({...}_{reportId}_2). Returns null if no UUID is present.
 */
function getVisitReportId(dirName: string): string | null {
  const match = dirName.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_\d+)?$/i);
  return match ? match[1] : null;
}

/**
 * Find the patient directory matching a patient ID.
 * Patient dirs are named "{patientId}_{safeName}" (see storage.ts) or, in
 * legacy/corrupted states, just the ID.
 */
async function findPatientDir(reportsDir: string, patientId: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(reportsDir);
    const match = entries.find(d => d === patientId || d.startsWith(`${patientId}_`));
    return match ? path.join(reportsDir, match) : null;
  } catch {
    return null;
  }
}

/**
 * Phase 1: Database-driven dedup.
 * Finds duplicate report rows (same patient + same date) and merges them.
 */
async function dedupDatabaseReports(
  reportsDir: string,
  result: DedupResult,
  onProgress?: (status: { message: string; progress: number }) => void
): Promise<void> {
  const groups = await findDuplicateReports();
  result.groupsFound += groups.length;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const progress = Math.round(((i + 1) / groups.length) * 50); // 0-50% for phase 1
    onProgress?.({ message: `DB dedup ${i + 1}/${groups.length} (patient ${group.patient_id}, date ${group.date})`, progress });

    const reports: { id: string; row: any; score: number; fileCount: number; visitDir: string | null }[] = [];

    const patientDir = await findPatientDir(reportsDir, group.patient_id);
    if (!patientDir) {
      console.warn(`[Dedup] Patient directory not found for ${group.patient_id}, cleaning DB only`);
    }

    for (const reportId of group.reportIds) {
      const row = await getReportById(reportId);
      if (!row) continue;

      const visitDir = patientDir ? await findVisitDir(patientDir, reportId) : null;
      const fileCount = visitDir ? await countVisitFiles(visitDir) : 0;

      reports.push({ id: reportId, row, score: scoreReport(row), fileCount, visitDir });
    }

    if (reports.length < 2) continue;

    // Same patient + same date is not enough on its own: a patient can have
    // several legitimate interrogations on one day (e.g. a pacemaker and an
    // ICM, or a multi-visit day — see storage's multi-visit invariant). Only
    // rows that also share the same device serial number (or that both lack
    // one) are treated as duplicates of each other.
    const bySerial = new Map<string, typeof reports>();
    for (const r of reports) {
      const serialKey = String(r.row.device_serial_number || '').trim().toLowerCase();
      const arr = bySerial.get(serialKey) || [];
      arr.push(r);
      bySerial.set(serialKey, arr);
    }

    for (const subgroup of bySerial.values()) {
      if (subgroup.length < 2) continue;

      // Sort: highest score first, then most files as tiebreaker
      subgroup.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.fileCount - a.fileCount;
      });

      const keeper = subgroup[0];
      const duplicates = subgroup.slice(1);

      console.log(`[Dedup] Keeping report ${keeper.id} (score=${keeper.score}, files=${keeper.fileCount}) for patient ${group.patient_id} on ${group.date}`);

      for (const dup of duplicates) {
        // Only delete the duplicate's DB row once its files verifiably live in
        // the keeper's directory (or it never had any on disk). A row whose
        // directory exists but could not be fully merged is left untouched.
        let filesCleared = false;
        if (!dup.visitDir) {
          filesCleared = true;
        } else if (keeper.visitDir) {
          const { failed } = await mergeFiles(dup.visitDir, keeper.visitDir);
          filesCleared = failed === 0 && (await isDirSafeToRemove(dup.visitDir));
        }

        if (!filesCleared) {
          console.warn(`[Dedup] Skipping report ${dup.id} — its files could not be fully merged into ${keeper.id}`);
          continue;
        }

        await deleteReport(dup.id);
        result.reportsRemoved++;

        if (dup.visitDir && await fileExists(dup.visitDir)) {
          const removed = await removeDirectoryAndCleanup(dup.visitDir, reportsDir);
          if (removed) result.directoriesRemoved++;
        }

        console.log(`[Dedup] Removed duplicate report ${dup.id} (score=${dup.score}, files=${dup.fileCount})`);
      }
    }
  }
}

/**
 * Phase 2: Filesystem-driven dedup.
 * Scans patient directories for same-date visit dirs that resolve to the same
 * report identity (several dirs for one report, or orphan dirs without a DB
 * row next to a single live visit) and merges those into the authoritative
 * directory. Same-date dirs with distinct live DB rows are legitimate
 * multi-visit days and are left alone.
 */
async function dedupFilesystemDirectories(
  reportsDir: string,
  result: DedupResult,
  onProgress?: (status: { message: string; progress: number }) => void
): Promise<void> {
  let patientDirNames: string[];
  try {
    patientDirNames = await fs.readdir(reportsDir);
  } catch {
    return;
  }

  for (let pi = 0; pi < patientDirNames.length; pi++) {
    const progress = 50 + Math.round(((pi + 1) / patientDirNames.length) * 50); // 50-100%
    const patientDir = path.join(reportsDir, patientDirNames[pi]);

    let stat;
    try {
      stat = await fs.stat(patientDir);
    } catch { continue; }
    if (!stat.isDirectory()) continue;

    let visitDirNames: string[];
    try {
      visitDirNames = await fs.readdir(patientDir);
    } catch { continue; }

    // Group visit dirs by date prefix
    const dateGroups = new Map<string, string[]>();
    for (const vd of visitDirNames) {
      const datePrefix = getVisitDatePrefix(vd);
      if (!datePrefix) continue;

      let stat;
      try {
        stat = await fs.stat(path.join(patientDir, vd));
      } catch { continue; }
      if (!stat.isDirectory()) continue;

      const group = dateGroups.get(datePrefix) || [];
      group.push(vd);
      dateGroups.set(datePrefix, group);
    }

    // Process groups with duplicates
    for (const [datePrefix, dirs] of dateGroups) {
      if (dirs.length < 2) continue;

      onProgress?.({ message: `Directory dedup: ${patientDirNames[pi]} date ${datePrefix} (${dirs.length} dirs)`, progress });

      // Resolve each directory's report identity. Two same-date directories
      // are only duplicates when they refer to the SAME report, or when one of
      // them is an orphan (its report has no DB row) next to exactly one live
      // visit. Same-date directories with distinct live DB rows are legitimate
      // multi-visit days (e.g. two devices interrogated the same day) and must
      // be left alone.
      const resolved: { name: string; reportId: string | null; hasRow: boolean }[] = [];
      for (const d of dirs) {
        const reportId = getVisitReportId(d);
        const row = reportId ? await getReportById(reportId).catch(() => null) : null;
        resolved.push({ name: d, reportId, hasRow: !!row });
      }

      const consumed = new Set<string>();

      // 1) Several directories for the same report — true duplicates.
      const byReport = new Map<string, string[]>();
      for (const r of resolved) {
        if (!r.reportId) continue;
        const arr = byReport.get(r.reportId) || [];
        arr.push(r.name);
        byReport.set(r.reportId, arr);
      }
      for (const sameReportDirs of byReport.values()) {
        if (sameReportDirs.length < 2) continue;
        await mergeVisitDirGroup(patientDir, reportsDir, sameReportDirs, result);
        sameReportDirs.forEach(n => consumed.add(n));
      }

      // 2) Orphan directories (report ID with no DB row) merged into the
      //    single live visit of the same day. With several live visits it is
      //    ambiguous which one an orphan belongs to — leave them alone.
      const remaining = resolved.filter(r => !consumed.has(r.name) && r.reportId);
      const live = remaining.filter(r => r.hasRow);
      const orphans = remaining.filter(r => !r.hasRow);
      if (live.length === 1 && orphans.length > 0) {
        await mergeVisitDirGroup(
          patientDir,
          reportsDir,
          [live[0].name, ...orphans.map(o => o.name)],
          result,
          live[0].name
        );
      }
    }
  }
}

/**
 * Merge a group of duplicate visit directories into a single keeper and remove
 * the emptied duplicates. The keeper is `forcedKeeperName` when given (the
 * directory a live DB row points at), otherwise the directory with the most
 * data files (largest total size as tiebreaker). A duplicate is only removed
 * when every one of its data files was verifiably merged away.
 * Never deletes DB rows: the keeper's row must survive, and orphan directories
 * have no row by definition.
 */
async function mergeVisitDirGroup(
  patientDir: string,
  reportsDir: string,
  dirNames: string[],
  result: DedupResult,
  forcedKeeperName?: string
): Promise<void> {
  // Score each directory: most non-xml files wins, then largest total size
  const scored: { name: string; fullPath: string; fileCount: number; totalSize: number }[] = [];
  for (const d of dirNames) {
    const fullPath = path.join(patientDir, d);
    let entries: string[];
    try {
      entries = await fs.readdir(fullPath);
    } catch { continue; }

    const dataFiles = entries.filter(e => !e.endsWith('.xml'));
    let totalSize = 0;
    for (const f of dataFiles) {
      try {
        const s = await fs.stat(path.join(fullPath, f));
        totalSize += s.size;
      } catch { /* skip */ }
    }

    scored.push({ name: d, fullPath, fileCount: dataFiles.length, totalSize });
  }

  if (scored.length < 2) return;

  // Sort: most files first, then largest total size
  scored.sort((a, b) => {
    if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
    return b.totalSize - a.totalSize;
  });

  let keeper: typeof scored[0] | undefined;
  if (forcedKeeperName) {
    keeper = scored.find(s => s.name === forcedKeeperName);
    if (!keeper) return; // the live directory is unreadable — do nothing
  } else {
    keeper = scored[0];
  }
  const dupes = scored.filter(s => s !== keeper);

  result.groupsFound++;

  for (const dup of dupes) {
    console.log(`[Dedup/FS] Merging ${dup.name} (${dup.fileCount} files) into ${keeper.name} (${keeper.fileCount} files)`);
    const { failed } = await mergeFiles(dup.fullPath, keeper.fullPath);
    if (failed > 0 || !(await isDirSafeToRemove(dup.fullPath))) {
      console.warn(`[Dedup/FS] Keeping ${dup.name} — not all files could be merged into ${keeper.name}`);
      continue;
    }

    const removed = await removeDirectoryAndCleanup(dup.fullPath, reportsDir);
    if (removed) result.directoriesRemoved++;
  }
}

/**
 * Run the full dedup cleanup:
 * Phase 1: Database-driven — find duplicate report rows (same patient + date + device serial), merge and clean
 * Phase 2: Filesystem-driven — find duplicate visit directories (same report identity), merge and clean
 */
export async function runDedupCleanup(
  onProgress?: (status: { message: string; progress: number }) => void
): Promise<DedupResult> {
  const result: DedupResult = { groupsFound: 0, reportsRemoved: 0, directoriesRemoved: 0 };

  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  const reportsDir = path.join(dataDir, 'Reports');

  // Phase 1: DB dedup
  onProgress?.({ message: 'Phase 1: Checking database for duplicate reports...', progress: 0 });
  await dedupDatabaseReports(reportsDir, result, onProgress);

  // Phase 2: Filesystem dedup
  onProgress?.({ message: 'Phase 2: Scanning directories for duplicates...', progress: 50 });
  await dedupFilesystemDirectories(reportsDir, result, onProgress);

  if (result.groupsFound === 0) {
    onProgress?.({ message: 'No duplicates found.', progress: 100 });
  } else {
    onProgress?.({ message: 'Deduplication complete.', progress: 100 });
  }

  return result;
}

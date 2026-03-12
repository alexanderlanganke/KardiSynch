import fs from 'fs/promises';
import path from 'path';
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
 * Move all non-metadata files from src directory into dest directory.
 * Handles filename collisions by appending a suffix.
 * Skips files that are identical (same name + same size).
 */
async function mergeFiles(srcDir: string, destDir: string): Promise<number> {
  let merged = 0;
  try {
    const entries = await fs.readdir(srcDir);
    for (const entry of entries) {
      // Skip metadata XML files — the keeper's metadata is authoritative
      if (entry === 'visit.xml' || entry === 'patient.xml') continue;

      const srcPath = path.join(srcDir, entry);
      let destPath = path.join(destDir, entry);

      // Handle collision
      if (await fileExists(destPath)) {
        // Check if same size — likely identical file, skip
        const srcStat = await fs.stat(srcPath);
        const destStat = await fs.stat(destPath);
        if (srcStat.size === destStat.size) continue;

        // Different file, rename with suffix
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
        merged++;
      } catch (err: any) {
        // EXDEV: cross-device — fallback to copy+unlink
        if (err.code === 'EXDEV') {
          await fs.copyFile(srcPath, destPath);
          await fs.unlink(srcPath);
          merged++;
        } else {
          console.warn(`[Dedup] Failed to move ${entry}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.warn('[Dedup] Error merging files:', err);
  }
  return merged;
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
 * Find the patient directory matching a patient ID.
 * Patient dirs are named: "LastName_FirstName_DOB_ID" or just the ID.
 */
async function findPatientDir(reportsDir: string, patientId: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(reportsDir);
    const match = entries.find(d => d.endsWith(`_${patientId}`) || d === patientId);
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

    // Sort: highest score first, then most files as tiebreaker
    reports.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.fileCount - a.fileCount;
    });

    const keeper = reports[0];
    const duplicates = reports.slice(1);

    console.log(`[Dedup] Keeping report ${keeper.id} (score=${keeper.score}, files=${keeper.fileCount}) for patient ${group.patient_id} on ${group.date}`);

    for (const dup of duplicates) {
      if (dup.visitDir && keeper.visitDir) {
        await mergeFiles(dup.visitDir, keeper.visitDir);
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

/**
 * Phase 2: Filesystem-driven dedup.
 * Scans patient directories for visit dirs with the same date prefix,
 * merges files into the one with the most content, and removes the rest.
 * Catches orphaned duplicate directories that have no DB entry.
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

      // Score each directory: most non-xml files wins, then largest total size
      const scored: { name: string; fullPath: string; fileCount: number; totalSize: number }[] = [];
      for (const d of dirs) {
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

      if (scored.length < 2) continue;

      // Sort: most files first, then largest total size
      scored.sort((a, b) => {
        if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
        return b.totalSize - a.totalSize;
      });

      const keeper = scored[0];
      const dupes = scored.slice(1);

      result.groupsFound++;

      for (const dup of dupes) {
        console.log(`[Dedup/FS] Merging ${dup.name} (${dup.fileCount} files) into ${keeper.name} (${keeper.fileCount} files)`);
        await mergeFiles(dup.fullPath, keeper.fullPath);

        const removed = await removeDirectoryAndCleanup(dup.fullPath, reportsDir);
        if (removed) result.directoriesRemoved++;

        // If there's an orphan DB row for this directory's report ID, clean it up
        const uuidMatch = dup.name.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
        if (uuidMatch) {
          const orphanId = uuidMatch[1];
          const row = await getReportById(orphanId);
          if (row) {
            await deleteReport(orphanId);
            result.reportsRemoved++;
            console.log(`[Dedup/FS] Cleaned orphan DB row ${orphanId}`);
          }
        }
      }
    }
  }
}

/**
 * Run the full dedup cleanup:
 * Phase 1: Database-driven — find duplicate report rows (same patient + date), merge and clean
 * Phase 2: Filesystem-driven — find duplicate visit directories (same date prefix), merge and clean
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

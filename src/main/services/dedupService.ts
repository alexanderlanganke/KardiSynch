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
 * Run the full dedup cleanup:
 * 1. Find duplicate report groups (same patient + same date)
 * 2. For each group, pick the best report (highest score + most files)
 * 3. Merge files from duplicates into the keeper's directory
 * 4. Delete duplicate DB rows and remove empty directories
 */
export async function runDedupCleanup(
  onProgress?: (status: { message: string; progress: number }) => void
): Promise<DedupResult> {
  const result: DedupResult = { groupsFound: 0, reportsRemoved: 0, directoriesRemoved: 0 };

  const groups = await findDuplicateReports();
  result.groupsFound = groups.length;

  if (groups.length === 0) {
    onProgress?.({ message: 'No duplicates found.', progress: 100 });
    return result;
  }

  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  const reportsDir = path.join(dataDir, 'Reports');

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const progress = Math.round(((i + 1) / groups.length) * 100);
    onProgress?.({ message: `Processing group ${i + 1}/${groups.length} (patient ${group.patient_id}, date ${group.date})`, progress });

    // Load full report data for scoring
    const reports: { id: string; row: any; score: number; fileCount: number; visitDir: string | null }[] = [];

    // Find patient directory (could be named differently — search by patient_id)
    let patientDir: string | null = null;
    try {
      const patientDirs = await fs.readdir(reportsDir);
      // Patient dirs may be named with the patient ID at the end: "LastName_FirstName_DOB_ID"
      const match = patientDirs.find(d => d.endsWith(`_${group.patient_id}`) || d === group.patient_id);
      if (match) {
        patientDir = path.join(reportsDir, match);
      }
    } catch {
      console.warn(`[Dedup] Cannot read reports directory for patient ${group.patient_id}`);
      continue;
    }

    if (!patientDir) {
      console.warn(`[Dedup] Patient directory not found for ${group.patient_id}, cleaning DB only`);
    }

    for (const reportId of group.reportIds) {
      const row = await getReportById(reportId);
      if (!row) continue;

      const visitDir = patientDir ? await findVisitDir(patientDir, reportId) : null;
      const fileCount = visitDir ? await countVisitFiles(visitDir) : 0;

      reports.push({
        id: reportId,
        row,
        score: scoreReport(row),
        fileCount,
        visitDir,
      });
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
      // Merge files from duplicate into keeper's directory
      if (dup.visitDir && keeper.visitDir) {
        await mergeFiles(dup.visitDir, keeper.visitDir);
      }

      // Delete the DB row
      await deleteReport(dup.id);
      result.reportsRemoved++;

      // Remove the duplicate's visit directory
      if (dup.visitDir && await fileExists(dup.visitDir)) {
        const removed = await removeDirectoryAndCleanup(dup.visitDir, reportsDir);
        if (removed) result.directoriesRemoved++;
      }

      console.log(`[Dedup] Removed duplicate report ${dup.id} (score=${dup.score}, files=${dup.fileCount})`);
    }
  }

  onProgress?.({ message: 'Deduplication complete.', progress: 100 });
  return result;
}

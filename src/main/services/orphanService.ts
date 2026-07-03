import fs from 'fs/promises';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { app } from 'electron';
import { getPatientsWithSerials, getReportById, getSettings, updateReportPatient } from '../database';

/**
 * A visit directory that physically lives under one patient's folder but, per the
 * database, belongs to a different patient — i.e. it is stored in the wrong place.
 * This is the residue of misrouted moves (e.g. an interrupted merge, a manual
 * drag, or the pre-fix moveReport that could spawn a second keeper directory).
 */
export interface OrphanVisit {
  reportId: string;
  visitDirName: string;
  date: string | null;
  fileCount: number;
  /** Owner of the directory the visit currently sits in (null if that dir maps to no known patient). */
  currentPatientId: string | null;
  currentPatientDirName: string;
  currentPatientLabel: string | null;
  /** Patient the visit actually belongs to, per the DB report row. */
  correctPatientId: string;
  correctPatientLabel: string | null;
  /** Whether the correct patient already has a directory on disk (else it is created on move). */
  correctPatientDirExists: boolean;
}

export interface OrphanMoveResult {
  moved: number;
  errors: string[];
}

const patientLabel = (first: string | null, last: string | null): string =>
  `${first || ''} ${last || ''}`.trim() || 'Unknown';

/** Match a top-level patient directory to a patient ID (dir names are `{id}_{safeName}`). */
const patientIdForDir = (dirName: string, ids: string[]): string | null =>
  ids.find(id => dirName === id || dirName.startsWith(`${id}_`)) || null;

/** Date prefix of a visit dir name (`YYYY_MM_DD_...`), or null. */
const visitDatePrefix = (dirName: string): string | null => {
  const m = dirName.match(/^(\d{4}_\d{2}_\d{2})_/);
  return m ? m[1].replace(/_/g, '-') : null;
};

/**
 * Resolve the report ID a visit directory represents. Prefer the authoritative
 * `<report_id>` in visit.xml; fall back to stripping the date prefix from the
 * directory name (`YYYY_MM_DD_{reportId}` or `Unknown_{reportId}`).
 */
async function reportIdForVisit(visitPath: string, dirName: string): Promise<string | null> {
  try {
    const xml = await fs.readFile(path.join(visitPath, 'visit.xml'), 'utf-8');
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
    const rid = parsed?.visit?.report_id;
    if (rid !== undefined && rid !== null && String(rid).trim()) return String(rid).trim();
  } catch { /* fall through to name-based extraction */ }

  const stripped = dirName.replace(/^(\d{4}_\d{2}_\d{2}|Unknown)_/, '');
  return stripped && stripped !== dirName ? stripped : null;
}

async function countVisitFiles(visitPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(visitPath);
    return entries.filter(e => !e.endsWith('.xml')).length;
  } catch {
    return 0;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function resolveReportsDir(): Promise<string> {
  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  return path.join(dataDir, 'Reports');
}

/**
 * Scan the data directory for visits stored under the wrong patient. A visit is
 * an orphan when the DB says its report belongs to patient B, but the visit
 * directory physically sits under patient A's folder. Visits whose report has no
 * DB row are ignored here (that is the report/directory deduplicator's job).
 */
export async function findOrphanedVisits(): Promise<OrphanVisit[]> {
  const reportsDir = await resolveReportsDir();

  const patients = await getPatientsWithSerials();
  const ids = patients.map(p => p.id);
  const labelById = new Map(patients.map(p => [p.id, patientLabel(p.first_name, p.last_name)]));

  let patientDirNames: string[];
  try {
    patientDirNames = await fs.readdir(reportsDir);
  } catch {
    return [];
  }

  // Directories that exist for a given patient ID (a patient may, in a corrupted
  // state, have more than one) — used to report whether the correct dir exists.
  const dirsByPatientId = new Map<string, string[]>();
  for (const dirName of patientDirNames) {
    const owner = patientIdForDir(dirName, ids);
    if (owner) {
      const arr = dirsByPatientId.get(owner) || [];
      arr.push(dirName);
      dirsByPatientId.set(owner, arr);
    }
  }

  const orphans: OrphanVisit[] = [];

  for (const patientDirName of patientDirNames) {
    const patientDir = path.join(reportsDir, patientDirName);
    if (!(await isDirectory(patientDir))) continue;

    const currentPatientId = patientIdForDir(patientDirName, ids);

    let visitDirNames: string[];
    try {
      visitDirNames = await fs.readdir(patientDir);
    } catch {
      continue;
    }

    for (const visitDirName of visitDirNames) {
      const visitPath = path.join(patientDir, visitDirName);
      if (!(await isDirectory(visitPath))) continue;

      const reportId = await reportIdForVisit(visitPath, visitDirName);
      if (!reportId) continue;

      const report = await getReportById(reportId).catch(() => null);
      if (!report || !report.patient_id) continue; // no DB row → not our concern

      const correctPatientId = String(report.patient_id);
      if (correctPatientId === currentPatientId) continue; // correctly placed

      orphans.push({
        reportId,
        visitDirName,
        date: visitDatePrefix(visitDirName) || (report.interrogation_date ? String(report.interrogation_date).split('T')[0] : null),
        fileCount: await countVisitFiles(visitPath),
        currentPatientId,
        currentPatientDirName: patientDirName,
        currentPatientLabel: currentPatientId ? labelById.get(currentPatientId) || null : null,
        correctPatientId,
        correctPatientLabel: labelById.get(correctPatientId) || null,
        correctPatientDirExists: (dirsByPatientId.get(correctPatientId)?.length || 0) > 0,
      });
    }
  }

  return orphans;
}

/** Move a directory, falling back to copy+remove across filesystems (EXDEV). */
async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      await fs.cp(src, dest, { recursive: true });
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

/**
 * Move the given orphaned visits into their correct patient directory and repoint
 * the DB report row. Re-scans first so the caller only needs to pass report IDs,
 * and stale selections (already fixed elsewhere) are skipped rather than failing.
 */
export async function moveOrphanedVisits(
  reportIds: string[],
  onProgress?: (status: { message: string; progress: number }) => void
): Promise<OrphanMoveResult> {
  const result: OrphanMoveResult = { moved: 0, errors: [] };

  const wanted = new Set(reportIds);
  const orphans = (await findOrphanedVisits()).filter(o => wanted.has(o.reportId));
  if (orphans.length === 0) return result;

  const reportsDir = await resolveReportsDir();
  const patients = await getPatientsWithSerials();
  const labelById = new Map(patients.map(p => [p.id, patientLabel(p.first_name, p.last_name)]));

  for (let i = 0; i < orphans.length; i++) {
    const o = orphans[i];
    onProgress?.({
      message: `Moving visit ${i + 1}/${orphans.length} to ${o.correctPatientLabel || o.correctPatientId}`,
      progress: Math.round(((i + 1) / orphans.length) * 100),
    });

    try {
      const srcPath = path.join(reportsDir, o.currentPatientDirName, o.visitDirName);

      // Locate the destination patient's existing directory (by ID prefix, the
      // convention used across the app); create one if it has none yet.
      const existing = (await fs.readdir(reportsDir).catch(() => []))
        .find(d => d === o.correctPatientId || d.startsWith(`${o.correctPatientId}_`));
      const destPatientDirName = existing || `${o.correctPatientId}_${(labelById.get(o.correctPatientId) || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_')}`;
      const destPatientDir = path.join(reportsDir, destPatientDirName);
      await fs.mkdir(destPatientDir, { recursive: true });

      // Avoid clobbering an existing dir of the same name at the destination.
      let destVisitPath = path.join(destPatientDir, o.visitDirName);
      let suffix = 2;
      while (await isDirectory(destVisitPath)) {
        destVisitPath = path.join(destPatientDir, `${o.visitDirName}_${suffix++}`);
      }

      await moveDir(srcPath, destVisitPath);
      await updateReportPatient(o.reportId, o.correctPatientId);
      result.moved++;
    } catch (e: any) {
      result.errors.push(`Failed to move visit ${o.visitDirName} (report ${o.reportId}): ${e.message}`);
    }
  }

  return result;
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';

// Exercises the REAL storage.moveReport against a temp filesystem (only electron
// is mocked). patient_merge.test.ts mocks storage out, so the on-disk visit move
// — where the actual merge bugs live — is only covered here.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/kardisynch_test_merge_fs' },
}));

import {
  initializeDatabase,
  closeDatabase,
  setSettings,
  createPatient,
  createReport,
  getAllPatients,
  getReportIdsForPatient,
} from '../main/database';
import { mergePatients } from '../main/services/patientMergeService';

const testDataPath = path.join(__dirname, 'test_data_merge_fs');
const reportsDir = path.join(testDataPath, 'Reports');

const addPatient = (id: string, first: string, last: string, dob: string) =>
  createPatient({ id, first_name: first, last_name: last, dob, hospitalPatientId: null });

const addReport = (id: string, patientId: string, date: string, serial: string) =>
  createReport({
    id,
    patient_id: patientId,
    manufacturer: 'Medtronic',
    interrogation_date: date,
    device: { serial_number: serial, model: 'Azure', type: 'Pacemaker' },
  } as any);

// Lay a visit dir on disk exactly like storeFile does:
//   {patientId}_{last}_{first}/{YYYY_MM_DD}_{reportId}/{file}
const layVisit = (patientDirName: string, date: string, reportId: string) => {
  const visitDir = path.join(reportsDir, patientDirName, `${date}_${reportId}`);
  fs.mkdirSync(visitDir, { recursive: true });
  fs.writeFileSync(path.join(visitDir, `${reportId}.pdf`), 'PDF-CONTENT');
  fs.writeFileSync(path.join(visitDir, 'visit.xml'), `<visit><report_id>${reportId}</report_id></visit>`);
};

const layPatientXml = (patientDirName: string) => {
  fs.mkdirSync(path.join(reportsDir, patientDirName), { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, patientDirName, 'patient.xml'),
    '<patient><devices></devices><leads></leads></patient>'
  );
};

beforeEach(async () => {
  if (fs.existsSync(testDataPath)) fs.rmSync(testDataPath, { recursive: true, force: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  await initializeDatabase(':memory:');
  await setSettings({ dataPath: testDataPath });
});

afterEach(async () => {
  await closeDatabase();
  if (fs.existsSync(testDataPath)) fs.rmSync(testDataPath, { recursive: true, force: true });
});

describe('mergePatients (real filesystem)', () => {
  it('physically moves loser visit dirs into the keeper directory', async () => {
    await addPatient('keep', 'John', 'Smith', '1950-01-15');
    await addPatient('lose', 'John', 'Smith', '1950-01-15');
    await addReport('rk1', 'keep', '2024-01-01', 'SN-1');
    await addReport('rl1', 'lose', '2024-03-01', 'SN-2');
    await addReport('rl2', 'lose', '2024-04-01', 'SN-2');

    const keepDir = 'keep_Smith_John';
    const loseDir = 'lose_Smith_John';
    layPatientXml(keepDir);
    layPatientXml(loseDir);
    layVisit(keepDir, '2024_01_01', 'rk1');
    layVisit(loseDir, '2024_03_01', 'rl1');
    layVisit(loseDir, '2024_04_01', 'rl2');

    const result = await mergePatients('keep', ['lose']);

    expect(result.errors).toHaveLength(0);
    expect((await getReportIdsForPatient('keep')).sort()).toEqual(['rk1', 'rl1', 'rl2']);
    expect((await getAllPatients({})).map((p: any) => p.id)).toEqual(['keep']);

    const keeperVisits = fs.readdirSync(path.join(reportsDir, keepDir)).filter(e => e !== 'patient.xml');
    expect(keeperVisits.sort()).toEqual(['2024_01_01_rk1', '2024_03_01_rl1', '2024_04_01_rl2']);
    expect(fs.existsSync(path.join(reportsDir, keepDir, '2024_03_01_rl1', 'rl1.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(reportsDir, keepDir, '2024_04_01_rl2', 'rl2.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(reportsDir, loseDir))).toBe(false);
  });

  // Regression: moveReport used to rebuild the keeper dir name from the current
  // DB record, so when the on-disk name had drifted (e.g. the first name was
  // filled in after the folder was created) it spawned a SECOND keeper dir and
  // split the moved visits across the two — leaving them out of the keeper the
  // app actually reads (found by ID prefix).
  it('reuses the keeper dir even when its on-disk name differs from the DB name', async () => {
    await addPatient('keep', 'John', 'Smith', '1950-01-15');
    await addPatient('lose', 'John', 'Smith', '1950-01-15');
    await addReport('rk1', 'keep', '2024-01-01', 'SN-1');
    await addReport('rl1', 'lose', '2024-03-01', 'SN-2');
    await addReport('rl2', 'lose', '2024-04-01', 'SN-2');

    // On-disk keeper dir predates the first name being known.
    const keepDir = 'keep_Smith_';
    const loseDir = 'lose_Smith_John';
    layPatientXml(keepDir);
    layPatientXml(loseDir);
    layVisit(keepDir, '2024_01_01', 'rk1');
    layVisit(loseDir, '2024_03_01', 'rl1');
    layVisit(loseDir, '2024_04_01', 'rl2');

    const result = await mergePatients('keep', ['lose']);

    expect(result.errors).toHaveLength(0);
    expect((await getReportIdsForPatient('keep')).sort()).toEqual(['rk1', 'rl1', 'rl2']);
    expect((await getAllPatients({})).map((p: any) => p.id)).toEqual(['keep']);

    // Exactly one keeper directory, and it holds all three visits.
    const keeperDirs = fs.readdirSync(reportsDir).filter(d => d.startsWith('keep'));
    expect(keeperDirs).toHaveLength(1);
    const keeperVisits = fs.readdirSync(path.join(reportsDir, keeperDirs[0])).filter(e => e !== 'patient.xml');
    expect(keeperVisits.sort()).toEqual(['2024_01_01_rk1', '2024_03_01_rl1', '2024_04_01_rl2']);
    expect(fs.existsSync(path.join(reportsDir, keeperDirs[0], '2024_03_01_rl1', 'rl1.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(reportsDir, keeperDirs[0], '2024_04_01_rl2', 'rl2.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(reportsDir, loseDir))).toBe(false);
  });
});

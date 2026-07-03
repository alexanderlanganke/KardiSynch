import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/kardisynch_test_orphan' },
}));

import {
  initializeDatabase,
  closeDatabase,
  setSettings,
  createPatient,
  createReport,
  getReportById,
} from '../main/database';
import { findOrphanedVisits, moveOrphanedVisits } from '../main/services/orphanService';

const testDataPath = path.join(__dirname, 'test_data_orphan');
const reportsDir = path.join(testDataPath, 'Reports');

const addPatient = (id: string, first: string, last: string, dob: string) =>
  createPatient({ id, first_name: first, last_name: last, dob, hospitalPatientId: null });

const addReport = (id: string, patientId: string, date: string) =>
  createReport({
    id,
    patient_id: patientId,
    manufacturer: 'Medtronic',
    interrogation_date: date,
    device: { serial_number: `SN-${id}`, model: 'Azure', type: 'Pacemaker' },
  } as any);

// Lay a visit dir on disk the way storeFile does, in the given patient folder.
const layVisit = (patientDirName: string, date: string, reportId: string) => {
  const visitDir = path.join(reportsDir, patientDirName, `${date}_${reportId}`);
  fs.mkdirSync(visitDir, { recursive: true });
  fs.writeFileSync(path.join(visitDir, `${reportId}.pdf`), 'PDF');
  fs.writeFileSync(path.join(visitDir, 'visit.xml'), `<?xml version="1.0"?><visit><report_id>${reportId}</report_id></visit>`);
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

describe('findOrphanedVisits', () => {
  it('flags visits sitting under the wrong patient folder and ignores correct ones', async () => {
    await addPatient('pa', 'Alice', 'Anderson', '1950-01-01');
    await addPatient('pb', 'Bob', 'Baker', '1960-02-02');
    await addReport('r-a', 'pa', '2024-01-01');   // belongs to A
    await addReport('r-b', 'pb', '2024-02-02');   // belongs to B, but stored under A

    layVisit('pa_Anderson_Alice', '2024_01_01', 'r-a'); // correctly placed
    layVisit('pa_Anderson_Alice', '2024_02_02', 'r-b'); // MISPLACED — under A, belongs to B
    fs.mkdirSync(path.join(reportsDir, 'pb_Baker_Bob'), { recursive: true });

    const orphans = await findOrphanedVisits();
    expect(orphans).toHaveLength(1);
    expect(orphans[0].reportId).toBe('r-b');
    expect(orphans[0].currentPatientId).toBe('pa');
    expect(orphans[0].correctPatientId).toBe('pb');
    expect(orphans[0].correctPatientLabel).toBe('Bob Baker');
    expect(orphans[0].correctPatientDirExists).toBe(true);
  });

  it('returns nothing when all visits are correctly placed', async () => {
    await addPatient('pa', 'Alice', 'Anderson', '1950-01-01');
    await addReport('r-a', 'pa', '2024-01-01');
    layVisit('pa_Anderson_Alice', '2024_01_01', 'r-a');

    expect(await findOrphanedVisits()).toHaveLength(0);
  });

  it('ignores visit dirs whose report has no DB row', async () => {
    await addPatient('pa', 'Alice', 'Anderson', '1950-01-01');
    layVisit('pa_Anderson_Alice', '2024_09_09', 'r-ghost'); // no report row

    expect(await findOrphanedVisits()).toHaveLength(0);
  });
});

describe('moveOrphanedVisits', () => {
  it('physically moves the misplaced visit into the correct patient folder', async () => {
    await addPatient('pa', 'Alice', 'Anderson', '1950-01-01');
    await addPatient('pb', 'Bob', 'Baker', '1960-02-02');
    await addReport('r-b', 'pb', '2024-02-02');

    layVisit('pa_Anderson_Alice', '2024_02_02', 'r-b'); // under A, belongs to B
    fs.mkdirSync(path.join(reportsDir, 'pb_Baker_Bob'), { recursive: true });

    const res = await moveOrphanedVisits(['r-b']);
    expect(res.errors).toHaveLength(0);
    expect(res.moved).toBe(1);

    // Gone from A, present under B, with its file.
    expect(fs.existsSync(path.join(reportsDir, 'pa_Anderson_Alice', '2024_02_02_r-b'))).toBe(false);
    expect(fs.existsSync(path.join(reportsDir, 'pb_Baker_Bob', '2024_02_02_r-b', 'r-b.pdf'))).toBe(true);

    // No orphans remain.
    expect(await findOrphanedVisits()).toHaveLength(0);
  });

  it('creates the destination patient folder when it does not exist yet', async () => {
    await addPatient('pa', 'Alice', 'Anderson', '1950-01-01');
    await addPatient('pb', 'Bob', 'Baker', '1960-02-02');
    await addReport('r-b', 'pb', '2024-02-02');

    layVisit('pa_Anderson_Alice', '2024_02_02', 'r-b'); // B has no folder on disk at all

    const orphans = await findOrphanedVisits();
    expect(orphans[0].correctPatientDirExists).toBe(false);

    const res = await moveOrphanedVisits(['r-b']);
    expect(res.moved).toBe(1);

    const bDir = fs.readdirSync(reportsDir).find(d => d.startsWith('pb'));
    expect(bDir).toBeTruthy();
    expect(fs.existsSync(path.join(reportsDir, bDir!, '2024_02_02_r-b', 'r-b.pdf'))).toBe(true);
    expect(String((await getReportById('r-b')).patient_id)).toBe('pb');
  });
});

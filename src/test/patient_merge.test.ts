import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';

// Mock electron (database.ts imports `app`)
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/kardisynch_test_merge' },
}));

// Avoid filesystem work: moveReport just re-points the DB row; profile/dir
// helpers and the post-merge report dedup are no-ops here.
vi.mock('../main/storage', () => ({
  moveReport: async (reportId: string, _oldId: string, newId: string) => {
    const db = await import('../main/database');
    await db.updateReportPatient(reportId, newId);
  },
  mergePatientProfiles: async () => {},
  removePatientDirectory: async () => true,
}));
vi.mock('../main/services/dedupService', () => ({
  runDedupCleanup: async () => ({ groupsFound: 0, reportsRemoved: 0, directoriesRemoved: 0 }),
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
import { findDuplicatePatientGroups, mergePatients } from '../main/services/patientMergeService';

const testDataPath = path.join(__dirname, 'test_data_merge');

const addPatient = async (id: string, first: string, last: string, dob: string, hospitalPatientId: string | null = null) =>
  createPatient({ id, first_name: first, last_name: last, dob, hospitalPatientId });

const addReport = async (id: string, patientId: string, date: string, serial: string | null) =>
  createReport({
    id,
    patient_id: patientId,
    manufacturer: 'Medtronic',
    interrogation_date: date,
    device: serial ? { serial_number: serial, model: 'Azure', type: 'Pacemaker' } : undefined,
  } as any);

beforeEach(async () => {
  if (fs.existsSync(testDataPath)) fs.rmSync(testDataPath, { recursive: true, force: true });
  fs.mkdirSync(testDataPath, { recursive: true });
  await initializeDatabase(':memory:');
  await setSettings({ dataPath: testDataPath });
});

afterEach(async () => {
  await closeDatabase();
  if (fs.existsSync(testDataPath)) fs.rmSync(testDataPath, { recursive: true, force: true });
});

describe('findDuplicatePatientGroups', () => {
  it('tiers exact / serial / fuzzy-name matches and ignores unrelated patients', async () => {
    // Exact: same surname + DOB
    await addPatient('a1', 'John', 'Anderson', '1950-01-01');
    await addPatient('a2', 'J', 'Anderson', '1950-01-01');

    // Shared device serial across two otherwise-distinct patients
    await addPatient('b1', 'Bob', 'Baker', '1960-06-06');
    await addPatient('c1', 'Carl', 'Clark', '1970-07-07');
    await addReport('r-b1', 'b1', '2024-01-10', 'SN-SHARED');
    await addReport('r-c1', 'c1', '2024-02-20', 'SN-SHARED');

    // Same DOB, one-character surname difference
    await addPatient('d1', 'Dan', 'Johnson', '1980-05-05');
    await addPatient('d2', 'Dana', 'Johnsen', '1980-05-05');

    // Unrelated
    await addPatient('z1', 'Zoe', 'Zimmer', '1990-09-09');

    const groups = await findDuplicatePatientGroups();
    const byTier = (t: string) => groups.filter(g => g.tier === t);

    expect(byTier('exact')).toHaveLength(1);
    expect(new Set(byTier('exact')[0].patients.map(p => p.id))).toEqual(new Set(['a1', 'a2']));

    expect(byTier('serial')).toHaveLength(1);
    expect(new Set(byTier('serial')[0].patients.map(p => p.id))).toEqual(new Set(['b1', 'c1']));

    expect(byTier('dob-fuzzy-name')).toHaveLength(1);
    expect(new Set(byTier('dob-fuzzy-name')[0].patients.map(p => p.id))).toEqual(new Set(['d1', 'd2']));

    // Zimmer appears in no group
    expect(groups.some(g => g.patients.some(p => p.id === 'z1'))).toBe(false);
  });

  it('unions transitively related patients into one group', async () => {
    // Three records, same surname + DOB — all mutually exact.
    await addPatient('t1', 'A', 'Meyer', '2000-01-01');
    await addPatient('t2', 'B', 'Meyer', '2000-01-01');
    await addPatient('t3', 'C', 'Meyer', '2000-01-01');

    const groups = await findDuplicatePatientGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].patients).toHaveLength(3);
  });
});

describe('mergePatients', () => {
  it('moves all visits to the keeper and deletes the loser', async () => {
    await addPatient('keep', 'John', 'Smith', '1950-01-15');
    await addPatient('lose', 'John', 'Smith', '1950-01-15');
    await addReport('rk1', 'keep', '2024-01-01', 'SN-1');
    await addReport('rl1', 'lose', '2024-03-01', 'SN-2');
    await addReport('rl2', 'lose', '2024-04-01', 'SN-2');

    const result = await mergePatients('keep', ['lose']);

    expect(result.reportsMoved).toBe(2);
    expect(result.patientsDeleted).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Keeper now owns all three reports; loser is gone.
    expect((await getReportIdsForPatient('keep')).sort()).toEqual(['rk1', 'rl1', 'rl2']);
    const patients = await getAllPatients({});
    expect(patients.map(p => p.id)).toEqual(['keep']);
  });

  it('rejects merging a patient into itself', async () => {
    await addPatient('solo', 'Jane', 'Doe', '1970-02-02');
    await expect(mergePatients('solo', ['solo'])).rejects.toThrow();
  });
});

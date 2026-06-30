import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { initializeDatabase, closeDatabase, setSettings, findOrCreatePatient, findPatient, getAllPatients } from '../main/database';

// Mock electron (database.ts imports `app`)
vi.mock('electron', () => ({
    app: {
        getPath: () => '/tmp/kardisynch_test_data'
    }
}));

describe('Patient dedup (issue #139: double patients)', () => {
    const testDataPath = path.join(__dirname, 'test_data_dedup');

    beforeEach(async () => {
        if (fs.existsSync(testDataPath)) fs.rmSync(testDataPath, { recursive: true, force: true });
        fs.mkdirSync(testDataPath);
        await initializeDatabase(':memory:');
        // Awaiting a DB write flushes the async CREATE TABLE statements.
        await setSettings({ dataPath: testDataPath });
    });

    afterEach(async () => {
        await closeDatabase();
        if (fs.existsSync(testDataPath)) fs.rmSync(testDataPath, { recursive: true, force: true });
    });

    const base = { first_name: 'John', last_name: 'Smith', dob: '1950-01-15', hospitalPatientId: null };

    it('creates a patient on first call', async () => {
        const { patient, created } = await findOrCreatePatient(base);
        expect(created).toBe(true);
        expect(patient.id).toBeDefined();
        expect(patient.last_name).toBe('Smith');
    });

    it('reuses the existing patient for identical name + DOB (no duplicate)', async () => {
        const first = await findOrCreatePatient(base);
        const second = await findOrCreatePatient({ ...base });
        expect(second.created).toBe(false);
        expect(second.patient.id).toBe(first.patient.id);
        expect((await getAllPatients({})).length).toBe(1);
    });

    it('reuses across case + whitespace variants (auto-import vs sorting dialogue)', async () => {
        const first = await findOrCreatePatient(base);
        const variant = await findOrCreatePatient({ ...base, last_name: '  smith ' });
        expect(variant.created).toBe(false);
        expect(variant.patient.id).toBe(first.patient.id);
        expect((await getAllPatients({})).length).toBe(1);
    });

    it('creates a distinct patient when the DOB differs', async () => {
        await findOrCreatePatient(base);
        const other = await findOrCreatePatient({ ...base, dob: '1960-02-20' });
        expect(other.created).toBe(true);
        expect((await getAllPatients({})).length).toBe(2);
    });

    it('findPatient matches case/whitespace-insensitively', async () => {
        await findOrCreatePatient(base);
        const match = await findPatient('SMITH ', '1950-01-15');
        expect(match).toBeTruthy();
        expect(match.last_name).toBe('Smith');
    });

    it('does not duplicate under concurrent find-or-create for the same person', async () => {
        const results = await Promise.all([
            findOrCreatePatient(base),
            findOrCreatePatient({ ...base, last_name: 'smith' }),
            findOrCreatePatient({ ...base, first_name: 'Jon' })
        ]);
        const ids = new Set(results.map(r => r.patient.id));
        expect(ids.size).toBe(1);
        expect((await getAllPatients({})).length).toBe(1);
    });
});

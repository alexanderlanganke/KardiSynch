import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { initializeDatabase, closeDatabase, setSettings } from '../main/database';
import { storeFile, initializeStorage } from '../main/storage';
import { reparseEverything } from '../main/watcher';
import { UnifiedReport } from '../main/reports';

vi.mock('electron', () => ({
    app: {
        getPath: () => '/tmp/kardisynch_test_data'
    }
}));

describe('reparseEverything', () => {
    const testDbPath = ':memory:';
    const testDataPath = path.join(__dirname, 'test_data_reparse');

    beforeEach(async () => {
        if (fs.existsSync(testDataPath)) fs.rmSync(testDataPath, { recursive: true, force: true });
        fs.mkdirSync(testDataPath);
        await initializeDatabase(testDbPath);
        await setSettings({ dataPath: testDataPath });
        await initializeStorage();
    });

    afterEach(async () => {
        await closeDatabase();
        if (fs.existsSync(testDataPath)) fs.rmSync(testDataPath, { recursive: true, force: true });
    });

    const mockReport: UnifiedReport = {
        manufacturer: 'Medtronic',
        interrogation_date: '2023-01-01',
        patient: { first_name: 'Test', last_name: 'Patient', dob: '1980-01-01' },
        device: { model: 'ModelX', serial_number: '12345', type: 'ICD' },
        battery: { voltage: { value: '3.0', unit: 'V' } },
        leads: [],
        raw_text: 'raw data'
    };

    // A real Abbott concatenated-coded-log fixture — reparseEverything
    // re-parses the ORIGINAL source file on disk (not the stored mockReport),
    // so it needs content the parser dispatcher actually recognizes; an
    // arbitrary .xml stub parses to null and would always land in "empty".
    const abbottLogContent = [
        '2430Patient Name Doe, John',
        '2431Patient Date of Birth 01/15/1950',
        '204Patient ID 12345',
        '200Device Model Name Fortify Assura CD',
        '202Device Serial Number 987654',
        '105Session Timestamp 11/06/2025 10:15:00',
        '519Unloaded Battery Voltage 3.008V',
        '301Mode DDDR',
        '2440Ejection Fraction 35%',
        '2441Indications for Implant: List Primary Prevention',
    ].join('\n');

    it('walks every visit directory on disk and reports start/progress/complete callbacks', async () => {
        const sourceFile = path.join(testDataPath, 'source.log');
        fs.writeFileSync(sourceFile, abbottLogContent);
        await storeFile(sourceFile, 'report-1', 'patient-1', 'Patient', '2023-01-01', { id: 'patient-1', ...mockReport.patient }, mockReport);

        const events: any[] = [];
        const result = await reparseEverything((status) => events.push(status));

        expect(result.visitsTotal).toBe(1);
        expect(result.visitsSucceeded).toBe(1);
        expect(events[0].type).toBe('start');
        expect(events[events.length - 1].type).toBe('complete');
        expect(events.some(e => e.type === 'progress')).toBe(true);
    });

    it('counts a visit with no parseable source file as empty rather than failing the whole run', async () => {
        // A visit directory that only has metadata (no original source file left
        // on disk, e.g. an older export whose raw file was later deleted).
        const emptyVisitDir = path.join(testDataPath, 'Reports', 'patient-2_Patient', '2023_02_01_report-2');
        fs.mkdirSync(emptyVisitDir, { recursive: true });
        fs.writeFileSync(path.join(emptyVisitDir, 'visit.xml'), '<?xml version="1.0"?><visit><report_id>report-2</report_id></visit>');

        const result = await reparseEverything();

        expect(result.visitsTotal).toBe(1);
        expect(result.visitsEmpty).toBe(1);
        expect(result.visitsSucceeded).toBe(0);
        expect(result.visitsFailed).toBe(0);
    });

    it('processes visits across multiple patients and keeps going after a per-visit failure', async () => {
        const source1 = path.join(testDataPath, 'source1.log');
        fs.writeFileSync(source1, abbottLogContent);
        await storeFile(source1, 'report-a', 'patient-a', 'PatientA', '2023-01-01', { id: 'patient-a', ...mockReport.patient }, mockReport);

        const source2 = path.join(testDataPath, 'source2.log');
        fs.writeFileSync(source2, abbottLogContent);
        await storeFile(source2, 'report-b', 'patient-b', 'PatientB', '2023-02-01', { id: 'patient-b', ...mockReport.patient }, mockReport);

        // A visit directory with no metadata/source at all — readdir on it still
        // succeeds (it's a real, empty directory), so aggregateVisitFiles simply
        // finds nothing parseable there too.
        const brokenVisitDir = path.join(testDataPath, 'Reports', 'patient-c_PatientC', '2023_03_01_report-c');
        fs.mkdirSync(brokenVisitDir, { recursive: true });

        const result = await reparseEverything();

        expect(result.visitsTotal).toBe(3);
        expect(result.visitsSucceeded).toBe(2);
        expect(result.visitsEmpty).toBe(1);
    });

    it('returns all-zero counts when there is no data directory yet', async () => {
        fs.rmSync(testDataPath, { recursive: true, force: true });
        fs.mkdirSync(testDataPath);

        const result = await reparseEverything();
        expect(result).toEqual({ visitsTotal: 0, visitsSucceeded: 0, visitsEmpty: 0, visitsFailed: 0, failures: [] });
    });
});

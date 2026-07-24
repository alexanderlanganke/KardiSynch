
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { initializeDatabase, closeDatabase, setSettings } from '../main/database';
import { storeReport, storeFile, initializeStorage } from '../main/storage';
import { UnifiedReport } from '../main/reports';

// Mock electron
vi.mock('electron', () => ({
    app: {
        getPath: () => '/tmp/kardisynch_test_data'
    }
}));

describe('File Management', () => {
    const testDbPath = ':memory:';
    const testDataPath = path.join(__dirname, 'test_data');

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

    it('should store a report and create patient/visit records', async () => {
        const mockReport: UnifiedReport = {
            manufacturer: 'TestMaker',
            interrogation_date: '2023-01-01',
            patient: { first_name: 'Test', last_name: 'Patient', dob: '1980-01-01' },
            device: { model: 'ModelX', serial_number: '12345', type: 'ICD' },
            battery: { voltage: { value: '3.0', unit: 'V' }, status: 'Good', remaining_longevity: { value: '5', unit: 'years' } },
            leads: [],
            raw_text: 'raw data'
        };

        const result = await storeReport(mockReport);

        expect(result.reportId).toBeDefined();
        expect(result.patient.id).toBeDefined();
        expect(result.patient.first_name).toBe('Test');
    });

    it('should store a file correctly', async () => {
        const mockReport: UnifiedReport = {
            manufacturer: 'TestMaker',
            interrogation_date: '2023-01-01',
            patient: { first_name: 'Test', last_name: 'Patient', dob: '1980-01-01' },
            device: { model: 'ModelX', serial_number: '12345', type: 'ICD' },
            battery: { voltage: { value: '3.0', unit: 'V' }, status: 'Good', remaining_longevity: { value: '5', unit: 'years' } },
            leads: [],
            raw_text: 'raw data'
        };

        // Create dummy source file
        const sourceFile = path.join(testDataPath, 'source.xml');
        fs.writeFileSync(sourceFile, 'content');

        const reportId = 'test-report-id';
        const patientId = 'test-patient-id';

        await storeFile(sourceFile, reportId, patientId, 'Patient', '2023-01-01', { id: patientId, ...mockReport.patient }, mockReport);

        // Verify file existence in expected path
        // Path logic: _DATA/Reports/PatientId_Name/YYYY_MM_DD_reportId/filename
        const expectedDir = path.join(testDataPath, 'Reports', `${patientId}_Patient`, '2023_01_01_test-report-id');
        const expectedFile = path.join(expectedDir, 'source.xml');

        expect(fs.existsSync(expectedFile)).toBe(true);
    });

    it('adds a lead to the patient device/lead list even without a serial number (#152)', async () => {
        // Some real Abbott coded logs report a lead's model/manufacturer/
        // measurements but not its serial number (an older code revision
        // missing that field) — requiring a serial silently dropped such
        // leads from the patient's device list entirely.
        const mockReport: UnifiedReport = {
            manufacturer: 'Abbott',
            interrogation_date: '2023-01-01',
            patient: { first_name: 'Test', last_name: 'Patient', dob: '1980-01-01' },
            device: { model: 'Entrant DR', serial_number: 'DEV12345', type: 'Pacemaker' },
            battery: {},
            leads: [
                { name: 'RV', model: '2088TC Tendril STS', manufacturer: 'St. Jude Medical', impedance: { value: 500, unit: 'Ohm' } },
            ],
            raw_text: 'raw data'
        };

        const sourceFile = path.join(testDataPath, 'source_no_serial.log');
        fs.writeFileSync(sourceFile, 'content');

        const reportId = 'test-report-id-2';
        const patientId = 'test-patient-id-2';

        await storeFile(sourceFile, reportId, patientId, 'Patient', '2023-01-01', { id: patientId, ...mockReport.patient }, mockReport);

        const patientXmlPath = path.join(testDataPath, 'Reports', `${patientId}_Patient`, 'patient.xml');
        const xmlContent = fs.readFileSync(patientXmlPath, 'utf-8');

        expect(xmlContent).toContain('<leads>');
        expect(xmlContent).toContain('2088TC Tendril STS');
        expect(xmlContent).toContain('St. Jude Medical');
    });
});


import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { initializeDatabase, closeDatabase, setSettings } from '../main/database';
import { storeReport, storeFile, initializeStorage } from '../main/storage';
import { UnifiedReport } from '../main/reports';
import { parseFile } from '../main/parser';

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

    it('adds a device to the patient device list even without a serial number', async () => {
        // Same gap as the lead fix above, but for the device itself: a
        // parser can resolve model/manufacturer without a serial (e.g. a
        // header/regex miss) — requiring one used to drop the device
        // entirely instead of recording it and refreshing by
        // (manufacturer, model) on a later, better-identified import.
        const mockReport: UnifiedReport = {
            manufacturer: 'Medtronic',
            interrogation_date: '2023-01-01',
            patient: { first_name: 'Test', last_name: 'Patient', dob: '1980-01-01' },
            device: { model: 'Astra S DR MRI', serial_number: '', type: 'Pacemaker' },
            battery: {},
            leads: [],
            raw_text: 'raw data'
        };

        const sourceFile = path.join(testDataPath, 'source_no_device_serial.pdd');
        fs.writeFileSync(sourceFile, 'content');

        const reportId = 'test-report-id-3';
        const patientId = 'test-patient-id-3';

        await storeFile(sourceFile, reportId, patientId, 'Patient', '2023-01-01', { id: patientId, ...mockReport.patient }, mockReport);

        const patientXmlPath = path.join(testDataPath, 'Reports', `${patientId}_Patient`, 'patient.xml');
        const xmlContent = fs.readFileSync(patientXmlPath, 'utf-8');

        expect(xmlContent).toContain('<devices>');
        expect(xmlContent).toContain('Astra S DR MRI');
    });

    it('persists additional_fields to visit.xml and round-trips them back via parseFile', async () => {
        const mockReport: UnifiedReport = {
            manufacturer: 'Abbott',
            interrogation_date: '2023-01-01',
            patient: { first_name: 'Test', last_name: 'Patient', dob: '1980-01-01' },
            device: { model: 'Entrant DR', serial_number: 'DEV12345', type: 'Pacemaker' },
            battery: {},
            leads: [],
            raw_text: 'raw data',
            additional_fields: { ejection_fraction: '35%', indications_for_implant: 'AV Block' }
        };

        const sourceFile = path.join(testDataPath, 'source_additional_fields.log');
        fs.writeFileSync(sourceFile, 'content');

        const reportId = 'test-report-id-4';
        const patientId = 'test-patient-id-4';

        await storeFile(sourceFile, reportId, patientId, 'Patient', '2023-01-01', { id: patientId, ...mockReport.patient }, mockReport);

        const visitXmlPath = path.join(testDataPath, 'Reports', `${patientId}_Patient`, '2023_01_01_test-report-id-4', 'visit.xml');
        const xmlContent = fs.readFileSync(visitXmlPath, 'utf-8');
        expect(xmlContent).toContain('<additional_fields>');
        expect(xmlContent).toContain('35%');
        expect(xmlContent).toContain('AV Block');

        const roundTripped = await parseFile(visitXmlPath);
        expect(roundTripped?.additional_fields?.ejection_fraction).toBe('35%');
        expect(roundTripped?.additional_fields?.indications_for_implant).toBe('AV Block');
    });

    it('merges additional_fields from a second file imported into the same visit instead of overwriting', async () => {
        const patientId = 'test-patient-id-5';
        const reportId = 'test-report-id-5';
        const patient = { id: patientId, first_name: 'Test', last_name: 'Patient', dob: '1980-01-01' };

        const firstReport: UnifiedReport = {
            manufacturer: 'Boston Scientific',
            interrogation_date: '2023-01-01',
            patient: { first_name: 'Test', last_name: 'Patient', dob: '1980-01-01' },
            device: { model: 'D321-200-0', serial_number: 'DEV1', type: 'Pacemaker' },
            battery: {},
            leads: [],
            raw_text: 'raw data 1',
            additional_fields: { ejection_fraction: '40%' }
        };
        const secondReport: UnifiedReport = {
            ...firstReport,
            raw_text: 'raw data 2',
            additional_fields: { nyha_class: 'II' }
        };

        const firstSource = path.join(testDataPath, 'source_1.bnk');
        fs.writeFileSync(firstSource, 'content1');
        await storeFile(firstSource, reportId, patientId, 'Patient', '2023-01-01', patient, firstReport);

        const secondSource = path.join(testDataPath, 'source_2.bnk');
        fs.writeFileSync(secondSource, 'content2');
        await storeFile(secondSource, reportId, patientId, 'Patient', '2023-01-01', patient, secondReport);

        const visitXmlPath = path.join(testDataPath, 'Reports', `${patientId}_Patient`, '2023_01_01_test-report-id-5', 'visit.xml');
        const roundTripped = await parseFile(visitXmlPath);
        expect(roundTripped?.additional_fields?.ejection_fraction).toBe('40%');
        expect(roundTripped?.additional_fields?.nyha_class).toBe('II');
    });

    it('preserves battery/device data from the first file when a second same-day file merged into the same visit lacks it (#155)', async () => {
        // Two same-day files (e.g. a device XML export plus a supplementary
        // PDF) can be matched into the same visit by pickSameDayReport. The
        // second file storeFile() is called with often won't carry battery or
        // device-identity data of its own — that must not silently overwrite
        // what the first file already established.
        const patientId = 'test-patient-id-6';
        const reportId = 'test-report-id-6';
        const patient = { id: patientId, first_name: 'Test', last_name: 'Patient', dob: '1980-01-01' };

        const firstReport: UnifiedReport = {
            manufacturer: 'Medtronic',
            interrogation_date: '2023-01-01',
            patient: { first_name: 'Test', last_name: 'Patient', dob: '1980-01-01' },
            device: { model: 'Astra S DR MRI', serial_number: 'DEV999', type: 'Pacemaker' },
            battery: { voltage: { value: 2.95, unit: 'V' }, status: 'OK' },
            leads: [],
            raw_text: 'raw data 1'
        };
        // A second, weaker parse of a supplementary file for the same visit —
        // no battery data, and device fields fell back to 'Unknown'.
        const secondReport: UnifiedReport = {
            manufacturer: 'Unknown',
            interrogation_date: '2023-01-01',
            patient: { first_name: 'Test', last_name: 'Patient', dob: '1980-01-01' },
            device: { model: 'Unknown', serial_number: 'Unknown', type: 'Unknown' },
            battery: {},
            leads: [],
            raw_text: 'raw data 2'
        };

        const firstSource = path.join(testDataPath, 'source_a.xml');
        fs.writeFileSync(firstSource, 'content-a');
        await storeFile(firstSource, reportId, patientId, 'Patient', '2023-01-01', patient, firstReport);

        const secondSource = path.join(testDataPath, 'source_b.pdf');
        fs.writeFileSync(secondSource, 'content-b');
        await storeFile(secondSource, reportId, patientId, 'Patient', '2023-01-01', patient, secondReport);

        const visitXmlPath = path.join(testDataPath, 'Reports', `${patientId}_Patient`, '2023_01_01_test-report-id-6', 'visit.xml');
        const roundTripped = await parseFile(visitXmlPath);
        expect(roundTripped?.battery?.voltage?.value).toBe(2.95);
        expect(roundTripped?.battery?.status).toBe('OK');
        expect(roundTripped?.device?.model).toBe('Astra S DR MRI');
        expect(roundTripped?.device?.serial_number).toBe('DEV999');
        expect(roundTripped?.manufacturer).toBe('Medtronic');
    });
});

import { describe, it, expect } from 'vitest';
import { parseMicroportXML } from '../main/parsers/microport-parser';
import fs from 'fs';
import path from 'path';

describe('Microport Parser', () => {
    it('should parse valid Microport XML', async () => {
        const filePath = path.join(process.cwd(), 'src/test/fixtures/microport/sample.xml');
        if (!fs.existsSync(filePath)) {
            console.warn('Skipping Microport test: sample file not found');
            return;
        }

        const xmlContent = fs.readFileSync(filePath, 'utf-8');
        const report = await parseMicroportXML(xmlContent);

        expect(report).not.toBeNull();
        if (!report) return;

        expect(report.manufacturer).toBeTruthy();
        expect(report.patient.last_name).toBeTruthy();
        expect(report.patient.first_name).toBeTruthy();
        expect(report.patient.dob).toBeTruthy();
        expect(report.device.serial_number).toBeTruthy();
        expect(report.device.model).toBeTruthy();
        expect(report.interrogation_date).toBeTruthy();

        expect(report.leads).toBeDefined();
        expect(report.leads?.length).toBeGreaterThan(0);

        const raLead = report.leads?.find(l => l.name === 'RA');
        expect(raLead).toBeDefined();
        expect(raLead?.model).toBeTruthy();
        expect(raLead?.serial).toBeTruthy();
        if (raLead?.sensing) {
            expect(raLead.sensing.value).toBeGreaterThan(0);
        }
        if (raLead?.impedance) {
            expect(raLead.impedance.value).toBeGreaterThan(0);
        }
    });
});

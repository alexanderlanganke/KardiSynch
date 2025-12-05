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

        expect(report.manufacturer).toBe('ELA Medical');
        expect(report.patient.last_name).toBe('Speck-Rossel');
        expect(report.patient.first_name).toBe('Eleonore');
        expect(report.patient.dob).toBe('1950-10-27');
        expect(report.device.serial_number).toBe('111CS21E');
        expect(report.device.model).toBe('TEO DR');
        expect(report.interrogation_date).toContain('2025-09-11');

        expect(report.leads).toBeDefined();
        expect(report.leads?.length).toBe(2);

        const raLead = report.leads?.find(l => l.name === 'RA');
        expect(raLead).toBeDefined();
        expect(raLead?.model).toBe('VeGa R52');
        expect(raLead?.serial).toBe('52DRG38527');
        // Check measurements if implemented
        // <Sensing Chamber="RA" ... Amplitude_millivolts="0.40" ...>
        // <Pacing Chamber="RA" ... Amplitude_volts="2.00" ...>
        // <Lead Chamber="RA" BipolarImpedance_ohms="607.26"/>
        // My parser maps:
        // sensing -> from Thresholds.Sensing (1.25mV) or Telemetry?
        // The parser uses findLeadMeasure which checks Thresholds first.
        // In XML: <Sensing Chamber="RA" UseForGraphing="1" Amplitude_millivolts="1.25" Polarity="Bipolar"/>
        expect(raLead?.sensing?.value).toBe(1.25);
        expect(raLead?.impedance?.value).toBe(607.26);
    });
});

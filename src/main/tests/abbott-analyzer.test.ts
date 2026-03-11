import { describe, it, expect } from 'vitest';
import { analyzeAbbottLog, AbbottAnalysis } from '../parsers/abbott-analyzer';

/**
 * Synthetic Abbott plain-text log. Uses ONLY fictional data -- no real patient information.
 */
const MOCK_PLAINTEXT_LOG = [
    'DEVICE INFORMATION',
    '==================',
    '',
    'Model Number:  PM3456',
    'Serial Number  XYZ12345',
    'Device Type    CRT-D',
    '',
    'PATIENT INFORMATION',
    '-------------------',
    '',
    'Patient Name    Testpatient, Fictional',
    'Date of Birth:  03/15/1955',
    '',
    'SESSION SUMMARY',
    '',
    'Session Timestamp  01/20/2025 14:30:00',
    '',
    'BATTERY STATUS',
    '',
    'Unloaded Battery Voltage  2.81 V',
    'Battery Current   18.5 mA',
    'Estimated Longevity   4.2 years',
    '',
    'LEAD MEASUREMENTS',
    '',
    'Atrial Lead Serial Number  ATR98765',
    'RV Lead Serial Number  RV54321',
    'LV Lead Serial Number  LV11111',
    'RV Pacing Lead Impedance  485 Ohm',
    'Atrial Signal Amplitude  2.1 mV',
    'Ventricular Signal Amplitude  8.5 mV',
    'LV Pacing Impedance  620 Ohm',
    'Atrial Pacing Threshold  0.75 V',
    'RV Pacing Threshold  0.50 V',
    '',
    'EPISODE SUMMARY',
    '',
    'AT/AF Burden  12 %',
    'VT Episode Count  3',
    'Shock Therapy Delivered  1',
    '',
    'PROGRAMMED PARAMETERS',
    '',
    'Lower Rate  60 bpm',
    'Upper Sensor Rate  130 bpm',
    'Mode  DDDR',
    'AV Interval  180 ms',
].join('\n');

/**
 * A minimal log that matches only a few parser patterns.
 */
const MINIMAL_LOG = [
    'Model Number: SomeDevice',
    'Serial Number  ABC999',
].join('\n');

/**
 * A log with NO matching patterns at all.
 */
const EMPTY_LOG = [
    'Some random content here',
    'Nothing that matches any pattern',
].join('\n');

function bufferFrom(text: string): Buffer {
    return Buffer.from(text, 'utf-8');
}

describe('Abbott Log Analyzer', () => {

    describe('format detection', () => {
        it('should detect plaintext format for a text buffer', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            expect(result.format).toBe('plaintext');
        });

        it('should detect non-zip binary as plaintext or unknown', () => {
            // A buffer that starts with non-PK bytes but has some printable chars
            const buf = Buffer.from('Hello this is text', 'utf-8');
            const result = analyzeAbbottLog(buf);
            expect(result.format).toBe('plaintext');
        });

        it('should NOT detect a plain text buffer as docx', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            expect(result.format).not.toBe('docx');
            expect(result.docxStructure).toBeUndefined();
        });

        it('should detect a buffer starting with PK header as docx attempt', () => {
            // PK\x03\x04 is ZIP magic bytes -- this is not a valid ZIP, but format detection
            // should still identify it as docx (even if extraction fails, yielding unknown)
            const fakePk = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
            const result = analyzeAbbottLog(fakePk);
            // Format will be 'unknown' since the ZIP is invalid, but it tried the docx path
            expect(result.format).toBe('unknown');
        });

        it('should handle empty buffer', () => {
            const result = analyzeAbbottLog(Buffer.alloc(0));
            expect(result.format).toBe('unknown');
            expect(result.lineCount).toBe(1); // empty string split gives ['']
            expect(result.labels).toHaveLength(0);
        });
    });

    describe('label extraction', () => {
        it('should extract labels from multi-space separated lines', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            expect(result.labels).toContain('Patient Name');
            expect(result.labels).toContain('Serial Number');
            expect(result.labels).toContain('Device Type');
        });

        it('should extract labels from colon-separated lines', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            expect(result.labels).toContain('Model Number');
            expect(result.labels).toContain('Date of Birth');
        });

        it('should extract lead measurement labels', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            expect(result.labels).toContain('Atrial Lead Serial Number');
            expect(result.labels).toContain('RV Lead Serial Number');
            expect(result.labels).toContain('LV Lead Serial Number');
            expect(result.labels).toContain('RV Pacing Lead Impedance');
        });

        it('should not include actual patient values in labels', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            const allLabels = result.labels.join(' ');
            // None of these values should appear in labels
            expect(allLabels).not.toContain('Testpatient');
            expect(allLabels).not.toContain('Fictional');
            expect(allLabels).not.toContain('XYZ12345');
            expect(allLabels).not.toContain('PM3456');
            expect(allLabels).not.toContain('2.81');
            expect(allLabels).not.toContain('03/15/1955');
        });

        it('should return sorted labels', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            const sorted = [...result.labels].sort();
            expect(result.labels).toEqual(sorted);
        });
    });

    describe('parser pattern matches', () => {
        it('should detect all parser patterns in a complete log', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            const m = result.parserPatternMatches;

            expect(m.patientName).toBe(true);
            expect(m.sessionTimestamp).toBe(true);
            expect(m.model).toBe(true);
            expect(m.serial).toBe(true);
            expect(m.batteryVoltage).toBe(true);
            expect(m.atrialSerial).toBe(true);
            expect(m.rvSerial).toBe(true);
            expect(m.lvSerial).toBe(true);
            expect(m.rvImp).toBe(true);
            expect(m.atrialSense).toBe(true);
            expect(m.rvSense).toBe(true);
            expect(m.dob).toBe(true);
        });

        it('should report only matching patterns for a minimal log', () => {
            const result = analyzeAbbottLog(bufferFrom(MINIMAL_LOG));
            const m = result.parserPatternMatches;

            expect(m.model).toBe(true);
            expect(m.serial).toBe(true);
            expect(m.patientName).toBe(false);
            expect(m.sessionTimestamp).toBe(false);
            expect(m.batteryVoltage).toBe(false);
            expect(m.dob).toBe(false);
        });

        it('should report all false for an unrelated log', () => {
            const result = analyzeAbbottLog(bufferFrom(EMPTY_LOG));
            const m = result.parserPatternMatches;

            expect(Object.values(m).every(v => v === false)).toBe(true);
        });
    });

    describe('uncaptured fields', () => {
        it('should identify clinical fields not captured by parser patterns', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            const uncapturedLabels = result.uncapturedFields.map(f => f.label);

            // These fields have clinical keywords but are NOT in the parser's pattern set
            expect(uncapturedLabels).toContain('LV Pacing Impedance');
            expect(uncapturedLabels).toContain('Atrial Pacing Threshold');
            expect(uncapturedLabels).toContain('RV Pacing Threshold');
            expect(uncapturedLabels).toContain('Estimated Longevity');
        });

        it('should classify uncaptured field value types', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));

            const lvImpedance = result.uncapturedFields.find(f => f.label === 'LV Pacing Impedance');
            expect(lvImpedance).toBeDefined();
            expect(lvImpedance!.valueType).toBe('<number>');

            const burden = result.uncapturedFields.find(f => f.label === 'AT/AF Burden');
            expect(burden).toBeDefined();
            expect(burden!.valueType).toBe('<number>');
        });

        it('should NOT include fields that ARE captured by parser patterns', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            const uncapturedLabels = result.uncapturedFields.map(f => f.label);

            // These are handled by the parser already
            expect(uncapturedLabels).not.toContain('Unloaded Battery Voltage');
            expect(uncapturedLabels).not.toContain('RV Pacing Lead Impedance');
            expect(uncapturedLabels).not.toContain('Atrial Signal Amplitude');
            expect(uncapturedLabels).not.toContain('Ventricular Signal Amplitude');
        });

        it('should not expose actual patient values in uncaptured fields', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            const json = JSON.stringify(result.uncapturedFields);

            // No actual values should appear
            expect(json).not.toContain('620');
            expect(json).not.toContain('0.75');
            expect(json).not.toContain('0.50');
            expect(json).not.toContain('4.2');
            expect(json).not.toContain('18.5');
        });
    });

    describe('section detection', () => {
        it('should detect ALL CAPS section headers', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));

            expect(result.sections).toContain('DEVICE INFORMATION');
            expect(result.sections).toContain('BATTERY STATUS');
            expect(result.sections).toContain('LEAD MEASUREMENTS');
        });

        it('should detect section headers with underline separators', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));

            // "PATIENT INFORMATION" is followed by "-------------------"
            expect(result.sections).toContain('PATIENT INFORMATION');
        });

        it('should detect known Abbott section names regardless of case', () => {
            const logWithMixedCase = [
                'Session Summary',
                '',
                'Episode Summary',
                '',
                'Some other content  here',
            ].join('\n');

            const result = analyzeAbbottLog(bufferFrom(logWithMixedCase));
            expect(result.sections).toContain('Session Summary');
            expect(result.sections).toContain('Episode Summary');
        });
    });

    describe('stats', () => {
        it('should calculate coverage correctly for a complete log', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));

            expect(result.stats.totalLabels).toBeGreaterThan(0);
            expect(result.stats.matchedByParser).toBe(12); // all 12 patterns match
            expect(result.stats.coveragePercent).toBeGreaterThan(0);
            expect(result.stats.coveragePercent).toBeLessThanOrEqual(100);
        });

        it('should report zero coverage for empty log', () => {
            const result = analyzeAbbottLog(bufferFrom(EMPTY_LOG));

            expect(result.stats.matchedByParser).toBe(0);
            expect(result.stats.coveragePercent).toBe(0);
        });

        it('should count line count correctly', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));

            const expectedLines = MOCK_PLAINTEXT_LOG.split('\n').length;
            expect(result.lineCount).toBe(expectedLines);
        });
    });

    describe('PHI safety', () => {
        it('should never include patient data values anywhere in the output', () => {
            const result = analyzeAbbottLog(bufferFrom(MOCK_PLAINTEXT_LOG));
            const json = JSON.stringify(result);

            // Patient identifiers
            expect(json).not.toContain('Testpatient');
            expect(json).not.toContain('Fictional');
            expect(json).not.toContain('03/15/1955');

            // Device identifiers
            expect(json).not.toContain('XYZ12345');
            expect(json).not.toContain('ATR98765');
            expect(json).not.toContain('RV54321');
            expect(json).not.toContain('LV11111');
            expect(json).not.toContain('PM3456');

            // Measurement values
            expect(json).not.toContain('2.81');
            expect(json).not.toContain('485');
            expect(json).not.toContain('01/20/2025');
            expect(json).not.toContain('14:30:00');
        });
    });
});

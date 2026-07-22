import { describe, it, expect, afterAll } from 'vitest';
import { parseAbbottLog } from '../parsers/abbott-parser';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('Abbott parser diagnostics', () => {
    const tmpFiles: string[] = [];

    const writeLog = (content: string): string => {
        const p = path.join(os.tmpdir(), `kardisynch_abbott_test_${tmpFiles.length}_${process.pid}.log`);
        fs.writeFileSync(p, content, 'utf-8');
        tmpFiles.push(p);
        return p;
    };

    afterAll(() => {
        for (const p of tmpFiles) {
            try { fs.unlinkSync(p); } catch { /* ignore */ }
        }
    });

    it('tags a recognized coded log with formatVariant and a clean parseStatus', async () => {
        const lines = [
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
        ];
        const file = writeLog(lines.join('\n'));
        const report = await parseAbbottLog(file);

        expect(report).not.toBeNull();
        expect(report!.formatVariant).toContain('source=plain-text');
        expect(report!.formatVariant).toContain('abbott-coded-log');
        expect(report!.parseStatus).not.toBe('failed');
        expect(report!.patient.last_name).toBe('Doe');
    });

    it('fails soft when lines look coded but no known codes match (unrecognized revision)', async () => {
        // Numeric-code-prefixed lines (matches the coded-format heuristic) but
        // using codes/labels the parser doesn't know about — simulates an
        // older/different Abbott log code revision.
        const lines: string[] = [];
        for (let i = 0; i < 12; i++) {
            lines.push(`${9000 + i}XUnknownField${i} somevalue`);
        }
        const file = writeLog(lines.join('\n'));
        const report = await parseAbbottLog(file);

        expect(report).not.toBeNull();
        expect(report!.parseStatus).toBe('failed'); // no identity recovered
        expect(report!.parseWarnings?.some(w => w.stage === 'coded-log')).toBe(true);
    });

    it('tags freeform-text fallback with its own formatVariant', async () => {
        const text = [
            'Patient Name Smith, Jane',
            'Date of Birth: 03/22/1965',
            'Session Timestamp 11/06/2025 09:00:00',
            'Model Number: Assura CRT-D',
            'Serial Number: 555666',
            'Unloaded Battery Voltage 2.95 V',
        ].join('\n');
        const file = writeLog(text);
        const report = await parseAbbottLog(file);

        expect(report).not.toBeNull();
        expect(report!.formatVariant).toContain('abbott-freeform-text');
        expect(report!.patient.last_name).toBe('Smith');
    });
});

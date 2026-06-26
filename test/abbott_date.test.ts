import { parseAbbottLog } from '../src/main/parsers/abbott-parser';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { expect, test, describe, afterAll } from 'vitest';

/**
 * Regression tests for issue #127: Abbott SR / non-PDF logs whose session
 * timestamp is date-only (or carries a time without seconds) used to yield an
 * empty interrogation_date, so the visit was stored under "Unknown_<id>" with a
 * blank visit.xml date. parseAbbottDateTime now falls back to a date-only parse.
 */
describe('Abbott date extraction (#127)', () => {
    const tmpFiles: string[] = [];

    const writeLog = (lines: string[]): string => {
        const p = path.join(os.tmpdir(), `kardisynch_abbott_test_${tmpFiles.length}_${process.pid}.log`);
        fs.writeFileSync(p, lines.join('\n'), 'utf-8');
        tmpFiles.push(p);
        return p;
    };

    afterAll(() => {
        for (const p of tmpFiles) {
            try { fs.unlinkSync(p); } catch { /* ignore */ }
        }
    });

    // A coded log needs >=10 lines and >70% lines starting with {digits}{UPPER}.
    const baseLines = [
        '2430Patient NameDOE,JOHN',
        '2431Patient Date of Birth01/15/1950',
        '204Patient ID000123',
        '200Device Model NameAssurity',
        '202Device Serial Number123456',
        '519Unloaded Battery Voltage3.008V',
        '512Atrial Pacing Lead Impedance450Ohm',
        '507RV Pacing Lead Impedance500Ohm',
        '2721Atrial Signal Amplitude2.5mV',
        '2722Ventricular Signal Amplitude12.0mV',
        '301ModeDDDR',
    ];

    test('date-only Session Timestamp is parsed into the visit date', async () => {
        const file = writeLog([...baseLines, '105Session Timestamp06/26/2026']);
        const report = await parseAbbottLog(file);
        expect(report).not.toBeNull();
        expect(report!.interrogation_date).toBe('2026-06-26');
    });

    test('full datetime Session Timestamp still parses to the date', async () => {
        const file = writeLog([...baseLines, '105Session Timestamp06/26/2026 14:30:05']);
        const report = await parseAbbottLog(file);
        expect(report).not.toBeNull();
        expect(report!.interrogation_date).toBe('2026-06-26');
    });

    test('Session Timestamp with time but no seconds still recovers the date', async () => {
        const file = writeLog([...baseLines, '105Session Timestamp06/26/2026 14:30']);
        const report = await parseAbbottLog(file);
        expect(report).not.toBeNull();
        expect(report!.interrogation_date).toBe('2026-06-26');
    });
});

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
        // Ejection Fraction / Indications for Implant have no dedicated
        // schema slot — captured into additional_fields instead of dropped.
        expect(report!.additional_fields?.ejection_fraction).toBe('35%');
        expect(report!.additional_fields?.indications_for_implant).toBe('Primary Prevention');
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

    // Every real Abbott "Detailed Log" export we've been able to test against
    // (Merlin.net downloads, see #146) delimits each line's fields with an
    // 0x1C control character — `{code}\x1c{Label}\x1c{Value}\x1c{Unit}\x1c` —
    // which is invisible in a plain text viewer. The original parser assumed
    // fields were concatenated with no separator and never matched a single
    // real file. These tests cover the real format.
    describe('0x1C-delimited coded log (real Merlin.net export format)', () => {
        const FS = '\x1c';
        const field = (code: string, label: string, value: string, unit = '') =>
            `${code}${FS}${label}${FS}${value}${FS}${unit}${FS}`;
        // isCodedFormat requires >=10 lines to consider the ratio-based
        // heuristic meaningful — pad short fixtures with unrelated settings
        // fields the parser doesn't track, matching how real exports always
        // run to dozens of lines.
        const filler = [
            field('9500', 'Some Setting A', 'On'),
            field('9501', 'Some Setting B', 'Off'),
            field('9502', 'Some Setting C', '10', 'ms'),
            field('9503', 'Some Setting D', 'Bipolar'),
            field('9504', 'Some Setting E', '5', 'bpm'),
            field('9505', 'Some Setting F', 'Unipolar'),
        ];

        it('parses patient/device/battery from the delimited format', async () => {
            const lines = [
                field('2430', 'Patient Name', 'Doe, John'),
                field('2431', 'Patient Date of Birth', '01/15/1950 00:00:00'),
                field('200', 'Device Model Name', 'Fortify Assura CD'),
                field('202', 'Device Serial Number', '987654'),
                field('105', 'Session Timestamp', '11/06/2025 10:15:00'),
                field('519', 'Unloaded Battery Voltage', '3.008', 'V'),
                field('301', 'Mode', 'DDDR'),
                field('2440', 'Ejection Fraction', '35', '%'),
                field('204', 'Patient ID', '12345'),
                field('2441', 'Indications for Implant: List', 'Primary Prevention'),
            ];
            const file = writeLog(lines.join('\n'));
            const report = await parseAbbottLog(file);

            expect(report).not.toBeNull();
            expect(report!.formatVariant).toContain('coded-delimited');
            expect(report!.parseStatus).not.toBe('failed');
            expect(report!.patient.last_name).toBe('Doe');
            expect(report!.patient.first_name).toBe('John');
            expect(report!.device.model).toBe('Fortify Assura CD');
            expect(report!.device.serial_number).toBe('987654');
            expect(report!.battery?.voltage?.value).toBe(3.008);
        });

        it('matches fields by code alone, tolerating a label wording the parser has never seen (ICM exports use "Patient Last Name" instead of "Patient Name")', async () => {
            const lines = [
                field('2430', 'Patient Last Name', 'Hoe'),
                field('2431', 'Patient Date of Birth', '01/01/1906 00:00:00'),
                field('200', 'Device Model Name', 'Assert-IQ 3 ICM'),
                field('202', 'Device Serial Number', 'ANONDEV00007'),
                field('105', 'Session Timestamp', '02/25/2026 15:26:04'),
                ...filler,
            ];
            const file = writeLog(lines.join('\n'));
            const report = await parseAbbottLog(file);

            expect(report).not.toBeNull();
            expect(report!.patient.last_name).toBe('Hoe');
            expect(report!.device.type).toBe('ICM');
        });

        it('extracts an LV lead and upgrades device type to CRT-P when the model name carries no CRT keyword', async () => {
            // Real example: Abbott's "Entrant HF" CRT-P family — the model
            // name alone gives no hint it's a CRT device.
            const lines = [
                field('2430', 'Patient Name', 'Roe, John'),
                field('200', 'Device Model Name', 'Entrant HF'),
                field('202', 'Device Serial Number', 'ANONDEV00002'),
                field('2471', 'LV Lead Serial Number', 'ANONLV00001'),
                field('2465', 'Model Number: SJM LV Lead', '1458Q Quartet'),
                field('2464', 'Manufacturer: LV Lead', 'Abbott'),
                field('2720', 'LV Pacing Lead Impedance', '650.0', 'Ohm'),
                ...filler,
            ];
            const file = writeLog(lines.join('\n'));
            const report = await parseAbbottLog(file);

            expect(report).not.toBeNull();
            expect(report!.device.type).toBe('CRT-P');
            const lvLead = report!.leads?.find(l => l.name === 'LV');
            expect(lvLead).toBeDefined();
            expect(lvLead?.serial).toBe('ANONLV00001');
            expect(lvLead?.impedance?.value).toBe(650.0);
        });

        it('upgrades device type to CRT-D (not CRT-P) when an LV lead is paired with ICD indicators', async () => {
            // "Unify Assura" matches the ICD keyword ('UNIFY') but not the
            // CRT-D keyword — the LV lead is what should push ICD -> CRT-D.
            const lines = [
                field('2430', 'Patient Name', 'Miles, John'),
                field('200', 'Device Model Name', 'Unify Assura'),
                field('202', 'Device Serial Number', 'ANONDEV00012'),
                field('2471', 'LV Lead Serial Number', 'ANONLV00003'),
                ...filler,
            ];
            const file = writeLog(lines.join('\n'));
            const report = await parseAbbottLog(file);

            expect(report!.device.type).toBe('CRT-D');
        });
    });
});

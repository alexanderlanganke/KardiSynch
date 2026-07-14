
import { describe, it, expect, afterAll } from 'vitest';
import { parseMedtronicPdd } from '../parsers/medtronic-parser';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('Medtronic PDD Debug', () => {
    it('should parse the debug PDD file', async () => {
        const pddPath = path.join(process.cwd(), 'debug_data', '06144805.pdd');
        console.log(`Parsing PDD: ${pddPath}`);

        if (!fs.existsSync(pddPath)) {
            console.warn('Skipping Medtronic PDD test: debug file not found at', pddPath);
            return;
        }

        try {
            const report = await parseMedtronicPdd(pddPath);


            expect(report).toBeDefined();
            expect(report?.patient.last_name).toBeTruthy();
            expect(report?.patient.first_name).toBeTruthy();
            expect(report?.device.model).toContain('Protecta');
            expect(report?.device.serial_number).toBe('PTC610468S');

            // Check leads if possible, or at least that we have some data
            // Based on earlier analysis: RV Imp ~589, A Imp ~342
            if (report?.leads && report.leads.length > 0) {
                const rvLead = report.leads.find(l => l.anatomic_location === 'RV');
                if (rvLead && rvLead.impedance) {
                    // 589636 -> Prefix 589, Value 636
                    expect(rvLead.impedance.value).toBeCloseTo(636, 1);
                }
            }

        } catch (e) {
            console.error('Error parsing PDD:', e);
            throw e;
        }
    });
});

describe('Medtronic PDD string extraction (synthetic)', () => {
    const tmpFiles: string[] = [];

    const writePdd = (parts: (Buffer | string)[]): string => {
        const p = path.join(os.tmpdir(), `kardisynch_pdd_test_${tmpFiles.length}_${process.pid}.pdd`);
        const chunks = parts.map(x => typeof x === 'string' ? Buffer.from(x, 'utf-8') : x);
        fs.writeFileSync(p, Buffer.concat(chunks));
        tmpFiles.push(p);
        return p;
    };

    afterAll(() => {
        for (const p of tmpFiles) {
            try { fs.unlinkSync(p); } catch { /* ignore */ }
        }
    });

    // Binary separator between "strings" in the PDD
    const SEP = Buffer.from([0x00, 0x01, 0x00]);

    it('keeps UTF-8 umlauts in patient names intact', async () => {
        const file = writePdd([SEP, 'Müller, Hans', SEP, 'Protecta XT DR', SEP, 'PTC610468S', SEP]);
        const report = await parseMedtronicPdd(file);

        expect(report).not.toBeNull();
        expect(report!.patient.last_name).toBe('Müller');
        expect(report!.patient.first_name).toBe('Hans');
        expect(report!.device.serial_number).toBe('PTC610468S');
    });

    it('derives the interrogation date from the timestamp suffix without a UTC day shift', async () => {
        // Serial + YYYYMMDDHHMMSS suffix at 00:30 local — must stay on the 6th
        const file = writePdd([SEP, 'Doe, John', SEP, 'PTC610468S20251106003015', SEP]);
        const report = await parseMedtronicPdd(file);

        expect(report).not.toBeNull();
        expect(report!.interrogation_date).toBe('2025-11-06');
    });
});

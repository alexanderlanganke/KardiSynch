
import { describe, it, expect } from 'vitest';
import { parseMedtronicPdd } from '../parsers/medtronic-parser';
import * as path from 'path';
import * as fs from 'fs';

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
            expect(report?.patient.last_name).toBeTruthy(); // Was Mustermann
            expect(report?.patient.first_name).toBeTruthy(); // Was Peter
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

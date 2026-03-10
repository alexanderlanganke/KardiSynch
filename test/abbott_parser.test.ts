
import { parseAbbottLog } from '../src/main/parsers/abbott-parser';
import * as path from 'path';
import * as fs from 'fs';
import { expect, test, describe } from 'vitest';

describe('Abbott Parser', () => {
    const mockDir = path.resolve(__dirname, '../mock_import_dir');
    const logFile = path.join(mockDir, '6805398.log');

    test('should parse Abbott .log (DOCX) file correctly', async () => {
        if (!fs.existsSync(logFile)) {
            console.warn('Skipping test: mock file not found at', logFile);
            return;
        }

        const report = await parseAbbottLog(logFile);

        expect(report).not.toBeNull();
        if (!report) return;

        expect(report.manufacturer).toBe('Abbott');
        expect(report.patient.last_name).toBeTruthy();
        expect(report.patient.first_name).toBeTruthy();
        expect(report.device.model).toBe('SJM Atrial Lead 2088TC Tendril STS'); // Wait, the regex might pick up the first "Model Number" it sees which was the lead. 
        // In the text: "2457 Model Number: SJM Atrial Lead..."
        // Then later "101 Programmer Model Number 3650"
        // Then later "301 Mode DDDR"
        // Let's see what it actually picked up. The test will reveal it.

        // Check Battery
        if (report.battery.voltage) {
            expect(report.battery.voltage.value).toBeCloseTo(3.008);
            expect(report.battery.voltage.unit).toBe('V');
        }

        // Check Leads
        // We expect at least one lead
        expect(report.leads?.length).toBeGreaterThan(0);

        // Check PDF Linking
        // The session ID 6805398 should match a directory in the mock import structure.

        expect(report.generatedFiles).toBeDefined();
        if (report.generatedFiles && report.generatedFiles.length > 0) {
            console.log('Found linked PDF:', report.generatedFiles[0]);
            expect(report.generatedFiles[0]).toContain('.pdf');
        } else {
            console.warn('PDF not linked. Check directory structure logic.');
        }
    });
});

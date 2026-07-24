import { describe, it, expect, afterAll } from 'vitest';
import { parseMedtronicPdd } from '../parsers/medtronic-parser';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Real anonymized .pdd samples (test/medtronic pdd files/, gitignored) showed
// every file with any type=4 entries in the plausible-voltage range (2.0-3.5V)
// carries 3-6 DISTINCT candidate values in that same file (e.g. 2.365, 2.700,
// 2.914, 2.920, 3.328) — almost certainly a mix of the actual current voltage
// alongside fixed BOL/ERI/EOL reference constants that happen to fall in the
// same numeric band, with no field name to tell them apart. The old code took
// "whichever candidate is last in the byte stream", which is a coin flip
// between values that can differ by over half a volt — a real, reproducible
// source of a spurious "increasing battery voltage" trend (#154).

describe('Medtronic .pdd battery voltage (type=4 byte-scan ambiguity)', () => {
    const tmpFiles: string[] = [];

    const writePdd = (buf: Buffer): string => {
        const p = path.join(os.tmpdir(), `kardisynch_pdd_voltage_test_${tmpFiles.length}_${process.pid}.pdd`);
        fs.writeFileSync(p, buf);
        tmpFiles.push(p);
        return p;
    };

    afterAll(() => {
        for (const p of tmpFiles) {
            try { fs.unlinkSync(p); } catch { /* ignore */ }
        }
    });

    // Appends one `0xFF<value>\n0xFF<type>\n` marker pair to a buffer, matching
    // parsePDDStructure's byte scan.
    const appendEntry = (chunks: Buffer[], value: number, type: number) => {
        chunks.push(Buffer.from([0xFF, ...Buffer.from(String(value), 'ascii'), 0x0A, 0xFF, ...Buffer.from(String(type), 'ascii'), 0x0A]));
    };

    it('asserts the voltage when every in-range type=4 candidate agrees', async () => {
        const chunks: Buffer[] = [Buffer.alloc(400, 0)];
        appendEntry(chunks, 2920, 4);
        appendEntry(chunks, 2920, 4); // repeated identical reading — real agreement, not ambiguity
        const file = writePdd(Buffer.concat(chunks));

        const report = await parseMedtronicPdd(file);
        expect(report?.battery.voltage?.value).toBe(2.92);
    });

    it('leaves voltage unset (not a guess) when in-range type=4 candidates disagree', async () => {
        const chunks: Buffer[] = [Buffer.alloc(400, 0)];
        // Mirrors a real sample's candidate set: current voltage plus BOL/ERI/EOL-like constants.
        appendEntry(chunks, 2914, 4);
        appendEntry(chunks, 2365, 4);
        appendEntry(chunks, 3328, 4);
        appendEntry(chunks, 2700, 4);
        appendEntry(chunks, 2920, 4);
        const file = writePdd(Buffer.concat(chunks));

        const report = await parseMedtronicPdd(file);
        expect(report?.battery.voltage).toBeUndefined();
        expect(report?.parseWarnings?.some(w => w.stage === 'battery.voltage')).toBe(true);
    });

    it('ignores type=4 entries outside the plausible voltage range when checking for agreement', async () => {
        const chunks: Buffer[] = [Buffer.alloc(400, 0)];
        appendEntry(chunks, 2920, 4);
        appendEntry(chunks, 500, 4); // out of range — not a voltage candidate at all
        const file = writePdd(Buffer.concat(chunks));

        const report = await parseMedtronicPdd(file);
        expect(report?.battery.voltage?.value).toBe(2.92);
    });
});

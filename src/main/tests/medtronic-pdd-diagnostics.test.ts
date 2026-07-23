import { describe, it, expect, afterAll } from 'vitest';
import { parseMedtronicPdd } from '../parsers/medtronic-parser';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Real anonymized .pdd samples (test/medtronic pdd files/, gitignored) showed
// the previous string-scanning approach almost never found the patient name
// (~5 of 33 files) or device model (~5 of 33, only by accident of matching a
// hardcoded family list) even though both are present at fixed, reliable
// byte offsets in every sample. These tests cover that fixed-offset
// extraction using synthetic buffers built to the same layout.

describe('Medtronic .pdd fixed-offset header extraction (real sample layout)', () => {
    const tmpFiles: string[] = [];

    const writePdd = (buf: Buffer): string => {
        const p = path.join(os.tmpdir(), `kardisynch_pdd_offset_test_${tmpFiles.length}_${process.pid}.pdd`);
        fs.writeFileSync(p, buf);
        tmpFiles.push(p);
        return p;
    };

    afterAll(() => {
        for (const p of tmpFiles) {
            try { fs.unlinkSync(p); } catch { /* ignore */ }
        }
    });

    // Builds a buffer matching the real header layout: 3-byte prefix, 1-byte
    // ASCII-name length + name at offset 0x03/0x04, 1-byte model length +
    // model at offset 0x22/0x23, and optionally a 1-byte UTF-16BE-name
    // length + name at offset 0x77/0x78 (used when the ASCII name is blank).
    const buildHeader = (opts: { asciiName?: string; model: string; utf16Name?: string; serial?: string }): Buffer => {
        const buf = Buffer.alloc(400, 0);
        buf[0] = 0x00; buf[1] = 0x01; buf[2] = 0x01;
        if (opts.asciiName) {
            buf[0x03] = opts.asciiName.length;
            buf.write(opts.asciiName, 0x04, 'latin1');
        }
        buf[0x22] = opts.model.length;
        buf.write(opts.model, 0x23, 'latin1');
        if (opts.utf16Name) {
            buf[0x77] = opts.utf16Name.length * 2;
            for (let i = 0; i < opts.utf16Name.length; i++) {
                buf[0x78 + i * 2] = 0x00;
                buf[0x78 + i * 2 + 1] = opts.utf16Name.charCodeAt(i);
            }
        }
        if (opts.serial) buf.write(opts.serial, 0x100, 'latin1');
        return buf;
    };

    it('reads the patient name from the fixed-offset ASCII field (offset 0x03/0x04)', async () => {
        const file = writePdd(buildHeader({ asciiName: 'Doe, Jane', model: 'Ensura DR MRI E' }));
        const report = await parseMedtronicPdd(file);

        expect(report?.patient.last_name).toBe('Doe');
        expect(report?.patient.first_name).toBe('Jane');
        expect(report?.formatVariant).toContain('name=ascii-fixed-offset');
    });

    it('falls back to the fixed-offset UTF-16BE field (offset 0x77/0x78) when the ASCII name is blank', async () => {
        const file = writePdd(buildHeader({ model: 'Astra S DR MRI', utf16Name: 'Hensley, John' }));
        const report = await parseMedtronicPdd(file);

        expect(report?.patient.last_name).toBe('Hensley');
        expect(report?.patient.first_name).toBe('John');
        expect(report?.formatVariant).toContain('name=utf16be-fixed-offset');
    });

    it('parses a space-separated name (no comma) from the UTF-16BE field', async () => {
        const file = writePdd(buildHeader({ model: 'Astra S DR MRI', utf16Name: 'Garrity John' }));
        const report = await parseMedtronicPdd(file);

        expect(report?.patient.last_name).toBe('Garrity');
        expect(report?.patient.first_name).toBe('John');
    });

    it('treats a bare surname with no first name as last-name-only', async () => {
        const file = writePdd(buildHeader({ model: 'Astra S DR MRI', utf16Name: 'Public' }));
        const report = await parseMedtronicPdd(file);

        expect(report?.patient.last_name).toBe('Public');
        expect(report?.patient.first_name).toBe('');
    });

    it('reads the device model from the fixed offset even for a family not in the known-names list', async () => {
        // "Astra" isn't in the hardcoded family list the old scan-only
        // approach relied on — the real gap that left ~85% of real samples'
        // device model blank.
        const file = writePdd(buildHeader({ asciiName: 'Doe, Jane', model: 'Astra S DR MRI' }));
        const report = await parseMedtronicPdd(file);

        expect(report?.device.model).toBe('Astra S DR MRI');
        expect(report?.formatVariant).toContain('model=fixed-offset');
    });

    it.each([
        ['REVEAL LINQ LNQ', 'ICM'],
        ['Amplia MRI Quad', 'CRT-D'],
        ['Visia AF MRI S ', 'ICD'],
        ['Evera MRI S DR ', 'ICD'],
        ['Protecta DR D36', 'ICD'],
        ['Serena CRT-P W1', 'CRT-P'],
        ['Serena Quad CRT', 'CRT'], // -P/-D suffix truncated away; don't guess defib capability
        ['Astra S DR MRI ', 'Pacemaker'], // known family, no ICD/CRT/ICM signal -> basic pacemaker
        ['Ensura DR MRI E', 'Pacemaker'],
    ])('infers device type %s -> %s from the real model string', async (model, expectedType) => {
        const file = writePdd(buildHeader({ asciiName: 'Doe, Jane', model }));
        const report = await parseMedtronicPdd(file);
        expect(report?.device.type).toBe(expectedType);
    });
});

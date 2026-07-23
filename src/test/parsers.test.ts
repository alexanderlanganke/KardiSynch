
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseBiotronikXML } from '../main/parsers/biotronik-parser';
import { parseBostonScientificBnk, parseBostonScientificPdf } from '../main/parsers/boston-scientific-parser';

describe('Parsers', () => {
    const fixturesDir = path.join(__dirname, 'fixtures');

    describe('Biotronik Parser', () => {
        it('should parse a valid Biotronik XML file', () => {
            const xmlContent = fs.readFileSync(path.join(fixturesDir, 'mock_biotronik.txt'), 'utf-8');
            const result = parseBiotronikXML(xmlContent);

            expect(result).not.toBeNull();
            expect(result?.manufacturer).toBe('Biotronik');
            expect(result?.patient.first_name).toBe('Erika');
            expect(result?.patient.last_name).toBe('Mustermann');
            expect(result?.device.serial_number).toBe('12345678');
            // parseTagValue: false preserves the source string verbatim ("3.10")
            expect(result?.battery?.voltage?.value).toBe('3.10');
            // Diagnostics: the summary table was found via the primary attribute name.
            expect(result?.formatVariant).toContain('summary=MANUFACTURERDESCR');
        });

        it('should fail soft (not null/throw) when no known table attributes match at all', () => {
            // Structurally valid XML, but none of the summary/settings attribute
            // names the parser knows about are present — simulates an
            // unrecognized/very old schema revision. Should not throw or return
            // null; should return a skeleton report with diagnostics instead.
            const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<carddas:InterfaceData xmlns:carddas="http://www.biotronik.com/carddas">
    <carddas:Examination>
        <carddas:ExaminationDate>2023-10-27</carddas:ExaminationDate>
        <carddas:Measurements>
            <carddas:Table>
                <carddas:TableName>SOME_UNKNOWN_TABLE</carddas:TableName>
                <carddas:TableEntry>
                    <carddas:AttributeName>SOME_UNKNOWN_ATTRIBUTE</carddas:AttributeName>
                    <carddas:CharValue>foo</carddas:CharValue>
                </carddas:TableEntry>
            </carddas:Table>
        </carddas:Measurements>
    </carddas:Examination>
    <carddas:Patient>
        <carddas:PersonalData />
    </carddas:Patient>
</carddas:InterfaceData>`;

            const result = parseBiotronikXML(xmlContent);

            expect(result).not.toBeNull();
            expect(result?.manufacturer).toBe('Biotronik');
            expect(result?.parseStatus).toBe('failed'); // no patient AND no device identity recovered
            expect(result?.parseWarnings?.length).toBeGreaterThan(0);
            expect(result?.parseWarnings?.some(w => w.stage === 'summaryTable' && w.severity === 'error')).toBe(true);
        });

        it('should never throw, even on garbage input', () => {
            expect(() => parseBiotronikXML('not xml at all {{{')).not.toThrow();
            expect(() => parseBiotronikXML('')).not.toThrow();
        });
    });

    describe('Boston Scientific Parser', () => {
        it('should parse a valid BNK file', () => {
            // mock_boston.bnk mirrors the real PACEART export format: a '#'
            // comment header carrying device model/serial + interrogation
            // date (never key/value lines — the previous fixture invented a
            // schema no real export actually uses, see #146-style findings
            // for Boston Scientific), plus flat PatientXxx key/value lines.
            const bnkContent = fs.readFileSync(path.join(fixturesDir, 'mock_boston.bnk'), 'utf-8');
            const result = parseBostonScientificBnk(bnkContent);

            expect(result).not.toBeNull();
            expect(result?.manufacturer).toBe('Boston Scientific');
            expect(result?.patient.first_name).toBe('Max');
            expect(result?.patient.last_name).toBe('Mustermann');
            expect(result?.patient.dob).toBe('1980-01-01');
            expect(result?.device.model).toBe('ACCOLADE-MRI');
            expect(result?.device.serial_number).toBe('123456');
            expect(result?.interrogation_date).toBe('2023-10-27');
            expect(result?.battery?.remaining_longevity?.value).toBe(60);
            expect(result?.leads?.find(l => l.name === 'Atrium')?.serial).toBe('654321');
            expect(result?.leads?.find(l => l.name === 'RV')?.serial).toBe('654322');
            expect(result?.formatVariant).toBe('boston-scientific-bnk');
            expect(result?.parseStatus).not.toBe('failed');
        });

        it('fails soft (not null/throw) on a .bnk file with no recognizable key/value lines', () => {
            const result = parseBostonScientificBnk('no commas here\nor here either\n# comment only');

            expect(result).not.toBeNull();
            expect(result?.parseStatus).toBe('failed');
            expect(result?.parseWarnings?.some(w => w.stage === 'parse' && w.severity === 'error')).toBe(true);
        });

        it('tags which name-extraction strategy matched in a Standard PDF', () => {
            // Name must precede the DOB in the text — the anchor strategy
            // searches backwards from the DOB match for a "Last, First" pattern.
            const text = 'LATITUDE Home Monitoring System\nMustermann, Erika\nGeburtsdatum 25 Sep 1952\nBericht erstel. 02 Nov 2025\nModel: ACCOLADE MRI\nSerial: 654321';
            const result = parseBostonScientificPdf(text);

            expect(result.patient.last_name).toBe('Mustermann');
            expect(result.formatVariant).toBe('boston-scientific-pdf:standard;name=dob-anchor');
            expect(result.parseStatus).not.toBe('failed');
        });

        it('fails soft (parseStatus failed, no throw) when no known patterns match at all', () => {
            const result = parseBostonScientificPdf('completely unrelated text with no recognizable fields whatsoever');

            expect(result).not.toBeNull();
            expect(result.parseStatus).toBe('failed');
            expect(result.parseWarnings?.length).toBeGreaterThan(0);
        });
    });
});

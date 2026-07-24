
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

        // Real sample (test/Biotronik xml/, gitignored, not committed): an
        // "Amvia Sky DR-T" pacemaker came back with device.model correct but
        // device.type 'Unknown' — "Amvia" wasn't in the family keyword list,
        // and battery.status was 'Unknown' because this export uses
        // 'BATTERYSTATUS' where the parser only looked for
        // 'FU1BATTERYSTATUS'.
        it('recognizes the Amvia family as a Pacemaker', () => {
            const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<carddas:InterfaceData xmlns:carddas="http://www.biotronik.com/carddas">
    <carddas:Examination>
        <carddas:ExaminationDate>2026-07-23</carddas:ExaminationDate>
        <carddas:Measurements>
            <carddas:Table>
                <carddas:TableName>TBU_HSM_DATEN</carddas:TableName>
                <carddas:TableEntry>
                    <carddas:AttributeName>MANUFACTURERDESCR</carddas:AttributeName>
                    <carddas:CharValue>Biotronik</carddas:CharValue>
                </carddas:TableEntry>
                <carddas:TableEntry>
                    <carddas:AttributeName>CATAGGREGATDESCR</carddas:AttributeName>
                    <carddas:CharValue>Amvia Sky DR-T</carddas:CharValue>
                </carddas:TableEntry>
                <carddas:TableEntry>
                    <carddas:AttributeName>SERHSM</carddas:AttributeName>
                    <carddas:CharValue>0000000000</carddas:CharValue>
                </carddas:TableEntry>
                <carddas:TableEntry>
                    <carddas:AttributeName>BATTERYSTATUS</carddas:AttributeName>
                    <carddas:CharValue>OK</carddas:CharValue>
                </carddas:TableEntry>
            </carddas:Table>
        </carddas:Measurements>
    </carddas:Examination>
    <carddas:Patient>
        <carddas:PersonalData>
            <carddas:FirstName>Erika</carddas:FirstName>
            <carddas:Name>Mustermann</carddas:Name>
            <carddas:DOB>1975-05-20</carddas:DOB>
        </carddas:PersonalData>
    </carddas:Patient>
</carddas:InterfaceData>`;

            const result = parseBiotronikXML(xmlContent);

            expect(result?.device.model).toBe('Amvia Sky DR-T');
            expect(result?.device.type).toBe('Pacemaker');
            expect(result?.battery?.status).toBe('OK');
        });

        it('falls back to FunctionalDomain=HSM to infer Pacemaker when the model matches no known family keyword', () => {
            const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<carddas:InterfaceData xmlns:carddas="http://www.biotronik.com/carddas">
    <carddas:Examination>
        <carddas:ExaminationDate>2026-07-23</carddas:ExaminationDate>
        <carddas:FunctionalDomain>HSM</carddas:FunctionalDomain>
        <carddas:Measurements>
            <carddas:Table>
                <carddas:TableName>TBU_HSM_DATEN</carddas:TableName>
                <carddas:TableEntry>
                    <carddas:AttributeName>MANUFACTURERDESCR</carddas:AttributeName>
                    <carddas:CharValue>Biotronik</carddas:CharValue>
                </carddas:TableEntry>
                <carddas:TableEntry>
                    <carddas:AttributeName>CATAGGREGATDESCR</carddas:AttributeName>
                    <carddas:CharValue>SomeBrandNewModel XR</carddas:CharValue>
                </carddas:TableEntry>
                <carddas:TableEntry>
                    <carddas:AttributeName>SERHSM</carddas:AttributeName>
                    <carddas:CharValue>0000000001</carddas:CharValue>
                </carddas:TableEntry>
            </carddas:Table>
        </carddas:Measurements>
    </carddas:Examination>
    <carddas:Patient>
        <carddas:PersonalData />
    </carddas:Patient>
</carddas:InterfaceData>`;

            const result = parseBiotronikXML(xmlContent);

            expect(result?.device.model).toBe('SomeBrandNewModel XR');
            expect(result?.device.type).toBe('Pacemaker');
        });

        it('finds battery remaining-capacity in a separate AdditionalMeasurements table and strips the redundant % sign', () => {
            // Real sample: Batterie-Restkapazität lives in an
            // AdditionalMeasurements table (table '9112'), not the
            // settings table findTableByAttribute('Elektrodenmodell')
            // resolves — and its CharValue carries its own "95%" rather
            // than a bare number.
            const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<carddas:InterfaceData xmlns:carddas="http://www.biotronik.com/carddas">
    <carddas:Examination>
        <carddas:ExaminationDate>2026-07-23</carddas:ExaminationDate>
        <carddas:Measurements>
            <carddas:Table>
                <carddas:TableName>TBU_HSM_DATEN</carddas:TableName>
                <carddas:TableEntry>
                    <carddas:AttributeName>MANUFACTURERDESCR</carddas:AttributeName>
                    <carddas:CharValue>Biotronik</carddas:CharValue>
                </carddas:TableEntry>
                <carddas:TableEntry>
                    <carddas:AttributeName>CATAGGREGATDESCR</carddas:AttributeName>
                    <carddas:CharValue>Amvia Sky DR-T</carddas:CharValue>
                </carddas:TableEntry>
                <carddas:TableEntry>
                    <carddas:AttributeName>SERHSM</carddas:AttributeName>
                    <carddas:CharValue>0000000000</carddas:CharValue>
                </carddas:TableEntry>
            </carddas:Table>
        </carddas:Measurements>
        <carddas:AdditionalMeasurements>
            <carddas:Table>
                <carddas:TableName>9112</carddas:TableName>
                <carddas:TableEntry>
                    <carddas:AttributeName>Batterie-Restkapazität</carddas:AttributeName>
                    <carddas:CharValue>95%</carddas:CharValue>
                </carddas:TableEntry>
            </carddas:Table>
        </carddas:AdditionalMeasurements>
    </carddas:Examination>
    <carddas:Patient>
        <carddas:PersonalData />
    </carddas:Patient>
</carddas:InterfaceData>`;

            const result = parseBiotronikXML(xmlContent);

            expect(result?.battery?.remaining_longevity?.value).toBe('95');
            expect(result?.battery?.remaining_longevity?.unit).toBe('%');
        });

        // Helper for the tests below: a minimal-but-valid summary table so
        // manufacturer/model/serial resolve, with room to inject extra
        // Measurements/AdditionalMeasurements XML per test.
        const withSummary = (model: string, extraXml: string) => `<?xml version="1.0" encoding="UTF-8"?>
<carddas:InterfaceData xmlns:carddas="http://www.biotronik.com/carddas">
    <carddas:Examination>
        <carddas:ExaminationDate>2026-07-24</carddas:ExaminationDate>
        <carddas:Measurements>
            <carddas:Table>
                <carddas:TableName>TBU_HSM_DATEN</carddas:TableName>
                <carddas:TableEntry>
                    <carddas:AttributeName>MANUFACTURERDESCR</carddas:AttributeName>
                    <carddas:CharValue>Biotronik</carddas:CharValue>
                </carddas:TableEntry>
                <carddas:TableEntry>
                    <carddas:AttributeName>CATAGGREGATDESCR</carddas:AttributeName>
                    <carddas:CharValue>${model}</carddas:CharValue>
                </carddas:TableEntry>
                <carddas:TableEntry>
                    <carddas:AttributeName>SERHSM</carddas:AttributeName>
                    <carddas:CharValue>0000000000</carddas:CharValue>
                </carddas:TableEntry>
            </carddas:Table>
            ${extraXml}
        </carddas:Measurements>
    </carddas:Examination>
    <carddas:Patient>
        <carddas:PersonalData />
    </carddas:Patient>
</carddas:InterfaceData>`;

        it.each([
            ['Rivacor 7 VR-T', 'ICD'],
            ['Rivacor 5 DR-T', 'ICD'],
            ['Intica Neo 5 VR-T DX', 'ICD'],
            ['BIOMONITOR IIIm', 'ICM'],
        ])('classifies %s as %s', (model, expectedType) => {
            const result = parseBiotronikXML(withSummary(model, ''));
            expect(result?.device.type).toBe(expectedType);
        });

        it('infers RA/RV lead order positionally when Kanäle/Kanal-N are all placeholders but Elektrodenmodell has real data', () => {
            // Real pattern (Enticos/Enitra/Evity families): 4 padded slots,
            // only the first 2 populated, and Kanäle carries no usable label
            // at all (both entries are '.').
            const extra = `<carddas:Table>
                <carddas:TableName>9002</carddas:TableName>
                <carddas:TableEntry><carddas:AttributeName>Elektrodenmodell</carddas:AttributeName><carddas:CharValue>Solia S53</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>Elektrodenmodell</carddas:AttributeName><carddas:CharValue>Solia S60</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>Elektrodenmodell</carddas:AttributeName><carddas:CharValue>.</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>Elektrodenmodell</carddas:AttributeName><carddas:CharValue>.</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>Kanäle</carddas:AttributeName><carddas:CharValue>.</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>Kanäle</carddas:AttributeName><carddas:CharValue>.</carddas:CharValue></carddas:TableEntry>
            </carddas:Table>`;
            const result = parseBiotronikXML(withSummary('Enticos 4 DR', extra));

            expect(result?.formatVariant).toContain('channels=positional');
            expect(result?.leads?.map(l => l.name)).toEqual(['RA-Lead', 'RV-Lead']);
            expect(result?.leads?.map(l => l.model)).toEqual(['Solia S53', 'Solia S60']);
        });

        it('names a single unlabeled lead generically rather than guessing RA vs RV', () => {
            const extra = `<carddas:Table>
                <carddas:TableName>9002</carddas:TableName>
                <carddas:TableEntry><carddas:AttributeName>Elektrodenmodell</carddas:AttributeName><carddas:CharValue>Isoflex1948</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>Kanäle</carddas:AttributeName><carddas:CharValue>.</carddas:CharValue></carddas:TableEntry>
            </carddas:Table>`;
            const result = parseBiotronikXML(withSummary('Enitra 6 SR', extra));

            expect(result?.leads?.map(l => l.name)).toEqual(['Lead']);
            expect(result?.leads?.[0].model).toBe('Isoflex1948');
        });

        it('extracts leads from the TBU_HSM_IMPLANT_SO per-lead table schema (Ecuro/Entovis/Evia/Effecta families)', () => {
            // Real pattern: no Elektrodenmodell/Kanäle anywhere at all — one
            // TBU_HSM_IMPLANT_SO table per lead with an explicit LOKALISATION,
            // plus a shared '9115' table with measurements positionally
            // aligned to the TBU_HSM_IMPLANT_SO table order.
            const extra = `<carddas:Table>
                <carddas:TableName>TBU_HSM_IMPLANT_SO</carddas:TableName>
                <carddas:TableEntry><carddas:AttributeName>LOKALISATION</carddas:AttributeName><carddas:CharValue>RA</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>MANUFACTURERDESCR</carddas:AttributeName><carddas:CharValue>BIOTRONIK</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>CATLEADDESCR</carddas:AttributeName><carddas:CharValue>Solia S 53</carddas:CharValue></carddas:TableEntry>
            </carddas:Table>
            <carddas:Table>
                <carddas:TableName>TBU_HSM_IMPLANT_SO</carddas:TableName>
                <carddas:TableEntry><carddas:AttributeName>LOKALISATION</carddas:AttributeName><carddas:CharValue>RV</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>MANUFACTURERDESCR</carddas:AttributeName><carddas:CharValue>BIOTRONIK</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>CATLEADDESCR</carddas:AttributeName><carddas:CharValue>Solia T 60</carddas:CharValue></carddas:TableEntry>
            </carddas:Table>
            <carddas:Table>
                <carddas:TableName>9115</carddas:TableName>
                <carddas:TableEntry><carddas:AttributeName>Elektrodenimpedanz</carddas:AttributeName><carddas:CharValue>468</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>Elektrodenimpedanz</carddas:AttributeName><carddas:CharValue>585</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>Reizschwelle</carddas:AttributeName><carddas:CharValue>0.7</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>Reizschwelle</carddas:AttributeName><carddas:CharValue>0.8</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>Impulsdauer</carddas:AttributeName><carddas:CharValue>0.4</carddas:CharValue></carddas:TableEntry>
                <carddas:TableEntry><carddas:AttributeName>Impulsdauer</carddas:AttributeName><carddas:CharValue>0.4</carddas:CharValue></carddas:TableEntry>
            </carddas:Table>`;
            const result = parseBiotronikXML(withSummary('Ecuro DR', extra));

            expect(result?.formatVariant).toContain('channels=TBU_HSM_IMPLANT_SO');
            expect(result?.leads?.length).toBe(2);

            const ra = result?.leads?.find(l => l.name === 'RA-Lead');
            expect(ra?.model).toBe('Solia S 53');
            expect(ra?.manufacturer).toBe('BIOTRONIK');
            expect(ra?.impedance?.value).toBe('468');
            expect(ra?.pacing_threshold?.value).toBe('0.7 @ 0.4');

            const rv = result?.leads?.find(l => l.name === 'RV-Lead');
            expect(rv?.model).toBe('Solia T 60');
            expect(rv?.impedance?.value).toBe('585');
            expect(rv?.pacing_threshold?.value).toBe('0.8 @ 0.4');
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

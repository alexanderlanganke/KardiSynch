import { describe, it, expect } from 'vitest';
import { analyzeBiotronikXml } from '../parsers/biotronik-analyzer';

const MOCK_XML = `
<InterfaceData xmlns:carddas="http://med.ge.com//carddas">
    <Patient>
        <PersonalData>
            <FirstName>Max</FirstName>
            <Name>Muster</Name>
            <DOB>1950-01-01</DOB>
        </PersonalData>
    </Patient>
    <Examination>
        <ExaminationDate>2025-01-15</ExaminationDate>
        <Measurements>
            <Table>
                <TableName>TBU_DEFI_DATA</TableName>
                <TableEntry><AttributeName>MANUFACTURERDESCR</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
                <TableEntry><AttributeName>CATAGGREGATDESCR</AttributeName><CharValue>Rivacor 7 HF-T QP</CharValue></TableEntry>
                <TableEntry><AttributeName>SERHSM</AttributeName><CharValue>88763967</CharValue></TableEntry>
                <TableEntry><AttributeName>ACTBATTERYVOLTAGE</AttributeName><DecimalValue>3.1</DecimalValue></TableEntry>
                <TableEntry><AttributeName>FU_RA_SENSING</AttributeName><DecimalValue>1.4</DecimalValue></TableEntry>
                <TableEntry><AttributeName>FU_RA_IMPED</AttributeName><DecimalValue>558</DecimalValue></TableEntry>
            </Table>
            <Table>
                <TableName>9002</TableName>
                <TableEntry><AttributeName>Kanäle</AttributeName><CharValue>RA</CharValue></TableEntry>
                <TableEntry><AttributeName>Kanäle</AttributeName><CharValue>RV</CharValue></TableEntry>
                <TableEntry><AttributeName>Hersteller</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
                <TableEntry><AttributeName>Hersteller</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
                <TableEntry><AttributeName>Elektrodenmodell</AttributeName><CharValue>Solia S 53</CharValue></TableEntry>
                <TableEntry><AttributeName>Elektrodenmodell</AttributeName><CharValue>Plexa MRI S 65</CharValue></TableEntry>
                <TableEntry><AttributeName>Seriennummer</AttributeName><CharValue>11111</CharValue></TableEntry>
                <TableEntry><AttributeName>Seriennummer</AttributeName><CharValue>22222</CharValue></TableEntry>
            </Table>
            <Table>
                <TableName>9473</TableName>
                <TableEntry><AttributeName>Atriale Arrhythmielast</AttributeName><CharValue>5%</CharValue></TableEntry>
            </Table>
            <Table>
                <TableName>TBU_EPISODE_LIST</TableName>
                <ForeignKey>
                    <TableEntry><AttributeName>EpisodeType</AttributeName><CharValue>nsT</CharValue></TableEntry>
                </ForeignKey>
            </Table>
        </Measurements>
    </Examination>
</InterfaceData>
`;

describe('Biotronik XML Analyzer', () => {

    it('should find all parser lookup targets in a complete XML', () => {
        const result = analyzeBiotronikXml(MOCK_XML);

        expect(result.parserLookups.summaryTable.found).toBe(true);
        expect(result.parserLookups.summaryTable.foundVia).toBe('MANUFACTURERDESCR');
        expect(result.parserLookups.summaryTable.inTable).toBe('TBU_DEFI_DATA');

        expect(result.parserLookups.settingsTable.found).toBe(true);
        expect(result.parserLookups.settingsTable.foundVia).toBe('Elektrodenmodell');
        expect(result.parserLookups.settingsTable.inTable).toBe('9002');

        expect(result.parserLookups.statsTable.found).toBe(true);
        expect(result.parserLookups.episodeTable.found).toBe(true);

        expect(result.parserLookups.personalData.found).toBe(true);
        expect(result.parserLookups.personalData.availableKeys).toContain('FirstName');
        expect(result.parserLookups.personalData.availableKeys).toContain('Name');
        expect(result.parserLookups.personalData.availableKeys).toContain('DOB');
    });

    it('should enumerate all tables with correct metadata', () => {
        const result = analyzeBiotronikXml(MOCK_XML);

        expect(result.tables).toHaveLength(4);

        const defiTable = result.tables.find(t => t.tableName === 'TBU_DEFI_DATA');
        expect(defiTable).toBeDefined();
        expect(defiTable!.source).toBe('Measurements');
        expect(defiTable!.attributeNames).toContain('MANUFACTURERDESCR');
        expect(defiTable!.attributeNames).toContain('SERHSM');
        expect(defiTable!.valueTypes).toContain('CharValue');
        expect(defiTable!.valueTypes).toContain('DecimalValue');

        const settingsTable = result.tables.find(t => t.tableName === '9002');
        expect(settingsTable).toBeDefined();
        expect(settingsTable!.attributeNames).toContain('Kanäle');
        expect(settingsTable!.attributeNames).toContain('Elektrodenmodell');

        const episodeTable = result.tables.find(t => t.tableName === 'TBU_EPISODE_LIST');
        expect(episodeTable).toBeDefined();
        expect(episodeTable!.hasForeignKeys).toBe(true);
        expect(episodeTable!.foreignKeyCount).toBe(1);
        expect(episodeTable!.foreignKeyAttributeNames).toContain('EpisodeType');
    });

    it('should never include patient values in output', () => {
        const result = analyzeBiotronikXml(MOCK_XML);
        const json = JSON.stringify(result);

        // Patient data that must NOT appear
        expect(json).not.toContain('Max');
        expect(json).not.toContain('Muster');
        expect(json).not.toContain('1950-01-01');
        expect(json).not.toContain('88763967');
        expect(json).not.toContain('Rivacor');
        expect(json).not.toContain('Solia');
        expect(json).not.toContain('Plexa');
        expect(json).not.toContain('11111');
        expect(json).not.toContain('22222');
        expect(json).not.toContain('3.1');
        expect(json).not.toContain('1.4');
        expect(json).not.toContain('558');
    });

    it('should report section hierarchy', () => {
        const result = analyzeBiotronikXml(MOCK_XML);

        expect(result.sectionHierarchy['InterfaceData']).toContain('Patient');
        expect(result.sectionHierarchy['InterfaceData']).toContain('Examination');
        expect(result.sectionHierarchy['InterfaceData > Examination']).toContain('Measurements');
    });

    it('should report failures when tables are missing', () => {
        const minimalXml = `
        <InterfaceData>
            <Examination>
                <Measurements>
                    <Table>
                        <TableName>SomeOtherTable</TableName>
                        <TableEntry><AttributeName>SomeOtherAttr</AttributeName><CharValue>x</CharValue></TableEntry>
                    </Table>
                </Measurements>
            </Examination>
        </InterfaceData>`;

        const result = analyzeBiotronikXml(minimalXml);

        expect(result.parserLookups.summaryTable.found).toBe(false);
        expect(result.parserLookups.settingsTable.found).toBe(false);
        expect(result.parserLookups.statsTable.found).toBe(false);
        expect(result.parserLookups.episodeTable.found).toBe(false);
        expect(result.parserLookups.personalData.found).toBe(false);

        expect(result.tables).toHaveLength(1);
        expect(result.tables[0].tableName).toBe('SomeOtherTable');
    });
});

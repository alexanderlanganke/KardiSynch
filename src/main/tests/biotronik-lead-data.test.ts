
import { describe, it, expect, vi } from 'vitest';
import { parseBiotronikXML } from '../parsers/biotronik-parser';

describe('Biotronik XML Parser (Lead Data)', () => {

    it('should dynamically extract leads from Table 9002', () => {
        const xmlMock = `
        <InterfaceData xmlns:carddas="http://med.ge.com//carddas">
            <Examination>
                <Measurements>
                    <!-- Summary Table for measurements -->
                    <Table>
                        <TableName>TBU_DEFI_DATA</TableName>
                        <TableEntry><AttributeName>MANUFACTURERDESCR</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
                        <TableEntry><AttributeName>CATAGGREGATDESCR</AttributeName><CharValue>Rivacor 7 HF-T QP</CharValue></TableEntry>
                        <TableEntry><AttributeName>SERHSM</AttributeName><CharValue>88763967</CharValue></TableEntry>
                        
                        <!-- Measurements for R/RV -->
                        <TableEntry><AttributeName>FU_RA_SENSING</AttributeName><DecimalValue>1.4</DecimalValue></TableEntry>
                        <TableEntry><AttributeName>FU_RA_IMPED</AttributeName><DecimalValue>558</DecimalValue></TableEntry>
                    </Table>

                    <!-- Settings Table 9002 containing Lead Info -->
                    <Table>
                        <TableName>9002</TableName>
                        <!-- Kanäle (Channels) -->
                        <TableEntry><AttributeName>Kanäle</AttributeName><CharValue>RA</CharValue></TableEntry>
                        <TableEntry><AttributeName>Kanäle</AttributeName><CharValue>RV</CharValue></TableEntry>
                        <TableEntry><AttributeName>Kanäle</AttributeName><CharValue>LV</CharValue></TableEntry>
                        <TableEntry><AttributeName>Kanäle</AttributeName><CharValue>.</CharValue></TableEntry> <!-- Garbage entry to filter -->

                        <!-- Hersteller (Manufacturers) -->
                        <TableEntry><AttributeName>Hersteller</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
                        <TableEntry><AttributeName>Hersteller</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
                        <TableEntry><AttributeName>Hersteller</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
                        <TableEntry><AttributeName>Hersteller</AttributeName><CharValue>.</CharValue></TableEntry>

                        <!-- Elektrodenmodell (Models) -->
                        <TableEntry><AttributeName>Elektrodenmodell</AttributeName><CharValue>Solia S 53</CharValue></TableEntry>
                        <TableEntry><AttributeName>Elektrodenmodell</AttributeName><CharValue>Plexa MRI S 65</CharValue></TableEntry>
                        <TableEntry><AttributeName>Elektrodenmodell</AttributeName><CharValue>Sentus QP</CharValue></TableEntry>
                        <TableEntry><AttributeName>Elektrodenmodell</AttributeName><CharValue>.</CharValue></TableEntry>

                        <!-- Seriennummer (Serials) -->
                        <TableEntry><AttributeName>Seriennummer</AttributeName><CharValue>11111</CharValue></TableEntry>
                        <TableEntry><AttributeName>Seriennummer</AttributeName><CharValue>22222</CharValue></TableEntry>
                        <TableEntry><AttributeName>Seriennummer</AttributeName><CharValue>33333</CharValue></TableEntry>
                        <TableEntry><AttributeName>Seriennummer</AttributeName><CharValue>.</CharValue></TableEntry>
                    </Table>
                </Measurements>
            </Examination>
        </InterfaceData>
        `;

        const result = parseBiotronikXML(xmlMock);

        expect(result).not.toBeNull();
        const leads = result?.leads || [];

        // Verify we found exactly 3 valid leads (ignoring the 4th garbage one)
        expect(leads.length).toBe(3);

        // Verify Lead 1 (RA)
        expect(leads[0].name).toContain('RA'); // Or whatever naming convention we adopt
        expect(leads[0].model).toBe('Solia S 53');
        expect(leads[0].serial).toBe('11111');
        expect(leads[0].manufacturer).toBe('Biotronik');
        // RA measurements should be attached
        expect(leads[0].sensing?.value).toBe('1.4');

        // Verify Lead 2 (RV)
        expect(leads[1].name).toContain('RV');
        expect(leads[1].model).toBe('Plexa MRI S 65');
        expect(leads[1].serial).toBe('22222');

        // Verify Lead 3 (LV)
        expect(leads[2].name).toContain('LV');
        expect(leads[2].model).toBe('Sentus QP');
        expect(leads[2].serial).toBe('33333');
    });

    it('should handle missing measurements gracefully', () => {
        const xmlMock = `
        <InterfaceData xmlns:carddas="http://med.ge.com//carddas">
            <Examination>
                <Measurements>
                    <Table>
                        <TableName>TBU_DEFI_DATA</TableName>
                        <!-- No measurements here -->
                    </Table>
                    <Table>
                        <TableName>9002</TableName>
                        <TableEntry><AttributeName>Kanäle</AttributeName><CharValue>RV</CharValue></TableEntry>
                        <TableEntry><AttributeName>Hersteller</AttributeName><CharValue>Bio</CharValue></TableEntry>
                        <TableEntry><AttributeName>Elektrodenmodell</AttributeName><CharValue>ModelX</CharValue></TableEntry>
                        <TableEntry><AttributeName>Seriennummer</AttributeName><CharValue>123</CharValue></TableEntry>
                    </Table>
                </Measurements>
            </Examination>
        </InterfaceData>
        `;
        const result = parseBiotronikXML(xmlMock);
        expect(result?.leads).toBeDefined();
        const leads = result!.leads!;
        expect(leads).toHaveLength(1);
        expect(leads[0].model).toBe('ModelX');
        expect(leads[0].impedance).toBeUndefined();
    });

    it('should extract leads from pacemaker XMLs using numbered "Kanal 1/2/3/4" format', () => {
        const xmlMock = `
        <InterfaceData xmlns:carddas="http://med.ge.com//carddas">
            <Examination>
                <Measurements>
                    <Table>
                        <TableName>TBU_HSM_DATEN</TableName>
                        <TableEntry><AttributeName>MANUFACTURERDESCR</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
                        <TableEntry><AttributeName>CATAGGREGATDESCR</AttributeName><CharValue>Edora 8 DR-T</CharValue></TableEntry>
                        <TableEntry><AttributeName>SERHSM</AttributeName><CharValue>99887766</CharValue></TableEntry>
                        <TableEntry><AttributeName>FU_RA_SENSING</AttributeName><DecimalValue>2.1</DecimalValue></TableEntry>
                        <TableEntry><AttributeName>FU_RA_IMPED</AttributeName><DecimalValue>480</DecimalValue></TableEntry>
                        <TableEntry><AttributeName>FU_RV_SENSING</AttributeName><DecimalValue>8.5</DecimalValue></TableEntry>
                        <TableEntry><AttributeName>FU_RV_IMPED</AttributeName><DecimalValue>520</DecimalValue></TableEntry>
                    </Table>
                </Measurements>
                <AdditionalMeasurements>
                    <Table>
                        <TableName>9002</TableName>
                        <!-- Numbered channels instead of repeated Kanäle -->
                        <TableEntry><AttributeName>Kanal 1</AttributeName><CharValue>RA</CharValue></TableEntry>
                        <TableEntry><AttributeName>Kanal 2</AttributeName><CharValue>RV</CharValue></TableEntry>
                        <TableEntry><AttributeName>Kanal 3</AttributeName><CharValue>.</CharValue></TableEntry>
                        <TableEntry><AttributeName>Kanal 4</AttributeName><CharValue>.</CharValue></TableEntry>

                        <TableEntry><AttributeName>Hersteller</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
                        <TableEntry><AttributeName>Hersteller</AttributeName><CharValue>Biotronik</CharValue></TableEntry>

                        <TableEntry><AttributeName>Elektrodenmodell</AttributeName><CharValue>Solia S 53</CharValue></TableEntry>
                        <TableEntry><AttributeName>Elektrodenmodell</AttributeName><CharValue>Protego S 60</CharValue></TableEntry>

                        <TableEntry><AttributeName>Seriennummer</AttributeName><CharValue>44444</CharValue></TableEntry>
                        <TableEntry><AttributeName>Seriennummer</AttributeName><CharValue>55555</CharValue></TableEntry>
                    </Table>
                </AdditionalMeasurements>
            </Examination>
        </InterfaceData>
        `;

        const result = parseBiotronikXML(xmlMock);

        expect(result).not.toBeNull();
        const leads = result?.leads || [];

        // Should find exactly 2 leads (Kanal 3/4 are '.' and should be filtered)
        expect(leads.length).toBe(2);

        // RA lead
        expect(leads[0].name).toContain('RA');
        expect(leads[0].model).toBe('Solia S 53');
        expect(leads[0].serial).toBe('44444');
        expect(leads[0].sensing?.value).toBe('2.1');
        expect(leads[0].impedance?.value).toBe('480');

        // RV lead
        expect(leads[1].name).toContain('RV');
        expect(leads[1].model).toBe('Protego S 60');
        expect(leads[1].serial).toBe('55555');
        expect(leads[1].sensing?.value).toBe('8.5');
        expect(leads[1].impedance?.value).toBe('520');

        // Device type should detect pacemaker
        expect(result?.device.type).toBe('Pacemaker');
    });

    it('preserves serial numbers verbatim (leading zeros, E-notation lookalikes)', () => {
        const xmlMock = `
        <InterfaceData>
            <Examination>
                <ExaminationDate>2023-10-27</ExaminationDate>
                <Measurements>
                    <Table>
                        <TableName>TBU_HSM_DATEN</TableName>
                        <TableEntry><AttributeName>MANUFACTURERDESCR</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
                        <TableEntry><AttributeName>CATAGGREGATDESCR</AttributeName><CharValue>Edora 8 DR-T</CharValue></TableEntry>
                        <TableEntry><AttributeName>SERHSM</AttributeName><CharValue>008763967</CharValue></TableEntry>
                    </Table>
                    <Table>
                        <TableName>9002</TableName>
                        <TableEntry><AttributeName>Kanäle</AttributeName><CharValue>RA</CharValue></TableEntry>
                        <TableEntry><AttributeName>Hersteller</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
                        <TableEntry><AttributeName>Elektrodenmodell</AttributeName><CharValue>Solia S 53</CharValue></TableEntry>
                        <TableEntry><AttributeName>Seriennummer</AttributeName><CharValue>60E5</CharValue></TableEntry>
                    </Table>
                </Measurements>
            </Examination>
        </InterfaceData>
        `;

        const result = parseBiotronikXML(xmlMock);

        expect(result).not.toBeNull();
        // Leading zeros must survive (number coercion turned this into "8763967")
        expect(result?.device.serial_number).toBe('008763967');
        // E-notation lookalikes must survive (was expanded to "6000000")
        expect(result?.leads?.[0]?.serial).toBe('60E5');
        expect(result?.interrogation_date).toBe('2023-10-27');
    });
});

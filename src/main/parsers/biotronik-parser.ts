// src/main/parsers/biotronik-parser.ts

import { XMLParser } from 'fast-xml-parser';
import { UnifiedReport, LeadData, BatteryData, Measurement } from '../reports';

/**
* --- Biotronik XML Parser ---
* * This file reads the proprietary Biotronik XML export and transforms
* it into our internal, standardized JSON format.
* * ~<*>~
*/

// --- Helper Functions to navigate the complex XML structure ---

/**
* Finds a specific table in the Biotronik XML structure
*/
function findTable(data: any, tableName: string): any[] | null {
    try {
        const rawTables = data['InterfaceData']['Examination']['Measurements']['Table'];
        const tables = Array.isArray(rawTables) ? rawTables : [rawTables];

        for (const table of tables) {
            if (table['TableName'] === tableName) {
                return table['TableEntry'];
            }
        }
    } catch (e) {
        console.error(`Error finding table: ${tableName}`, e);
    }
    return null;
}

/**
* Finds a value from a table entry
* E.g., findTableEntry(table, 'SERHSM') -> '88763967'
*/
function findEntry(rawTableEntries: any[] | any | null, attributeName: string): string | null {
    if (!rawTableEntries) return null;
    try {
        const tableEntries = Array.isArray(rawTableEntries) ? rawTableEntries : [rawTableEntries];
        const entry = tableEntries.find((e: any) => e['AttributeName'] === attributeName);
        if (!entry) return null;

        if (entry['CharValue']) return String(entry['CharValue']);
        if (entry['DecimalValue']) return entry['DecimalValue'].toString();
        if (entry['SmallIntValue']) return entry['SmallIntValue'].toString();
        if (entry['DateValue']) return String(entry['DateValue']);

    } catch (e) {
        console.error(`Error finding attribute: ${attributeName}`, e);
    }
    return null;
}

/**
* The main parser function.
* @param xmlData The raw XML string content from the .xml file.
* @returns Our standardized JSON object, or null if parsing fails.
*/
export function parseBiotronikXML(xmlData: string): UnifiedReport | null {
    try {
        const parser = new XMLParser({
            transformTagName: (tagName) => {
                const i = tagName.indexOf(':');
                return i > -1 ? tagName.substring(i + 1) : tagName;
            }
        });
        const xml = parser.parse(xmlData);

        // Get the main data tables
        const summaryTable = findTable(xml, 'TBU_DEFI_DATA');
        const settingsTable = findTable(xml, '9002'); // Contains programmed settings
        const statsTable = findTable(xml, '9473'); // Contains arrhythmia stats

        // Count 'nsT' episodes from the episode list (if it exists)
        let nsTCount = 0;
        try {
            const rawTables = xml['InterfaceData']['Examination']['Measurements']['Table'];
            const tables = Array.isArray(rawTables) ? rawTables : [rawTables];
            const episodeTable = tables.find((t: any) => t['TableName'] === 'TBU_EPISODE_LIST');

            if (episodeTable && episodeTable['ForeignKey']) {
                const episodeList = Array.isArray(episodeTable['ForeignKey'])
                    ? episodeTable['ForeignKey']
                    : [episodeTable['ForeignKey']];

                nsTCount = episodeList.filter((ep: any) => {
                    const entries = Array.isArray(ep['TableEntry'])
                        ? ep['TableEntry']
                        : [ep['TableEntry']];
                    return entries.some((e: any) => e['CharValue'] === 'nsT');
                }).length;
            }
        } catch (e) {
            console.warn('Could not parse episode list, setting nsT count to 0');
        }

        // --- Assemble the final standardized object ---
        const personalData = xml['InterfaceData']?.['Patient']?.['PersonalData'];
        console.log('PersonalData keys:', personalData ? Object.keys(personalData) : 'PersonalData is missing');

        const standardizedData: UnifiedReport = {
            manufacturer: findEntry(summaryTable, 'MANUFACTURERDESCR') || 'Biotronik',
            interrogation_date: xml['InterfaceData']['Examination']['ExaminationDate'],
            patient: {
                first_name: personalData?.['FirstName'] || '',
                last_name: personalData?.['Name'] || personalData?.['LastName'] || '',
                dob: personalData?.['DOB'] || personalData?.['DateOfBirth'] || '',
            },
            device: {
                type: 'Unknown',
                model: findEntry(summaryTable, 'CATAGGREGATDESCR') || '',
                serial_number: findEntry(summaryTable, 'SERHSM') || '',
            },
            battery: {
                voltage: {
                    value: findEntry(summaryTable, 'ACTBATTERYVOLTAGE') || '',
                    unit: 'V'
                },
                remaining_longevity: {
                    value: findEntry(settingsTable, 'Batterie-Restkapazität') || '',
                    unit: '%'
                },
                status: findEntry(summaryTable, 'FU1BATTERYSTATUS') || 'Unknown',
            },
            leads: [
                {
                    name: 'A-Lead (RA)',
                    pacing_threshold: {
                        value: `${findEntry(summaryTable, 'A_AMPLITUDE')} @ ${findEntry(summaryTable, 'A_IMPDAUER')}`,
                        unit: 'V @ ms'
                    },
                    sensing: {
                        value: findEntry(summaryTable, 'FU_RA_SENSING') || '',
                        unit: 'mV'
                    },
                    impedance: {
                        value: findEntry(summaryTable, 'FU_RA_IMPED') || '',
                        unit: 'Ohms'
                    },
                },
                {
                    name: 'V-Lead (RV)',
                    pacing_threshold: {
                        value: `${findEntry(summaryTable, 'V_AMPLITUDE')} @ ${findEntry(summaryTable, 'V_IMPDAUER')}`,
                        unit: 'V @ ms'
                    },
                    sensing: {
                        value: findEntry(summaryTable, 'FU_RV_SENSING') || '',
                        unit: 'mV'
                    },
                    impedance: {
                        value: findEntry(summaryTable, 'FU_RV_IMPED') || '',
                        unit: 'Ohms'
                    },
                },
                {
                    name: 'LV-Lead (LV)',
                    pacing_threshold: {
                        value: `${findEntry(summaryTable, 'LV_AMPLITUDE')} @ ${findEntry(summaryTable, 'LV_IMPDAUER')}`,
                        unit: 'V @ ms'
                    },
                    sensing: {
                        value: findEntry(summaryTable, 'FU_LV_SENSING') || '',
                        unit: 'mV'
                    },
                    impedance: {
                        value: findEntry(summaryTable, 'FU_LV_IMPED') || '',
                        unit: 'Ohms'
                    },
                }
            ],
            arrhythmia_summary: {
                atrial_fibrillation_burden: {
                    value: findEntry(statsTable, 'Atriale Arrhythmielast') || '',
                    unit: '%'
                },
                ventricular_tachycardia_episodes: nsTCount,
            },
            raw_text: xmlData,
        };

        console.log('Parsed Biotronik data:', {
            manufacturer: standardizedData.manufacturer,
            interrogation_date: standardizedData.interrogation_date,
            patient: standardizedData.patient,
            device: standardizedData.device
        });

        return standardizedData;

    } catch (error) {
        console.error("Failed to parse Biotronik XML:", error);
        return null;
    }
}

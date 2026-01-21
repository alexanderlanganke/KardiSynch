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
            // String conversion handles cases where '9002' is parsed as number
            if (String(table['TableName']) === tableName) {
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
        const entry = tableEntries.find((e: any) => e['AttributeName']?.toLowerCase() === attributeName.toLowerCase());
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
 * Finds all values for a specific attribute from a table.
 * Returns an array of strings. 
 * Handles cases where the attribute might exist once, multiple times, or not at all.
 */
function findAllEntries(rawTableEntries: any[] | any | null, attributeName: string): string[] {
    if (!rawTableEntries) return [];
    try {
        const tableEntries = Array.isArray(rawTableEntries) ? rawTableEntries : [rawTableEntries];
        return tableEntries
            .filter((e: any) => e['AttributeName']?.toLowerCase() === attributeName.toLowerCase())
            .map((e: any) => {
                if (e['CharValue']) return String(e['CharValue']);
                if (e['DecimalValue']) return e['DecimalValue'].toString();
                if (e['SmallIntValue']) return e['SmallIntValue'].toString();
                if (e['DateValue']) return String(e['DateValue']);
                return '';
            });
    } catch (e) {
        console.error(`Error finding all entries for attribute: ${attributeName}`, e);
        return [];
    }
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

        // Extract hardware info from Table 9002 (Settings)
        let channels = findAllEntries(settingsTable, 'Kanäle');

        const manufacturers = findAllEntries(settingsTable, 'Hersteller');
        const models = findAllEntries(settingsTable, 'Elektrodenmodell');
        const serials = findAllEntries(settingsTable, 'Seriennummer');

        // INTELLIGENT ALIGNMENT FIX:
        // Biotronik XMLs sometimes contain multiple blocks of 'Kanäle' (e.g., historical vs current),
        // but only one block of 'Elektrodenmodell'.
        // If we naive-map, we might map Model[0] to Channel[0] of the wrong block.
        // Logic: If channels are a multiple of models, try to find the best aligned block.

        if (models.length > 0 && channels.length > models.length && channels.length % models.length === 0) {
            console.log(`[Biotronik Parser] Detected channel duplication (${channels.length} channels, ${models.length} models). Attempting alignment...`);

            const blockSize = models.length;
            const blockCount = channels.length / blockSize;
            let bestBlockIndex = 0;
            let bestBlockScore = -1;

            for (let b = 0; b < blockCount; b++) {
                const start = b * blockSize;
                const chunk = channels.slice(start, start + blockSize);

                // Score this chunk:
                // We want Key Information to align.
                // If Model[i] exists and is not '.', then Channel[i] should ideally not be '.'
                let score = 0;
                let hasValidChannel = false;

                for (let i = 0; i < blockSize; i++) {
                    const modelVal = models[i];
                    const channelVal = chunk[i];

                    const modelExists = modelVal && modelVal !== '.' && modelVal !== 'Unknown';
                    const channelExists = channelVal && channelVal !== '.' && channelVal !== 'Unknown';

                    if (modelExists && channelExists) {
                        score += 5; // Strong Match
                    } else if (modelExists && !channelExists) {
                        score -= 5; // Mismatch: Valid model but 'empty' channel
                    } else if (channelExists) {
                        hasValidChannel = true;
                    }
                }

                // Tie-breaker: prefer chunks with more valid channel data overall
                if (hasValidChannel) score += 1;

                // Tie-breaker: prefer later blocks (usually current?)
                // Actually not safe to assume, stick to content match.

                console.log(`Block ${b}: ${chunk.join(', ')} (Score: ${score})`);

                if (score > bestBlockScore) {
                    bestBlockScore = score;
                    bestBlockIndex = b;
                }
            }

            // Slice to use only the best block
            const bestStart = bestBlockIndex * blockSize;
            channels = channels.slice(bestStart, bestStart + blockSize);
            console.log(`Selected Channel Block ${bestBlockIndex}: ${channels.join(', ')}`);
        }

        // Dynamic Lead Construction
        const leads: LeadData[] = [];

        // We iterate through the 'Kanäle' array as it defines the installed slots.
        // We assume the other arrays (manufacturers, models, serials) start at the same index 
        // and align with the channels.
        // NOTE: The XML often ends with a "." or empty entry for unused slots, we must filter those.

        for (let i = 0; i < channels.length; i++) {
            const channel = channels[i];

            // Skip invalid or placeholder channels
            if (!channel || channel === '.' || channel === 'Unknown') continue;

            // Basic Lead Object
            const lead: LeadData = {
                name: `${channel}-Lead`,
                manufacturer: manufacturers[i] && manufacturers[i] !== '.' ? manufacturers[i] : 'Unknown',
                model: models[i] && models[i] !== '.' ? models[i] : undefined,
                serial: serials[i] && serials[i] !== '.' ? serials[i] : undefined
            };

            // Map extracted measurements based on Channel Name
            // Mapping Logic: RA -> FU_RA_*, RV -> FU_RV_*, LV -> FU_LV_*
            let prefix = '';
            if (channel === 'RA') prefix = 'FU_RA';
            else if (channel === 'RV') prefix = 'FU_RV';
            else if (channel === 'LV') prefix = 'FU_LV';

            if (prefix) {
                // Attach Impedance
                const impedVal = findEntry(summaryTable, `${prefix}_IMPED`);
                if (impedVal) {
                    lead.impedance = { value: impedVal, unit: 'Ohms' };
                }

                // Attach Sensing
                const senseVal = findEntry(summaryTable, `${prefix}_SENSING`);
                if (senseVal) {
                    lead.sensing = { value: senseVal, unit: 'mV' };
                }

                // Pacing Threshold (Requires manual constructing from two fields usually)
                // Assuming standard naming like A_AMPLITUDE, V_AMPLITUDE etc. derived from channel
                let pacingPrefix = '';
                if (channel === 'RA') pacingPrefix = 'A';
                else if (channel === 'RV') pacingPrefix = 'V';
                else if (channel === 'LV') pacingPrefix = 'LV';

                const amp = findEntry(summaryTable, `${pacingPrefix}_AMPLITUDE`);
                const pulse = findEntry(summaryTable, `${pacingPrefix}_IMPDAUER`);

                if (amp && pulse) {
                    lead.pacing_threshold = {
                        value: `${amp} @ ${pulse}`,
                        unit: 'V @ ms'
                    };
                }
            }

            leads.push(lead);
        }

        const standardizedData: UnifiedReport = {
            manufacturer: findEntry(summaryTable, 'MANUFACTURERDESCR') || 'Biotronik',
            interrogation_date: xml['InterfaceData']['Examination']['ExaminationDate'],
            patient: {
                first_name: personalData?.['FirstName'] || personalData?.['Vorname'] || '',
                last_name: personalData?.['Name'] || personalData?.['LastName'] || personalData?.['Nachname'] || '',
                dob: personalData?.['DOB'] || personalData?.['DateOfBirth'] || personalData?.['Geburtsdatum'] || personalData?.['BirthDate'] || '',
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

            leads: leads,

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

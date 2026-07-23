// src/main/parsers/biotronik-parser.ts

import { XMLParser } from 'fast-xml-parser';
import { UnifiedReport, LeadData, BatteryData, hasLeadData } from '../reports';
import { normalizeDate } from '../../lib/dates';
import { DiagnosticsCollector, safeExtract, detectVariant, deriveParseStatus } from './parseDiagnostics';

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
        const examination = data['InterfaceData']?.['Examination'];
        if (!examination) return null;

        let tables: any[] = [];

        // Collect tables from Measurements
        if (examination['Measurements']?.['Table']) {
            const mTables = examination['Measurements']['Table'];
            tables = tables.concat(Array.isArray(mTables) ? mTables : [mTables]);
        }

        // Collect tables from AdditionalMeasurements
        if (examination['AdditionalMeasurements']?.['Table']) {
            const amTables = examination['AdditionalMeasurements']['Table'];
            tables = tables.concat(Array.isArray(amTables) ? amTables : [amTables]);
        }

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
        const entry = tableEntries.find((e: any) => String(e['AttributeName'] ?? '').toLowerCase() === attributeName.toLowerCase());
        if (!entry) return null;

        // Explicit null/empty checks so legitimate 0 values survive
        // (a truthiness check dropped CharValue/DecimalValue of 0).
        const hasValue = (v: any) => v !== undefined && v !== null && v !== '';
        if (hasValue(entry['CharValue'])) return String(entry['CharValue']);
        if (hasValue(entry['DecimalValue'])) return String(entry['DecimalValue']);
        if (hasValue(entry['SmallIntValue'])) return String(entry['SmallIntValue']);
        if (hasValue(entry['DateValue'])) return String(entry['DateValue']);

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
        const hasValue = (v: any) => v !== undefined && v !== null && v !== '';
        return tableEntries
            .filter((e: any) => String(e['AttributeName'] ?? '').toLowerCase() === attributeName.toLowerCase())
            .map((e: any) => {
                if (hasValue(e['CharValue'])) return String(e['CharValue']);
                if (hasValue(e['DecimalValue'])) return String(e['DecimalValue']);
                if (hasValue(e['SmallIntValue'])) return String(e['SmallIntValue']);
                if (hasValue(e['DateValue'])) return String(e['DateValue']);
                return '';
            });
    } catch (e) {
        console.error(`Error finding all entries for attribute: ${attributeName}`, e);
        return [];
    }
}

/**
 * Finds the first table that contains a specific attribute name.
 * Useful when table names vary (e.g. 9002 vs 9006) but content schema is consistent.
 */
function findTableByAttribute(data: any, attributeName: string): any[] | null {
    try {
        const examination = data['InterfaceData']?.['Examination'];
        if (!examination) return null;

        let tables: any[] = [];
        // Collect tables from Measurements
        if (examination['Measurements']?.['Table']) {
            const mTables = examination['Measurements']['Table'];
            tables = tables.concat(Array.isArray(mTables) ? mTables : [mTables]);
        }
        // Collect tables from AdditionalMeasurements
        if (examination['AdditionalMeasurements']?.['Table']) {
            const amTables = examination['AdditionalMeasurements']['Table'];
            tables = tables.concat(Array.isArray(amTables) ? amTables : [amTables]);
        }

        for (const table of tables) {
            const entries = table['TableEntry'];
            if (!entries) continue;

            const entriesArr = Array.isArray(entries) ? entries : [entries];
            const hasAttribute = entriesArr.some((e: any) =>
                e['AttributeName']?.toLowerCase() === attributeName.toLowerCase()
            );

            if (hasAttribute) {
                console.log(`[Biotronik Parser] Found '${attributeName}' in table '${table['TableName']}'`);
                return entries; // Return the entries of the matching table
            }
        }
    } catch (e) {
        console.error(`Error searching table for attribute: ${attributeName}`, e);
    }
    return null;
}

/**
 * Finds entries by trying multiple attribute name variants (e.g. German + English).
 */
function findEntryMultilang(table: any[] | any | null, ...names: string[]): string | null {
    for (const name of names) {
        const result = findEntry(table, name);
        if (result) return result;
    }
    return null;
}

function findAllEntriesMultilang(table: any[] | any | null, ...names: string[]): string[] {
    for (const name of names) {
        const result = findAllEntries(table, name);
        if (result.length > 0) return result;
    }
    return [];
}

/**
* The main parser function.
* @param xmlData The raw XML string content from the .xml file.
* @returns Our standardized JSON object, or null if parsing fails.
*/
export function parseBiotronikXML(xmlData: string): UnifiedReport | null {
    const collector = new DiagnosticsCollector();
    let xml: any;

    try {
        const parser = new XMLParser({
            transformTagName: (tagName) => {
                const i = tagName.indexOf(':');
                return i > -1 ? tagName.substring(i + 1) : tagName;
            },
            // Keep values as strings: number coercion stripped leading zeros
            // from serials ("008763967" -> 8763967) and mangled values like
            // "60E5" (scientific notation -> 6000000), breaking serial matching.
            parseTagValue: false
        });
        xml = parser.parse(xmlData);
    } catch (error) {
        // The XML itself is unreadable — there is genuinely nothing to
        // extract, unlike a structurally-unexpected-but-valid XML below.
        console.error("Failed to parse Biotronik XML:", error);
        return null;
    }

    // --- Table discovery (this IS the format-variant detection: which of the
    // known attribute-name spellings actually matched tells us which schema
    // revision we're looking at, instead of silently falling through). ---
    const summaryResult = detectVariant(collector, 'summaryTable', [
        { name: 'summary=MANUFACTURERDESCR', test: () => findTableByAttribute(xml, 'MANUFACTURERDESCR') },
        { name: 'summary=CATAGGREGATDESCR', test: () => findTableByAttribute(xml, 'CATAGGREGATDESCR') },
    ]);
    const summaryTable = summaryResult?.value ?? null;
    if (!summaryResult) {
        // Device/battery identity depends entirely on this table — losing it
        // silently used to yield an empty-but-"successful" report.
        collector.error('summaryTable', 'No summary table found via any known attribute name — likely an unrecognized or very old Biotronik export.');
    }

    const settingsResult = detectVariant(collector, 'settingsTable', [
        { name: 'settings=Elektrodenmodell', test: () => findTableByAttribute(xml, 'Elektrodenmodell') },
        { name: 'settings=LeadModel', test: () => findTableByAttribute(xml, 'LeadModel') },
        { name: 'settings=Kanäle', test: () => findTableByAttribute(xml, 'Kanäle') },
        { name: 'settings=Channels', test: () => findTableByAttribute(xml, 'Channels') },
    ]);
    const settingsTable = settingsResult?.value ?? null;

    const statsTable = safeExtract(collector, 'statsTable', () => findTable(xml, '9473'), null); // Contains arrhythmia stats

    // Battery remaining-capacity sometimes lives in a separate
    // AdditionalMeasurements table (seen as table '9112' on a real Amvia Sky
    // sample) rather than settingsTable, where the lookup below checks
    // first. findTableByAttribute already searches AdditionalMeasurements
    // too, so this is found by attribute name rather than a hardcoded table
    // number, in case a different export uses a different table for it.
    // Not wrapped in detectVariant: unlike summary/settings tables, battery
    // capacity is genuinely optional in some exports, so a file that simply
    // doesn't report it shouldn't get a diagnostic (and the parseStatus
    // downgrade that comes with one).
    const batteryTable = safeExtract(collector, 'batteryTable', () =>
        findTableByAttribute(xml, 'Batterie-Restkapazität') || findTableByAttribute(xml, 'BatteryRemainingCapacity'),
        null);

    // Count 'nsT' episodes from the episode list (if it exists)
    const nsTCount = safeExtract(collector, 'episodeList', () => {
        const rawTables = xml['InterfaceData']['Examination']['Measurements']['Table'];
        const tables = Array.isArray(rawTables) ? rawTables : [rawTables];
        const episodeTable = tables.find((t: any) => t['TableName'] === 'TBU_EPISODE_LIST');

        if (!episodeTable || !episodeTable['ForeignKey']) return 0;

        const episodeList = Array.isArray(episodeTable['ForeignKey'])
            ? episodeTable['ForeignKey']
            : [episodeTable['ForeignKey']];

        return episodeList.filter((ep: any) => {
            const entries = Array.isArray(ep['TableEntry'])
                ? ep['TableEntry']
                : [ep['TableEntry']];
            return entries.some((e: any) => e['CharValue'] === 'nsT');
        }).length;
    }, 0);

    // --- Assemble the final standardized object ---
    const personalData = xml['InterfaceData']?.['Patient']?.['PersonalData'];

    // Extract hardware info from Table 9002 (Settings)
    let channels = safeExtract(collector, 'leads.channels', () => findAllEntriesMultilang(settingsTable, 'Kanäle', 'Channels'), [] as string[]);
    let channelVariant: string | null = channels.length > 0 ? 'channels=Kanäle/Channels' : null;

    // Fallback: Pacemaker XMLs use numbered "Kanal 1"..."Kanal 4" instead of repeated "Kanäle"
    if (channels.length === 0 && settingsTable) {
        const numberedChannels = safeExtract(collector, 'leads.channels.numbered', () => {
            const found: string[] = [];
            for (let k = 1; k <= 4; k++) {
                const val = findEntry(settingsTable, `Kanal ${k}`);
                if (val && val !== '.' && val !== 'Unknown') {
                    found.push(val);
                }
            }
            return found;
        }, [] as string[]);
        if (numberedChannels.length > 0) {
            channels = numberedChannels;
            channelVariant = 'channels=numbered';
            console.log(`[Biotronik Parser] Using numbered channel format: ${channels.join(', ')}`);
        }
    }

    const manufacturers = safeExtract(collector, 'leads.manufacturers', () => findAllEntriesMultilang(settingsTable, 'Hersteller', 'Manufacturer'), [] as string[]);
    const models = safeExtract(collector, 'leads.models', () => findAllEntriesMultilang(settingsTable, 'Elektrodenmodell', 'LeadModel'), [] as string[]);
    const serials = safeExtract(collector, 'leads.serials', () => findAllEntriesMultilang(settingsTable, 'Seriennummer', 'SerialNumber'), [] as string[]);

    // INTELLIGENT ALIGNMENT FIX:
    // Biotronik XMLs sometimes contain multiple blocks of 'Kanäle' (e.g., historical vs current),
    // but only one block of 'Elektrodenmodell'.
    // If we naive-map, we might map Model[0] to Channel[0] of the wrong block.
    // Logic: If channels are a multiple of models, try to find the best aligned block.
    channels = safeExtract(collector, 'leads.channelAlignment', () => {
        if (!(models.length > 0 && channels.length > models.length && channels.length % models.length === 0)) {
            return channels;
        }
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

            console.log(`Block ${b}: ${chunk.join(', ')} (Score: ${score})`);

            if (score > bestBlockScore) {
                bestBlockScore = score;
                bestBlockIndex = b;
            }
        }

        // Slice to use only the best block
        const bestStart = bestBlockIndex * blockSize;
        const aligned = channels.slice(bestStart, bestStart + blockSize);
        console.log(`Selected Channel Block ${bestBlockIndex}: ${aligned.join(', ')}`);
        return aligned;
    }, channels);

    // Dynamic Lead Construction
    //
    // We iterate through the 'Kanäle' array as it defines the installed slots.
    // We assume the other arrays (manufacturers, models, serials) start at the same index
    // and align with the channels.
    // NOTE: The XML often ends with a "." or empty entry for unused slots, we must filter those.
    const leads: LeadData[] = safeExtract(collector, 'leads', () => {
        const built: LeadData[] = [];
        for (let i = 0; i < channels.length; i++) {
            const channel = channels[i];

            // Skip invalid or placeholder channels
            if (!channel || channel === '.' || channel === 'Unknown') continue;

            const lead: LeadData = safeExtract(collector, `leads[${channel}]`, () => {
                // Basic Lead Object
                const built_lead: LeadData = {
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
                        built_lead.impedance = { value: impedVal, unit: 'Ohms' };
                    }

                    // Attach Sensing
                    const senseVal = findEntry(summaryTable, `${prefix}_SENSING`);
                    if (senseVal) {
                        built_lead.sensing = { value: senseVal, unit: 'mV' };
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
                        built_lead.pacing_threshold = {
                            value: `${amp} @ ${pulse}`,
                            unit: 'V @ ms'
                        };
                    }
                }
                return built_lead;
            }, { name: `${channel}-Lead` });

            if (hasLeadData(lead)) {
                built.push(lead);
            }
        }
        return built;
    }, []);

    // Infer device type from model name
    const deviceModelStr = safeExtract(collector, 'device.model', () => findEntry(summaryTable, 'CATAGGREGATDESCR') || '', '');
    const deviceType = safeExtract(collector, 'device.type', () => {
        const deviceModelUpper = deviceModelStr.toUpperCase();
        if (deviceModelUpper.includes('CRT-D') || deviceModelUpper.includes('HF-T')) return 'CRT-D';
        if (deviceModelUpper.includes('CRT-P') || deviceModelUpper.includes('HF-P')) return 'CRT-P';
        if (deviceModelUpper.includes('ICD') || deviceModelUpper.includes('DEFI') || deviceModelUpper.includes('LUMAX') || deviceModelUpper.includes('IFORIA') || deviceModelUpper.includes('ILIVIA')) return 'ICD';
        if (deviceModelUpper.includes('HSM') || deviceModelUpper.includes('ENTOVIS') || deviceModelUpper.includes('EDORA') || deviceModelUpper.includes('EFFECTA') || deviceModelUpper.includes('AMVIA')) return 'Pacemaker';
        // FunctionalDomain is the source system's own device-category code —
        // 'HSM' (Herzschrittmacher/pacemaker) is the one value confirmed
        // against a real sample (Amvia Sky, a pacemaker family not covered
        // by any of the keyword checks above). Only trusted for this one
        // known value; anything else falls through to 'Unknown' rather than
        // guessing what an unconfirmed code means.
        if (xml['InterfaceData']?.['Examination']?.['FunctionalDomain'] === 'HSM') return 'Pacemaker';
        return 'Unknown';
    }, 'Unknown');

    const patient = safeExtract(collector, 'patient', () => ({
        first_name: personalData?.['FirstName'] || personalData?.['Vorname'] || '',
        last_name: personalData?.['Name'] || personalData?.['LastName'] || personalData?.['Nachname'] || '',
        dob: normalizeDate(personalData?.['DOB'] || personalData?.['DateOfBirth'] || personalData?.['Geburtsdatum'] || personalData?.['BirthDate'] || '', 'eu'),
    }), { first_name: '', last_name: '', dob: '' });

    const deviceSerial = safeExtract(collector, 'device.serial_number', () => findEntry(summaryTable, 'SERHSM') || '', '');

    const battery = safeExtract<BatteryData>(collector, 'battery', () => ({
        voltage: {
            value: findEntry(summaryTable, 'ACTBATTERYVOLTAGE') || '',
            unit: 'V'
        },
        remaining_longevity: {
            // The raw value sometimes carries its own trailing '%' (e.g.
            // "95%") alongside the separate unit field below — strip it so
            // the two don't end up duplicated wherever this gets displayed.
            value: (findEntryMultilang(settingsTable, 'Batterie-Restkapazität', 'BatteryRemainingCapacity')
                || findEntryMultilang(batteryTable, 'Batterie-Restkapazität', 'BatteryRemainingCapacity')
                || '').replace(/%\s*$/, ''),
            unit: '%'
        },
        status: findEntryMultilang(summaryTable, 'FU1BATTERYSTATUS', 'BATTERYSTATUS') || 'Unknown',
    }), {});

    const arrhythmiaSummary = safeExtract<NonNullable<UnifiedReport['arrhythmia_summary']>>(collector, 'arrhythmia_summary', () => ({
        atrial_fibrillation_burden: {
            value: findEntryMultilang(statsTable, 'Atriale Arrhythmielast', 'Atrial Arrhythmia Burden') || '',
            unit: '%'
        },
        ventricular_tachycardia_episodes: nsTCount,
    }), {});

    const formatVariant = [
        summaryResult ? summaryResult.variant : 'summary=unmatched',
        settingsResult ? settingsResult.variant : 'settings=unmatched',
        channelVariant,
    ].filter(Boolean).join(';');

    const hasPatientIdentity = !!(patient.last_name || patient.dob);
    const hasDeviceIdentity = !!(deviceModelStr || deviceSerial);

    const standardizedData: UnifiedReport = {
        manufacturer: safeExtract(collector, 'manufacturer', () => findEntry(summaryTable, 'MANUFACTURERDESCR') || 'Biotronik', 'Biotronik'),
        interrogation_date: safeExtract(collector, 'interrogation_date', () => normalizeDate(xml['InterfaceData']?.['Examination']?.['ExaminationDate'], 'eu'), ''),
        patient,
        device: {
            type: deviceType,
            model: deviceModelStr,
            serial_number: deviceSerial,
        },
        battery,
        leads,
        arrhythmia_summary: arrhythmiaSummary,
        raw_text: xmlData,
        formatVariant: `biotronik:${formatVariant}`,
        parseWarnings: collector.list,
        parseStatus: deriveParseStatus(collector, hasPatientIdentity, hasDeviceIdentity),
    };

    return standardizedData;
}

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
* Finds a specific
*/
function findTable(data: any, tableName: string): any[] | null {
try {
const tables = data['carddas:InterfaceData']['carddas:Examination']['carddas:Measurements']['carddas:Table'];
for (const table of tables) {
if (table['carddas:TableName'] === tableName) {
return table['carddas:TableEntry'];
}
}
} catch (e) {
console.error(`Error finding table: ${tableName}`, e);
}
return null;
}

/**
* Finds a value from a
* E.g., findTableEntry(table, 'SERHSM') -> '88763967'
*/
function findEntry(tableEntries: any[], attributeName: string): string | null {
if (!tableEntries) return null;
try {
const entry = tableEntries.find(e => e['carddas:AttributeName'] === attributeName);
if (!entry) return null;

if (entry['carddas:CharValue']) return entry['carddas:CharValue'];
if (entry['carddas:DecimalValue']) return entry['carddas:DecimalValue'].toString();
if (entry['carddas:SmallIntValue']) return entry['carddas:SmallIntValue'].toString();
if (entry['carddas:DateValue']) return entry['carddas:DateValue'];

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
const parser = new XMLParser();
const xml = parser.parse(xmlData);

// Get the two main data tables
const summaryTable = findTable(xml, 'TBU_DEFI_DATA');
const settingsTable = findTable(xml, '9002'); // Contains programmed settings
const statsTable = findTable(xml, '9473'); // Contains arrhythmia stats

// Count 'nsT' episodes from the episode list
const episodeList = xml['carddas:InterfaceData']['carddas:Examination']['carddas:Measurements']['carddas:Table'].find((t: any) => t['carddas:TableName'] === 'TBU_EPISODE_LIST')['carddas:ForeignKey'];
const nsTCount = episodeList.filter((ep: any) => ep['carddas:TableEntry'].find((e:any) => e['carddas:CharValue'] === 'nsT')).length;

// --- Assemble the final standardized object ---
const standardizedData: UnifiedReport = {
manufacturer: findEntry(summaryTable, 'MANUFACTURERDESCR') || 'Biotronik',
interrogation_date: xml['carddas:InterfaceData']['carddas:Examination']['carddas:ExaminationDate'],
patient: {
first_name: findEntry(summaryTable, 'VORNAME') || '',
last_name: findEntry(summaryTable, 'NAME') || '',
dob: findEntry(summaryTable, 'GEBURTSDATUM') || '',
},
device: {
type: 'Unknown', // This information doesn't seem to be in the provided XML structure
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

return standardizedData;

} catch (error) {
console.error("Failed to parse Biotronik XML:", error);
return null;
}
}

// src/main/parsers/biotronik-analyzer.ts
// Structural analyzer for Biotronik XML files.
// Returns the XML skeleton (tag names, table names, attribute names) with ALL patient values stripped.
// Used for debugging parser failures without exposing PHI.

import { XMLParser } from 'fast-xml-parser';

export interface TableAnalysis {
    tableName: string;
    source: string;
    entryCount: number;
    attributeNames: string[];
    valueTypes: string[];
    hasForeignKeys: boolean;
    foreignKeyCount: number;
    foreignKeyAttributeNames: string[];
}

export interface BiotronikAnalysis {
    /** All unique tag paths found in the XML (no values) */
    tagPaths: string[];

    /** Keys directly under each major section */
    sectionHierarchy: Record<string, string[]>;

    /** All tables found, with their attribute names and metadata */
    tables: TableAnalysis[];

    /** Simulates the parser's lookup strategy and reports what would succeed/fail */
    parserLookups: {
        summaryTable: { found: boolean; foundVia: string | null; inTable: string | null };
        settingsTable: { found: boolean; foundVia: string | null; inTable: string | null };
        statsTable: { found: boolean };
        episodeTable: { found: boolean };
        personalData: { found: boolean; availableKeys: string[] };
    };
}

/**
 * Recursively collects all tag paths from a parsed XML object.
 * Only records object keys — never leaf values (strings, numbers, booleans).
 * Caps at depth 8 and max 500 paths to stay fast on large files.
 */
function collectTagPaths(obj: any, prefix: string, paths: Set<string>, depth: number): void {
    if (depth > 8 || paths.size > 500 || obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
        // Recurse into first element only as representative
        if (obj.length > 0 && typeof obj[0] === 'object') {
            collectTagPaths(obj[0], prefix + '[]', paths, depth + 1);
        }
        return;
    }

    if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            if (paths.size > 500) return;
            const childPath = prefix ? `${prefix} > ${key}` : key;
            paths.add(childPath);
            collectTagPaths(obj[key], childPath, paths, depth + 1);
        }
    }
}

/**
 * Analyzes a single Table element and returns its structural metadata.
 */
function analyzeTable(table: any, source: string): TableAnalysis {
    const tableName = String(table['TableName'] ?? '(unnamed)');
    const entries = table['TableEntry'];
    const entriesArr = !entries ? [] : Array.isArray(entries) ? entries : [entries];

    const attributeNames = new Set<string>();
    const valueTypes = new Set<string>();

    for (const entry of entriesArr) {
        if (entry['AttributeName']) {
            attributeNames.add(String(entry['AttributeName']));
        }
        // Record which value type keys are present (not their values)
        for (const key of ['CharValue', 'DecimalValue', 'SmallIntValue', 'DateValue']) {
            if (entry[key] !== undefined) valueTypes.add(key);
        }
    }

    // Check ForeignKey sub-structures
    const foreignKeys = table['ForeignKey'];
    const foreignKeysArr = !foreignKeys ? [] : Array.isArray(foreignKeys) ? foreignKeys : [foreignKeys];
    const fkAttributeNames = new Set<string>();

    for (const fk of foreignKeysArr) {
        const fkEntries = fk['TableEntry'];
        const fkEntriesArr = !fkEntries ? [] : Array.isArray(fkEntries) ? fkEntries : [fkEntries];
        for (const entry of fkEntriesArr) {
            if (entry['AttributeName']) {
                fkAttributeNames.add(String(entry['AttributeName']));
            }
        }
    }

    return {
        tableName,
        source,
        entryCount: entriesArr.length,
        attributeNames: [...attributeNames].sort(),
        valueTypes: [...valueTypes].sort(),
        hasForeignKeys: foreignKeysArr.length > 0,
        foreignKeyCount: foreignKeysArr.length,
        foreignKeyAttributeNames: [...fkAttributeNames].sort(),
    };
}

/**
 * Collects all Table elements from Measurements and AdditionalMeasurements,
 * mirroring the parser's `findTable` / `findTableByAttribute` search scope.
 */
function collectTables(examination: any): { table: any; source: string }[] {
    const result: { table: any; source: string }[] = [];

    if (examination?.['Measurements']?.['Table']) {
        const t = examination['Measurements']['Table'];
        const arr = Array.isArray(t) ? t : [t];
        for (const table of arr) {
            result.push({ table, source: 'Measurements' });
        }
    }

    if (examination?.['AdditionalMeasurements']?.['Table']) {
        const t = examination['AdditionalMeasurements']['Table'];
        const arr = Array.isArray(t) ? t : [t];
        for (const table of arr) {
            result.push({ table, source: 'AdditionalMeasurements' });
        }
    }

    return result;
}

/**
 * Simulates findTableByAttribute from biotronik-parser.ts.
 * Returns the table name where the attribute was found, or null.
 */
function findAttributeInTables(tables: { table: any; source: string }[], attributeName: string): string | null {
    for (const { table } of tables) {
        const entries = table['TableEntry'];
        if (!entries) continue;
        const entriesArr = Array.isArray(entries) ? entries : [entries];
        const found = entriesArr.some((e: any) =>
            String(e['AttributeName'] ?? '').toLowerCase() === attributeName.toLowerCase()
        );
        if (found) return String(table['TableName'] ?? '(unnamed)');
    }
    return null;
}

/**
 * Main analyzer function. Takes raw Biotronik XML, returns structural analysis with no patient data.
 */
export function analyzeBiotronikXml(xmlData: string): BiotronikAnalysis {
    const parser = new XMLParser({
        transformTagName: (tagName) => {
            const i = tagName.indexOf(':');
            return i > -1 ? tagName.substring(i + 1) : tagName;
        }
    });
    const xml = parser.parse(xmlData);

    // 1. Collect all tag paths
    const tagPathSet = new Set<string>();
    collectTagPaths(xml, '', tagPathSet, 0);
    const tagPaths = [...tagPathSet].sort();

    // 2. Section hierarchy — keys under major sections (no values)
    const sectionHierarchy: Record<string, string[]> = {};

    const interfaceData = xml['InterfaceData'];
    if (interfaceData && typeof interfaceData === 'object') {
        sectionHierarchy['InterfaceData'] = Object.keys(interfaceData);

        if (interfaceData['Examination'] && typeof interfaceData['Examination'] === 'object') {
            sectionHierarchy['InterfaceData > Examination'] = Object.keys(interfaceData['Examination']);
        }
        if (interfaceData['Patient'] && typeof interfaceData['Patient'] === 'object') {
            sectionHierarchy['InterfaceData > Patient'] = Object.keys(interfaceData['Patient']);

            const pd = interfaceData['Patient']['PersonalData'];
            if (pd && typeof pd === 'object') {
                sectionHierarchy['InterfaceData > Patient > PersonalData'] = Object.keys(pd);
            }
        }
    }

    // 3. Analyze all tables
    const examination = interfaceData?.['Examination'];
    const rawTables = collectTables(examination);
    const tables = rawTables.map(({ table, source }) => analyzeTable(table, source));

    // 4. Simulate parser lookups
    // summaryTable: try MANUFACTURERDESCR, then CATAGGREGATDESCR
    let summaryFound = false;
    let summaryVia: string | null = null;
    let summaryInTable: string | null = null;

    for (const attr of ['MANUFACTURERDESCR', 'CATAGGREGATDESCR']) {
        const tableName = findAttributeInTables(rawTables, attr);
        if (tableName) {
            summaryFound = true;
            summaryVia = attr;
            summaryInTable = tableName;
            break;
        }
    }

    // settingsTable: try Elektrodenmodell, LeadModel, Kanäle, Channels
    let settingsFound = false;
    let settingsVia: string | null = null;
    let settingsInTable: string | null = null;

    for (const attr of ['Elektrodenmodell', 'LeadModel', 'Kanäle', 'Channels']) {
        const tableName = findAttributeInTables(rawTables, attr);
        if (tableName) {
            settingsFound = true;
            settingsVia = attr;
            settingsInTable = tableName;
            break;
        }
    }

    // statsTable: table name 9473
    const statsFound = tables.some(t => t.tableName === '9473');

    // episodeTable: TBU_EPISODE_LIST
    const episodeFound = tables.some(t => t.tableName === 'TBU_EPISODE_LIST');

    // personalData
    const personalData = interfaceData?.['Patient']?.['PersonalData'];
    const personalDataFound = !!personalData && typeof personalData === 'object';
    const personalDataKeys = personalDataFound ? Object.keys(personalData) : [];

    return {
        tagPaths,
        sectionHierarchy,
        tables,
        parserLookups: {
            summaryTable: { found: summaryFound, foundVia: summaryVia, inTable: summaryInTable },
            settingsTable: { found: settingsFound, foundVia: settingsVia, inTable: settingsInTable },
            statsTable: { found: statsFound },
            episodeTable: { found: episodeFound },
            personalData: { found: personalDataFound, availableKeys: personalDataKeys },
        },
    };
}

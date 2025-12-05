
import fs from 'fs';
import path from 'path';
import { parseBiotronikXML } from '../src/main/parsers/biotronik-parser';

const xmlPath = path.join(__dirname, '../_IMPORT/BIOSTD_2025-11-03_14-21-46_SepulvedaSantana_A_88763967.xml');

try {
    console.log(`Reading XML file: ${xmlPath}`);
    const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
    console.log('Parsing XML...');
    const result = parseBiotronikXML(xmlContent);
    console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
    console.error('Error reproducing issue:', error);
}

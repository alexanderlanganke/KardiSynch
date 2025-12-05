
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseBiotronikXML } from '../main/parsers/biotronik-parser';
import { parseBostonScientificBnk } from '../main/parsers/boston-scientific-parser';

describe('Parsers', () => {
    const fixturesDir = path.join(__dirname, 'fixtures');

    describe('Biotronik Parser', () => {
        it('should parse a valid Biotronik XML file', () => {
            const xmlContent = fs.readFileSync(path.join(fixturesDir, 'mock_biotronik.txt'), 'utf-8');
            const result = parseBiotronikXML(xmlContent);
            console.log('Biotronik Result:', JSON.stringify(result, null, 2));

            expect(result).not.toBeNull();
            expect(result?.manufacturer).toBe('Biotronik');
            expect(result?.patient.first_name).toBe('Erika');
            expect(result?.patient.last_name).toBe('Mustermann');
            expect(result?.device.serial_number).toBe('12345678');
            expect(result?.battery?.voltage?.value).toBe('3.1');
        });
    });

    describe('Boston Scientific Parser', () => {
        it('should parse a valid BNK file', () => {
            const bnkContent = fs.readFileSync(path.join(fixturesDir, 'mock_boston.bnk'), 'utf-8');
            const result = parseBostonScientificBnk(bnkContent);
            console.log('Boston Result:', JSON.stringify(result, null, 2));

            expect(result).not.toBeNull();
            expect(result?.manufacturer).toBe('Boston Scientific');
            expect(result?.patient.first_name).toBe('Max');
            expect(result?.patient.last_name).toBe('Mustermann');
            expect(result?.device.serial_number).toBe('123456');
            expect(result?.battery?.voltage?.value).toBe('3.05');
        });
    });
});

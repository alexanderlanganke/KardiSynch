// src/main/tests/parser.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import { parseFile } from '../parser';
import * as biotronikParser from '../parsers/biotronik-parser';
import * as bostonScientificParser from '../parsers/boston-scientific-parser';
import * as medtronicParser from '../parsers/medtronic-parser';
import * as abbottParser from '../parsers/abbott-parser';

// Mock the 'fs/promises' module
vi.mock('fs/promises');

// Mock the specific parsers
vi.mock('../parsers/biotronik-parser');
vi.mock('../parsers/boston-scientific-parser');
vi.mock('../parsers/medtronic-parser');
vi.mock('../parsers/abbott-parser');

describe('parseFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call the Biotronik parser for BIOSTD_ XML files', async () => {
    const filePath = 'BIOSTD_test.xml';
    const xmlData = '<xml></xml>';

    // parseFile reads XML as a Buffer and decodes it (BOM / encoding declaration aware)
    (fs.readFile as vi.Mock).mockResolvedValue(Buffer.from(xmlData, 'utf-8'));

    const spy = vi.spyOn(biotronikParser, 'parseBiotronikXML').mockReturnValue({
        manufacturer: "Biotronik",
        interrogation_date: "",
        patient: {
            first_name: "Test",
            last_name: "Patient",
            dob: "",
            patient_id: "1"
        },
        device: {
            model: "",
            serial_number: "",
        },
        report_id: "1",
        conflicts: []
    });

    await parseFile(filePath);

    expect(fs.readFile).toHaveBeenCalledWith(filePath);
    expect(spy).toHaveBeenCalledWith(xmlData);
  });

  it('should call the Boston Scientific parser for .bnk files', async () => {
    const filePath = 'test.bnk';
    const bnkData = 'key=value';

    (fs.readFile as vi.Mock).mockResolvedValue(bnkData);

    const spy = vi.spyOn(bostonScientificParser, 'parseBostonScientificBnk').mockReturnValue({
        manufacturer: "Boston Scientific",
        interrogation_date: "",
        patient: {
            first_name: "Test",
            last_name: "Patient",
            dob: "",
            patient_id: "1"
        },
        device: {
            model: "",
            serial_number: "",
        },
        report_id: "1",
        conflicts: []
    });

    await parseFile(filePath);

    expect(fs.readFile).toHaveBeenCalledWith(filePath, 'utf-8');
    expect(spy).toHaveBeenCalledWith(bnkData);
  });

  // #147: manufacturer wasn't always set on autoimport — a parser-internal
  // extraction bug/edge case could leave `manufacturer` wrong or 'Unknown'
  // even though the dispatcher already knows the manufacturer for certain
  // from the file's extension/naming convention. parseFile now stamps the
  // known-correct value over whatever the underlying parser returned.
  describe('manufacturer is always stamped from the known file type (#147)', () => {
    const baseReport = {
      manufacturer: 'Unknown',
      interrogation_date: '',
      patient: { first_name: 'Test', last_name: 'Patient', dob: '' },
      device: { type: 'Unknown', model: 'Unknown', serial_number: 'Unknown' },
      battery: {},
      leads: [],
      raw_text: '',
    };

    it('overrides a wrong/Unknown manufacturer for BIOSTD_ XML files', async () => {
      (fs.readFile as vi.Mock).mockResolvedValue(Buffer.from('<xml></xml>', 'utf-8'));
      vi.spyOn(biotronikParser, 'parseBiotronikXML').mockReturnValue({ ...baseReport });

      const result = await parseFile('BIOSTD_test.xml');
      expect(result?.manufacturer).toBe('Biotronik');
    });

    it('overrides a wrong/Unknown manufacturer for .bnk files', async () => {
      (fs.readFile as vi.Mock).mockResolvedValue('key=value');
      vi.spyOn(bostonScientificParser, 'parseBostonScientificBnk').mockReturnValue({ ...baseReport });

      const result = await parseFile('test.bnk');
      expect(result?.manufacturer).toBe('Boston Scientific');
    });

    it('overrides a wrong/Unknown manufacturer for .pdd files', async () => {
      vi.spyOn(medtronicParser, 'parseMedtronicPdd').mockResolvedValue({ ...baseReport });

      const result = await parseFile('test.pdd');
      expect(result?.manufacturer).toBe('Medtronic');
    });

    it('overrides a wrong/Unknown manufacturer for .pkg files', async () => {
      vi.spyOn(medtronicParser, 'parseMedtronicPkg').mockResolvedValue({ ...baseReport });

      const result = await parseFile('test.pkg');
      expect(result?.manufacturer).toBe('Medtronic');
    });

    it('overrides a wrong/Unknown manufacturer for .log files', async () => {
      vi.spyOn(abbottParser, 'parseAbbottLog').mockResolvedValue({ ...baseReport });

      const result = await parseFile('test.log');
      expect(result?.manufacturer).toBe('Abbott');
    });

    it('leaves null results null instead of throwing', async () => {
      vi.spyOn(medtronicParser, 'parseMedtronicPdd').mockResolvedValue(null);
      const result = await parseFile('test.pdd');
      expect(result).toBeNull();
    });

    it('tags a Biotronik PDF (BIOSTD_ filename) as Biotronik even when the filename/text pattern is unrecognized', async () => {
      // Filename includes 'BIOSTD_' but doesn't match extractStructuredData's
      // strict internal date/name/serial regex, and the (empty) PDF text has
      // no manufacturer keyword either — only the dispatcher's own 'BIOSTD_'
      // check knows this is Biotronik.
      (fs.readFile as vi.Mock).mockRejectedValue(new Error('ENOENT'));
      const result = await parseFile('BIOSTD_report_final.pdf');
      expect(result?.manufacturer).toBe('Biotronik');
    });
  });
});

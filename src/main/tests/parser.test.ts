// src/main/tests/parser.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import { parseFile } from '../parser';
import * as biotronikParser from '../parsers/biotronik-parser';
import * as bostonScientificParser from '../parsers/boston-scientific-parser';

// Mock the 'fs/promises' module
vi.mock('fs/promises');

// Mock the specific parsers
vi.mock('../parsers/biotronik-parser');
vi.mock('../parsers/boston-scientific-parser');

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
});

// src/main/tests/parser.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { parseFile } from '../parser';
import * as biotronikParser from '../parsers/biotronik-parser';
import * as bostonScientificParser from '../parsers/boston-scientific-parser';

// Mock the entire 'fs' module
vi.mock('fs');

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

    (fs.readFileSync as vi.Mock).mockReturnValue(xmlData);

    const spy = vi.spyOn(biotronikParser, 'parseBiotronikXML').mockReturnValue({
        manufacturer: "Biotronik",
        interrogation_date: "",
        patient: {
            first_name: "John",
            last_name: "Doe",
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

    expect(fs.readFileSync).toHaveBeenCalledWith(filePath, 'utf-8');
    expect(spy).toHaveBeenCalledWith(xmlData);
  });

  it('should call the Boston Scientific parser for .bnk files', async () => {
    const filePath = 'test.bnk';
    const bnkData = 'key=value';

    (fs.readFileSync as vi.Mock).mockReturnValue(bnkData);

    const spy = vi.spyOn(bostonScientificParser, 'parseBostonScientificBnk').mockReturnValue({
        manufacturer: "Boston Scientific",
        interrogation_date: "",
        patient: {
            first_name: "John",
            last_name: "Doe",
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

    expect(fs.readFileSync).toHaveBeenCalledWith(filePath, 'utf-8');
    expect(spy).toHaveBeenCalledWith(bnkData);
  });
});

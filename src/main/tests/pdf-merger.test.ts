// src/main/tests/pdf-merger.test.ts

import { describe, it, expect } from 'vitest';
import { verifyPdfMatch } from '../pdf-merger';
import { UnifiedReport } from '../reports';

describe('verifyPdfMatch', () => {
  it('should return true when all report data is present in the PDF text', () => {
    const reportData: UnifiedReport = {
      patient: {
        first_name: 'John',
        last_name: 'Doe',
        dob: '1980-01-01',
        patient_id: '12345',
      },
      interrogation_date: '2023-10-27T10:00:00Z',
      device: {
        model: 'SomeModel',
        serial_number: 'SN12345',
      },
      report_id: '',
      conflicts: []
    };

    const pdfText = `
      Patient: Doe, John
      DOB: 1980-01-01
      Date of Interrogation: 2023-10-27
      Device: SomeModel, SN: SN12345
    `;

    expect(verifyPdfMatch(pdfText, reportData)).toBe(true);
  });

  it('should return false if any report data is missing from the PDF text', () => {
    const reportData: UnifiedReport = {
      patient: {
        first_name: 'John',
        last_name: 'Doe',
        dob: '1980-01-01',
        patient_id: '12345',
      },
      interrogation_date: '2023-10-27T10:00:00Z',
      device: {
        model: 'SomeModel',
        serial_number: 'SN12345',
      },
      report_id: '',
      conflicts: []
    };

    const pdfText = `
      Patient: Doe, John
      DOB: 1980-01-01
      Date of Interrogation: 2023-10-27
      Device: SomeModel, SN: MissingSerialNumber
    `;

    expect(verifyPdfMatch(pdfText, reportData)).toBe(false);
  });
});

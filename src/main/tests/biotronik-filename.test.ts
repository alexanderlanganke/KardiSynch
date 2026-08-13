
import { describe, it, expect } from 'vitest';
import { extractStructuredData } from '../utils/pdf-utils';

describe('Biotronik Filename Parsing', () => {
    it('should extract metadata from Biotronik filename', () => {
        const filename = 'BIOSTD_2025-11-03_14-21-46_Muster_Max_88763967.PDF';
        const report = extractStructuredData('', filename);

        expect(report.manufacturer).toBe('Biotronik');
        expect(report.patient.last_name).toBe('Muster');
        expect(report.patient.first_name).toBe('Max');
        expect(report.device.serial_number).toBe('88763967');
        expect(report.interrogation_date).toBe('2025-11-03T14:21:46');
    });

    it('should handle filenames with different casing', () => {
        const filename = 'BIOSTD_2025-11-03_14-21-46_Beispiel_Anna_12345.pdf';
        const report = extractStructuredData('', filename);

        expect(report.patient.last_name).toBe('Beispiel');
        expect(report.patient.first_name).toBe('Anna');
        expect(report.device.serial_number).toBe('12345');
    });

    // Regression for #166: a hyphenated German surname used to fail the
    // whole filename match, leaving patient/serial as "Unknown" and making
    // the standalone PDF unmatchable to its sibling XML's visit.
    it('handles hyphenated compound names without losing the match', () => {
        const filename = 'BIOSTD_2025-11-03_14-21-46_Mueller-Schmidt_Anna-Maria_88763967.PDF';
        const report = extractStructuredData('', filename);

        expect(report.manufacturer).toBe('Biotronik');
        expect(report.patient.last_name).toBe('Mueller-Schmidt');
        expect(report.patient.first_name).toBe('Anna-Maria');
        expect(report.device.serial_number).toBe('88763967');
        expect(report.interrogation_date).toBe('2025-11-03T14:21:46');
    });
});

describe('extractStructuredData date handling', () => {
    it('disambiguates US-style interrogation dates (month > 12 must be the day)', () => {
        const report = extractStructuredData('Interrogation Date: 10/27/2023 14:30');
        expect(report.interrogation_date).toBe('2023-10-27T14:30:00');
    });

    it('keeps day-first for German dotted dates', () => {
        const report = extractStructuredData('Untersuchungsdatum: 06.11.2025');
        expect(report.interrogation_date).toBe('2025-11-06');
    });

    it('parses German month abbreviations', () => {
        const report = extractStructuredData('Unters.datum: 06.Nov.2025 09:15');
        expect(report.interrogation_date).toBe('2025-11-06T09:15:00');
    });

    it('rejects invalid dates instead of storing garbage', () => {
        const report = extractStructuredData('Interrogation Date: 45/27/2023');
        expect(report.interrogation_date).toBe('');
    });

    it('windows 2-digit DOB years into the past', () => {
        const report = extractStructuredData('Geburtsdatum: 15.05.52');
        expect(report.patient.dob).toBe('1952-05-15');
    });
});

describe('extractStructuredData serial extraction', () => {
    it('does not extract a serial from words merely containing "sn"', () => {
        const report = extractStructuredData('Klinik Musterstadt, Hausnummer 12\nKein Gerät');
        expect(report.device.serial_number).toBe('Unknown');
    });

    it('extracts serials from labeled lines', () => {
        expect(extractStructuredData('Seriennummer: 008763967').device.serial_number).toBe('008763967');
        expect(extractStructuredData('SN: ABC12345').device.serial_number).toBe('ABC12345');
    });
});

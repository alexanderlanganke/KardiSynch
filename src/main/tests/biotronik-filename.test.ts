
import { describe, it, expect } from 'vitest';
import { extractStructuredData } from '../utils/pdf-utils';

describe('Biotronik Filename Parsing', () => {
    it('should extract metadata from Biotronik filename', () => {
        const filename = 'BIOSTD_2025-11-03_14-21-46_SepulvedaSantana_A_88763967.PDF';
        const report = extractStructuredData('', filename);

        expect(report.manufacturer).toBe('Biotronik');
        expect(report.patient.last_name).toBe('SepulvedaSantana');
        expect(report.patient.first_name).toBe('A');
        expect(report.device.serial_number).toBe('88763967');
        expect(report.interrogation_date).toBe('2025-11-03T14:21:46');
    });

    it('should handle filenames with different casing', () => {
        const filename = 'BIOSTD_2025-11-03_14-21-46_Doe_John_12345.pdf';
        const report = extractStructuredData('', filename);

        expect(report.patient.last_name).toBe('Doe');
        expect(report.patient.first_name).toBe('John');
        expect(report.device.serial_number).toBe('12345');
    });
});

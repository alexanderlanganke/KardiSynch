// src/main/parsers/boston-scientific-parser.ts

import { UnifiedReport, LeadData, BatteryData, Measurement } from '../reports';

/**
* --- Boston Scientific BNK Parser ---
* * This file reads the proprietary Boston Scientific BNK export and transforms
* it into our internal, standardized JSON format.
* * ~<*>~
*/

/**
* The main parser function.
* @param bnkData The raw string content from the .bnk file.
* @returns Our standardized JSON object, or null if parsing fails.
*/
export function parseBostonScientificBnk(bnkData: string): UnifiedReport | null {
  try {
    const dataMap = new Map<string, string>();
    const lines = bnkData.split(/\r?\n/);

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('#') || trimmedLine.length === 0) {
        continue;
      }

      const commaIndex = trimmedLine.indexOf(',');
      if (commaIndex === -1) {
        continue;
      }

      const key = trimmedLine.substring(0, commaIndex).trim();
      const value = trimmedLine.substring(commaIndex + 1).trim();
      dataMap.set(key, value);
    }

    const report: UnifiedReport = {
        manufacturer: 'Boston Scientific',
        interrogation_date: dataMap.get('Brady.LastInterrogationDate') || new Date().toISOString().split('T')[0],
        patient: {
            first_name: dataMap.get('Patient.PatientFirstName') || '',
            last_name: dataMap.get('Patient.PatientLastName') || '',
            dob: dataMap.get('Patient.PatientDOB') || '',
        },
        device: {
            type: 'Unknown',
            model: dataMap.get('Device.Model') || '',
            serial_number: dataMap.get('Device.SerialNumber') || '',
            implant_date: dataMap.get('Device.ImplantDate') || '',
        },
        battery: {
            voltage: {
                value: dataMap.get('BatteryStatus.BatteryVoltage') || '',
                unit: 'V',
            },
            remaining_longevity: {
                value: dataMap.get('BatteryStatus.EstLongevity') || '',
                unit: 'months',
            },
            status: dataMap.get('BatteryStatus.BatteryPhase') || 'Unknown',
        },
        leads: [], // Lead information is not typically in the BNK file
        raw_text: bnkData,
    };

    return report;
  } catch (error) {
    console.error("Failed to parse Boston Scientific BNK file:", error);
    return null;
  }
}

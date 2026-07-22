import { UnifiedReport } from '../reports';
import { normalizeDate } from '../../lib/dates';
import { DiagnosticsCollector, safeExtract, deriveParseStatus } from './parseDiagnostics';

/**
 * --- Boston Scientific BNK Parser ---
 * This file reads the proprietary Boston Scientific BNK export and transforms
 * it into our internal, standardized JSON format.
 */

/**
 * The main parser function for BNK files.
 * @param bnkData The raw string content from the .bnk file.
 * @returns Our standardized JSON object, or null if parsing fails.
 */
export function parseBostonScientificBnk(bnkData: string): UnifiedReport | null {
  const collector = new DiagnosticsCollector();
  try {
    console.log("Parsing Boston Scientific BNK file...");
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

    if (dataMap.size === 0) {
      collector.error('parse', 'No "key,value" lines recognized in the .bnk file — likely not the expected key/value export format.');
    }

    // Infer device type from model or explicit key
    const deviceType = safeExtract(collector, 'device.type', () => {
      const modelValue = (dataMap.get('Device.Model') || '').toUpperCase();
      const deviceTypeValue = dataMap.get('Device.DeviceType') || '';
      if (deviceTypeValue) return deviceTypeValue;
      if (modelValue.includes('CRT-D')) return 'CRT-D';
      if (modelValue.includes('CRT-P')) return 'CRT-P';
      if (modelValue.includes('S-ICD') || modelValue.includes('EMBLEM') || modelValue.includes('SQ-RX')) return 'S-ICD';
      if (modelValue.includes('ICD') || modelValue.includes('DYNAGEN') || modelValue.includes('ORIGEN') || modelValue.includes('AUTOGEN')) return 'ICD';
      if (modelValue.includes('ACCOLADE') || modelValue.includes('FORMIO') || modelValue.includes('PROPONENT')) return 'Pacemaker';
      return 'Unknown';
    }, 'Unknown');

    const patientLastName = dataMap.get('Patient.PatientLastName') || '';
    const patientDob = dataMap.get('Patient.PatientDOB') || '';
    const deviceModel = dataMap.get('Device.Model') || '';
    const deviceSerial = dataMap.get('Device.SerialNumber') || '';

    if (!patientLastName && !patientDob) {
      collector.warn('patient', 'No patient identity keys (Patient.PatientLastName / Patient.PatientDOB) found in the .bnk file.');
    }
    if (!deviceModel && !deviceSerial) {
      collector.warn('device', 'No device identity keys (Device.Model / Device.SerialNumber) found in the .bnk file.');
    }

    const report: UnifiedReport = {
      manufacturer: 'Boston Scientific',
      interrogation_date: normalizeDate(dataMap.get('Brady.LastInterrogationDate')),
      patient: {
        first_name: dataMap.get('Patient.PatientFirstName') || '',
        last_name: patientLastName,
        dob: normalizeDate(patientDob),
      },
      device: {
        type: deviceType,
        model: deviceModel,
        serial_number: deviceSerial,
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
      formatVariant: 'boston-scientific-bnk',
      parseWarnings: collector.list,
      parseStatus: deriveParseStatus(collector, !!(patientLastName || patientDob), !!(deviceModel || deviceSerial)),
    };

    console.log('BNK file parsed successfully.');
    return report;
  } catch (error) {
    console.error("Failed to parse Boston Scientific BNK file:", error);
    return null;
  }
}

/**
 * Detects if the device is a Standard (PM/ICD/CRT) or an S-ICD based on report content.
 */
function detectDeviceType(text: string): 'Standard' | 'SICD' {
  if (text.includes('S-ICD') || text.includes('Subcutaneous') || text.includes('EMBLEM') || text.includes('SQ-RX')) {
    return 'SICD';
  }
  return 'Standard';
}

/**
 * Parses a Standard Boston Scientific PDF report (PM/ICD/CRT).
 */
function parseStandardBostonPdf(text: string, collector: DiagnosticsCollector): UnifiedReport {
  console.log("Parsing Standard Boston Scientific PDF...");
  const report: UnifiedReport = {
    manufacturer: 'Boston Scientific',
    interrogation_date: '',
    patient: {
      first_name: '',
      last_name: '',
      dob: '',
    },
    device: {
      type: 'Unknown',
      model: '',
      serial_number: '',
    },
    battery: {
      voltage: { value: '', unit: 'V' },
      remaining_longevity: { value: '', unit: '' },
      status: 'Unknown',
    },
    leads: [],
    arrhythmia_summary: {},
    raw_text: text,
  };

  // --- 1. Patient & Report Info ---

  // Strategy: Use DOB as an anchor to find the Name.
  // 1. Find DOB (Geburtsdatum)
  // 2. Search backwards from DOB for the Name (Last, First)
  let nameVariant = 'name=unmatched';

  safeExtract(collector, 'patient', () => {
    // DOB
    // Handles "DOB", "Date of Birth", "Born", "Geburtsdatum"
    // Latitude: "Geburtsdatum 25 Sep 1952"
    let dobIndex = -1;
    const dobMatch = text.match(/(?:DOB|Date of Birth|Born|Geburtsdatum)[:\s]*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
    if (dobMatch) {
      report.patient.dob = normalizeDate(dobMatch[1]);
      dobIndex = dobMatch.index || -1;
    } else {
      console.log("PDF Parsing: DOB not found.");
    }

    // Name
    // If we found the DOB, look in the text preceding it.
    let nameFound = false;
    if (dobIndex !== -1) {
      // Look at the 300 characters before the DOB
      const searchWindow = text.substring(Math.max(0, dobIndex - 300), dobIndex);
      // Look for "Last, First" pattern.
      // We iterate through all matches and pick the one that looks most like a name (not containing keywords)
      // Common keywords to avoid in this window: "Letzte Abfrage in der Praxis", "Bericht", "QUICK NOTES"
      const nameCandidates = [...searchWindow.matchAll(/([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)\s*,\s*([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)/g)];

      // Iterate backwards (closest to DOB first)
      for (let i = nameCandidates.length - 1; i >= 0; i--) {
        const match = nameCandidates[i];
        const last = match[1];
        const first = match[2];

        // Filter out known non-names if they happen to match the pattern (unlikely with comma, but safety first)
        if (last.toLowerCase().includes('bericht') || first.toLowerCase().includes('bericht')) continue;
        if (last.toLowerCase().includes('latitude') || first.toLowerCase().includes('latitude')) continue;
        if (last.toLowerCase().includes('system') || first.toLowerCase().includes('system')) continue;

        report.patient.last_name = last.trim();
        report.patient.first_name = first.trim();
        nameFound = true;
        nameVariant = 'name=dob-anchor';
        break; // Found the closest valid name candidate
      }
    }

    // Fallback if anchor strategy failed (e.g. no DOB found or no name before it)
    if (!nameFound) {
      console.log("PDF Parsing: Anchor strategy failed for Name. Trying standard regexes.");
      const nameMatch = text.match(/(?:Patient(?: Name)?|Patient)\s*:?\s*([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-\s]+)[,\s]+([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-\s]+)/i);
      if (nameMatch) {
        report.patient.last_name = nameMatch[1].replace(/\s+/g, ' ').trim();
        report.patient.first_name = nameMatch[2].replace(/\s+/g, ' ').trim();
        nameVariant = 'name=patient-label';
      } else {
        // Try the Latitude header regex again as a backup
        const latitudeNameMatch = text.match(/LATITUDE.*?System\s+.*?(?:Bericht.*?)?([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)\s*,\s*([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)/i);
        if (latitudeNameMatch) {
          report.patient.last_name = latitudeNameMatch[1].replace(/\s+/g, ' ').trim();
          report.patient.first_name = latitudeNameMatch[2].replace(/\s+/g, ' ').trim();
          nameVariant = 'name=latitude-header';
        } else {
          console.log("PDF Parsing: Name not found.");
        }
      }
    }
    return undefined;
  }, undefined);

  if (nameVariant === 'name=unmatched') {
    collector.warn('patient', 'None of the known name-extraction strategies (DOB-anchor, "Patient:" label, LATITUDE header) matched.');
  }

  // Interrogation Date
  // Handles "Interrogation Date", "Session Date", "Date", "Letzte Nachsorge" (Last Follow-up)
  // Latitude: "Bericht erstel. 02 Nov 2025"
  // Prioritize "Bericht erstellt" / "Bericht erstel."
  safeExtract(collector, 'interrogation_date', () => {
    const reportDateMatch = text.match(/(?:Bericht\s+erstel\.?|Report Created)[:\s]*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
    if (reportDateMatch) {
      report.interrogation_date = normalizeDate(reportDateMatch[1]);
    } else {
      // Bare "Date" must not match implant/birth dates ("Implant Date: ...")
      const dateMatch = text.match(/(?:Interrogation Date|Session Date|Letzte\s+Nachsorge|(?<!Implant\s)(?<!Implantation\s)(?<!Birth\s)(?<!Geburts)Date)[:\s]*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
      if (dateMatch) {
        report.interrogation_date = normalizeDate(dateMatch[1]);
      } else {
        console.log("PDF Parsing: Interrogation Date not found.");
      }
    }
    return undefined;
  }, undefined);

  // --- 2. Device Info ---
  safeExtract(collector, 'device', () => {
    // Model
    // Single-line capture: stops at a line break or 2+ whitespace so the model
    // cannot swallow the following lines.
    const modelMatch = text.match(/(?:Model|Device Model|Aggregat):?[ \t]*([A-Za-z0-9 \t\-]+?)(?=\s{2,}|\r|\n|$|Serial)/i);
    if (modelMatch) {
      report.device.model = modelMatch[1].trim();
    }

    // Serial
    const serialMatch = text.match(/(?:Serial|Serial No|SN):?\s*(\d{5,})/i);
    if (serialMatch) {
      report.device.serial_number = serialMatch[1].trim();
    }
    return undefined;
  }, undefined);

  // --- 3. Battery ---
  safeExtract(collector, 'battery', () => {
    // Voltage
    const voltageMatch = text.match(/(?:Battery Voltage|Voltage):?\s*(\d+(?:\.\d+)?)\s*V/i);
    if (voltageMatch) {
      report.battery.voltage = { value: voltageMatch[1], unit: 'V' };
    }

    // Longevity (Time to Explant)
    const longevityMatch = text.match(/(?:Time to Explant|Longevity|Remaining):?\s*([><]?\s*\d+(?:\.\d+)?\s*(?:Years|Months|Yrs|Mos))/i);
    if (longevityMatch) {
      report.battery.remaining_longevity = { value: longevityMatch[1], unit: '' };
    }

    // Status
    const statusMatch = text.match(/(?:Battery Status|Status):?\s*(Good|ERI|EOS|Explant)/i);
    if (statusMatch) {
      report.battery.status = statusMatch[1];
    }
    return undefined;
  }, undefined);

  // --- 4. Leads (RA, RV, LV) ---
  // This is tricky without exact layout, using best-effort regex for common patterns
  // Pattern: "RA Lead ... Impedance: 450 ... Sensing: 2.5 ... Threshold: 0.75"
  safeExtract(collector, 'leads', () => {
    const extractLead = (chamber: string, name: string) => {
      // Look for a block of text related to the chamber
      // This is a simplification; real PDFs often have tables.
      // We'll look for "Chamber ... Impedance ... Sensing ... Threshold" proximity

      const lead: any = { name: name, impedance: { value: '', unit: 'Ohms' }, sensing: { value: '', unit: 'mV' }, pacing_threshold: { value: '', unit: 'V' } };

      // Impedance (limit search span to avoid matching wrong chamber)
      const impRegex = new RegExp(`${chamber}[\\s\\S]{0,300}?Impedance[^\\n]{0,100}?(\\d{3,4})\\s*Ohms`, 'i');
      const impMatch = text.match(impRegex);
      if (impMatch) lead.impedance.value = impMatch[1];

      // Sensing
      const senseRegex = new RegExp(`${chamber}[\\s\\S]{0,300}?Sensing[^\\n]{0,100}?(\\d+(?:\\.\\d+)?)\\s*mV`, 'i');
      const senseMatch = text.match(senseRegex);
      if (senseMatch) lead.sensing.value = senseMatch[1];

      // Threshold
      const threshRegex = new RegExp(`${chamber}[\\s\\S]{0,300}?Threshold[^\\n]{0,100}?(\\d+(?:\\.\\d+)?)\\s*V`, 'i');
      const threshMatch = text.match(threshRegex);
      if (threshMatch) lead.pacing_threshold.value = threshMatch[1];

      if (lead.impedance.value || lead.sensing.value || lead.pacing_threshold.value) {
        report.leads?.push(lead);
      }
    };

    extractLead('RA', 'Right Atrium');
    extractLead('RV', 'Right Ventricle');
    extractLead('LV', 'Left Ventricle');
    return undefined;
  }, undefined);

  // --- 5. Arrhythmia Summary ---
  safeExtract(collector, 'arrhythmia_summary', () => {
    // AF Burden
    const afMatch = text.match(/(?:AT\/AF Burden|AF Burden|Total AT\/AF):?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (afMatch && report.arrhythmia_summary) {
      report.arrhythmia_summary.atrial_fibrillation_burden = { value: afMatch[1], unit: '%' };
    }
    return undefined;
  }, undefined);

  const hasPatientIdentity = !!(report.patient.last_name || report.patient.dob);
  const hasDeviceIdentity = !!(report.device.model || report.device.serial_number);

  report.formatVariant = `boston-scientific-pdf:standard;${nameVariant}`;
  report.parseWarnings = collector.list;
  report.parseStatus = deriveParseStatus(collector, hasPatientIdentity, hasDeviceIdentity);

  console.log('Standard Boston Scientific PDF parsed.');
  return report;
}

/**
 * Parses an S-ICD Boston Scientific PDF report.
 * Skeleton implementation - to be expanded with sample data.
 */
function parseSicdBostonPdf(text: string, collector: DiagnosticsCollector): UnifiedReport {
  console.log("Parsing S-ICD Boston Scientific PDF...");
  const report: UnifiedReport = {
    manufacturer: 'Boston Scientific',
    interrogation_date: '',
    patient: { first_name: '', last_name: '', dob: '' },
    device: { type: 'S-ICD', model: '', serial_number: '' },
    battery: {},
    leads: [],
    raw_text: text,
  };

  // Basic extraction for S-ICD (Name, Serial)
  safeExtract(collector, 'patient', () => {
    const nameMatch = text.match(/Patient:?\s*([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)[,\s]+([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)/i);
    if (nameMatch) {
      report.patient.last_name = nameMatch[1].trim();
      report.patient.first_name = nameMatch[2].trim();
    } else {
      console.log("S-ICD PDF Parsing: Name not found.");
    }
    return undefined;
  }, undefined);

  safeExtract(collector, 'device.serial_number', () => {
    const serialMatch = text.match(/(?:Serial|SN):?\s*(\d{5,})/i);
    if (serialMatch) {
      report.device.serial_number = serialMatch[1].trim();
    }
    return undefined;
  }, undefined);

  // S-ICD specific: Shock Impedance
  safeExtract(collector, 'leads', () => {
    const shockImpMatch = text.match(/(?:Shock Impedance|Defib Impedance):?\s*(\d+)\s*Ohms/i);
    if (shockImpMatch) {
      report.leads?.push({
        name: 'Shock Coil',
        impedance: { value: shockImpMatch[1], unit: 'Ohms' }
      });
    }
    return undefined;
  }, undefined);

  if (!report.patient.last_name) {
    collector.warn('patient', 'S-ICD PDF: name pattern did not match.');
  }

  const hasPatientIdentity = !!(report.patient.last_name || report.patient.dob);
  const hasDeviceIdentity = !!(report.device.model || report.device.serial_number);

  report.formatVariant = 'boston-scientific-pdf:sicd';
  report.parseWarnings = collector.list;
  report.parseStatus = deriveParseStatus(collector, hasPatientIdentity, hasDeviceIdentity);

  console.log('S-ICD Boston Scientific PDF parsed.');
  return report;
}

/**
 * Main entry point for Boston Scientific PDF parsing.
 * Dispatches to the appropriate parser based on device type.
 */
export function parseBostonScientificPdf(text: string): UnifiedReport {
  const collector = new DiagnosticsCollector();
  const deviceType = detectDeviceType(text);
  console.log(`Detected Boston Scientific Device Type: ${deviceType}`);

  if (deviceType === 'SICD') {
    return parseSicdBostonPdf(text, collector);
  } else {
    return parseStandardBostonPdf(text, collector);
  }
}

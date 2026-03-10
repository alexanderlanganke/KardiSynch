import { UnifiedReport } from '../reports';

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

    // Infer device type from model or explicit key
    let deviceType: string = 'Unknown';
    const modelValue = (dataMap.get('Device.Model') || '').toUpperCase();
    const deviceTypeValue = dataMap.get('Device.DeviceType') || '';
    if (deviceTypeValue) {
      deviceType = deviceTypeValue;
    } else if (modelValue.includes('CRT-D')) {
      deviceType = 'CRT-D';
    } else if (modelValue.includes('CRT-P')) {
      deviceType = 'CRT-P';
    } else if (modelValue.includes('S-ICD') || modelValue.includes('EMBLEM') || modelValue.includes('SQ-RX')) {
      deviceType = 'S-ICD';
    } else if (modelValue.includes('ICD') || modelValue.includes('DYNAGEN') || modelValue.includes('ORIGEN') || modelValue.includes('AUTOGEN')) {
      deviceType = 'ICD';
    } else if (modelValue.includes('ACCOLADE') || modelValue.includes('FORMIO') || modelValue.includes('PROPONENT')) {
      deviceType = 'Pacemaker';
    }

    const report: UnifiedReport = {
      manufacturer: 'Boston Scientific',
      interrogation_date: dataMap.get('Brady.LastInterrogationDate') || '',
      patient: {
        first_name: dataMap.get('Patient.PatientFirstName') || '',
        last_name: dataMap.get('Patient.PatientLastName') || '',
        dob: dataMap.get('Patient.PatientDOB') || '',
      },
      device: {
        type: deviceType,
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
function parseStandardBostonPdf(text: string): UnifiedReport {
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

  // --- Helper: Date Formatter ---
  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        // Adjust for timezone offset to ensure we get the same calendar date
        // new Date() creates a date in local time. toISOString() converts to UTC.
        // If local time is behind UTC, or if the time is 00:00:00, this can shift the day.
        // We shift the time by the timezone offset so that the UTC time matches the local calendar date.
        const offset = date.getTimezoneOffset() * 60000;
        const adjustedDate = new Date(date.getTime() - offset);
        return adjustedDate.toISOString().split('T')[0];
      }
    } catch (e) { /* ignore */ }
    return dateStr;
  };

  // --- 1. Patient & Report Info ---

  // Strategy: Use DOB as an anchor to find the Name.
  // 1. Find DOB (Geburtsdatum)
  // 2. Search backwards from DOB for the Name (Last, First)

  // DOB
  // Handles "DOB", "Date of Birth", "Born", "Geburtsdatum"
  // Latitude: "Geburtsdatum 25 Sep 1952"
  let dobIndex = -1;
  const dobMatch = text.match(/(?:DOB|Date of Birth|Born|Geburtsdatum)[:\s]*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
  if (dobMatch) {
    report.patient.dob = formatDate(dobMatch[1]);
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
    } else {
      // Try the Latitude header regex again as a backup
      const latitudeNameMatch = text.match(/LATITUDE.*?System\s+.*?(?:Bericht.*?)?([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)\s*,\s*([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)/i);
      if (latitudeNameMatch) {
        report.patient.last_name = latitudeNameMatch[1].replace(/\s+/g, ' ').trim();
        report.patient.first_name = latitudeNameMatch[2].replace(/\s+/g, ' ').trim();
      } else {
        console.log("PDF Parsing: Name not found.");
      }
    }
  }

  // Interrogation Date
  // Handles "Interrogation Date", "Session Date", "Date", "Letzte Nachsorge" (Last Follow-up)
  // Latitude: "Bericht erstel. 02 Nov 2025"
  // Prioritize "Bericht erstellt" / "Bericht erstel."
  const reportDateMatch = text.match(/(?:Bericht\s+erstel\.?|Report Created)[:\s]*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
  if (reportDateMatch) {
    report.interrogation_date = formatDate(reportDateMatch[1]);
  } else {
    const dateMatch = text.match(/(?:Interrogation Date|Session Date|Date|Letzte\s+Nachsorge)[:\s]*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
    if (dateMatch) {
      report.interrogation_date = formatDate(dateMatch[1]);
    } else {
      console.log("PDF Parsing: Interrogation Date not found.");
    }
  }

  // --- 2. Device Info ---
  // Model
  const modelMatch = text.match(/(?:Model|Device Model|Aggregat)[:\s]*([A-Za-z0-9\s\-]+?)(?=\s{2,}|$|Serial)/i);
  if (modelMatch) {
    report.device.model = modelMatch[1].trim();
  }

  // Serial
  const serialMatch = text.match(/(?:Serial|Serial No|SN):?\s*(\d{5,})/i);
  if (serialMatch) {
    report.device.serial_number = serialMatch[1].trim();
  }

  // --- 3. Battery ---
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

  // --- 4. Leads (RA, RV, LV) ---
  // This is tricky without exact layout, using best-effort regex for common patterns
  // Pattern: "RA Lead ... Impedance: 450 ... Sensing: 2.5 ... Threshold: 0.75"

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


  // --- 5. Arrhythmia Summary ---
  // AF Burden
  const afMatch = text.match(/(?:AT\/AF Burden|AF Burden|Total AT\/AF):?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (afMatch && report.arrhythmia_summary) {
    report.arrhythmia_summary.atrial_fibrillation_burden = { value: afMatch[1], unit: '%' };
  }

  console.log('Standard Boston Scientific PDF parsed.');
  return report;
}

/**
 * Parses an S-ICD Boston Scientific PDF report.
 * Skeleton implementation - to be expanded with sample data.
 */
function parseSicdBostonPdf(text: string): UnifiedReport {
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
  const nameMatch = text.match(/Patient:?\s*([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)[,\s]+([A-Za-z\u00C0-\u00D6\u00D8-\u00f6\u00f8-\u00ff'-]+)/i);
  if (nameMatch) {
    report.patient.last_name = nameMatch[1].trim();
    report.patient.first_name = nameMatch[2].trim();
  } else {
    console.log("S-ICD PDF Parsing: Name not found.");
  }

  const serialMatch = text.match(/(?:Serial|SN):?\s*(\d{5,})/i);
  if (serialMatch) {
    report.device.serial_number = serialMatch[1].trim();
  }

  // S-ICD specific: Shock Impedance
  const shockImpMatch = text.match(/(?:Shock Impedance|Defib Impedance):?\s*(\d+)\s*Ohms/i);
  if (shockImpMatch) {
    report.leads?.push({
      name: 'Shock Coil',
      impedance: { value: shockImpMatch[1], unit: 'Ohms' }
    });
  }

  console.log('S-ICD Boston Scientific PDF parsed.');
  return report;
}

/**
 * Main entry point for Boston Scientific PDF parsing.
 * Dispatches to the appropriate parser based on device type.
 */
export function parseBostonScientificPdf(text: string): UnifiedReport {
  const deviceType = detectDeviceType(text);
  console.log(`Detected Boston Scientific Device Type: ${deviceType}`);

  if (deviceType === 'SICD') {
    return parseSicdBostonPdf(text);
  } else {
    return parseStandardBostonPdf(text);
  }
}

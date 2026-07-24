import { UnifiedReport, LeadData, hasLeadData } from '../reports';
import { normalizeDate } from '../../lib/dates';
import { DiagnosticsCollector, safeExtract, deriveParseStatus } from './parseDiagnostics';

/**
 * --- Boston Scientific BNK Parser ---
 * This file reads the proprietary Boston Scientific BNK export (a PACEART
 * key/value dump) and transforms it into our internal, standardized JSON
 * format.
 */

/** German "keine Angabe" (no data) sentinel PACEART uses for empty fields. */
const NO_DATA = 'K.A';
const hasValue = (v: string | undefined): v is string => !!v && v !== NO_DATA;

/**
 * Extract a numeric value from a string like "500.0 Ω", "0.4 ms",
 * ">132 months", "45.2 %". Returns null for missing-data sentinels.
 */
function extractBnkNumeric(str: string | undefined): number | null {
  if (!hasValue(str)) return null;
  const m = str.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  return Number.isNaN(val) ? null : val;
}

/**
 * PACEART spells every date in the file as a `{Prefix}Day` / `{Prefix}Month`
 * / `{Prefix}Year` triplet (DOB, device implant date, per-lead implant
 * date) rather than one combined field. Per-lead implant dates only ever
 * carry month+year (no day), so `dayKey` is optional and defaults to the
 * 1st. Any required part missing or 'K.A' means the date is unknown.
 */
function buildPartsDate(dataMap: Map<string, string>, dayKey: string | null, monthKey: string, yearKey: string): string {
  const month = dataMap.get(monthKey);
  const year = dataMap.get(yearKey);
  if (!hasValue(month) || !hasValue(year)) return '';
  const day = dayKey ? dataMap.get(dayKey) : undefined;
  return normalizeDate(`${hasValue(day) ? day : '1'} ${month} ${year}`);
}

/**
 * Every real PACEART export we've seen (test/boston_bnk) starts with '#'
 * comment lines carrying the interrogation date and device model/serial —
 * data the previous parser discarded along with the rest of the comment
 * lines, expecting model/serial instead (never actually present) as
 * `Device.Model` / `Device.SerialNumber` key/value lines:
 *
 *   # TYPE: PACEART           SAVE DATE: 29 Jun 2026
 *   # PROGRAMMER      MODEL: 3300 SERIAL: 000000 APP   MODEL: 3868 VERSION: 2.03
 *   # DEVICE          MODEL: D321-200-0  SERIAL: 000000
 */
function parseBnkHeader(bnkData: string, collector: DiagnosticsCollector): { interrogationDate: string; deviceModel: string; deviceSerial: string } {
  return safeExtract(collector, 'header', () => {
    const result = { interrogationDate: '', deviceModel: '', deviceSerial: '' };
    // Month token may itself be corrupted to '?' in the source export (seen
    // on ~1/3 of real samples, always as literal "M?r" — the export's
    // encoding step apparently can't round-trip 'ä'). Still capture the raw
    // token so it can be repaired below, or fail soft through normalizeDate
    // if it's some other, unrecognized corruption.
    const saveDateMatch = bnkData.match(/^#\s*TYPE:.*?SAVE DATE:\s*(\d{1,2})\s+([A-Za-zÄäÖöÜü?]+)\s+(\d{4})/mi);
    if (saveDateMatch) {
      const month = saveDateMatch[2] === 'M?r' ? 'Mär' : saveDateMatch[2];
      result.interrogationDate = normalizeDate(`${saveDateMatch[1]} ${month} ${saveDateMatch[3]}`);
    }

    const deviceMatch = bnkData.match(/^#\s*DEVICE\s+MODEL:\s*(\S+)\s+SERIAL:\s*(\S+)/mi);
    if (deviceMatch) {
      result.deviceModel = deviceMatch[1];
      result.deviceSerial = deviceMatch[2];
    }
    return result;
  }, { interrogationDate: '', deviceModel: '', deviceSerial: '' });
}

interface BnkLeadSlot {
  manufacturer?: string;
  model?: string;
  serial?: string;
  position?: string;
}

/** Reads one `PatientLead{key}*` slot (key is 'A' or 'V1'..'V5'). Returns null if the slot is unpopulated. */
function readLeadSlot(dataMap: Map<string, string>, key: string): BnkLeadSlot | null {
  const manufacturer = dataMap.get(`PatientLead${key}Manufacturer`);
  const model = dataMap.get(`PatientLead${key}ModelNum`);
  const serial = dataMap.get(`PatientLead${key}SerialNum`);
  const position = dataMap.get(`PatientLead${key}Position`);
  // A lead with a known chamber position but no model/serial (older/partial
  // exports) must still be built — otherwise the caller's impedance/
  // threshold lookups for that slot never run at all.
  if (!hasValue(model) && !hasValue(serial) && !hasValue(position)) return null;
  return {
    manufacturer: hasValue(manufacturer) ? manufacturer : undefined,
    model: hasValue(model) ? model : undefined,
    serial: hasValue(serial) ? serial : undefined,
    position: hasValue(position) ? position : undefined,
  };
}

/**
 * Infers the clinical chamber from a lead's Position text ("Rechter Vorhof",
 * "Rechter Ventrikel", "LV Mitte (poster.)") rather than trusting the slot
 * key (A vs V1-V5) it was stored under. Real exports don't reliably keep
 * those in sync: some records have PatientLeadAPosition = "Rechter
 * Ventrikel" and PatientLeadV1Position = "Rechter Vorhof" — the A/V1 slot
 * appears to track which physical connector port the lead is plugged into,
 * not anatomic chamber. Returns null when the position text itself doesn't
 * say (e.g. "Epikardial" alone, or 'K.A'), so the caller's slot-based
 * default still applies.
 */
function chamberFromPosition(position: string | undefined): 'Atrium' | 'RV' | 'LV' | null {
  if (!position) return null;
  if (/\bLV\b/i.test(position)) return 'LV';
  if (/vorhof|atrial|atrium/i.test(position)) return 'Atrium';
  if (/ventrikel|ventric/i.test(position)) return 'RV';
  return null;
}

/** mV amplitude + ms pulse width -> the "V @ ms" pacing_threshold convention used across parsers. */
function buildPacingThreshold(amplitudeMv: number | null, pulseWidthMs: number | null): LeadData['pacing_threshold'] {
  if (amplitudeMv == null) return undefined;
  const amplitudeV = amplitudeMv / 1000;
  return { value: pulseWidthMs != null ? `${amplitudeV} @ ${pulseWidthMs}` : amplitudeV, unit: pulseWidthMs != null ? 'V @ ms' : 'V' };
}

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

    const header = parseBnkHeader(bnkData, collector);
    const patientLastName = dataMap.get('PatientLastName') || '';
    const patientDob = buildPartsDate(dataMap, 'PatientBirthDay', 'PatientBirthMonth', 'PatientBirthYear');
    const deviceModel = header.deviceModel;
    const deviceSerial = header.deviceSerial;

    if (!patientLastName && !patientDob) {
      collector.warn('patient', 'No patient identity keys (PatientLastName / PatientBirthDay+Month+Year) found in the .bnk file.');
    }
    if (!deviceModel && !deviceSerial) {
      collector.warn('device', 'No device identity found in the "# DEVICE" header line of the .bnk file.');
    }

    // Leads. PACEART keys the atrial lead as "A" and the ventricular lead(s)
    // as "V1".."V5" (CRT devices carry a second/third V-lead for LV, and
    // occasionally a backup RV lead) — which slot is the LV lead varies
    // between exports, so it's identified by its Position text ("LV Mitte
    // (poster.)" etc.) rather than a fixed slot number.
    const leads: LeadData[] = [];

    const atrialLead = safeExtract(collector, 'leads.atrial', () => {
      const slot = readLeadSlot(dataMap, 'A');
      if (!slot) return null;
      const impedance = extractBnkNumeric(dataMap.get('PatientAtrialImped'));
      const threshAmpl = extractBnkNumeric(dataMap.get('PatientAtrialThreshAmpl'));
      const threshPw = extractBnkNumeric(dataMap.get('PatientAtrialThreshPW'));
      return {
        name: chamberFromPosition(slot.position) || 'Atrium',
        manufacturer: slot.manufacturer,
        model: slot.model,
        serial: slot.serial,
        anatomic_location: slot.position,
        implant_date: buildPartsDate(dataMap, null, 'PatientData.LeadA.ImplantMonth', 'PatientData.LeadA.ImplantYear') || undefined,
        impedance: impedance != null ? { value: impedance, unit: 'Ohms' } : undefined,
        pacing_threshold: buildPacingThreshold(threshAmpl, threshPw),
      };
    }, null);
    if (atrialLead && hasLeadData(atrialLead)) leads.push(atrialLead);

    const ventricularLeads = safeExtract(collector, 'leads.ventricular', () => {
      const result: LeadData[] = [];
      let attachedGenericV = false; // PatientVImped/VThreshAmpl/PatientShockImped describe one lead only
      for (let i = 1; i <= 5; i++) {
        const slot = readLeadSlot(dataMap, `V${i}`);
        if (!slot) continue;
        // Default 'RV' when position doesn't say — measurement set below
        // (generic V vs LV-specific) still keys off isLV either way.
        const chamber = chamberFromPosition(slot.position) || 'RV';
        const isLV = chamber === 'LV';

        let impedance: LeadData['impedance'];
        let pacingThreshold: LeadData['pacing_threshold'];
        let shockImpedance: LeadData['shock_impedance'];

        if (isLV) {
          impedance = (v => v != null ? { value: v, unit: 'Ohms' } as const : undefined)(extractBnkNumeric(dataMap.get('PatientData.LVMsmts.LeadImped')));
          pacingThreshold = buildPacingThreshold(
            extractBnkNumeric(dataMap.get('PatientData.LVMsmts.PaceThreshAmpl')),
            extractBnkNumeric(dataMap.get('PatientData.LVMsmts.PaceThreshPW'))
          );
        } else if (!attachedGenericV) {
          attachedGenericV = true;
          impedance = (v => v != null ? { value: v, unit: 'Ohms' } as const : undefined)(extractBnkNumeric(dataMap.get('PatientVImped')));
          pacingThreshold = buildPacingThreshold(
            extractBnkNumeric(dataMap.get('PatientVThreshAmpl')),
            extractBnkNumeric(dataMap.get('PatientVThreshPW'))
          );
          const shock = extractBnkNumeric(dataMap.get('PatientShockImped'));
          shockImpedance = shock != null ? { value: shock, unit: 'Ohms' } : undefined;
        }

        result.push({
          name: chamber,
          manufacturer: slot.manufacturer,
          model: slot.model,
          serial: slot.serial,
          anatomic_location: slot.position,
          implant_date: buildPartsDate(dataMap, null, `PatientData.Lead${i}.ImplantMonth`, `PatientData.Lead${i}.ImplantYear`) || undefined,
          impedance,
          pacing_threshold: pacingThreshold,
          shock_impedance: shockImpedance,
        });
      }
      return result;
    }, [] as LeadData[]);
    for (const lead of ventricularLeads) {
      if (hasLeadData(lead)) leads.push(lead);
    }

    // Device type: real PACEART model codes ("D321-200-0", "G247-200-0") are
    // internal Boston Scientific part numbers, not marketing names — none of
    // the keyword checks below (kept for other/future export variants that
    // might carry a human-readable model or explicit Device.DeviceType key)
    // will ever match them. So when that yields nothing, fall back to
    // inferring from what the leads/measurements actually show: an LV lead
    // means CRT, a DFT/shock-impedance measurement means ICD-capable.
    let deviceType = safeExtract(collector, 'device.type', () => {
      const modelValue = deviceModel.toUpperCase();
      const deviceTypeValue = dataMap.get('Device.DeviceType') || '';
      if (deviceTypeValue) return deviceTypeValue;
      if (modelValue.includes('CRT-D')) return 'CRT-D';
      if (modelValue.includes('CRT-P')) return 'CRT-P';
      if (modelValue.includes('S-ICD') || modelValue.includes('EMBLEM') || modelValue.includes('SQ-RX')) return 'S-ICD';
      if (modelValue.includes('ICD') || modelValue.includes('DYNAGEN') || modelValue.includes('ORIGEN') || modelValue.includes('AUTOGEN')) return 'ICD';
      if (modelValue.includes('ACCOLADE') || modelValue.includes('FORMIO') || modelValue.includes('PROPONENT')) return 'Pacemaker';
      return 'Unknown';
    }, 'Unknown');

    if (deviceType === 'Unknown') {
      const hasIcdCapability = hasValue(dataMap.get('PatientDFT')) || hasValue(dataMap.get('PatientShockImped'));
      const hasLvLead = leads.some(l => l.name === 'LV');
      if (hasLvLead) deviceType = hasIcdCapability ? 'CRT-D' : 'CRT-P';
      else if (hasIcdCapability) deviceType = 'ICD';
      else deviceType = 'Pacemaker';
    }

    // Fields with no dedicated UnifiedReport slot — captured verbatim rather
    // than dropped. Ejection Fraction and NYHA class are baseline facts
    // recorded at implant, not re-measured per visit. (PatientHospital is
    // deliberately excluded — ambiguous whether it means implant hospital or
    // clinic of record.)
    const additionalFields: Record<string, string | number> = {};
    const ejectionFraction = dataMap.get('PatientLeftVentEjectFraction');
    if (hasValue(ejectionFraction)) additionalFields.ejection_fraction = ejectionFraction;
    const nyhaClass = dataMap.get('PatientFuncHeartClass');
    if (hasValue(nyhaClass)) additionalFields.nyha_class = nyhaClass;

    const report: UnifiedReport = {
      manufacturer: 'Boston Scientific',
      interrogation_date: header.interrogationDate,
      patient: {
        first_name: dataMap.get('PatientFirstName') || '',
        last_name: patientLastName,
        dob: patientDob,
      },
      device: {
        type: deviceType,
        model: deviceModel,
        serial_number: deviceSerial,
        implant_date: buildPartsDate(dataMap, 'PatientData.ImplantDay', 'PatientData.ImplantMonth', 'PatientData.ImplantYear') || undefined,
      },
      battery: {
        remaining_longevity: (v => v != null ? { value: v, unit: 'months' } as const : undefined)(extractBnkNumeric(dataMap.get('BatteryLongevityParams.TimeToERI'))),
        status: dataMap.get('BatteryStatus.BatteryPhase') || 'Unknown',
      },
      leads,
      raw_text: bnkData,
      formatVariant: 'boston-scientific-bnk',
      parseWarnings: collector.list,
      parseStatus: deriveParseStatus(collector, !!(patientLastName || patientDob), !!(deviceModel || deviceSerial)),
      ...(Object.keys(additionalFields).length > 0 ? { additional_fields: additionalFields } : {}),
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

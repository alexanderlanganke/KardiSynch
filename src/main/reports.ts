// src/main/reports.ts

import { ParseDiagnostic } from './parsers/parseDiagnostics';

/**
 * A single measurement with a value and its unit.
 */
export interface Measurement {
  value: number | string;
  unit: string;
}

/**
 * Represents a single component, like a lead. Includes its own implant date.
 */
export interface LeadData {
  name: string;
  manufacturer?: string; // ADDED: Manufacturer of the lead
  model?: string;
  serial?: string;
  anatomic_location?: string;
  implant_date?: string; // ADDED: ISO 8601 format for individual lead implant date
  pacing_threshold?: Measurement;
  pacing_amplitude?: Measurement; // ADDED: Pacing output amplitude
  sensing?: Measurement;
  impedance?: Measurement; // Pacing Impedance
  shock_impedance?: Measurement; // ADDED: Defibrillation Impedance
}

/**
 * Represents the device's battery status.
 */
export interface BatteryData {
  voltage?: Measurement;
  remaining_longevity?: Measurement;
  lastChargeTime?: Measurement; // ADDED: Last capacitor charge time
  status?: 'OK' | 'ERI' | 'EOL' | string;
}

/**
 * The top-level, standardized structure for a parsed interrogation report.
 */
export interface UnifiedReport {
  id?: string; // Added for DB compatibility
  patient_id?: string; // Added for DB compatibility
  // --- Metadata (from the report and the hospital system) ---
  manufacturer: 'Medtronic' | 'Biotronik' | 'Abbott' | 'Boston Scientific' | 'Impulse Dynamics' | 'Microport' | 'Unknown' | string;
  interrogation_date: string; // ISO 8601 format
  hospitalVisitId?: string; // ADDED: The hospital's identifier for this specific visit/encounter.
  session_id?: string; // ADDED: ID derived from filename/log (e.g. Abbott Log ID) for linking

  // --- Patient Identification ---
  patient: {
    first_name: string; // ADDED: More granular name fields
    last_name: string;  // ADDED
    dob: string;        // RENAMED for clarity (Date of Birth in ISO 8601 format)
    hospitalPatientId?: string; // ADDED: The patient's permanent ID in the hospital system (e.g., MRN)
  };

  // --- Device & System Identification ---
  device: {
    type: 'Pacemaker' | 'ICD' | 'S-ICD' | 'Leadless Pacemaker' | 'CCM' | 'Unknown' | string;
    model: string;
    serial_number: string;
    implant_date?: string; // ISO 8601 format for the primary device implant date
  };

  // --- Core Clinical Data ---
  battery: BatteryData;
  leads?: LeadData[];

  // --- Key Findings & Summaries ---
  arrhythmia_summary?: {
    atrial_fibrillation_burden?: Measurement;
    ventricular_tachycardia_episodes?: number;
    [key: string]: any;
  };

  // --- Manufacturer-specific fields with no dedicated schema slot ---
  // Captured verbatim (no unit conversion/reformatting) rather than dropped
  // just because the unified schema has nowhere purpose-built to put them
  // (e.g. Ejection Fraction, NYHA class, Indications for Implant). Values
  // here are one-time/baseline facts as often as they are per-visit data —
  // callers must not assume they change across visits.
  additional_fields?: Record<string, string | number>;

  // --- Raw Data ---
  raw_text?: string;
  generatedFiles?: string[]; // Paths to files generated during parsing (e.g. extracted PDFs)

  // --- Parse Diagnostics ---
  // Machine-readable tag for which structural variant/branch a parser detected
  // (e.g. 'medtronic-pdd-legacy', 'abbott-coded-log', 'biotronik:settings=Kanäle').
  formatVariant?: string;
  // Non-fatal issues collected while parsing (fields that fell back to a
  // default instead of aborting the whole parse).
  parseWarnings?: ParseDiagnostic[];
  // 'ok': no warnings. 'partial': some fields missing/fell back but patient
  // and/or device identity was recovered. 'failed': neither patient nor
  // device identity could be established (still a real report, not null).
  parseStatus?: 'ok' | 'partial' | 'failed';
}

/**
 * Check whether a lead has meaningful data beyond just a name/location.
 * A lead is considered meaningful if it has at least one of:
 * - a model (not "Unknown")
 * - a serial number (not "Unknown" or ".")
 * - any electrical measurement
 */
export function hasLeadData(lead: LeadData): boolean {
  if (lead.model && lead.model !== 'Unknown' && lead.model !== '.') return true;
  if (lead.serial && lead.serial !== 'Unknown' && lead.serial !== '.') return true;
  if (lead.impedance?.value) return true;
  if (lead.sensing?.value) return true;
  if (lead.pacing_threshold?.value) return true;
  if (lead.pacing_amplitude?.value) return true;
  if (lead.shock_impedance?.value) return true;
  return false;
}

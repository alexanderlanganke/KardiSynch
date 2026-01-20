// src/main/reports.ts

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

  // --- Raw Data ---
  raw_text?: string;
  generatedFiles?: string[]; // Paths to files generated during parsing (e.g. extracted PDFs)
}

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
  anatomic_location?: string;
  implant_date?: string; // ADDED: ISO 8601 format for individual lead implant date
  pacing_threshold?: Measurement;
  sensing?: Measurement;
  impedance?: Measurement;
}

/**
 * Represents the device's battery status.
 */
export interface BatteryData {
  voltage?: Measurement;
  remaining_longevity?: Measurement;
  status?: 'OK' | 'ERI' | 'EOL' | string;
}

/**
 * The top-level, standardized structure for a parsed interrogation report.
 */
export interface UnifiedReport {
  // --- Metadata (from the report and the hospital system) ---
  manufacturer: 'Medtronic' | 'Biotronik' | 'Abbott' | 'Boston Scientific' | 'Impulse Dynamics' | 'Microport' | 'Unknown' | string;
  interrogation_date: string; // ISO 8601 format
  hospital_visit_id?: string; // ADDED: The hospital's identifier for this specific visit/encounter.

  // --- Patient Identification ---
  patient: {
    first_name: string; // ADDED: More granular name fields
    last_name: string;  // ADDED
    dob: string;        // RENAMED for clarity (Date of Birth in ISO 8601 format)
    hospital_patient_id?: string; // ADDED: The patient's permanent ID in the hospital system (e.g., MRN)
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
  raw_text: string;
}

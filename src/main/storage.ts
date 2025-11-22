import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { findPatient, createPatient, createReport, getSettings } from './database';
import { UnifiedReport } from './reports';
import { app } from 'electron';
import { sendNotification, sendPatientListUpdate } from './windowManager';

let dataDir: string;

/**
 * Initializes the storage module by setting the data directory path.
 */
export const initializeStorage = async () => {
  const settings = await getSettings();
  dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
};

/**
 * Generates patient.xml content
 */
const generatePatientXML = (patient: { id: string; first_name: string; last_name: string; dob: string; hospitalPatientId: string | null }): string => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<patient>
  <id>${patient.id}</id>
  <first_name>${patient.first_name || ''}</first_name>
  <last_name>${patient.last_name}</last_name>
  <dob>${patient.dob}</dob>
  <hospitalPatientId>${patient.hospitalPatientId || ''}</hospitalPatientId>
</patient>`;
};

/**
 * Generates visit.xml content
 */
const generateVisitXML = (report: UnifiedReport, reportId: string): string => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<visit>
  <report_id>${reportId}</report_id>
  <interrogation_date>${report.interrogation_date}</interrogation_date>
  <manufacturer>${report.manufacturer || ''}</manufacturer>
  <device_type>${report.device?.type || ''}</device_type>
  <device_model>${report.device?.model || ''}</device_model>
  <device_serial>${report.device?.serial_number || ''}</device_serial>
</visit>`;
};

/**
 * Stores a unified report in the database, creating a new patient if necessary.
 * @param report The UnifiedReport object to store.
 * @returns The ID of the newly created report.
 */
export const storeReport = async (report: UnifiedReport): Promise<{ reportId: string; patient: any }> => {
  const { patient: patientData } = report;

  if (!patientData || !patientData.last_name || !patientData.dob) {
    throw new Error('Cannot store report without patient last name and DOB.');
  }

  // Find or create the patient.
  let patient = await findPatient(patientData.last_name, patientData.dob);
  let isNewPatient = false;
  if (!patient) {
    const newPatientId = uuidv4();
    patient = {
      id: newPatientId,
      first_name: patientData.first_name || '',
      last_name: patientData.last_name,
      dob: patientData.dob,
      hospitalPatientId: patientData.hospitalPatientId || null
    };
    await createPatient(patient);
    sendNotification(`New patient created: ${patient.first_name} ${patient.last_name}`);
    isNewPatient = true;
  }

  // Create the report record in the database.
  const reportId = uuidv4();
  await createReport({
    id: reportId,
    patient_id: patient.id,
    ...report
  });

  // Notify the renderer to refresh the patient list
  if (isNewPatient) {
    sendPatientListUpdate();
  }

  return { reportId, patient };
}


/**
 * Moves a file from its source path to the permanent data storage directory.
 * @param sourcePath The original path of the file.
 * @param reportId The ID of the report this file is associated with.
 * @param patientId The ID of the patient.
 * @param patientName Patient name to include in the directory name for readability.
 * @param interrogationDate The interrogation date to use in the visit subdirectory name.
 */
export const storeFile = async (
  sourcePath: string,
  reportId: string,
  patientId: string,
  patientName?: string,
  interrogationDate?: string,
  patient?: any,
  report?: UnifiedReport
): Promise<void> => {
  // Sanitize patient name for filesystem
  const safeName = patientName ? patientName.replace(/[^a-zA-Z0-9]/g, '_') : 'Unknown';

  // Create patient directory: PatientId_PatientName
  const patientDir = path.join(dataDir, 'Reports', `${patientId}_${safeName}`);

  // Extract date from interrogation_date (format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
  let dateString = 'Unknown';
  if (interrogationDate) {
    const date = new Date(interrogationDate);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      dateString = `${year}_${month}_${day}`;
    }
  }

  // Create visit subdirectory: YYYY_MM_DD_reportId
  const visitDir = path.join(patientDir, `${dateString}_${reportId}`);

  if (!fs.existsSync(visitDir)) {
    fs.mkdirSync(visitDir, { recursive: true });
  }

  const destPath = path.join(visitDir, path.basename(sourcePath));
  fs.renameSync(sourcePath, destPath);

  // Generate patient.xml if patient data provided and file doesn't exist
  if (patient) {
    const patientXmlPath = path.join(patientDir, 'patient.xml');
    if (!fs.existsSync(patientXmlPath)) {
      fs.writeFileSync(patientXmlPath, generatePatientXML(patient));
    }
  }

  // Generate visit.xml if report data provided
  if (report) {
    const visitXmlPath = path.join(visitDir, 'visit.xml');
    fs.writeFileSync(visitXmlPath, generateVisitXML(report, reportId));
  }
};

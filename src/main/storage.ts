import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { findPatient, createPatient, createReport, getSettings } from './database';
import { UnifiedReport } from './reports';
import { app } from 'electron';
import { sendNotification } from './main';

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
 * Stores a unified report in the database, creating a new patient if necessary.
 * @param report The UnifiedReport object to store.
 * @returns The ID of the newly created report.
 */
export const storeReport = async (report: UnifiedReport): Promise<string> => {
  const { patient: patientData } = report;

  if (!patientData || !patientData.last_name || !patientData.dob) {
    throw new Error('Cannot store report without patient last name and DOB.');
  }

  // Find or create the patient.
  let patient = await findPatient(patientData.last_name, patientData.dob);
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
  }

  // Create the report record in the database.
  const reportId = uuidv4();
  await createReport({
    id: reportId,
    patient_id: patient.id,
    ...report
  });

  return reportId;
};

/**
 * Moves a file from its source path to the permanent data storage directory.
 * @param sourcePath The original path of the file.
 * @param reportId The ID of the report this file is associated with.
 */
export const storeFile = async (sourcePath: string, reportId: string): Promise<void> => {
  const reportDir = path.join(dataDir, 'Reports', reportId);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const destPath = path.join(reportDir, path.basename(sourcePath));
  fs.renameSync(sourcePath, destPath);
};

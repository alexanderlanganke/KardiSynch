import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { findPatient, createPatient, createReport, getSettings } from './database';
import { app } from 'electron';

let dataDir: string;

export const initializeStorage = async () => {
  const settings = await getSettings();
  dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
};

export const storeVisit = async (visitData: {
  patientName: string;
  patientDob: string;
  visitDate: string;
  pdfFilePaths: string[];
  structuredReportFilePaths: string[];
  parsedData: any;
}) => {
  try {
    let patient = await findPatient(visitData.patientName, visitData.patientDob);
    if (!patient) {
      const newPatientId = uuidv4();
      patient = {
        id: newPatientId,
        name: visitData.patientName,
        dob: visitData.patientDob,
      };
      await createPatient(patient);
    }

    const visitId = uuidv4();
    const patientDir = path.join(dataDir, 'Patients', patient.id);
    const visitDir = path.join(patientDir, visitId);
    fs.mkdirSync(visitDir, { recursive: true });

    // Store parsed data
    const dataPath = path.join(visitDir, 'data.json');
    fs.writeFileSync(dataPath, JSON.stringify(visitData.parsedData, null, 2));

    // Move PDF files
    const newPdfPaths: string[] = [];
    visitData.pdfFilePaths.forEach((pdfPath, index) => {
      const newPdfPath = path.join(visitDir, `report_${index + 1}.pdf`);
      fs.renameSync(pdfPath, newPdfPath);
      newPdfPaths.push(newPdfPath);
    });

    // Move structured report files
    visitData.structuredReportFilePaths.forEach((reportPath) => {
      const newReportPath = path.join(visitDir, path.basename(reportPath));
      fs.renameSync(reportPath, newReportPath);
    });

    // Create report in DB
    await createReport({
      id: visitId,
      patient_id: patient.id,
      visit_date: visitData.visitDate,
      pdf_paths: JSON.stringify(newPdfPaths),
      data_path: dataPath,
    });

    console.log('Visit stored successfully for patient:', patient.name);
  } catch (error) {
    console.error('Error storing visit:', error);
  }
};

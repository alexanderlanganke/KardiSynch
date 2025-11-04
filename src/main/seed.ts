import { getDb } from './database';
import { v4 as uuidv4 } from 'uuid';

const mockPatients = [
  {
    id: 'p-uuid-001',
    name: 'Meyer, Helmut',
    dob: '1952-09-25',
    hospitalPatientId: 'h-pid-001',
    last_device_model: 'Azure XT DR MRI',
    last_seen_date: '2025-10-28',
  },
  {
    id: 'p-uuid-002',
    name: 'Schmidt, Anna',
    dob: '1978-04-12',
    hospitalPatientId: 'h-pid-002',
    last_device_model: 'Gallant CRT-D',
    last_seen_date: '2025-09-15',
  },
];

const mockReports = [
  {
    id: 'r-uuid-100',
    patient_id: 'p-uuid-001',
    visit_date: '2025-10-28',
    hospitalVisitId: 'h-vid-100',
    device_manufacturer: 'Medtronic',
    pdf_paths: JSON.stringify(['_DATA/Patients/p-uuid-001/r-uuid-100/report.pdf']),
    data_path: '_DATA/Patients/p-uuid-001/r-uuid-100/data.json',
  },
  {
    id: 'r-uuid-101',
    patient_id: 'p-uuid-001',
    visit_date: '2025-04-17',
    hospitalVisitId: 'h-vid-101',
    device_manufacturer: 'Medtronic',
    pdf_paths: JSON.stringify(['_DATA/Patients/p-uuid-001/r-uuid-101/report.pdf']),
    data_path: '_DATA/Patients/p-uuid-001/r-uuid-101/data.json',
  },
  {
    id: 'r-uuid-102',
    patient_id: 'p-uuid-002',
    visit_date: '2025-09-15',
    hospitalVisitId: 'h-vid-102',
    device_manufacturer: 'Abbott',
    pdf_paths: JSON.stringify([
      '_DATA/Patients/p-uuid-002/r-uuid-102/report-page1.pdf',
      '_DATA/Patients/p-uuid-002/r-uuid-102/report-page2.pdf',
    ]),
    data_path: '_DATA/Patients/p-uuid-002/r-uuid-102/data.json',
  },
];

export const seedDatabase = () => {
  const db = getDb();

  db.serialize(() => {
    const patientStmt = db.prepare(
      'INSERT INTO Patients (id, name, dob, hospitalPatientId, last_device_model, last_seen_date) VALUES (?, ?, ?, ?, ?, ?)'
    );
    mockPatients.forEach((patient) => {
      patientStmt.run(
        patient.id,
        patient.name,
        patient.dob,
        patient.hospitalPatientId,
        patient.last_device_model,
        patient.last_seen_date
      );
    });
    patientStmt.finalize();

    const reportStmt = db.prepare(
      'INSERT INTO Reports (id, patient_id, visit_date, hospitalVisitId, device_manufacturer, pdf_paths, data_path) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    mockReports.forEach((report) => {
      reportStmt.run(
        report.id,
        report.patient_id,
        report.visit_date,
        report.hospitalVisitId,
        report.device_manufacturer,
        report.pdf_paths,
        report.data_path
      );
    });
    reportStmt.finalize();
  });

  console.log('Mock data has been inserted');
};

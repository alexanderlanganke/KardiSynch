import { getDb } from './database';
import { v4 as uuidv4 } from 'uuid';

// Mock data for Patients
const mockPatients = [
  {
    id: uuidv4(),
    first_name: 'Helmut',
    last_name: 'Meyer',
    dob: '1952-09-25',
    hospitalPatientId: 'h-pid-001',
  },
  {
    id: uuidv4(),
    first_name: 'Anna',
    last_name: 'Schmidt',
    dob: '1978-04-12',
    hospitalPatientId: 'h-pid-002',
  },
];

// Mock data for Reports
const mockReports = [
  {
    id: uuidv4(),
    patient_id: mockPatients[0].id,
    manufacturer: 'Medtronic',
    interrogation_date: '2025-10-28',
    hospitalVisitId: 'h-vid-100',
    device_type: 'Pacemaker',
    device_model: 'Azure XT DR MRI',
    device_serial_number: 'SN-12345',
    raw_text: 'This is a raw text summary of the first report.',
    data: '{"key":"value1"}', // JSON blob
  },
  {
    id: uuidv4(),
    patient_id: mockPatients[0].id,
    manufacturer: 'Medtronic',
    interrogation_date: '2025-04-17',
    hospitalVisitId: 'h-vid-101',
    device_type: 'Pacemaker',
    device_model: 'Azure XT DR MRI',
    device_serial_number: 'SN-12345',
    raw_text: 'This is a raw text summary of the second report.',
    data: '{"key":"value2"}', // JSON blob
  },
  {
    id: uuidv4(),
    patient_id: mockPatients[1].id,
    manufacturer: 'Abbott',
    interrogation_date: '2025-09-15',
    hospitalVisitId: 'h-vid-102',
    device_type: 'ICD',
    device_model: 'Gallant CRT-D',
    device_serial_number: 'SN-67890',
    raw_text: 'This is a raw text summary of the third report.',
    data: '{"key":"value3"}', // JSON blob
  },
];

export const seedDatabase = () => {
  const db = getDb();

  db.serialize(() => {
    // Check if the database is already seeded
    db.get('SELECT COUNT(*) as count FROM Patients', (err, row: { count: number }) => {
      if (err) {
        console.error('Error checking for existing patients:', err);
        return;
      }
      if (row.count > 0) {
        console.log('Database already seeded. Skipping.');
        return;
      }

      console.log('Seeding database with mock data...');

      const patientStmt = db.prepare(
        'INSERT INTO Patients (id, first_name, last_name, dob, hospitalPatientId) VALUES (?, ?, ?, ?, ?)'
      );
      mockPatients.forEach((patient) => {
        patientStmt.run(
          patient.id,
          patient.first_name,
          patient.last_name,
          patient.dob,
          patient.hospitalPatientId
        );
      });
      patientStmt.finalize();

      const reportStmt = db.prepare(
        `INSERT INTO Reports (
          id, patient_id, manufacturer, interrogation_date, hospitalVisitId,
          device_type, device_model, device_serial_number, raw_text, data
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      mockReports.forEach((report) => {
        reportStmt.run(
          report.id,
          report.patient_id,
          report.manufacturer,
          report.interrogation_date,
          report.hospitalVisitId,
          report.device_type,
          report.device_model,
          report.device_serial_number,
          report.raw_text,
          report.data
        );
      });
      reportStmt.finalize((err) => {
        if (err) {
          console.error('Error seeding reports:', err.message);
        } else {
          console.log('Mock data has been inserted successfully.');
        }
      });
    });
  });
};

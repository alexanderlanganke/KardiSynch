import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(__dirname, '..', '..', '_DATA', 'database.db');

const createDbConnection = () => {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      return console.error(err.message);
    }
    console.log('Connection with SQLite has been established');
  });

  return db;
};

const createTables = (db: sqlite3.Database) => {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS Patients (
        id TEXT PRIMARY KEY,
        name TEXT,
        dob TEXT,
        hospitalPatientId TEXT,
        last_device_model TEXT,
        last_seen_date TEXT
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS Reports (
        id TEXT PRIMARY KEY,
        patient_id TEXT,
        visit_date TEXT,
        hospitalVisitId TEXT,
        device_manufacturer TEXT,
        pdf_paths TEXT,
        data_path TEXT,
        FOREIGN KEY (patient_id) REFERENCES Patients (id)
      );
    `);
  });
};

let dbInstance: sqlite3.Database;

export const initializeDatabase = () => {
  if (!dbInstance) {
    dbInstance = createDbConnection();
    createTables(dbInstance);
  }
  return dbInstance;
};

export const getDb = () => {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initializeDatabase first.');
  }
  return dbInstance;
};

export const findPatient = (name: string, dob: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.get('SELECT * FROM Patients WHERE name = ? AND dob = ?', [name, dob], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

export const createPatient = (patient: { id: string; name: string; dob: string; }): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      'INSERT INTO Patients (id, name, dob) VALUES (?, ?, ?)',
      [patient.id, patient.name, patient.dob],
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
};

export const getAllPatients = (filters: any): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    let query = 'SELECT DISTINCT p.* FROM Patients p LEFT JOIN Reports r ON p.id = r.patient_id WHERE 1=1';
    const params: any[] = [];

    if (filters.name) {
      query += ' AND p.name LIKE ?';
      params.push(`%${filters.name}%`);
    }
    if (filters.dob) {
      query += ' AND p.dob = ?';
      params.push(filters.dob);
    }
    if (filters.patientId) {
      query += ' AND p.id LIKE ?';
      params.push(`%${filters.patientId}%`);
    }
    if (filters.hospitalPatientId) {
      query += ' AND p.hospitalPatientId LIKE ?';
      params.push(`%${filters.hospitalPatientId}%`);
    }
    if (filters.hospitalVisitId) {
      query += ' AND r.hospitalVisitId LIKE ?';
      params.push(`%${filters.hospitalVisitId}%`);
    }
    if (filters.deviceManufacturer) {
      query += ' AND r.device_manufacturer = ?';
      params.push(filters.deviceManufacturer);
    }
    if (filters.lastSeenStartDate) {
      query += ' AND p.last_seen_date >= ?';
      params.push(filters.lastSeenStartDate);
    }
    if (filters.lastSeenEndDate) {
      query += ' AND p.last_seen_date <= ?';
      params.push(filters.lastSeenEndDate);
    }

    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

export const createReport = (report: { id: string; patient_id: string; visit_date: string; pdf_paths: string; data_path: string; }): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      'INSERT INTO Reports (id, patient_id, visit_date, pdf_paths, data_path) VALUES (?, ?, ?, ?, ?)',
      [report.id, report.patient_id, report.visit_date, report.pdf_paths, report.data_path],
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
};

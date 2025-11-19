import { app } from 'electron';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { UnifiedReport } from './reports';

let dbInstance: sqlite3.Database;

const createDbConnection = (dbPath: string) => {
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
    // NOTE: Dropping tables is for development convenience.
    // A production app would require a robust migration strategy.
    db.run(`DROP TABLE IF EXISTS Reports;`);
    db.run(`DROP TABLE IF EXISTS Patients;`);

    db.run(`
      CREATE TABLE IF NOT EXISTS Patients (
        id TEXT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT NOT NULL,
        dob TEXT NOT NULL,
        hospitalPatientId TEXT
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS Reports (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        manufacturer TEXT,
        interrogation_date TEXT NOT NULL,
        hospitalVisitId TEXT,
        device_type TEXT,
        device_model TEXT,
        device_serial_number TEXT,
        raw_text TEXT,
        data TEXT,
        FOREIGN KEY (patient_id) REFERENCES Patients (id)
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS Settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  });
};

export const initializeDatabase = (customDbPath?: string) => {
  if (!dbInstance) {
    const dbPath = customDbPath || path.join(app.getPath('userData'), '_DATA', 'database.db');
    dbInstance = createDbConnection(dbPath);
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

export const findPatient = (lastName: string, dob: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.get('SELECT * FROM Patients WHERE last_name = ? AND dob = ?', [lastName, dob], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

export const createPatient = (patient: {
    id: string;
    first_name: string;
    last_name: string;
    dob: string;
    hospitalPatientId: string | null;
  }): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      'INSERT INTO Patients (id, first_name, last_name, dob, hospitalPatientId) VALUES (?, ?, ?, ?, ?)',
      [patient.id, patient.first_name, patient.last_name, patient.dob, patient.hospitalPatientId],
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

export const getPatientReports = (patientId: string): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    const query = `
      SELECT
        r.data,
        p.first_name,
        p.last_name,
        p.dob,
        p.hospitalPatientId
      FROM Reports r
      JOIN Patients p ON r.patient_id = p.id
      WHERE r.patient_id = ?
      ORDER BY r.interrogation_date DESC
    `;
    db.all(query, [patientId], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        const reports = rows.map((row: any) => {
          const report = JSON.parse(row.data);
          report.patient = {
            first_name: row.first_name,
            last_name: row.last_name,
            dob: row.dob,
            hospitalPatientId: row.hospitalPatientId,
          };
          return report;
        });
        resolve(reports);
      }
    });
  });
};

export const getSettings = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.all('SELECT * FROM Settings', (err, rows) => {
      if (err) {
        reject(err);
      } else {
        const settings = rows.reduce((acc: any, row: any) => {
          acc[row.key] = row.value;
          return acc;
        }, {});
        resolve(settings);
      }
    });
  });
};

export const setSettings = (settings: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.serialize(() => {
      const stmt = db.prepare('INSERT OR REPLACE INTO Settings (key, value) VALUES (?, ?)');
      for (const key in settings) {
        stmt.run(key, settings[key]);
      }
      stmt.finalize((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
};

export const getAllPatients = (filters: any): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    let query = 'SELECT DISTINCT p.* FROM Patients p LEFT JOIN Reports r ON p.id = r.patient_id WHERE 1=1';
    const params: any[] = [];

    if (filters.name) {
      query += ' AND (p.first_name LIKE ? OR p.last_name LIKE ?)';
      params.push(`%${filters.name}%`, `%${filters.name}%`);
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
      query += ' AND r.manufacturer = ?';
      params.push(filters.deviceManufacturer);
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

export const createReport = (report: UnifiedReport & { patient_id: string; id: string }): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      `INSERT INTO Reports (
          id, patient_id, manufacturer, interrogation_date, hospitalVisitId,
          device_type, device_model, device_serial_number, raw_text, data
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        report.id,
        report.patient_id,
        report.manufacturer,
        report.interrogation_date,
        report.hospitalVisitId || null,
        report.device?.type || null,
        report.device?.model || null,
        report.device?.serial_number || null,
        report.raw_text || null,
        JSON.stringify(report),
      ],
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

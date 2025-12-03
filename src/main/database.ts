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
    // Create tables if they don't exist

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


export const findPatientBySerial = (serial: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    // Find the most recent patient associated with this serial number
    db.get(
      `SELECT p.* FROM Patients p
       JOIN Reports r ON p.id = r.patient_id
       WHERE r.device_serial_number = ?
       ORDER BY r.interrogation_date DESC
       LIMIT 1`,
      [serial],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
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

export const getPatientById = (patientId: string): Promise<any> => {
  console.log('[getPatientById] Looking for patient with ID:', patientId);
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.get(
      `SELECT * FROM Patients WHERE id = ?`,
      [patientId],
      (err, row: any) => {
        if (err) {
          console.error('[getPatientById] Database error:', err);
          reject(err);
        } else if (!row) {
          console.error('[getPatientById] Patient not found with ID:', patientId);
          reject(new Error('Patient not found'));
        } else {
          console.log('[getPatientById] Found patient:', row);
          // Transform to include combined name
          const patient = {
            id: row.id,
            patientId: `P-${row.id}`,
            first_name: row.first_name,
            last_name: row.last_name,
            name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Unknown Patient',
            dob: row.dob || ''
          };
          resolve(patient);
        }
      }
    );
  });
};

export const getPatientReports = async (patientId: string): Promise<any[]> => {
  let dataDir: string;
  try {
    const settings = await getSettings();
    dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  } catch (e) {
    dataDir = path.join(app.getPath('userData'), '_DATA');
  }

  return new Promise((resolve, reject) => {
    const db = getDb();
    db.all(
      `SELECT r.*, p.first_name, p.last_name, p.dob 
       FROM Reports r 
       JOIN Patients p ON r.patient_id = p.id 
       WHERE r.patient_id = ? 
       ORDER BY r.interrogation_date DESC`,
      [patientId],
      (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          // Parse JSON fields and extract file info
          const reports = rows.map(row => {
            let device = null;
            let battery = null;
            let leads = null;
            let arrhythmia_summary = null;
            let files: string[] = [];

            try {
              // Parse the full data JSON
              if (row.data) {
                const fullData = JSON.parse(row.data);
                device = fullData.device;
                battery = fullData.battery;
                leads = fullData.leads;
                arrhythmia_summary = fullData.arrhythmia_summary;
              }

              // Scan for files in the report directory
              const reportDir = path.join(dataDir, 'Reports', row.id);
              if (fs.existsSync(reportDir)) {
                const reportFiles = fs.readdirSync(reportDir);
                files = reportFiles.map(file => path.join(reportDir, file));
              }
            } catch (e) {
              console.error('Error parsing report data or reading files:', e);
            }

            return {
              id: row.id,
              patient_id: row.patient_id,
              manufacturer: row.manufacturer,
              interrogation_date: row.interrogation_date,
              device,
              battery,
              leads,
              arrhythmia_summary,
              files,
              raw_text: row.raw_text
            };
          });
          resolve(reports);
        }
      }
    );
  });
};


export const findReportByDate = (patientId: string, date: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    // Ensure date is YYYY-MM-DD
    const datePrefix = date.split('T')[0];
    console.log(`[findReportByDate] Checking for duplicate: Patient ${patientId}, Date ${datePrefix}`);

    db.get(
      'SELECT * FROM Reports WHERE patient_id = ? AND interrogation_date LIKE ?',
      [patientId, `${datePrefix}%`],
      (err, row) => {
        if (err) {
          console.error('[findReportByDate] Error:', err);
          reject(err);
        } else {
          if (row) console.log('[findReportByDate] Duplicate found:', row);
          resolve(row);
        }
      }
    );
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
    let query = `
      SELECT 
        p.id,
        p.first_name,
        p.last_name,
        p.dob,
        COUNT(r.id) as reportCount,
        MAX(r.interrogation_date) as lastReportDate
      FROM Patients p 
      LEFT JOIN Reports r ON p.id = r.patient_id 
      WHERE 1=1
    `;
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

    query += ' GROUP BY p.id, p.first_name, p.last_name, p.dob';

    db.all(query, params, (err, rows: any[]) => {
      if (err) {
        reject(err);
      } else {
        // Transform the data to match frontend expectations
        const patients = rows.map(row => ({
          id: row.id,
          patientId: `P-${row.id}`,
          name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Unknown Patient',
          dob: row.dob || '',
          lastReportDate: row.lastReportDate || '',
          reportCount: row.reportCount || 0
        }));
        resolve(patients);
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

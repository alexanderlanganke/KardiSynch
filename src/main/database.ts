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
        hospitalPatientId TEXT,
        mri_status TEXT,
        mri_data_hash TEXT,
        manufacturer_warning_status TEXT,
        manufacturer_warning_hash TEXT
      );
    `);

    // Safe Migration Helper
    const safeAddColumn = (sql: string) => {
      db.run(sql, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.warn(`[Schema Migration] Error running ${sql}:`, err.message);
        }
      });
    };

    // Migration for existing databases
    safeAddColumn("ALTER TABLE Patients ADD COLUMN mri_status TEXT");
    safeAddColumn("ALTER TABLE Patients ADD COLUMN mri_data_hash TEXT");
    // Add Manual Device Data Columns (Patient Profile)
    safeAddColumn("ALTER TABLE Patients ADD COLUMN device_manufacturer TEXT");
    safeAddColumn("ALTER TABLE Patients ADD COLUMN device_model TEXT");
    safeAddColumn("ALTER TABLE Patients ADD COLUMN device_serial TEXT");
    safeAddColumn("ALTER TABLE Patients ADD COLUMN leads TEXT");
    safeAddColumn("ALTER TABLE Patients ADD COLUMN devices TEXT");
    // Lazy Sync Support
    safeAddColumn("ALTER TABLE Patients ADD COLUMN last_indexed_mtime INTEGER");
    // Manufacturer Warning Support
    safeAddColumn("ALTER TABLE Patients ADD COLUMN manufacturer_warning_status TEXT");
    safeAddColumn("ALTER TABLE Patients ADD COLUMN manufacturer_warning_hash TEXT");

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

    db.run(`
      CREATE TABLE IF NOT EXISTS ImportSessions (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        status TEXT,
        summary TEXT
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS ImportEvents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        file_path TEXT NOT NULL,
        status TEXT NOT NULL,
        patient_id TEXT,
        report_id TEXT,
        message TEXT,
        FOREIGN KEY (session_id) REFERENCES ImportSessions (id)
      );
    `);

    // Indexes for common query patterns
    db.run(`CREATE INDEX IF NOT EXISTS idx_reports_patient_id ON Reports(patient_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_reports_interrogation_date ON Reports(interrogation_date);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_patients_last_name_dob ON Patients(last_name, dob);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_import_events_session_id ON ImportEvents(session_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_import_events_patient_id ON ImportEvents(patient_id);`);
  });
};

export const initializeDatabase = (customDbPath: string): Promise<sqlite3.Database> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const dbPath = customDbPath;
    const dir = path.dirname(dbPath);

    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        reject(new Error(`Failed to create database directory: ${err}`));
        return;
      }
    }

    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('[Database] Connection failed:', err.message);
        reject(err);
      } else {
        console.log(`[Database] Connected to ${dbPath}`);
        createTables(db);
        dbInstance = db;
        resolve(db);
      }
    });
  });
};

export const getDb = () => {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initializeDatabase first.');
  }
  return dbInstance;
};

export const closeDatabase = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      dbInstance.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
          reject(err);
        } else {
          dbInstance = undefined as any;
          console.log('Database connection closed.');
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
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

export const updatePatient = (patient: {
  id: string;
  first_name: string;
  last_name: string;
  dob: string;
  hospitalPatientId: string | null;
  device_manufacturer?: string | null;
  device_model?: string | null;
  device_serial?: string | null;
  leads?: string | null;
  devices?: any[] | null;
  manufacturer_warning_status?: any | null;
  manufacturer_warning_hash?: string | null;
}): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      `UPDATE Patients SET 
         first_name = ?, last_name = ?, dob = ?, hospitalPatientId = ?,
         device_manufacturer = ?, device_model = ?, device_serial = ?, leads = ?, devices = ?,
         manufacturer_warning_status = ?, manufacturer_warning_hash = ?
       WHERE id = ?`,
      [
        patient.first_name,
        patient.last_name,
        patient.dob,
        patient.hospitalPatientId,
        patient.device_manufacturer || null,
        patient.device_model || null,
        patient.device_serial || null,
        patient.leads || null,
        patient.devices ? JSON.stringify(patient.devices) : null,
        patient.manufacturer_warning_status ? JSON.stringify(patient.manufacturer_warning_status) : null,
        patient.manufacturer_warning_hash || null,
        patient.id
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

export const getReportById = (id: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.get('SELECT * FROM Reports WHERE id = ?', [id], (err, row) => {
      if (err) {
        console.error('[getReportById] Error:', err);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

export const getPatientById = (patientId: string): Promise<any> => {
  return new Promise(async (resolve, reject) => {
    const db = getDb();

    // 1. Fetch from DB
    db.get(
      `SELECT 
         p.*, 
         r.manufacturer as deviceManufacturer, 
         r.device_model as deviceModel, 
         r.device_serial_number as deviceSerial
       FROM Patients p 
       LEFT JOIN Reports r ON p.id = r.patient_id 
       WHERE p.id = ?
       ORDER BY r.interrogation_date DESC 
       LIMIT 1`,
      [patientId],
      async (err, row: any) => {
        if (err) {
          console.error('[getPatientById] Database error:', err);
          reject(err);
          return;
        }

        // 2. Resolve Data Path for Verification
        let dataDir;
        try {
          const settings = await getSettings();
          dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
        } catch (e) {
          dataDir = path.join(app.getPath('userData'), '_DATA');
        }
        const reportsDir = path.join(dataDir, 'Reports');

        // Access FS to find patient directory (heuristic by ID prefix)
        let patientXmlPath: string | null = null;
        try {
          const dirs = await fs.promises.readdir(reportsDir);
          const patientDirName = dirs.find(dir => dir.startsWith(patientId));
          if (patientDirName) {
            patientXmlPath = path.join(reportsDir, patientDirName, 'patient.xml');
          }
        } catch (e) { /* ignore */ }

        // 3. Lazy Sync / Read Repair
        let shouldRepair = false;
        let fileStats: fs.Stats | undefined;

        if (patientXmlPath && fs.existsSync(patientXmlPath)) {
          try {
            fileStats = fs.statSync(patientXmlPath);
            // If DB is missing row OR timestamps mismatch OR critical data is missing (e.g. bad previous repair)
            const isStale = !row || !row.last_indexed_mtime || Math.abs(fileStats.mtimeMs - row.last_indexed_mtime) > 1000;
            const isMissingData = row && (!row.device_manufacturer || !row.device_model || !row.devices);

            if (isStale || isMissingData) {
              console.log(`[getPatientById] Repair triggered for ${patientId}. Stale: ${isStale}, Missing Data: ${isMissingData}. DB Mtime: ${row?.last_indexed_mtime}, File Mtime: ${fileStats.mtimeMs}.`);
              shouldRepair = true;
            }
          } catch (e) { console.warn('[getPatientById] Stat failed:', e); }
        } else if (!row) {
          // No DB row and no File -> Not found
          reject(new Error('Patient not found'));
          return;
        }

        // 4. Perform Repair if needed
        if (shouldRepair && patientXmlPath) {
          try {
            const { XMLParser } = await import('fast-xml-parser');
            const parser = new XMLParser({ ignoreAttributes: false });
            const xmlContent = fs.readFileSync(patientXmlPath, 'utf-8');
            const parsed = parser.parse(xmlContent);
            const p = parsed.patient;

            if (p) {
              console.log('[getPatientById] Repair Debug - Parsed Device:', JSON.stringify(p.devices, null, 2));

              // Update DB immediately
              await new Promise<void>((res, rej) => {
                db.run(
                  `INSERT OR REPLACE INTO Patients (
                             id, first_name, last_name, dob, hospitalPatientId, 
                             device_manufacturer, device_model, device_serial, leads, devices,
                             last_indexed_mtime,
                             mri_status, mri_data_hash,
                             manufacturer_warning_status, manufacturer_warning_hash
                           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    p.id,
                    p.first_name,
                    p.last_name,
                    p.dob,
                    p.hospitalPatientId || null,
                    p.device_manufacturer || (Array.isArray(p.devices?.device) ? p.devices.device[0].manufacturer : p.devices?.device?.manufacturer) || null,
                    p.device_model || (Array.isArray(p.devices?.device) ? p.devices.device[0].model : p.devices?.device?.model) || null,
                    p.device_serial || (Array.isArray(p.devices?.device) ? p.devices.device[0].serial : p.devices?.device?.serial) || null,
                    p.leads ? JSON.stringify(p.leads) : null,
                    p.devices && p.devices.device ? JSON.stringify(Array.isArray(p.devices.device) ? p.devices.device : [p.devices.device]) : null,
                    fileStats?.mtimeMs || Date.now(),
                    p.mri_status || null,
                    p.mri_data_hash || null,
                    p.manufacturer_warning_status || null,
                    p.manufacturer_warning_hash || null
                  ],
                  (e) => {
                    if (e) rej(e);
                    else res();
                  }
                );
              });

              // Update the 'row' variable so we return fresh data
              row = {
                ...row,
                id: p.id,
                first_name: p.first_name,
                last_name: p.last_name,
                dob: p.dob,
                deviceManufacturer: p.device_manufacturer || (p.devices?.device?.[0]?.manufacturer),
                deviceModel: p.device_model || (p.devices?.device?.[0]?.model),
                deviceSerial: p.device_serial || (p.devices?.device?.[0]?.serial),
                leads: p.leads ? JSON.stringify(p.leads) : null,
                devices: p.devices && p.devices.device ? JSON.stringify(Array.isArray(p.devices.device) ? p.devices.device : [p.devices.device]) : null,
                mri_status: row?.mri_status, // Preserve existing analysis if any
                manufacturer_warning_status: row?.manufacturer_warning_status // Preserve existing
              };
              console.log('[getPatientById] Read-repair complete.');
            }
          } catch (e) {
            console.error('[getPatientById] Repair failed:', e);
          }
        }

        // 5. Return Data
        if (!row) {
          reject(new Error('Patient not found'));
          return;
        }

        // Safe JSON Parse Helper
        const safeJSONParse = (str: any, fallback: any = []) => {
          if (!str) return fallback;
          try {
            return JSON.parse(str);
          } catch (e) {
            console.warn('[getPatientById] JSON parse failed, returning fallback:', e);
            return fallback;
          }
        };

        const normalizeLeads = (source: any) => {
          if (!source) return [];
          if (Array.isArray(source)) return source;
          if (source.lead && Array.isArray(source.lead)) return source.lead;
          if (source.lead) return [source.lead];
          return [];
        };

        const leads = normalizeLeads(safeJSONParse(row.leads, []));
        const devices = safeJSONParse(row.devices, []);

        // Resolve Device Data: Prioritize 'devices' list (from patient.xml) as it represents the current implant profile.
        // Fallback to Report/DB columns only if 'devices' list is empty.
        let deviceManufacturer = row.deviceManufacturer || row.device_manufacturer;
        let deviceModel = row.deviceModel || row.device_model;
        let deviceSerial = row.deviceSerial || row.device_serial;

        if (devices.length > 0) {
          const activeDevice = devices[0];
          if (activeDevice && activeDevice.model) {
            deviceManufacturer = activeDevice.manufacturer || deviceManufacturer;
            deviceModel = activeDevice.model;
            deviceSerial = activeDevice.serial || deviceSerial;
          }
        }

        const patient = {
          id: row.id,
          patientId: `P-${row.id}`,
          first_name: row.first_name,
          last_name: row.last_name,
          name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Unknown Patient',
          dob: row.dob || '',
          deviceManufacturer,
          deviceModel,
          deviceSerial,
          leads,
          devices,
          mriStatus: safeJSONParse(row.mri_status, null),
          manufacturerWarningStatus: safeJSONParse(row.manufacturer_warning_status, null)
        };
        resolve(patient);
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
        p.hospitalPatientId,
        p.mri_status,
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

    query += ' GROUP BY p.id, p.first_name, p.last_name, p.dob, p.mri_status';

    db.all(query, params, (err, rows: any[]) => {
      if (err) {
        reject(err);
      } else {
        // Transform the data to match frontend expectations
        const patients = rows.map(row => ({
          id: row.id,
          patientId: `P-${row.id}`,
          hospitalPatientId: row.hospitalPatientId || '',
          name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Unknown Patient',
          dob: row.dob || '',
          lastReportDate: row.lastReportDate || '',
          reportCount: row.reportCount || 0,
          mriStatus: row.mri_status ? JSON.parse(row.mri_status) : null,
          manufacturerWarningStatus: row.manufacturer_warning_status ? JSON.parse(row.manufacturer_warning_status) : null
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

export const rebuildDatabase = async (onProgress?: (status: any) => void): Promise<{ patients: number; reports: number }> => {
  console.log('[rebuildDatabase] Starting database rebuild...');
  if (onProgress) onProgress({ type: 'start', title: 'Rebuilding Database', message: 'Initializing...', progress: 0 });

  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  const reportsDir = path.join(dataDir, 'Reports');

  if (!fs.existsSync(reportsDir)) {
    console.warn('[rebuildDatabase] Reports directory not found:', reportsDir);
    return { patients: 0, reports: 0 };
  }

  // Dynamically import XMLParser to avoid circular dependency issues if any, though standard import is usually fine
  const { XMLParser } = await import('fast-xml-parser');
  const parser = new XMLParser({ ignoreAttributes: false });

  let patientCount = 0;
  let reportCount = 0;

  const patientDirs = await fs.promises.readdir(reportsDir, { withFileTypes: true });
  const totalDirs = patientDirs.filter(d => d.isDirectory()).length;
  let processedDirs = 0;

  for (const dir of patientDirs) {
    if (!dir.isDirectory()) continue;

    processedDirs++;
    const progress = Math.round((processedDirs / totalDirs) * 100);
    if (onProgress) onProgress({ type: 'progress', message: `Processing ${dir.name}...`, progress });

    const patientDir = path.join(reportsDir, dir.name);
    const patientXmlPath = path.join(patientDir, 'patient.xml');

    // 1. Process Patient
    if (fs.existsSync(patientXmlPath)) {
      try {
        const xmlContent = await fs.promises.readFile(patientXmlPath, 'utf-8');
        const parsed = parser.parse(xmlContent);
        const p = parsed.patient;

        if (p && p.id && p.last_name && p.dob) {
          // Upsert Patient
          await new Promise<void>((resolve, reject) => {
            const db = getDb();
            db.run(
              `INSERT OR REPLACE INTO Patients (
                 id, first_name, last_name, dob, hospitalPatientId,
                 device_manufacturer, device_model, device_serial, leads, devices,
                 mri_status, mri_data_hash,
                 manufacturer_warning_status, manufacturer_warning_hash,
                 last_indexed_mtime
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                p.id,
                p.first_name,
                p.last_name,
                p.dob,
                p.hospitalPatientId || null,
                p.device_manufacturer || null,
                p.device_model || null,
                p.device_serial || null,
                p.leads ? JSON.stringify(p.leads) : null,
                p.devices && p.devices.device ? JSON.stringify(Array.isArray(p.devices.device) ? p.devices.device : [p.devices.device]) : null,
                p.mri_status || null,
                p.mri_data_hash || null,
                p.manufacturer_warning_status || null,
                p.manufacturer_warning_hash || null,
                Date.now()
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
          patientCount++;
        }
      } catch (e) {
        console.error(`[rebuildDatabase] Failed to process patient XML for ${dir.name}:`, e);
      }
    }

    // 2. Process Visits (Reports)
    const visitDirs = await fs.promises.readdir(patientDir, { withFileTypes: true });
    // console.log(`[rebuildDatabase] Found ${visitDirs.length} items in ${dir.name}`);
    for (const vDir of visitDirs) {
      if (!vDir.isDirectory()) {
        // console.log(`Skipping non-directory in patient folder: ${vDir.name}`);
        continue;
      }
      console.log(`[rebuildDatabase] Processing visit dir: ${vDir.name}`);

      const visitDir = path.join(patientDir, vDir.name);

      // DEEP SCAN: Look for Files and Structured Data
      const visitFiles = await fs.promises.readdir(visitDir);

      // Find the main report file (PDF, PKG, etc.) matching the visit ID suffix if possible, or just the largest file?
      // Actually, we should just look for *any* valid report file.
      // But typically there is one source file per visit directory in this structure (plus mapped files).
      // Let's look for known extensions.
      const rawFile = visitFiles.find(f =>
        ['.pkg', '.xml', '.bnk', '.log'].includes(path.extname(f).toLowerCase()) &&
        !f.startsWith('patient') && // Exclude metadata XMLs
        !f.startsWith('visit')
      ) || visitFiles.find(f => path.extname(f).toLowerCase() === '.pdf');

      let reportData: any = {
        id: vDir.name.split('_').pop(), // Extract ID from "YYYY_MM_DD_UUID"
        patient_id: dir.name.split('_')[0],
        manufacturer: 'Unknown',
        interrogation_date: vDir.name.split('_').slice(0, 3).join('-'), // "YYYY-MM-DD" fallback
        device: { type: 'Unknown', model: 'Unknown', serial_number: 'Unknown' },
        leads: [],
        battery: {}
      };

      // 1. Parse Source File to Enrich Data (Deep Scan ON THE FLY - No Persistence)
      if (rawFile) {
        console.log(`[rebuildDatabase] Deep scanning ${rawFile} for ${vDir.name}...`);
        try {
          // Dynamic import
          const parserModule = await import('./parser');
          const report = await parserModule.parseFile(path.join(visitDir, rawFile));

          if (report) {
            // Merge deep data into reportData
            reportData = { ...reportData, ...report };
            // Ensure IDs match the folder structure if parser returned something else (unlikely but safe)
            reportData.id = vDir.name.split('_').pop();
            reportData.patient_id = dir.name.split('_')[0];
          }
        } catch (e) {
          console.error(`[rebuildDatabase] Failed to parse raw file ${rawFile}:`, e);
          // Fallback to visit.xml data only if parse fails
        }
      }

      // 2. Fallback / Baseline: Visit.xml
      const visitXmlPath = path.join(visitDir, 'visit.xml');
      if (fs.existsSync(visitXmlPath)) {
        try {
          const xmlContent = await fs.promises.readFile(visitXmlPath, 'utf-8');
          const parsed = parser.parse(xmlContent);
          const v = parsed.visit;
          if (v) {
            // Merge XML data as fallback/baseline
            if (!reportData.id) reportData.id = v.report_id;
            if (reportData.interrogation_date === 'Invalid Date') reportData.interrogation_date = v.interrogation_date;
            if (reportData.manufacturer === 'Unknown') reportData.manufacturer = v.manufacturer;

            if (v.device_type && reportData.device.type === 'Unknown') reportData.device.type = v.device_type;
            if (v.device_model && reportData.device.model === 'Unknown') reportData.device.model = v.device_model;
            if (v.device_serial && reportData.device.serial_number === 'Unknown') reportData.device.serial_number = v.device_serial;

            // Parse Leads from XML if not already found by deep scan
            if (v.leads && v.leads.lead && reportData.leads.length === 0) {
              const rawLeads = Array.isArray(v.leads.lead) ? v.leads.lead : [v.leads.lead];
              reportData.leads = rawLeads.map((l: any) => ({
                model: l.model,
                serial_number: l.serial,
                position: l.position || 'Unknown'
              }));
            }
            if (v.device_serial && reportData.device.serial_number === 'Unknown') reportData.device.serial_number = v.device_serial;
          }
        } catch (e) { console.error('Error reading visit.xml', e); }
      }

      // Upsert Report to DB
      if (reportData.id) {
        await new Promise<void>((resolve, reject) => {
          const db = getDb();
          db.run(
            `INSERT OR REPLACE INTO Reports (
                   id, patient_id, manufacturer, interrogation_date, 
                   device_type, device_model, device_serial_number, data
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              reportData.id,
              reportData.patient_id,
              reportData.manufacturer,
              reportData.interrogation_date,
              reportData.device?.type,
              reportData.device?.model,
              reportData.device?.serial_number,
              JSON.stringify(reportData)
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        reportCount++;
      }
    }
  }

  console.log(`[rebuildDatabase] Complete. Processed ${patientCount} patients and ${reportCount} reports.`);
  if (onProgress) onProgress({ type: 'complete', message: 'Database rebuild complete.', progress: 100 });
  return { patients: patientCount, reports: reportCount };
};

// --- Import Session & Event Helpers ---

export const createImportSession = (sessionId: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      'INSERT INTO ImportSessions (id, timestamp, status, summary) VALUES (?, ?, ?, ?)',
      [sessionId, new Date().toISOString(), 'running', JSON.stringify({})],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

export const updateImportSessionStatus = (sessionId: string, status: string, summary?: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    let query = 'UPDATE ImportSessions SET status = ?';
    const params = [status];

    if (summary) {
      query += ', summary = ?';
      params.push(JSON.stringify(summary));
    }
    query += ' WHERE id = ?';
    params.push(sessionId);

    db.run(query, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

export const logImportEvent = (event: {
  id: string;
  session_id: string;
  file_path: string;
  status: 'imported' | 'unmatched' | 'error' | 'manually_sorted' | 'skipped';
  patient_id?: string;
  report_id?: string;
  message?: string;
}): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      `INSERT INTO ImportEvents (
        id, session_id, timestamp, file_path, status, patient_id, report_id, message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.session_id,
        new Date().toISOString(),
        event.file_path,
        event.status,
        event.patient_id || null,
        event.report_id || null,
        event.message || null
      ],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

export const getImportHistory = (): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.all(
      `SELECT * FROM ImportSessions ORDER BY timestamp DESC LIMIT 50`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
};

export const getImportSessionEvents = (sessionId: string): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.all(
      `SELECT e.*, p.first_name, p.last_name 
       FROM ImportEvents e
       LEFT JOIN Patients p ON e.patient_id = p.id
       WHERE session_id = ?
       ORDER BY e.timestamp ASC`,
      [sessionId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
};

export const getImportEvent = async (eventId: string): Promise<any> => {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM ImportEvents WHERE id = ?', [eventId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const updateImportEvent = async (eventId: string, updates: any): Promise<void> => {
  const db = getDb();
  return new Promise((resolve, reject) => {
    const sets: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
    values.push(eventId);

    db.run(`UPDATE ImportEvents SET ${sets.join(', ')} WHERE id = ?`, values, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

export const updateReportPatient = async (reportId: string, newPatientId: string): Promise<void> => {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('UPDATE Reports SET patient_id = ? WHERE id = ?', [newPatientId, reportId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

export const updatePatientMRIStatus = async (patientId: string, status: any, hash: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      `UPDATE Patients SET mri_status = ?, mri_data_hash = ? WHERE id = ?`,
      [JSON.stringify(status), hash, patientId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

import { XMLParser } from 'fast-xml-parser';

export const syncDatabase = async (): Promise<{ newPatients: number; newReports: number }> => {
  console.log('[syncDatabase] Starting efficient background sync...');
  const start = Date.now();

  let newPatients = 0;
  let newReports = 0;

  try {
    const db = getDb();

    // 1. Get existing IDs in memory for fast checking
    const existingPatientIds = new Set<string>();
    const existingReportIds = new Set<string>();

    await new Promise<void>((resolve, reject) => {
      db.all('SELECT id FROM Patients', (err, rows: any[]) => {
        if (err) reject(err);
        else {
          rows.forEach(r => existingPatientIds.add(r.id));
          resolve();
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      db.all('SELECT id FROM Reports', (err, rows: any[]) => {
        if (err) reject(err);
        else {
          rows.forEach(r => existingReportIds.add(r.id));
          resolve();
        }
      });
    });

    // 2. Scan Filesystem
    const settings = await getSettings();
    const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
    const reportsDir = path.join(dataDir, 'Reports');

    if (!fs.existsSync(reportsDir)) {
      return { newPatients: 0, newReports: 0 };
    }

    const parser = new XMLParser({ ignoreAttributes: false });

    // Read Patient Dirs
    const patientDirs = await fs.promises.readdir(reportsDir, { withFileTypes: true });

    for (const pDir of patientDirs) {
      if (!pDir.isDirectory()) continue;

      // Extract Patient ID from Folder Name (heuristic: it's usually the ID, or starts with it)
      // Actually, folder name IS the patient ID in this system.
      const patientIdCandidate = pDir.name;

      // Check if Patient Exists
      let patientExists = existingPatientIds.has(patientIdCandidate);
      const patientPath = path.join(reportsDir, pDir.name);

      if (!patientExists) {
        // [NEW PATIENT FOUND] -> Import
        const patientXmlPath = path.join(patientPath, 'patient.xml');
        if (fs.existsSync(patientXmlPath)) {
          try {
            const xmlContent = await fs.promises.readFile(patientXmlPath, 'utf-8');
            const parsed = parser.parse(xmlContent);
            const p = parsed.patient;

            if (p) {
              await new Promise<void>((resolve, reject) => {
                db.run(
                  `INSERT OR REPLACE INTO Patients (
                     id, first_name, last_name, dob, hospitalPatientId,
                     device_manufacturer, device_model, device_serial, leads, devices, last_indexed_mtime,
                     mri_status, mri_data_hash
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    p.id,
                    p.first_name,
                    p.last_name,
                    p.dob,
                    p.hospitalPatientId || null,
                    p.device_manufacturer || null,
                    p.device_model || null,
                    p.device_serial || null,
                    p.leads ? JSON.stringify(p.leads) : null,
                    p.devices && p.devices.device ? JSON.stringify(Array.isArray(p.devices.device) ? p.devices.device : [p.devices.device]) : null,

                    Date.now(),
                    p.mri_status || null,
                    p.mri_data_hash || null
                  ],
                  (err) => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              });
              newPatients++;
              existingPatientIds.add(p.id); // Add to set so we don't re-add
            }
          } catch (e) {
            console.warn(`[syncDatabase] Failed to import new patient ${pDir.name}:`, e);
          }
        }
      }

      // Check for New Visits (Reports)
      // Only if patient is effectively known (was known or just added)
      // Scan visit directories
      const visitDirs = await fs.promises.readdir(patientPath, { withFileTypes: true });

      for (const vDir of visitDirs) {
        if (!vDir.isDirectory()) continue;

        // Visit ID is the last part of "YYYY_MM_DD_UUID"
        const visitId = vDir.name.split('_').pop();
        if (!visitId) continue;

        if (!existingReportIds.has(visitId)) {
          // [NEW VISIT FOUND] -> Import
          // Use the Deep Scan logic from rebuildDatabase... simplified here
          // We need to parse a file to get details.
          const visitAbsPath = path.join(patientPath, vDir.name);
          const visitFiles = await fs.promises.readdir(visitAbsPath);
          const rawFile = visitFiles.find(f =>
            ['.pkg', '.xml', '.bnk', '.log'].includes(path.extname(f).toLowerCase()) &&
            !f.startsWith('patient') && !f.startsWith('visit')
          ) || visitFiles.find(f => path.extname(f).toLowerCase() === '.pdf');

          if (rawFile) {
            try {
              // Dynamic import parser
              const parserModule = await import('./parser');
              const report = await parserModule.parseFile(path.join(visitAbsPath, rawFile));

              if (report) {
                // Ensure IDs match what we expect
                if (!report.id) report.id = visitId;
                if (!report.patient_id) report.patient_id = patientIdCandidate;

                await createReport(report as any);
                newReports++;
                existingReportIds.add(visitId);
              }
            } catch (e) {
              console.warn(`[syncDatabase] Failed to import new visit ${vDir.name}:`, e);
            }
          }
        }
      }
    }

  } catch (error) {
    console.error('[syncDatabase] Error:', error);
  }

  if (newPatients > 0 || newReports > 0) {
    console.log(`[syncDatabase] Complete in ${Date.now() - start}ms. Added ${newPatients} patients, ${newReports} reports.`);
  }

  return { newPatients, newReports };
};

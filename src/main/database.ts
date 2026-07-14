import { app } from 'electron';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { UnifiedReport } from './reports';
import { normalizeDate } from '../lib/dates';
import { normalizeNameKey } from '../lib/names';
import { writeFileAtomic } from './utils/atomicFile';

/**
 * Recursively strip fast-xml-parser leftovers from a parsed-report payload
 * so the renderer never sees an XML-attribute object dropped into JSX
 * (React error #31). Specifically:
 *  - drops keys starting with `@_` (fast-xml-parser attribute prefix)
 *  - unwraps `{'#text': 'value', ...}` to its text content
 *  - collapses attribute-only objects (e.g. `{'@_charset': 'UCS-2'}`) to ''
 *
 * Applied at read time so already-corrupted Reports.data rows render
 * without crashing instead of requiring a re-import.
 */
function sanitizeXmlLeftovers(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeXmlLeftovers);
  if (typeof value !== 'object') return value;

  if ('#text' in value) return sanitizeXmlLeftovers((value as any)['#text']);

  const cleaned: Record<string, any> = {};
  let kept = 0;
  for (const [k, v] of Object.entries(value)) {
    if (k.startsWith('@_')) continue;
    cleaned[k] = sanitizeXmlLeftovers(v);
    kept++;
  }
  return kept === 0 ? '' : cleaned;
}

/**
 * If `xmlPath` contains `<field>raw</field>` and `normalizeDate(raw)` produces a
 * different non-empty canonical form, rewrite the tag in place and return the
 * canonical value. Returns the original (or normalized) value the caller should
 * trust going forward; returns null if the field is absent.
 *
 * Used by rebuildDatabase to heal pre-existing visit.xml / patient.xml whose
 * date fields were written by older parser code paths that didn't normalize.
 */
async function healDateField(xmlPath: string, fieldName: string): Promise<string | null> {
  let content: string;
  try {
    content = await fs.promises.readFile(xmlPath, 'utf-8');
  } catch {
    return null;
  }
  const re = new RegExp(`<${fieldName}>([^<]*)</${fieldName}>`);
  const m = re.exec(content);
  if (!m) return null;
  const raw = m[1];
  const normalized = normalizeDate(raw);
  if (!normalized || normalized === raw) return raw;
  try {
    await writeFileAtomic(xmlPath, content.replace(re, `<${fieldName}>${normalized}</${fieldName}>`));
    console.log(`[rebuildDatabase] Normalized ${fieldName} in ${xmlPath}: "${raw}" -> "${normalized}"`);
  } catch (e) {
    console.warn(`[rebuildDatabase] Failed to rewrite ${fieldName} in ${xmlPath}:`, e);
    return raw;
  }
  return normalized;
}

/**
 * Safe JSON parse: returns `fallback` for empty/malformed input instead of
 * throwing. Used wherever JSON-encoded DB columns are decoded — a single
 * corrupted row must never take down a whole query (e.g. the dashboard list).
 */
const safeJSONParse = (str: any, fallback: any = null) => {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    console.warn('[database] JSON parse failed, returning fallback:', e);
    return fallback;
  }
};

/**
 * First-name compatibility check used when matching patients by last name +
 * DOB. Two first names are compatible when either is empty, or when one
 * normalized key is a prefix of the other ("Jo" / "Johann", "Anna" /
 * "Anna Maria").
 *
 * Patient identity intentionally remains last name + DOB (issue #139: parser
 * first-name variants like "Jon"/"John" must not spawn duplicates), so this is
 * ADVISORY only: when several rows share the key we prefer a compatible one,
 * and a clear mismatch is logged for review — it never blocks the match.
 */
const firstNamesCompatible = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const keyA = normalizeNameKey(a ?? '');
  const keyB = normalizeNameKey(b ?? '');
  if (!keyA || !keyB) return true;
  return keyA.startsWith(keyB) || keyB.startsWith(keyA);
};

/** Pick the best last-name+DOB candidate: prefer a first-name-compatible row,
 *  fall back to the first match (legacy behavior) with a logged warning. */
const pickPatientCandidate = (rows: any[], firstName?: string | null): any | undefined => {
  const candidates = rows || [];
  if (candidates.length === 0) return undefined;
  const compatible = candidates.find(r => firstNamesCompatible(firstName, r.first_name));
  if (compatible) return compatible;
  console.warn(
    `[database] Patient match on last name + DOB with differing first name ` +
    `("${firstName}" vs "${candidates[0].first_name}") — matched anyway (id ${candidates[0].id}). ` +
    `If these are two different people, split them via the patient editor.`
  );
  return candidates[0];
};

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
        last_name_key TEXT,
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
    // Unicode-normalized last-name key for case/diacritic-insensitive matching.
    // Backfilled for existing rows in backfillLastNameKeys() after init.
    safeAddColumn("ALTER TABLE Patients ADD COLUMN last_name_key TEXT");
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
    db.run(`CREATE INDEX IF NOT EXISTS idx_patients_last_name_key_dob ON Patients(last_name_key, dob);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_import_events_session_id ON ImportEvents(session_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_import_events_patient_id ON ImportEvents(patient_id);`);
  });
};

/**
 * Populate last_name_key for rows created before the column existed (or any row
 * left null). Best-effort: a failure here must not block startup, so we resolve
 * regardless. Runs on the same connection as createTables, so it is queued after
 * the ADD COLUMN migration.
 */
const backfillLastNameKeys = (db: sqlite3.Database): Promise<void> => {
  return new Promise((resolve) => {
    db.all(
      `SELECT id, last_name FROM Patients WHERE last_name_key IS NULL OR last_name_key = ''`,
      (err, rows: any[]) => {
        if (err || !rows || rows.length === 0) {
          if (err) console.warn('[Schema Migration] last_name_key backfill skipped:', err.message);
          resolve();
          return;
        }
        const stmt = db.prepare('UPDATE Patients SET last_name_key = ? WHERE id = ?');
        for (const row of rows) {
          stmt.run(normalizeNameKey(row.last_name), row.id);
        }
        stmt.finalize(() => {
          console.log(`[Schema Migration] Backfilled last_name_key for ${rows.length} patient(s).`);
          resolve();
        });
      }
    );
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
        // Enable WAL mode and busy timeout for file-based databases
        // (not supported for :memory: databases)
        if (dbPath !== ':memory:') {
          db.run('PRAGMA journal_mode = WAL');
          db.run('PRAGMA busy_timeout = 5000');
        }
        createTables(db);
        dbInstance = db;
        // Backfill is queued after createTables on the same connection; await it
        // so the first match query never races an un-keyed row.
        backfillLastNameKeys(db)
          .then(() => resolve(db))
          .catch(() => resolve(db));
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

export const findPatient = (lastName: string, dob: string, firstName?: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    // Match on the Unicode-normalized last-name key (see normalizeNameKey) so
    // name variants from different parsers / manual entry — case, whitespace and
    // accents ("Smith " / "smith" / "Müller" / "müller") — resolve to the same
    // patient instead of spawning a duplicate.
    //
    // When a first name is supplied it is used to PREFER among multiple
    // candidates (see pickPatientCandidate) — it never rejects the match,
    // since parser first-name variants ("Jon"/"John") must resolve to the
    // same patient (issue #139).
    db.all(
      'SELECT * FROM Patients WHERE last_name_key = ? AND dob = ?',
      [normalizeNameKey(lastName), dob],
      (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(pickPatientCandidate(rows, firstName));
        }
      }
    );
  });
};


export const findPatientBySerial = (serial: string, manufacturer?: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    // Find the most recent patient associated with this serial number.
    // Serial numbers are only unique per manufacturer, so when the caller
    // knows the manufacturer we scope the lookup to it — otherwise a Medtronic
    // serial could match an unrelated patient's Biotronik device.
    let query = `SELECT p.* FROM Patients p
       JOIN Reports r ON p.id = r.patient_id
       WHERE r.device_serial_number = ?`;
    const params: any[] = [serial];
    if (manufacturer && manufacturer !== 'Unknown') {
      query += ' AND r.manufacturer = ?';
      params.push(manufacturer);
    }
    query += `
       ORDER BY r.interrogation_date DESC
       LIMIT 1`;
    db.get(query, params, (err, row) => {
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
      'INSERT INTO Patients (id, first_name, last_name, last_name_key, dob, hospitalPatientId) VALUES (?, ?, ?, ?, ?, ?)',
      [patient.id, patient.first_name, patient.last_name, normalizeNameKey(patient.last_name), patient.dob, patient.hospitalPatientId],
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

/**
 * Return the existing patient matching the Unicode-normalized last-name key
 * (see normalizeNameKey — case/whitespace/accent-insensitive) + dob, or create a
 * new one. The insert is guarded by a `WHERE NOT EXISTS` sub-select so the
 * check-then-insert is a single atomic statement — this closes the race window
 * that let concurrent imports (auto-import + manual sort, or two parallel files)
 * each create a duplicate patient for the same person.
 *
 * Every patient-creation path (auto-import, the sorting dialogue, drag-to-move,
 * remote import) routes through here so duplicate detection is consistent.
 */
export const findOrCreatePatient = async (patient: {
  id?: string;
  first_name: string;
  last_name: string;
  dob: string;
  hospitalPatientId: string | null;
}): Promise<{ patient: any; created: boolean }> => {
  const db = getDb();
  const lastNameKey = normalizeNameKey(patient.last_name);

  const selectMatch = (): Promise<any | undefined> => new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM Patients WHERE last_name_key = ? AND dob = ?',
      [lastNameKey, patient.dob],
      (err, rows: any[]) => {
        if (err) reject(err);
        // Prefer a first-name-compatible candidate, but never refuse the
        // match — identity is last name + DOB (issue #139).
        else resolve(pickPatientCandidate(rows, patient.first_name));
      }
    );
  });

  const selectById = (id: string): Promise<any> => new Promise((resolve, reject) => {
    db.get('SELECT * FROM Patients WHERE id = ?', [id], (err, row) => err ? reject(err) : resolve(row));
  });

  // 1. Reuse an existing matching patient.
  const existing = await selectMatch();
  if (existing) return { patient: existing, created: false };

  const id = patient.id || uuidv4();

  // 2. Guarded insert: the `WHERE NOT EXISTS` sub-select keeps the
  //    check-then-insert atomic against a concurrent import creating the same
  //    person (auto-import + manual sort, or two parallel files).
  const changes = await new Promise<number>((resolve, reject) => {
    db.run(
      `INSERT INTO Patients (id, first_name, last_name, last_name_key, dob, hospitalPatientId)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM Patients WHERE last_name_key = ? AND dob = ?
       )`,
      [id, patient.first_name, patient.last_name, lastNameKey, patient.dob, patient.hospitalPatientId, lastNameKey, patient.dob],
      function (this: sqlite3.RunResult, err: Error | null) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
  if (changes > 0) {
    return { patient: await selectById(id), created: true };
  }

  // 3. The guard blocked us: a concurrent import inserted the same person
  //    between step 1 and step 2 — reuse that row.
  const concurrent = await selectMatch();
  if (concurrent) return { patient: concurrent, created: false };

  // Unreachable: the guard only blocks when a matching row exists.
  throw new Error(`findOrCreatePatient: insert blocked but no row found for key ${lastNameKey}/${patient.dob}`);
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
    // The warning columns are only touched when the caller explicitly passes
    // them (even as null). Callers that update demographics/devices without
    // warning data (e.g. the update-patient IPC) must not wipe the cached
    // manufacturer-warning result.
    let query = `UPDATE Patients SET
         first_name = ?, last_name = ?, last_name_key = ?, dob = ?, hospitalPatientId = ?,
         device_manufacturer = ?, device_model = ?, device_serial = ?, leads = ?, devices = ?`;
    const params: any[] = [
      patient.first_name,
      patient.last_name,
      normalizeNameKey(patient.last_name),
      patient.dob,
      patient.hospitalPatientId,
      patient.device_manufacturer || null,
      patient.device_model || null,
      patient.device_serial || null,
      patient.leads || null,
      patient.devices ? JSON.stringify(patient.devices) : null,
    ];
    if (patient.manufacturer_warning_status !== undefined) {
      query += ', manufacturer_warning_status = ?';
      params.push(patient.manufacturer_warning_status ? JSON.stringify(patient.manufacturer_warning_status) : null);
    }
    if (patient.manufacturer_warning_hash !== undefined) {
      query += ', manufacturer_warning_hash = ?';
      params.push(patient.manufacturer_warning_hash || null);
    }
    query += ' WHERE id = ?';
    params.push(patient.id);

    db.run(query, params, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
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

export const getPatientById = async (patientId: string): Promise<any> => {
  // Plain async function (NOT an async Promise executor): a synchronous throw
  // here — e.g. getDb() while the DB is closed — must reject the returned
  // promise instead of leaving the caller hanging forever.
  const db = getDb();

  // 1. Fetch from DB
  let row: any = await new Promise((resolve, reject) => {
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
      (err, r: any) => {
        if (err) {
          console.error('[getPatientById] Database error:', err);
          reject(err);
        } else {
          resolve(r);
        }
      }
    );
  });

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

  let patientXmlExists = false;
  if (patientXmlPath) {
    try {
      await fs.promises.access(patientXmlPath);
      patientXmlExists = true;
    } catch { /* doesn't exist */ }
  }

  if (patientXmlPath && patientXmlExists) {
    try {
      fileStats = await fs.promises.stat(patientXmlPath);
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
    throw new Error('Patient not found');
  }

  // 4. Perform Repair if needed
  if (shouldRepair && patientXmlPath) {
    try {
      const { XMLParser } = await import('fast-xml-parser');
      const parser = new XMLParser({ ignoreAttributes: false });
      const xmlContent = await fs.promises.readFile(patientXmlPath, 'utf-8');
      const parsed = parser.parse(xmlContent);
      const p = parsed.patient;

      if (p) {
        console.log('[getPatientById] Repair Debug - Parsed Device:', JSON.stringify(p.devices, null, 2));

        // Update DB immediately.
        // NOTE: INSERT OR REPLACE nulls any column not listed, so last_name_key
        // MUST be included here — losing it silently breaks the name+DOB patient
        // matching (findPatient / findOrCreatePatient) until the next startup
        // backfill and spawns duplicate patients on import.
        await new Promise<void>((res, rej) => {
          db.run(
            `INSERT OR REPLACE INTO Patients (
                       id, first_name, last_name, last_name_key, dob, hospitalPatientId,
                       device_manufacturer, device_model, device_serial, leads, devices,
                       last_indexed_mtime,
                       mri_status, mri_data_hash,
                       manufacturer_warning_status, manufacturer_warning_hash
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              p.id,
              p.first_name,
              p.last_name,
              normalizeNameKey(p.last_name),
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
    throw new Error('Patient not found');
  }

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

  return {
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
          const processRows = async () => {
            // Resolve the real patient directory once: the on-disk layout is
            // Reports/{patientId}_{Name}/{YYYY_MM_DD}_{reportId}/ — NOT
            // Reports/{reportId}/ — so files must be looked up per visit dir.
            let patientDirPath: string | null = null;
            let visitDirNames: string[] = [];
            try {
              const reportsRoot = path.join(dataDir, 'Reports');
              const dirs = await fs.promises.readdir(reportsRoot);
              const patientDirName = dirs.find(d => d === patientId || d.startsWith(`${patientId}_`));
              if (patientDirName) {
                patientDirPath = path.join(reportsRoot, patientDirName);
                visitDirNames = await fs.promises.readdir(patientDirPath);
              }
            } catch {
              // Reports dir missing — return reports without file lists
            }

            const reports = [];
            for (const row of rows) {
              let device = null;
              let battery = null;
              let leads = null;
              let arrhythmia_summary = null;
              let files: string[] = [];

              try {
                // Parse the full data JSON
                if (row.data) {
                  const fullData = sanitizeXmlLeftovers(JSON.parse(row.data));
                  device = fullData.device;
                  battery = fullData.battery;
                  leads = fullData.leads;
                  arrhythmia_summary = fullData.arrhythmia_summary;
                }

                // Scan for files in the visit directory belonging to this report
                if (patientDirPath) {
                  const visitDirName = visitDirNames.find(d => d.endsWith(`_${row.id}`) || d === row.id);
                  if (visitDirName) {
                    const visitDir = path.join(patientDirPath, visitDirName);
                    try {
                      const reportFiles = await fs.promises.readdir(visitDir);
                      files = reportFiles.map(file => path.join(visitDir, file));
                    } catch {
                      // directory doesn't exist
                    }
                  }
                }
              } catch (e) {
                console.error('Error parsing report data or reading files:', e);
              }

              reports.push({
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
              });
            }
            return reports;
          };
          processRows().then(resolve).catch(reject);
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
        p.manufacturer_warning_status,
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

    query += ' GROUP BY p.id, p.first_name, p.last_name, p.dob, p.mri_status, p.manufacturer_warning_status';

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
          // safeJSONParse: one corrupted JSON cell must not break the whole list
          mriStatus: safeJSONParse(row.mri_status, null),
          manufacturerWarningStatus: safeJSONParse(row.manufacturer_warning_status, null)
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

/**
 * Find duplicate reports: same patient + same interrogation date.
 * Returns groups of report IDs that share patient_id + date prefix.
 */
export const findDuplicateReports = (): Promise<{ patient_id: string; date: string; reportIds: string[] }[]> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    // Find all (patient_id, date) combos that have more than one report
    db.all(
      `SELECT patient_id, SUBSTR(interrogation_date, 1, 10) as date_prefix, GROUP_CONCAT(id) as ids, COUNT(*) as cnt
       FROM Reports
       WHERE interrogation_date IS NOT NULL
       GROUP BY patient_id, date_prefix
       HAVING cnt > 1`,
      (err, rows: any[]) => {
        if (err) return reject(err);
        const groups = rows.map(row => ({
          patient_id: row.patient_id,
          date: row.date_prefix,
          reportIds: row.ids.split(','),
        }));
        resolve(groups);
      }
    );
  });
};

/**
 * Delete a report row from the database.
 */
export const deleteReport = (reportId: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run('DELETE FROM Reports WHERE id = ?', [reportId], function (err) {
      if (err) return reject(err);
      resolve();
    });
  });
};

export interface PatientWithSerials {
  id: string;
  first_name: string | null;
  last_name: string | null;
  last_name_key: string | null;
  dob: string | null;
  hospitalPatientId: string | null;
  reportCount: number;
  lastReportDate: string | null;
  serials: string[];
}

/**
 * Fetch every patient together with the distinct device serial numbers that
 * appear in their reports, plus report counts and last-visit date. Used by the
 * patient-merge service to detect duplicate/near-duplicate patient records.
 */
export const getPatientsWithSerials = (): Promise<PatientWithSerials[]> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.all(
      `SELECT
         p.id,
         p.first_name,
         p.last_name,
         p.last_name_key,
         p.dob,
         p.hospitalPatientId,
         COUNT(r.id) as reportCount,
         MAX(r.interrogation_date) as lastReportDate,
         GROUP_CONCAT(DISTINCT r.device_serial_number) as serials
       FROM Patients p
       LEFT JOIN Reports r ON p.id = r.patient_id
       GROUP BY p.id`,
      (err, rows: any[]) => {
        if (err) return reject(err);
        const patients: PatientWithSerials[] = rows.map(row => ({
          id: row.id,
          first_name: row.first_name ?? null,
          last_name: row.last_name ?? null,
          last_name_key: row.last_name_key ?? null,
          dob: row.dob ?? null,
          hospitalPatientId: row.hospitalPatientId ?? null,
          reportCount: row.reportCount || 0,
          lastReportDate: row.lastReportDate ?? null,
          serials: (row.serials ? String(row.serials).split(',') : [])
            .map((s: string) => s.trim())
            .filter((s: string) => s && s !== 'Unknown'),
        }));
        resolve(patients);
      }
    );
  });
};

/**
 * Return just the report IDs belonging to a patient (lightweight; avoids the
 * per-report filesystem reads that getPatientReports performs).
 */
export const getReportIdsForPatient = (patientId: string): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.all('SELECT id FROM Reports WHERE patient_id = ?', [patientId], (err, rows: any[]) => {
      if (err) return reject(err);
      resolve(rows.map(r => r.id));
    });
  });
};

/**
 * Delete a patient row and any reports still referencing it. Reports are
 * normally moved away before a merge deletes the loser patient; the report
 * delete here is a safety net against orphaned rows. Filesystem cleanup of the
 * patient directory is handled by the caller.
 */
export const deletePatient = (patientId: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    // Both deletes run in one transaction so a mid-way failure can't leave the
    // patient deleted with orphaned reports (or vice versa). BEGIN + the two
    // DELETEs are queued back-to-back inside serialize(); COMMIT/ROLLBACK is
    // dispatched from the final callback based on whether either failed.
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');
      let txError: Error | null = null;
      db.run('DELETE FROM Reports WHERE patient_id = ?', [patientId], (err) => {
        if (err) txError = txError || err;
      });
      db.run('DELETE FROM Patients WHERE id = ?', [patientId], (err) => {
        if (err) txError = txError || err;
        if (txError) {
          db.run('ROLLBACK', () => reject(txError));
        } else {
          db.run('COMMIT', (commitErr) => commitErr ? reject(commitErr) : resolve());
        }
      });
    });
  });
};

export const rebuildDatabase = async (onProgress?: (status: any) => void): Promise<{ patients: number; reports: number }> => {
  console.log('[rebuildDatabase] Starting database rebuild...');
  if (onProgress) onProgress({ type: 'start', title: 'Rebuilding Database', message: 'Initializing...', progress: 0 });

  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  const reportsDir = path.join(dataDir, 'Reports');

  try {
    await fs.promises.access(reportsDir);
  } catch {
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
    try {
      await healDateField(patientXmlPath, 'dob');
      const xmlContent = await fs.promises.readFile(patientXmlPath, 'utf-8');
      const parsed = parser.parse(xmlContent);
      const p = parsed.patient;

      if (p && p.id && p.last_name && p.dob) {
        // Upsert Patient
        await new Promise<void>((resolve, reject) => {
          const db = getDb();
          db.run(
            // INSERT OR REPLACE nulls unlisted columns — last_name_key must be
            // included or patient matching breaks until the next startup backfill.
            `INSERT OR REPLACE INTO Patients (
               id, first_name, last_name, last_name_key, dob, hospitalPatientId,
               device_manufacturer, device_model, device_serial, leads, devices,
               mri_status, mri_data_hash,
               manufacturer_warning_status, manufacturer_warning_hash,
               last_indexed_mtime
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              p.id,
              p.first_name,
              p.last_name,
              normalizeNameKey(p.last_name),
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
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
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
      try {
        await healDateField(visitXmlPath, 'interrogation_date');
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
      } catch (e: any) {
        if (e.code !== 'ENOENT') {
          console.error('Error reading visit.xml', e);
        }
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
  status: 'imported' | 'unmatched' | 'error' | 'manually_sorted' | 'skipped' | 'pending_manual_sort';
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

    try {
      await fs.promises.access(reportsDir);
    } catch {
      return { newPatients: 0, newReports: 0 };
    }

    const parser = new XMLParser({ ignoreAttributes: false });

    // Read Patient Dirs
    const patientDirs = await fs.promises.readdir(reportsDir, { withFileTypes: true });

    for (const pDir of patientDirs) {
      if (!pDir.isDirectory()) continue;

      // Extract Patient ID from folder name (format: "UUID_LastName_FirstName")
      const patientIdCandidate = pDir.name.split('_')[0];

      // Check if Patient Exists
      let patientExists = existingPatientIds.has(patientIdCandidate);
      const patientPath = path.join(reportsDir, pDir.name);

      if (!patientExists) {
        // [NEW PATIENT FOUND] -> Import
        const patientXmlPath = path.join(patientPath, 'patient.xml');
        try {
          const xmlContent = await fs.promises.readFile(patientXmlPath, 'utf-8');
          const parsed = parser.parse(xmlContent);
          const p = parsed.patient;

          if (p) {
            await new Promise<void>((resolve, reject) => {
              db.run(
                // INSERT OR REPLACE nulls unlisted columns — last_name_key must
                // be included or newly synced patients can't be matched by
                // name+DOB until the next startup backfill (duplicate patients).
                `INSERT OR REPLACE INTO Patients (
                   id, first_name, last_name, last_name_key, dob, hospitalPatientId,
                   device_manufacturer, device_model, device_serial, leads, devices, last_indexed_mtime,
                   mri_status, mri_data_hash
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  p.id,
                  p.first_name,
                  p.last_name,
                  normalizeNameKey(p.last_name),
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
        } catch (e: any) {
          if (e.code !== 'ENOENT') {
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
                if (!report.patient_id) report.patient_id = pDir.name.split('_')[0];

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

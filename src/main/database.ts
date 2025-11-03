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
        last_device_model TEXT,
        last_seen_date TEXT
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS Reports (
        id TEXT PRIMARY KEY,
        patient_id TEXT,
        visit_date TEXT,
        device_manufacturer TEXT,
        pdf_paths TEXT,
        data_path TEXT,
        FOREIGN KEY (patient_id) REFERENCES Patients (id)
      );
    `);
  });
};

export const initializeDatabase = () => {
  const db = createDbConnection();
  createTables(db);
  return db;
};

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { initializeDatabase, getDb, getAllPatients, getPatientReports, getSettings, setSettings } from './database';
import { initializeWatcher } from './watcher';
import { seedDatabase } from './seed';
import { getConfig, saveConfig } from './config';
import { initializeStorage } from './storage';

let mainWindow: BrowserWindow | null;

export function sendUnmatchedFiles(files: string[]) {
  if (mainWindow) {
    mainWindow.webContents.send('unmatched-files', files);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  const config = getConfig();

  const dbPath = config.dbPath || path.join(userDataPath, '_DATA', 'database.db');
  initializeDatabase(dbPath);

  const settings = await getSettings();
  const importDir = settings.importDir || path.join(userDataPath, '_IMPORT');
  const unmatchedDir = settings.unmatchedDir || path.join(userDataPath, '_UNMATCHED');

  await initializeStorage();

  const db = getDb();
  db.get('SELECT COUNT(*) as count FROM Patients', (err, row: { count: number }) => {
    if (err) {
      console.error('Error checking patient count:', err);
      return;
    }

    if (row.count === 0) {
      console.log('Database is empty, seeding with mock data...');
      seedDatabase();
    } else {
      console.log('Database already contains data, skipping seed.');
    }
  });

  initializeWatcher(importDir, unmatchedDir);
  createWindow();
  console.log('Electron app is ready.');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.handle('get-all-patients', async (event, filters) => {
  try {
    const patients = await getAllPatients(filters);
    return patients;
  } catch (error) {
    console.error('Failed to get all patients:', error);
    throw error;
  }
});

ipcMain.handle('select-directory', async () => {
  if (!mainWindow) {
    return;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

ipcMain.handle('get-patient-reports', async (event, patientId) => {
  try {
    const reports = await getPatientReports(patientId);
    return reports;
  } catch (error) {
    console.error('Failed to get patient reports:', error);
    throw error;
  }
});

ipcMain.handle('get-settings', async () => {
  try {
    const dbSettings = await getSettings();
    const config = getConfig();
    return { ...dbSettings, dbPath: config.dbPath };
  } catch (error) {
    console.error('Failed to get settings:', error);
    throw error;
  }
});

ipcMain.handle('set-settings', async (event, settings) => {
  try {
    const { dbPath, ...dbSettings } = settings;
    await setSettings(dbSettings);
    const config = getConfig();
    config.dbPath = dbPath;
    saveConfig(config);
  } catch (error) {
    console.error('Failed to set settings:', error);
    throw error;
  }
});

ipcMain.handle('get-pdf-data', async (event, filePath) => {
  try {
    const data = await fs.readFile(filePath);
    return data;
  } catch (error) {
    console.error('Failed to read PDF file:', error);
    throw error;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

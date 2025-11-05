import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { initializeDatabase, getDb, getAllPatients, getPatientReports, getSettings, setSettings } from './database';
import { initializeWatcher } from './watcher';
import { seedDatabase } from './seed';

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

app.whenReady().then(() => {
  initializeDatabase();

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

  initializeWatcher();
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
    const settings = await getSettings();
    return settings;
  } catch (error) {
    console.error('Failed to get settings:', error);
    throw error;
  }
});

ipcMain.handle('set-settings', async (event, settings) => {
  try {
    await setSettings(settings);
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

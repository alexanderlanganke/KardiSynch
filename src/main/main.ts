import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { initializeDatabase, getDb, getAllPatients, getPatientById, getPatientReports } from './database';
import { initializeWatcher, stopWatcher } from './watcher';
import { initializeStorage } from './storage';
import { setMainWindow, getMainWindow } from './windowManager';
import { getAllSettings, saveSettings } from './settingsService';
import { getConfig } from './config';
import { XMLParser } from 'fast-xml-parser';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1800,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    title: 'KardiSynch'
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  setMainWindow(mainWindow);
}

app.whenReady().then(async () => {
  // Initialize Database FIRST
  const config = getConfig();
  const dbPath = config.dbPath;
  initializeDatabase(dbPath);

  // Now get all settings
  const settings = await getAllSettings();

  await initializeStorage();

  // Initialize watcher (NO MOCK DATA SEEDING)
  initializeWatcher(settings.importDir, settings.unmatchedDir, settings.dataPath);
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

ipcMain.handle('get-patient-by-id', async (event, patientId) => {
  try {
    const patient = await getPatientById(patientId);
    return patient;
  } catch (error) {
    console.error('Failed to get patient by id:', error);
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

ipcMain.handle('select-directory', async () => {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});



ipcMain.handle('get-settings', async () => {
  try {
    return await getAllSettings();
  } catch (error) {
    console.error('Failed to get settings:', error);
    throw error;
  }
});

ipcMain.handle('set-settings', async (event, settings) => {
  try {
    const oldSettings = await getAllSettings();
    await saveSettings(settings);
    const newSettings = await getAllSettings();

    // Restart watcher if relevant paths changed
    if (
      oldSettings.importDir !== newSettings.importDir ||
      oldSettings.unmatchedDir !== newSettings.unmatchedDir ||
      oldSettings.dataPath !== newSettings.dataPath
    ) {
      console.log('Paths changed, restarting watcher...');
      stopWatcher();
      initializeWatcher(newSettings.importDir, newSettings.unmatchedDir, newSettings.dataPath);
    }

  } catch (error) {
    console.error('Failed to set settings:', error);
    throw error;
  }
});

ipcMain.handle('reset-settings', async () => {
  try {
    const newSettings = await import('./settingsService').then(m => m.resetSettings());

    // Restart watcher with default paths
    console.log('Settings reset, restarting watcher...');
    stopWatcher();
    initializeWatcher(newSettings.importDir, newSettings.unmatchedDir, newSettings.dataPath);

    return newSettings;
  } catch (error) {
    console.error('Failed to reset settings:', error);
    throw error;
  }
});

ipcMain.handle('get-pdf-data', async (event, filePath) => {
  try {
    console.log('[get-pdf-data] Requesting file:', filePath);
    const data = await fs.readFile(filePath);
    console.log('[get-pdf-data] Read success. Size:', data.length);
    return data;
  } catch (error) {
    console.error('[get-pdf-data] Failed to read PDF file:', error);
  }
});

ipcMain.handle('open-patient-directory', async (event, patientId: string) => {
  try {
    const settings = await getAllSettings();
    const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
    const reportsDir = path.join(dataDir, 'Reports');

    // Find the patient directory that starts with the patientId
    const dirs = await fs.readdir(reportsDir);
    const patientDir = dirs.find(dir => dir.startsWith(patientId));

    if (!patientDir) {
      // If no patient dir found, open the Reports folder
      await shell.openPath(reportsDir);
      return { success: true };
    }

    const fullPath = path.join(reportsDir, patientDir);
    await shell.openPath(fullPath);
    return { success: true };
  } catch (error) {
    console.error('[open-patient-directory] Failed:', error);
    throw error;
  }
});

// Filesystem-based IPC handlers
ipcMain.handle('get-patient-directories', async () => {
  try {
    const settings = await getAllSettings();
    const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
    const reportsDir = path.join(dataDir, 'Reports');

    if (!await fs.access(reportsDir).then(() => true).catch(() => false)) {
      return [];
    }

    const dirs = await fs.readdir(reportsDir, { withFileTypes: true });
    const parser = new XMLParser();
    const patients = [];

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;

      const patientXmlPath = path.join(reportsDir, dir.name, 'patient.xml');
      try {
        const xmlContent = await fs.readFile(patientXmlPath, 'utf-8');
        const patientData = parser.parse(xmlContent).patient;

        // Count visits
        const patientDirPath = path.join(reportsDir, dir.name); const visitDirs = await fs.readdir(patientDirPath, { withFileTypes: true });
        const visitCount = visitDirs.filter(d => d.isDirectory() && d.name !== 'patient.xml').length;

        // Find most recent visit
        const visitDates = visitDirs
          .filter(d => d.isDirectory())
          .map(d => d.name.split('_').slice(0, 3).join('-'))
          .filter(d => d.match(/\d{4}-\d{2}-\d{2}/))
          .sort()
          .reverse();

        patients.push({
          id: patientData.id,
          name: `${patientData.last_name}, ${patientData.first_name}`,
          patientId: patientData.hospitalPatientId || patientData.id,
          dob: patientData.dob,
          reportCount: visitCount,
          lastReportDate: visitDates[0] || null
        });
      } catch (err) {
        console.warn(`Failed to read patient data from ${dir.name}:`, err);
      }
    }

    return patients;
  } catch (error) {
    console.error('[get-patient-directories] Failed:', error);
    return [];
  }
});

ipcMain.handle('get-visit-directories', async (event, patientId: string) => {
  try {
    const settings = await getAllSettings();
    const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
    const reportsDir = path.join(dataDir, 'Reports');

    const dirs = await fs.readdir(reportsDir);
    const patientDir = dirs.find(dir => dir.startsWith(patientId));

    if (!patientDir) {
      return [];
    }

    const patientPath = path.join(reportsDir, patientDir);
    const visitDirs = await fs.readdir(patientPath, { withFileTypes: true });
    const parser = new XMLParser();
    const visits = [];

    for (const dir of visitDirs) {
      if (!dir.isDirectory()) continue;

      const visitXmlPath = path.join(patientPath, dir.name, 'visit.xml');
      try {
        const xmlContent = await fs.readFile(visitXmlPath, 'utf-8');
        const visitData = parser.parse(xmlContent).visit;

        visits.push({
          id: visitData.report_id,
          interrogation_date: visitData.interrogation_date,
          manufacturer: visitData.manufacturer,
          device_type: visitData.device_type,
          directoryName: dir.name
        });
      } catch (err) {
        console.warn(`Failed to read visit data from ${dir.name}:`, err);
      }
    }

    return visits.sort((a, b) => b.interrogation_date.localeCompare(a.interrogation_date));
  } catch (error) {
    console.error('[get-visit-directories] Failed:', error);
    return [];
  }
});

ipcMain.handle('get-visit-files', async (event, patientId: string, visitDirName: string) => {
  try {
    const settings = await getAllSettings();
    const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
    const reportsDir = path.join(dataDir, 'Reports');

    const dirs = await fs.readdir(reportsDir);
    const patientDir = dirs.find(dir => dir.startsWith(patientId));

    if (!patientDir) {
      return [];
    }

    const visitPath = path.join(reportsDir, patientDir, visitDirName);
    const files = await fs.readdir(visitPath);

    // Filter to displayable types
    const displayableExts = ['.pdf', '.png', '.jpg', '.jpeg', '.xml'];
    const displayableFiles = files
      .filter(f => displayableExts.includes(path.extname(f).toLowerCase()))
      .filter(f => f !== 'visit.xml') // Exclude metadata file
      .map(f => path.join(visitPath, f));

    return displayableFiles;
  } catch (error) {
    console.error('[get-visit-files] Failed:', error);
    return [];
  }
});

ipcMain.handle('get-parsed-xml', async (event, filePath: string) => {
  try {
    // Import dynamically to avoid circular dependencies if any
    const { parseFile } = await import('./parser');
    const report = await parseFile(filePath);
    return report;
  } catch (error) {
    console.error('[get-parsed-xml] Failed:', error);
    return null;
  }
});

ipcMain.on('find-in-page', (event, text, options) => {
  const webContents = event.sender;
  webContents.findInPage(text, options);
});

ipcMain.on('stop-find-in-page', (event, action) => {
  const webContents = event.sender;
  webContents.stopFindInPage(action);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

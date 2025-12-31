import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import fs from 'fs/promises';
import { initializeDatabase, getDb, getAllPatients, getPatientById, getPatientReports, closeDatabase } from './database';
import { initializeWatcher, stopWatcher } from './watcher';
import { startUsbWatcher, stopUsbWatcher } from './usbWatcher';
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
  let settings;

  // 1. Try to initialize critical components
  try {
    // Initialize Database
    const config = getConfig();
    const dbPath = config.dbPath;
    initializeDatabase(dbPath);

    // Get settings
    settings = await getAllSettings();
  } catch (error) {
    console.error('Critical initialization failed:', error);
    // Use fallback settings if DB/Config fails
    settings = {
      updateChannel: 'stable',
      importDir: path.join(app.getPath('userData'), '_IMPORT'),
      unmatchedDir: path.join(app.getPath('userData'), '_UNMATCHED'),
      dataPath: path.join(app.getPath('userData'), '_DATA')
    } as any;
  }

  // 2. Initialize Auto-Updater (Robust)
  try {
    autoUpdater.logger = console;
    autoUpdater.allowPrerelease = settings.updateChannel === 'beta';

    // DEBUG: Force dev updates to work (for verification)
    if (process.env.NODE_ENV === 'development') {
      autoUpdater.forceDevUpdateConfig = true;
    }

    // Check for updates immediately

    // Check for updates immediately
    autoUpdater.checkForUpdatesAndNotify();

    // Setup listeners to forward to renderer
    autoUpdater.on('checking-for-update', () => {
      const win = getMainWindow();
      if (win) win.webContents.send('update-status', 'Checking for updates...');
    });
    autoUpdater.on('update-available', (info) => {
      const win = getMainWindow();
      if (win) win.webContents.send('update-status', `Update available: ${info.version}`);
    });
    autoUpdater.on('update-not-available', (info) => {
      const win = getMainWindow();
      if (win) win.webContents.send('update-status', 'Your application is up to date.');
    });
    autoUpdater.on('error', (err) => {
      const win = getMainWindow();
      if (win) win.webContents.send('update-status', { message: 'Update error', error: err.toString() });
    });
    autoUpdater.on('download-progress', (progressObj) => {
      const win = getMainWindow();
      if (win) win.webContents.send('update-status', `Downloading: ${Math.round(progressObj.percent)}%`);
    });
    autoUpdater.on('update-downloaded', (info) => {
      const win = getMainWindow();
      if (win) win.webContents.send('update-status', `Update downloaded. Ready to install.`);

      // Ask user to update? Or just notify. Detailed UI can handle "Restart and Install"
    });

  } catch (error) {
    console.error('Failed to initialize auto-updater:', error);
  }

  // 3. Initialize rest of the app (Storage, Watchers)
  try {
    // If we have valid settings from step 1
    if (settings && settings.dbPath) { // Check if we got real settings
      await initializeStorage();
      initializeWatcher(settings.importDir, settings.unmatchedDir, settings.dataPath);
      startUsbWatcher(settings);
    }
  } catch (error) {
    console.error('Non-critical initialization failed:', error);
  }

  // 4. Create Window
  createWindow();
  console.log('Electron app is ready.');

  if (settings) {
    fs.writeFile('debug_paths.txt', `UserData: ${app.getPath('userData')}\nImportDir: ${settings.importDir}\nDataDir: ${settings.dataPath}`);
  }

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

    // Enrich with device/lead history from patient.xml
    try {
      const settings = await getAllSettings();
      const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
      const reportsDir = path.join(dataDir, 'Reports');

      // Find patient directory
      const dirs = await fs.readdir(reportsDir);
      const patientDirName = dirs.find(dir => dir.startsWith(patientId));

      if (patientDirName) {
        const patientXmlPath = path.join(reportsDir, patientDirName, 'patient.xml');
        const xmlContent = await fs.readFile(patientXmlPath, 'utf-8');
        const parser = new XMLParser({ ignoreAttributes: false });
        const patientData = parser.parse(xmlContent).patient;

        if (patientData.devices && patientData.devices.device) {
          patient.devices = Array.isArray(patientData.devices.device)
            ? patientData.devices.device
            : [patientData.devices.device];
        } else {
          patient.devices = [];
        }

        if (patientData.leads && patientData.leads.lead) {
          patient.leads = Array.isArray(patientData.leads.lead)
            ? patientData.leads.lead
            : [patientData.leads.lead];
        } else {
          patient.leads = [];
        }
      }
    } catch (fsError) {
      console.warn(`Failed to read patient.xml for ${patientId}:`, fsError);
      // Non-fatal, return patient from DB
    }

    return patient;
  } catch (error) {
    console.error('Failed to get patient by id:', error);
    throw error;
  }
});

ipcMain.handle('update-patient', async (event, patient) => {
  try {
    // 1. Update Database
    await import('./database').then(m => m.updatePatient(patient));

    // 2. Update XML Storage
    await import('./storage').then(m => m.updatePatientXML(patient.id, {
      first_name: patient.first_name,
      last_name: patient.last_name,
      dob: patient.dob,
      hospitalPatientId: patient.hospitalPatientId
    }));

    return { success: true };
  } catch (error) {
    console.error('Failed to update patient:', error);
    throw error;
  }
});

ipcMain.handle('rebuild-database', async () => {
  try {
    const mainWindow = getMainWindow();
    return await import('./database').then(m => m.rebuildDatabase((status) => {
      if (mainWindow) {
        mainWindow.webContents.send('process-status', { ...status, taskId: 'rebuild-db' });
      }
    }));
  } catch (error) {
    console.error('Failed to rebuild database:', error);
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

  // On Linux, attaching the dialog to the window can cause crashes or freezes
  // so we detach it by not passing the window argument.
  if (process.platform === 'linux') {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    return result.filePaths[0];
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

    // Always restart USB watcher on settings change to pick up new source/target dirs
    startUsbWatcher(newSettings);

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

    // Restart USB watcher
    startUsbWatcher(newSettings);

    return newSettings;
  } catch (error) {
    console.error('Failed to reset settings:', error);
    throw error;
  }
});

ipcMain.handle('clear-all-data', async () => {
  console.log('[Main] Clearing all application data...');
  try {
    const settings = await getAllSettings();
    const dataPath = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
    const unmatchedDir = settings.unmatchedDir || path.join(app.getPath('userData'), '_UNMATCHED');
    const dbPath = settings.dbPath || path.join(dataPath, 'database.db');

    // 1. Stop Watchers
    stopWatcher();
    stopUsbWatcher();

    // 2. Close Database
    await closeDatabase();

    // 3. Delete Data Directories
    console.log('[Main] Deleting data directory:', dataPath);
    await fs.rm(dataPath, { recursive: true, force: true });

    console.log('[Main] Deleting unmatched directory:', unmatchedDir);
    await fs.rm(unmatchedDir, { recursive: true, force: true });

    // 4. Delete Database File if outside dataDir (redundant but safe)
    if (dbPath && !dbPath.startsWith(dataPath)) {
      console.log('[Main] Deleting database file:', dbPath);
      await fs.rm(dbPath, { force: true });
    }

    // 5. Re-initialize
    console.log('[Main] Re-initializing system...');
    initializeDatabase(dbPath);
    await initializeStorage();
    initializeWatcher(settings.importDir, settings.unmatchedDir, settings.dataPath);
    startUsbWatcher(settings);

    return true;
  } catch (error) {
    console.error('[Main] Failed to clear all data:', error);
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

        // Extract latest device info
        let deviceManufacturer = 'Unknown';
        let deviceModel = 'Unknown';
        let leadsSummary: string[] = [];

        if (patientData.devices && patientData.devices.device) {
          const devices = Array.isArray(patientData.devices.device)
            ? patientData.devices.device
            : [patientData.devices.device];

          // Get the last added device (assuming append order)
          if (devices.length > 0) {
            const latest = devices[devices.length - 1];
            deviceManufacturer = latest.manufacturer;
            deviceModel = latest.model;
          }
        }

        if (patientData.leads && patientData.leads.lead) {
          const leads = Array.isArray(patientData.leads.lead)
            ? patientData.leads.lead
            : [patientData.leads.lead];

          leadsSummary = leads.map((l: any) => `${l.manufacturer} ${l.model} (${l.serial})`);
        }

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
          first_name: patientData.first_name,
          last_name: patientData.last_name,
          name: `${patientData.last_name}, ${patientData.first_name}`,
          patientId: patientData.hospitalPatientId || patientData.id,
          dob: patientData.dob,
          reportCount: visitCount,
          lastReportDate: visitDates[0] || null,
          deviceManufacturer,
          deviceModel,
          leads: leadsSummary
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
      // .filter(f => f !== 'visit.xml') // Allow metadata file to be viewed
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

// Update Handlers
ipcMain.handle('check-for-updates', async () => {
  console.log('[Main] Manual check for updates initiated...');
  try {
    const settings = await getAllSettings();
    console.log('[Main] Settings loaded:', settings.updateChannel);

    // Ensure prerelease setting is active
    autoUpdater.allowPrerelease = settings.updateChannel === 'beta';

    console.log('[Main] calling autoUpdater.checkForUpdates()...');
    const result = await autoUpdater.checkForUpdates();
    console.log('[Main] checkForUpdates result:', result);
    return result;
  } catch (e) {
    console.error('[Main] Failed to check for updates:', e);
    throw e;
  }
});

ipcMain.handle('quit-and-install', () => {
  autoUpdater.quitAndInstall();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

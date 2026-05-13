import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import fs from 'fs/promises';
import { initializeDatabase, getDb, getAllPatients, getPatientById, getPatientReports, closeDatabase, syncDatabase } from './database';
import { ensureDatabaseLocation } from './databaseMigration';
import { initializeWatcher, stopWatcher, initializeIntraopWatcher, stopIntraopWatcher } from './watcher';
import { startUsbWatcher, stopUsbWatcher } from './usbWatcher';
import { initializeStorage } from './storage';
import { setMainWindow, getMainWindow, sendNotification } from './windowManager';
import { getAllSettings, saveSettings } from './settingsService';
import { getConfig } from './config';
import { XMLParser } from 'fast-xml-parser';
import { logError, logInfo, getLogPath, getRecentLogs } from './logger';
import { buildGitHubIssueUrl } from './crashReport';

// ─── Global Error Handlers ───────────────────────────────────────
process.on('uncaughtException', (error) => {
  logError('main/uncaughtException', error.message, error.stack);
  const detail = `${error.message}\n\n${error.stack ?? ''}`;
  dialog.showMessageBox({
    type: 'error',
    title: 'KardiSynch — Unexpected Error',
    message: error.message,
    detail,
    buttons: ['Report on GitHub', 'Copy & Close', 'Close'],
    defaultId: 0
  }).then(({ response }) => {
    if (response === 0) {
      const url = buildGitHubIssueUrl({
        errorMessage: error.message,
        stack: error.stack,
        source: 'main/uncaughtException',
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        platform: `${process.platform} ${process.arch}`
      });
      shell.openExternal(url);
    } else if (response === 1) {
      clipboard.writeText(detail);
    }
  }).catch(() => {});
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logError('main/unhandledRejection', message, stack);
});

// Cache of allowed base directories, updated when settings change
let allowedBaseDirs: string[] = [];

function updateAllowedPaths(settings: any) {
  const userDataDir = app.getPath('userData');
  const dirs = new Set<string>([userDataDir]);
  if (settings?.dataPath) dirs.add(path.resolve(settings.dataPath));
  if (settings?.importDir) dirs.add(path.resolve(settings.importDir));
  if (settings?.intraopImportDir) dirs.add(path.resolve(settings.intraopImportDir));
  if (settings?.unmatchedDir) dirs.add(path.resolve(settings.unmatchedDir));
  allowedBaseDirs = Array.from(dirs);
}

function isPathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return allowedBaseDirs.some(dir =>
    resolved.startsWith(dir + path.sep) || resolved === dir
  );
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1800,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    icon: path.join(__dirname, '../renderer/assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'KardiSynch'
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  setMainWindow(mainWindow);

  // Helper to open external links in a dedicated window (since system browser might be missing)
  const openExternalLink = (targetUrl: string) => {
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'External Link',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    win.loadURL(targetUrl).catch(e => {
      console.error('Failed to load external URL:', targetUrl, e);
      win.close();
    });
  };

  // Intercept new window creation (window.open, target="_blank")
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Basic security check: ensure it's http/https
    if (url.startsWith('http:') || url.startsWith('https:')) {
      // shell.openExternal(url); // Fails if xdg-open missing
      openExternalLink(url);
    }
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  logInfo('main', `KardiSynch v${app.getVersion()} starting (Electron ${process.versions.electron}, Node ${process.versions.node})`);
  let settings;

  // 1. Try to initialize critical components
  try {
    // Initialize Database (Robust & Migrated)
    // 1. Ensure correct DB location (Standard local path)
    const dbPath = ensureDatabaseLocation();

    // 2. Initialize connection
    await initializeDatabase(dbPath).catch(async (err) => {
      console.error('[Critical] Parsing failed. Attempting recovery...', err);
      // Fallback: Rename corrupt file and retry with fresh DB
      const corruptPath = dbPath.replace('.db', `_corrupt_${Date.now()}.db`);
      if (await fs.stat(dbPath).then(() => true).catch(() => false)) {
        await fs.rename(dbPath, corruptPath);
        console.warn(`[Critical] Corrupt database moved to ${corruptPath}. Creating fresh DB.`);
        return initializeDatabase(dbPath);
      }
      throw err;
    });

    // 3. Start Background Sync (Efficient)
    // Run immediately
    syncDatabase().then(({ newPatients, newReports }) => {
      console.log(`[Startup Sync] Added ${newPatients} patients and ${newReports} reports.`);
    });

    // Run periodically (every 5 minutes)
    setInterval(() => {
      syncDatabase().catch(e => console.error('[Periodic Sync] Failed:', e));
    }, 5 * 60 * 1000);

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

  // Initialize allowed paths for IPC security validation
  updateAllowedPaths(settings);

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
    if (settings) { // Check if we got real settings
      await initializeStorage();
      initializeWatcher(settings.importDir, settings.unmatchedDir, settings.dataPath);
      if (settings.intraopImportDir) {
        initializeIntraopWatcher(settings.intraopImportDir, settings.unmatchedDir, settings.dataPath);
      }
      startUsbWatcher(settings);
    }
  } catch (error) {
    console.error('Non-critical initialization failed:', error);
  }

  // 4. Create Window
  createWindow();
  console.log('Electron app is ready.');

  // Check for missing Boston Data and update if needed
  const bostonPath = path.join(app.getPath('userData'), 'boston_data.json');
  fs.access(bostonPath).then(() => {
    console.log('[Startup] Boston data present.');
  }).catch(() => {
    console.log('[Startup] Boston data missing. Triggering background update...');
    checkForBostonUpdates().then(res => {
      console.log('[Startup] Boston update result:', res);
    }).catch(err => {
      console.error('[Startup] Boston update failed:', err);
    });
  });


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.handle('read-file-text', async (event, filePath) => {
  try {
    if (!isPathAllowed(filePath)) {
      throw new Error(`Access denied: path is outside allowed directories`);
    }
    const stats = await fs.stat(filePath);

    if (stats.isDirectory()) {
      const files = await fs.readdir(filePath);
      // Prioritize XML, then TXT/LOG
      const candidate = files.find(f => f.toLowerCase().endsWith('.xml')) ||
        files.find(f => f.toLowerCase().endsWith('.txt')) ||
        files.find(f => f.toLowerCase().endsWith('.log'));

      if (candidate) {
        const candidatePath = path.join(filePath, candidate);
        const content = await fs.readFile(candidatePath, 'utf-8');
        return `--- DIRECTORY PREVIEW: ${path.basename(filePath)} ---\n--- SHOWING FILE: ${candidate} ---\n\n${content}`;
      } else {
        return `--- DIRECTORY CONTENT ---\n${files.join('\n')}\n\n(No textual preview available)`;
      }
    } else {
      // Regular file
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    }
  } catch (error) {
    console.warn(`Failed to read text file ${filePath}:`, error);
    // Return error as text so user sees why
    return `Error reading file: ${error}`;
  }
});

ipcMain.handle('get-preview-path', async (event, originalPath) => {
  try {
    // 1. Try original path
    try {
      await fs.access(originalPath);
      return originalPath;
    } catch {
      // 2. Try unmatched folder
      const { getUnmatchedFilePath } = await import('./watcher');
      const basename = path.basename(originalPath);
      const unmatchedPath = getUnmatchedFilePath(basename);

      if (unmatchedPath) {
        try {
          await fs.access(unmatchedPath);
          return unmatchedPath;
        } catch {
          // Both failed
          return null;
        }
      }
      return null;
    }
  } catch (error) {
    console.error('Failed to resolve preview path:', error);
    return null;
  }
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

ipcMain.handle('create-patient', async (event, patient) => {
  try {
    const { createPatient } = await import('./database');
    const { v4: uuidv4 } = await import('uuid');

    if (!patient.id) {
      patient.id = uuidv4();
    }

    await createPatient(patient);

    // Notify renderer so the dashboard updates immediately
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('patient-list-update');
    }

    return { success: true, id: patient.id };
  } catch (error) {
    console.error('Failed to create patient:', error);
    throw error;
  }
});

ipcMain.handle('get-patient-by-id', async (event, patientId) => {
  try {
    const patient = await getPatientById(patientId);

    // Enrich with device/lead history from patient.xml -> REMOVED.
    // Logic is now centralized in database.ts::getPatientById to ensure Single Source of Truth.

    return patient;
  } catch (error) {
    console.error('Failed to get patient by id:', error);
    throw error;
  }
});

ipcMain.handle('update-patient', async (event, patient) => {
  try {
    // 1. Update Database
    // Extract primary device info for DB cache
    let device_manufacturer = null;
    let device_model = null;
    let device_serial = null;

    if (patient.devices && patient.devices.length > 0) {
      // Assume first device is primary/active
      const d = patient.devices[0];
      device_manufacturer = d.manufacturer;
      device_model = d.model;
      device_serial = d.serial;
    }

    await import('./database').then(m => m.updatePatient({
      ...patient,
      device_manufacturer,
      device_model,
      device_serial,
      leads: patient.leads ? JSON.stringify(patient.leads) : null
    }));

    // 2. Update XML Storage
    await import('./storage').then(m => m.updatePatientXML(patient.id, {
      first_name: patient.first_name,
      last_name: patient.last_name,
      dob: patient.dob,
      hospitalPatientId: patient.hospitalPatientId,
      devices: patient.devices,
      leads: patient.leads
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

ipcMain.handle('dedup-reports', async () => {
  try {
    const mainWindow = getMainWindow();
    const { runDedupCleanup } = await import('./services/dedupService');
    return await runDedupCleanup((status) => {
      if (mainWindow) {
        mainWindow.webContents.send('process-status', { ...status, taskId: 'dedup-reports' });
      }
    });
  } catch (error) {
    console.error('Failed to deduplicate reports:', error);
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
    console.log('[IPC Main] Received set-settings request with:', JSON.stringify(settings, null, 2));
    const oldSettings = await getAllSettings();
    await saveSettings(settings);
    const newSettings = await getAllSettings();

    // Update allowed paths for IPC security validation
    updateAllowedPaths(newSettings);

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

    // Restart intraop watcher if its dir changed (or shared paths changed)
    if (
      oldSettings.intraopImportDir !== newSettings.intraopImportDir ||
      oldSettings.unmatchedDir !== newSettings.unmatchedDir ||
      oldSettings.dataPath !== newSettings.dataPath
    ) {
      console.log('Intraop path changed, restarting intraop watcher...');
      stopIntraopWatcher();
      if (newSettings.intraopImportDir) {
        initializeIntraopWatcher(newSettings.intraopImportDir, newSettings.unmatchedDir, newSettings.dataPath);
      }
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
    stopIntraopWatcher();
    if (newSettings.intraopImportDir) {
      initializeIntraopWatcher(newSettings.intraopImportDir, newSettings.unmatchedDir, newSettings.dataPath);
    }

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
    const dbPath = path.join(app.getPath('userData'), 'database.db'); // Fixed path now

    // 1. Stop Watchers
    stopWatcher();
    stopIntraopWatcher();
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
    if (settings.intraopImportDir) {
      initializeIntraopWatcher(settings.intraopImportDir, settings.unmatchedDir, settings.dataPath);
    }
    startUsbWatcher(settings);

    return true;
  } catch (error) {
    console.error('[Main] Failed to clear all data:', error);
    throw error;
  }
});

ipcMain.handle('get-pdf-data', async (event, filePath) => {
  try {
    if (!isPathAllowed(filePath)) {
      throw new Error(`Access denied: path is outside allowed directories`);
    }
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

ipcMain.handle('reprocess-unmatched', async () => {
  try {
    const settings = await getAllSettings();
    const importDir = settings.importDir || path.join(app.getPath('userData'), '_IMPORT');
    const unmatchedDir = settings.unmatchedDir || path.join(app.getPath('userData'), '_UNMATCHED');

    if (!await fs.access(unmatchedDir).then(() => true).catch(() => false)) {
      return { count: 0, message: 'No unmatched directory found.' };
    }

    const files = await fs.readdir(unmatchedDir);
    let movedCount = 0;

    for (const file of files) {
      const srcPath = path.join(unmatchedDir, file);
      const destPath = path.join(importDir, file);

      try {
        const stats = await fs.stat(srcPath);
        if (stats.isFile()) {
          await fs.rename(srcPath, destPath);
          movedCount++;
        }
      } catch (err) {
        console.error(`Failed to move file ${file}:`, err);
      }
    }

    return { count: movedCount, success: true };
  } catch (error) {
    console.error('Failed to reprocess unmatched:', error);
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

    // Fetch MRI statuses from DB in parallel with directory processing
    const mriStatusPromise = new Promise<Record<string, any>>((resolve) => {
      import('./database').then(({ getDb }) => {
        try {
          getDb().all('SELECT id, mri_status FROM Patients', (err, rows: any[]) => {
            if (err) {
              console.warn('Failed to fetch MRI statuses for directory listing:', err);
              resolve({});
            } else {
              const map: Record<string, any> = {};
              rows.forEach(r => {
                if (r.mri_status) {
                  try { map[r.id] = JSON.parse(r.mri_status); } catch { }
                }
              });
              resolve(map);
            }
          });
        } catch (e) {
          resolve({});
        }
      });
    });

    // Process all patient directories concurrently
    const patientDirs = dirs.filter(d => d.isDirectory());
    const patientPromises = patientDirs.map(async (dir) => {
      const patientXmlPath = path.join(reportsDir, dir.name, 'patient.xml');
      try {
        const [xmlContent, visitDirEntries] = await Promise.all([
          fs.readFile(patientXmlPath, 'utf-8'),
          fs.readdir(path.join(reportsDir, dir.name), { withFileTypes: true }),
        ]);
        const patientData = parser.parse(xmlContent).patient;

        // Extract latest device info
        let deviceManufacturer = 'Unknown';
        let deviceModel = 'Unknown';
        let leadsSummary: string[] = [];

        if (patientData.devices && patientData.devices.device) {
          const devices = Array.isArray(patientData.devices.device)
            ? patientData.devices.device
            : [patientData.devices.device];

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

        const visitCount = visitDirEntries.filter(d => d.isDirectory()).length;
        const visitDates = visitDirEntries
          .filter(d => d.isDirectory())
          .map(d => d.name.split('_').slice(0, 3).join('-'))
          .filter(d => d.match(/\d{4}-\d{2}-\d{2}/))
          .sort()
          .reverse();

        return {
          id: patientData.id,
          first_name: patientData.first_name,
          last_name: patientData.last_name,
          name: `${patientData.last_name}, ${patientData.first_name}`,
          patientId: patientData.hospitalPatientId || patientData.id,
          hospitalPatientId: patientData.hospitalPatientId,
          dob: patientData.dob,
          reportCount: visitCount,
          lastReportDate: visitDates[0] || null,
          deviceManufacturer,
          deviceModel,
          leads: leadsSummary,
          _patientId: patientData.id, // for MRI lookup below
        };
      } catch (err) {
        console.warn(`Failed to read patient data from ${dir.name}:`, err);
        return null;
      }
    });

    const [mriStatuses, patientResults] = await Promise.all([
      mriStatusPromise,
      Promise.all(patientPromises),
    ]);

    return patientResults
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map(({ _patientId, ...patient }) => ({
        ...patient,
        mriStatus: mriStatuses[_patientId] || null,
      }));
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

    const visitPromises = visitDirs
      .filter(d => d.isDirectory())
      .map(async (dir) => {
        const visitXmlPath = path.join(patientPath, dir.name, 'visit.xml');
        try {
          const xmlContent = await fs.readFile(visitXmlPath, 'utf-8');
          const visitData = parser.parse(xmlContent).visit;
          // Parse battery data
          const battery = visitData.battery;
          let batteryVoltage: string | undefined;
          let batteryStatus: string | undefined;
          let batteryLongevity: string | undefined;
          if (battery) {
            if (battery.voltage?.['@_value']) batteryVoltage = battery.voltage['@_value'];
            if (battery.status) batteryStatus = battery.status;
            if (battery.last_charge_time?.['@_value']) batteryLongevity = `${battery.last_charge_time['@_value']} ${battery.last_charge_time['@_unit'] || ''}`.trim();
          }

          // Parse leads data
          let leads: any[] | undefined;
          if (visitData.leads?.lead) {
            const rawLeads = Array.isArray(visitData.leads.lead) ? visitData.leads.lead : [visitData.leads.lead];
            leads = rawLeads.map((l: any) => ({
              location: l.anatomic_location || l.name || undefined,
              type: l.name || undefined,
              model: l.model || undefined,
              serial: l.serial || undefined,
              impedance: l.impedance?.['@_value'] || undefined,
              sensing: l.sensing?.['@_value'] || undefined,
              threshold: l.pacing_threshold?.['@_value'] || undefined,
              pulseWidth: l.pacing_amplitude?.['@_value'] || undefined,
              shockImpedance: l.shock_impedance?.['@_value'] || undefined,
            }));
          }

          return {
            id: visitData.report_id,
            interrogation_date: visitData.interrogation_date,
            manufacturer: visitData.manufacturer,
            device_type: visitData.device_type,
            deviceModel: visitData.device_model || undefined,
            deviceSerial: visitData.device_serial || undefined,
            directoryName: dir.name,
            visit_type: visitData.visit_type || undefined,
            source_domain: visitData.source_domain || undefined,
            source_manufacturer: visitData.source_manufacturer || undefined,
            batteryVoltage,
            batteryStatus,
            batteryLongevity,
            leads,
          };
        } catch (err) {
          console.warn(`Failed to read visit data from ${dir.name}:`, err);
          return null;
        }
      });

    const visits = (await Promise.all(visitPromises)).filter((v): v is NonNullable<typeof v> => v !== null);
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
    console.log('[get-visit-files] Found files:', files);
    return files.map(file => path.join(visitPath, file)); // Return file list for frontend if needed
  } catch (error) {
    console.error('[get-visit-files] Failed:', error);
    return [];
  }
});

ipcMain.handle('export-visit-files', async (event, patientId: string, visitId: string, targetDirectory: string) => {
  try {
    const result = await import('./storage').then(m => m.exportVisitFiles(patientId, visitId, targetDirectory));
    return result;
  } catch (error) {
    console.error('[export-visit-files] Failed:', error);
    throw error;
  }
});


ipcMain.handle('get-parsed-xml', async (event, filePath: string) => {
  try {
    if (!isPathAllowed(filePath)) {
      throw new Error(`Access denied: path is outside allowed directories`);
    }
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
import { checkForMedtronicUpdates } from './services/medtronicScraper';
import { checkForBostonUpdates } from './services/bostonScraper';

ipcMain.handle('check-medtronic-updates', async () => {
  try {
    return await checkForMedtronicUpdates();
  } catch (error: any) {
    console.error('Failed to check Medtronic updates:', error);
    return { updated: false, count: 0, error: error.message };
  }
});

ipcMain.handle('check-boston-updates', async () => {
  try {
    return await checkForBostonUpdates();
  } catch (error: any) {
    console.error('Failed to check Boston updates:', error);
    return { updated: false, count: 0, error: error.message };
  }
});

import { getDeviceNews } from './services/newsService';

ipcMain.handle('get-device-news', async (event) => {
  const sendStatus = (msg: string) => event.sender.send('news-status', msg);
  try {
    return await getDeviceNews(sendStatus);
  } catch (error) {
    console.error('Failed to get device news:', error);
    return [];
  }
});
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});


ipcMain.handle('manual-sorting-response', async (event, response) => {
  try {
    const { resolveManualSorting } = await import('./watcher');
    resolveManualSorting(response);
    return { success: true };
  } catch (error) {
    console.error('Failed to handle manual sorting response:', error);
    throw error;
  }
});

ipcMain.handle('device-selection-result', async (event, result) => {
  try {
    const { resolveDeviceSelection } = await import('./watcher');
    resolveDeviceSelection(result);
    return { success: true };
  } catch (error) {
    console.error('Failed to handle device selection result:', error);
    throw error;
  }
});

ipcMain.handle('get-import-history', async () => {
  try {
    const { getImportHistory } = await import('./database');
    return await getImportHistory();
  } catch (error) {
    console.error('Failed to get import history', error);
    throw error;
  }
});

ipcMain.handle('get-import-session-events', async (event, sessionId) => {
  try {
    const { getImportSessionEvents } = await import('./database');
    return await getImportSessionEvents(sessionId);
  } catch (error) {
    console.error('Failed to get import session events', error);
    throw error;
  }
});

ipcMain.handle('move-imported-file', async (event, eventId, newPatientId, targetVisitId?: string, newVisitDate?: string, confirmedFilePath?: string) => {
  try {
    const { getImportEvent, updateImportEvent, getPatientById, getReportById, createReport, updateReportPatient } = await import('./database');
    const { moveReport, storeFile } = await import('./storage');
    const { v4: uuidv4 } = await import('uuid');

    const importEvent = await getImportEvent(eventId);
    if (!importEvent) {
      throw new Error('Event not found');
    }

    const targetPatient = await getPatientById(newPatientId);
    if (!targetPatient) throw new Error('Target patient not found');

    // Helper to determine target report
    const determineTargetReport = async (dateForNew: string, templateReport?: any) => {
      if (targetVisitId) {
        const r = await getReportById(targetVisitId);
        if (r) return { id: r.id, date: r.interrogation_date, isNew: false, reportObj: undefined }; // Don't overwrite existing visit.xml
      }
      // New Visit
      const newReportId = uuidv4();

      const base = templateReport || { manufacturer: 'Unknown' };
      // Create skeleton report for new visit, copying metadata if available
      const newReport = {
        ...base,
        id: newReportId,
        patient_id: targetPatient.id,
        interrogation_date: newVisitDate || dateForNew,
        raw_text: base.raw_text || 'Manually created visit',
        data: base.data || JSON.stringify({ note: 'Created via move file' })
      };

      // Remove DB specific fields that shouldn't be copied
      delete newReport.rowid;
      delete newReport.created_at;
      delete newReport.updated_at;

      await createReport(newReport);
      return { id: newReportId, date: newVisitDate || dateForNew, isNew: true, reportObj: newReport };
    };

    if (importEvent.status === 'unmatched') {
      // 1. Handle Unmatched File Move
      const filePath = confirmedFilePath || importEvent.file_path;
      if (!filePath) throw new Error('File path missing');

      let parsedReport = null;
      let date = 'Unknown';

      try {
        const { parseFile } = await import('./parser');
        parsedReport = await parseFile(filePath);
        if (parsedReport) {
          date = parsedReport.interrogation_date || 'Unknown';
        }
      } catch (e) {
        console.warn('Failed to parse file during move:', e);
      }

      // Preserve intraop origin: files staged by the intraop watcher carry the
      // INTRAOP__ prefix in their filename. When they end up in the unmatched
      // dir and the user reassigns them manually, tag the resulting visit.
      if (parsedReport && path.basename(filePath).startsWith('INTRAOP__')) {
        (parsedReport as any)._remoteSource = {
          visit_type: 'intraoperative',
          source_manufacturer: parsedReport.manufacturer || undefined,
        };
      }

      // Determine Target Report
      const targetReport = await determineTargetReport(date, parsedReport);

      // Store file
      // If we created a new report, passing targetReport.reportObj allows storeFile to create visit.xml
      await storeFile(filePath, targetReport.id, targetPatient.id, `${targetPatient.last_name}_${targetPatient.first_name}`, targetReport.date, targetPatient, targetReport.reportObj || parsedReport || undefined);

      // Update Import Event
      await updateImportEvent(eventId, {
        patient_id: newPatientId,
        status: 'manually_sorted',
        message: targetVisitId ? 'Assigned to existing visit' : 'Assigned to new visit',
        report_id: targetReport.id
      });

    } else {
      // 2. Handle Existing Report Move
      if (!importEvent.report_id || !importEvent.patient_id) {
        throw new Error('Event invalid');
      }

      // If specific visit logic is requested
      if (targetVisitId || newVisitDate) {
        // SPLIT/MOVE SINGLE FILE

        // 1. Find Current File Path
        const oldReport = await getReportById(importEvent.report_id);
        const oldPatient = await getPatientById(importEvent.patient_id);
        if (!oldReport || !oldPatient) throw new Error('Source context not found');

        // Construct old path
        const settings = await import('./database').then(m => m.getSettings()); // Need settings for data path
        // Actually importing storage handles settings, but we need the path here to find the file.
        // Use a helper or import 'app' and construct?
        // Storage exports initializeStorage, but dataDir is private.
        // Let's assume standard structure or use `get-visit-files` logic?
        // It's cleaner to use `storage.ts` logic if exposed.
        // But we can just use the same logic as `storeFile`.
        const { app } = await import('electron');
        const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');

        const safeName = `${oldPatient.last_name}_${oldPatient.first_name}`.replace(/[^a-zA-Z0-9]/g, '_');

        // Date formatting for folder
        let dateString = 'Unknown';
        if (oldReport.interrogation_date) {
          const d = new Date(oldReport.interrogation_date);
          if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            dateString = `${y}_${m}_${day}`;
          }
        }

        const visitDir = path.join(dataDir, 'Reports', `${oldPatient.id}_${safeName}`, `${dateString}_${oldReport.id}`);
        const filename = path.basename(importEvent.file_path); // Assume this is correct filename
        const currentPath = path.join(visitDir, filename);

        if (!require('fs').existsSync(currentPath)) {
          console.warn(`File not found at ${currentPath}, trying broad search in visit dir`);
          // Fallback: search for file with same name?
        }

        // 2. Determine Target Report/Visit (Use oldReport as template)
        const targetReport = await determineTargetReport(oldReport.interrogation_date, oldReport);

        // 3. Move File using storeFile
        // storeFile will move it from currentPath -> New Path
        // We pass 'undefined' for reportObj to avoid overwriting visit metadata unless necessary
        await storeFile(currentPath, targetReport.id, targetPatient.id, `${targetPatient.last_name}_${targetPatient.first_name}`, targetReport.date, targetPatient, targetReport.reportObj);

        // 4. Update Import Event
        await updateImportEvent(eventId, {
          patient_id: newPatientId,
          status: 'manually_sorted',
          report_id: targetReport.id,
          message: targetVisitId ? 'Moved to existing visit' : 'Moved to new visit'
        });

        // 5. Cleanup? (Check if old visit empty) - Optional for now.

      } else {
        // FULL REPORT MOVE (Legacy/Default behavior for "Move to Patient")
        await moveReport(importEvent.report_id, importEvent.patient_id, newPatientId);
        await updateImportEvent(eventId, {
          patient_id: newPatientId,
          status: 'manually_sorted',
          message: 'Moved by user'
        });
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to move imported file', error);
    throw error;
  }
});


ipcMain.handle('rescan-visit', async (event, visitId: string) => {
  try {
    console.log('[IPC] Rescan visit:', visitId);

    // Resolve path using watcher helper instead of missing generic file_path
    const visitPath = await import('./watcher').then(m => m.findVisitPath(visitId));

    if (!visitPath) {
      throw new Error('Visit directory not found on disk');
    }

    // Call Watcher with visitId for persistence
    return await import('./watcher').then(m => m.rescanVisitDirectory(visitPath, visitId));
  } catch (error) {
    console.error('Rescan failed:', error);
    throw error;
  }
});

ipcMain.handle('move-visit', async (event, visitId: string, targetPatientId: string) => {
  try {
    // Move visit refactored to take ID and find path internally
    return await import('./watcher').then(m => m.moveVisit(visitId, targetPatientId));
  } catch (error) {
    console.error('Move visit failed:', error);
    throw error;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  // Cleanup web panel
  try {
    const { WebPanelManager } = await import('./webPanelManager');
    WebPanelManager.getInstance().destroy();
  } catch { /* noop */ }

  // Cleanup temp downloads
  try {
    const tempDir = path.join(app.getPath('userData'), 'temp_downloads');
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch { /* noop */ }
});
// Debug: File selection and Biotronik XML analyzer
ipcMain.handle('select-file', async (event, filters?: { name: string; extensions: string[] }[]) => {
  const mainWindow = getMainWindow();
  const options: any = {
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  };

  if (process.platform === 'linux') {
    const result = await dialog.showOpenDialog(options);
    return result.filePaths[0];
  }

  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result.filePaths[0];
});

ipcMain.handle('analyze-biotronik-xml', async (event, filePath: string) => {
  const fs = await import('fs/promises');
  const { Worker } = await import('worker_threads');
  const xmlData = await fs.readFile(filePath, 'utf-8');

  // Run analyzer off the main thread to avoid UI freeze on large files
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `const { parentPort, workerData } = require('worker_threads');
       const { analyzeBiotronikXml } = require(workerData.modulePath);
       try {
         const result = analyzeBiotronikXml(workerData.xmlData);
         parentPort.postMessage(result);
       } catch (e) {
         parentPort.postMessage({ error: e.message });
       }`,
      {
        eval: true,
        workerData: {
          xmlData,
          modulePath: require('path').join(__dirname, 'parsers', 'biotronik-analyzer'),
        },
      }
    );
    worker.on('message', (result) => {
      if (result.error) reject(new Error(result.error));
      else resolve(result);
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
});

ipcMain.handle('analyze-abbott-log', async (_event, filePath: string) => {
  const fsAsync = await import('fs/promises');
  const buffer = await fsAsync.readFile(filePath);
  const { analyzeAbbottLog } = require('./parsers/abbott-analyzer');
  return analyzeAbbottLog(buffer);
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Failed to open external URL:', error);
    throw error;
  }
});

// ─── Web Panel IPC Handlers ──────────────────────────────────────

ipcMain.handle('web-panel-show', async () => {
  const { WebPanelManager } = await import('./webPanelManager');
  const mainWindow = getMainWindow();
  if (mainWindow) WebPanelManager.getInstance().show(mainWindow);
});

ipcMain.handle('web-panel-hide', async () => {
  const { WebPanelManager } = await import('./webPanelManager');
  const mainWindow = getMainWindow();
  if (mainWindow) WebPanelManager.getInstance().hide(mainWindow);
});

ipcMain.handle('web-panel-navigate', async (_event, url: string) => {
  const { WebPanelManager } = await import('./webPanelManager');
  WebPanelManager.getInstance().navigate(url);
});

ipcMain.handle('web-panel-go-back', async () => {
  const { WebPanelManager } = await import('./webPanelManager');
  WebPanelManager.getInstance().goBack();
});

ipcMain.handle('web-panel-go-forward', async () => {
  const { WebPanelManager } = await import('./webPanelManager');
  WebPanelManager.getInstance().goForward();
});

ipcMain.handle('web-panel-reload', async () => {
  const { WebPanelManager } = await import('./webPanelManager');
  WebPanelManager.getInstance().reload();
});

ipcMain.handle('web-panel-get-url', async () => {
  const { WebPanelManager } = await import('./webPanelManager');
  return WebPanelManager.getInstance().getURL();
});

// ─── Web Panel — Bookmarks ───────────────────────────────────────

ipcMain.handle('get-web-bookmarks', async () => {
  const { getBookmarks } = await import('./webPanelConfig');
  const settings = await getAllSettings();
  return getBookmarks(settings.mriCountry);
});

ipcMain.handle('set-web-bookmarks', async (_event, config) => {
  const { setBookmarks } = await import('./webPanelConfig');
  setBookmarks(config);
});

// ─── Web Panel — Download Whitelist ──────────────────────────────

ipcMain.handle('get-download-whitelist', async () => {
  const { getDownloadWhitelist } = await import('./webPanelConfig');
  return getDownloadWhitelist();
});

ipcMain.handle('set-download-whitelist', async (_event, config) => {
  const { setDownloadWhitelist } = await import('./webPanelConfig');
  setDownloadWhitelist(config);
});

// ─── Web Panel — Download Assignment ─────────────────────────────

ipcMain.handle('web-panel-assign-download', async (_event, info: {
  filePath: string;
  patientId?: string;
  patientData?: { first_name: string; last_name: string; dob: string; hospitalPatientId?: string };
  visitMode: 'new' | 'existing';
  visitId?: string;
  visitDate?: string;
  sourceDomain: string;
  sourceManufacturer: string;
}) => {
  try {
    const { getPatientById, createPatient, createReport } = await import('./database');
    const { storeFile } = await import('./storage');
    const { v4: uuidv4 } = await import('uuid');

    let patient: any;

    if (info.patientData && !info.patientId) {
      // Create-patient flow: create the patient first
      const newId = uuidv4();
      await createPatient({
        id: newId,
        first_name: info.patientData.first_name || '',
        last_name: info.patientData.last_name,
        dob: info.patientData.dob,
        hospitalPatientId: info.patientData.hospitalPatientId || null,
      });
      info.patientId = newId;
      patient = await getPatientById(newId);
      sendNotification(`New patient created: ${info.patientData.first_name} ${info.patientData.last_name}`);
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('patient-list-update');
      }
    } else {
      patient = await getPatientById(info.patientId!);
    }
    if (!patient) throw new Error('Patient not found');

    const patientId = info.patientId!;
    const visitDate = info.visitDate || new Date().toISOString().split('T')[0];
    const reportId = info.visitId || uuidv4();

    // Build a minimal UnifiedReport for DB + visit.xml
    const remoteReport: any = {
      id: reportId,
      patient_id: patientId,
      manufacturer: info.sourceManufacturer,
      interrogation_date: visitDate,
      device: { type: 'Unknown', model: 'Unknown', serial_number: 'Unknown' },
      battery: null,
      leads: [],
      patient: {
        first_name: patient.first_name,
        last_name: patient.last_name,
        dob: patient.dob,
      },
      // Remote visit metadata — used by extended generateVisitXML
      _remoteSource: {
        visit_type: 'remote',
        source_domain: info.sourceDomain,
        source_manufacturer: info.sourceManufacturer,
      },
    };

    // Create a skeleton report for DB tracking
    if (!info.visitId) {
      await createReport(remoteReport);
    }

    if (info.filePath.toLowerCase().endsWith('.zip')) {
      const { storeZipContents } = await import('./storage');
      await storeZipContents(
        info.filePath,
        reportId,
        patientId,
        `${patient.last_name}_${patient.first_name}`,
        visitDate,
        patient,
        remoteReport
      );
    } else {
      await storeFile(
        info.filePath,
        reportId,
        patientId,
        `${patient.last_name}_${patient.first_name}`,
        visitDate,
        patient,
        remoteReport
      );
    }

    // Notify renderer to refresh
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('patient-list-update');
    }

    return { success: true };
  } catch (error) {
    console.error('[web-panel-assign-download] Failed:', error);
    throw error;
  }
});

ipcMain.handle('web-panel-dismiss-download', async (_event, filePath: string) => {
  try {
    const fsAsync = await import('fs/promises');
    const downloadsDir = app.getPath('downloads');
    const dest = path.join(downloadsDir, path.basename(filePath));
    try {
      await fsAsync.rename(filePath, dest);
    } catch (err: any) {
      if (err.code === 'EXDEV') {
        await fsAsync.copyFile(filePath, dest);
        await fsAsync.unlink(filePath);
      } else {
        throw err;
      }
    }
    return { success: true, path: dest };
  } catch (error) {
    console.error('[web-panel-dismiss-download] Failed:', error);
    throw error;
  }
});

// ─── Web Panel — Credentials ─────────────────────────────────────
// Passwords are never sent to the renderer process.
// Auto-fill & saving flow through webPanelManager (main-process only).
// The renderer can only list metadata and delete entries.

ipcMain.handle('credential-delete', async (_event, domain: string, username: string) => {
  const { CredentialStore } = await import('./credentialStore');
  CredentialStore.getInstance().delete(domain, username);
});

ipcMain.handle('credential-list', async () => {
  const { CredentialStore } = await import('./credentialStore');
  return CredentialStore.getInstance().list();
});

ipcMain.handle('credential-is-available', async () => {
  const { CredentialStore } = await import('./credentialStore');
  return CredentialStore.getInstance().isAvailable();
});

// ─── Error Logging ───────────────────────────────────────────────
ipcMain.handle('log-renderer-error', (_event, data: { message: string; stack?: string; source?: string }) => {
  logError(data.source ?? 'renderer', data.message, data.stack);
});

ipcMain.handle('get-log-path', () => getLogPath());

ipcMain.handle('get-recent-logs', (_event, lines?: number) => getRecentLogs(lines));

ipcMain.handle('open-log-directory', async () => {
  shell.showItemInFolder(getLogPath());
});

ipcMain.handle('build-crash-report-url', (_event, data: { message: string; stack?: string; source?: string }) => {
  return buildGitHubIssueUrl({
    errorMessage: data.message,
    stack: data.stack,
    source: data.source ?? 'renderer',
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: `${process.platform} ${process.arch}`
  });
});

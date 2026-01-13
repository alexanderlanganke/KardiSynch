import { BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null;

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function sendUnmatchedFiles(files: string[]) {
  if (mainWindow) {
    mainWindow.webContents.send('unmatched-files', files);
  }
}

export function sendNotification(message: string, type: 'info' | 'warning' | 'error' = 'info') {
  if (mainWindow) {
    mainWindow.webContents.send('notify', { type, message });
  }
}

export function sendProcessStatus(status: { type: 'start' | 'progress' | 'complete' | 'error'; message: string; file?: string }) {
  if (mainWindow) {
    mainWindow.webContents.send('process-status', status);
  }
}


export function sendPatientListUpdate() {
  if (mainWindow) {
    mainWindow.webContents.send('patient-list-update');
  }
}

export function sendManualSortingRequest(fileInfo: any) {
  if (mainWindow) {
    mainWindow.webContents.send('request-manual-sorting', fileInfo);
  }
}

export function sendImportSessionUpdate(session: any) {
  if (mainWindow) {
    mainWindow.webContents.send('import-session-update', session);
  }
}

export function sendDeviceSelectionRequest(fileInfo: any) {
  if (mainWindow) {
    mainWindow.webContents.send('request-device-selection', fileInfo);
  }
}

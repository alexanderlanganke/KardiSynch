import { BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null;

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window;
  // Clear the reference once the window is gone so callers that only
  // truthiness-check getMainWindow() can't send to a destroyed window.
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function sendUnmatchedFiles(files: string[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('unmatched-files', files);
  }
}

export function sendNotification(message: string, type: 'info' | 'warning' | 'error' = 'info') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notify', { type, message });
  }
}

export function sendProcessStatus(status: {
  type: 'start' | 'progress' | 'complete' | 'error';
  message: string;
  taskId?: string;
  title?: string;
  progress?: number;
  file?: string
}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('process-status', status);
  }
}


export function sendPatientListUpdate() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('patient-list-update');
  }
}

export function sendManualSortingRequest(fileInfo: any) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('request-manual-sorting', fileInfo);
  }
}

// Notifies the renderer that the pending manual-sort queue changed (issue #136).
// Carries the full task list so the notification area can re-render directly.
export function sendPendingSortUpdate(tasks: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pending-sort-update', tasks);
  }
}

export function sendImportSessionUpdate(session: any) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('import-session-update', session);
  }
}

export function sendDeviceSelectionRequest(fileInfo: any) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('request-device-selection', fileInfo);
  }
}

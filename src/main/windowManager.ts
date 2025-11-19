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

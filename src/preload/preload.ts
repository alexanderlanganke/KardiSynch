import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAllPatients: (filters: any) => ipcRenderer.invoke('get-all-patients', filters),
  getPatientById: (patientId: string) => ipcRenderer.invoke('get-patient-by-id', patientId),
  updatePatient: (patient: any) => ipcRenderer.invoke('update-patient', patient),
  rebuildDatabase: () => ipcRenderer.invoke('rebuild-database'),
  getPatientReports: (patientId: string) => ipcRenderer.invoke('get-patient-reports', patientId),
  getPdfData: (filePath: string) => ipcRenderer.invoke('get-pdf-data', filePath),
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) =>
    ipcRenderer.send('find-in-page', text, options),
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') =>
    ipcRenderer.send('stop-find-in-page', action),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings: any) => ipcRenderer.invoke('set-settings', settings),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  onUnmatchedFiles: (callback: (files: string[]) => void) => {
    ipcRenderer.on('unmatched-files', (event, files) => callback(files));
  },
  onNotify: (callback: (type: 'info' | 'warning' | 'error', message: string) => void) => {
    const handler = (
      event: IpcRendererEvent,
      { type, message }: { type: 'info' | 'warning' | 'error'; message: string }
    ) => callback(type, message);
    ipcRenderer.on('notify', handler);
    return () => {
      ipcRenderer.removeListener('notify', handler);
    };
  },
  onProcessStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('process-status', (event, status) => callback(status));
  },
  onPatientListUpdate: (callback: () => void) => {
    ipcRenderer.on('patient-list-update', () => callback());
  },
  openPatientDirectory: (patientId: string) => ipcRenderer.invoke('open-patient-directory', patientId),
  getPatientDirectories: () => ipcRenderer.invoke('get-patient-directories'),
  getVisitDirectories: (patientId: string) => ipcRenderer.invoke('get-visit-directories', patientId),
  getVisitFiles: (patientId: string, visitDirName: string) => ipcRenderer.invoke('get-visit-files', patientId, visitDirName),
  getParsedXml: (filePath: string) => ipcRenderer.invoke('get-parsed-xml', filePath),
  removeListener: (channel: string, func: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, func);
  }
});

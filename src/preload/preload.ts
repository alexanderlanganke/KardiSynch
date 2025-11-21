import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAllPatients: (filters: any) => ipcRenderer.invoke('get-all-patients', filters),
  getPatientById: (patientId: string) => ipcRenderer.invoke('get-patient-by-id', patientId),
  getPatientReports: (patientId: string) => ipcRenderer.invoke('get-patient-reports', patientId),
  getPdfData: (filePath: string) => ipcRenderer.invoke('get-pdf-data', filePath),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings: any) => ipcRenderer.invoke('set-settings', settings),
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
  }
});

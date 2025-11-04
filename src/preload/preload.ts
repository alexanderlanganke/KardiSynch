import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAllPatients: (filters: any) => ipcRenderer.invoke('get-all-patients', filters),
  getPatientReports: (patientId: string) => ipcRenderer.invoke('get-patient-reports', patientId),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings: any) => ipcRenderer.invoke('set-settings', settings),
});

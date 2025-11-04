import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAllPatients: (filters: any) => ipcRenderer.invoke('get-all-patients', filters),
});

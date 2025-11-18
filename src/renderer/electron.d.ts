export interface IElectronAPI {
  getAllPatients: (filters: any) => Promise<any>;
  getPatientReports: (patientId: string) => Promise<any>;
  getPdfData: (filePath: string) => Promise<Uint8Array>;
  getSettings: () => Promise<any>;
  setSettings: (settings: any) => Promise<void>;
  onUnmatchedFiles: (callback: (files: string[]) => void) => void;
  onNotify: (callback: (type: 'info' | 'warning' | 'error', message: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

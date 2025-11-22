interface IElectronAPI {
  getAllPatients: (filters: any) => Promise<any[]>;
  getPatientById: (patientId: string) => Promise<any>;
  getPatientReports: (patientId: string) => Promise<any[]>;
  getSettings: () => Promise<any>;
  setSettings: (settings: any) => Promise<void>;
  resetSettings: () => Promise<any>;
  selectDirectory: () => Promise<string>;
  getPdfData: (filePath: string) => Promise<Uint8Array>;
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) => void;
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

export { };

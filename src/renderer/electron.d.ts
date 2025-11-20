interface IElectronAPI {
  getAllPatients: (filters: any) => Promise<any[]>;
  getPatientById: (patientId: number) => Promise<any>;
  getPatientReports: (patientId: number) => Promise<any[]>;
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<void>;
  resetSettings: () => Promise<void>;
  selectDirectory: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

export { };

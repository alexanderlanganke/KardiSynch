export interface IElectronAPI {
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
  onNotify: (callback: (type: 'info' | 'warning' | 'error', message: string) => void) => () => void;
  onUnmatchedFiles: (callback: (files: string[]) => void) => void;
  onProcessStatus: (callback: (status: any) => void) => void;
  onPatientListUpdate: (callback: () => void) => void;
  updatePatient: (patient: any) => Promise<any>;
  rebuildDatabase: () => Promise<any>;
  clearAllData: () => Promise<boolean>;
  checkForUpdates: () => Promise<any>;
  quitAndInstall: () => Promise<void>;
  onUpdateStatus: (callback: (status: any) => void) => () => void;
}
getPatientDirectories: () => Promise<any[]>;
getVisitDirectories: (patientId: string) => Promise<any[]>;
getVisitFiles: (patientId: string, visitDirName: string) => Promise<string[]>;
getParsedXml: (filePath: string) => Promise<any>;
removeListener: (channel: string, func: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

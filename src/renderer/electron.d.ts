export interface IElectronAPI {
  readFileText(filePath: string): Promise<string>;
  getPreviewPath: (originalPath: string) => Promise<string | null>;
  getAllPatients: (filters: any) => Promise<any[]>;
  createPatient: (patient: any) => Promise<any>;
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
  dedupReports: () => Promise<{ groupsFound: number; reportsRemoved: number; directoriesRemoved: number }>;
  clearAllData: () => Promise<boolean>;
  checkForUpdates: () => Promise<any>;
  checkMedtronicUpdates: () => Promise<{ updated: boolean; count: number; error?: string }>;
  checkBostonUpdates: () => Promise<{ updated: boolean; count: number; error?: string }>;
  getDeviceNews: () => Promise<any[]>;
  onNewsStatus: (callback: (message: string) => void) => void;
  quitAndInstall: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  onUpdateStatus: (callback: (status: any) => void) => () => void;
  getPatientDirectories: () => Promise<any[]>;
  getVisitDirectories: (patientId: string) => Promise<any[]>;
  getVisitFiles: (patientId: string, visitDirName: string) => Promise<string[]>;
  getParsedXml: (filePath: string) => Promise<any>;
  removeListener: (channel: string, func: (...args: any[]) => void) => void;
  openPatientDirectory: (patientId: string) => Promise<void>;
  reprocessUnmatched: () => Promise<{ count: number; success: boolean; message?: string }>;

  // Import History & Manual Sorting
  manualSortingResponse: (response: any) => Promise<void>;
  getImportHistory: () => Promise<any[]>;
  getImportSessionEvents: (sessionId: string) => Promise<any[]>;
  moveImportedFile: (eventId: string, newPatientId: string, targetVisitId?: string, newVisitDate?: string, confirmedFilePath?: string) => Promise<void>;
  onRequestManualSorting: (callback: (fileInfo: any) => void) => void;
  onImportSessionUpdate: (callback: (session: any) => void) => void;

  // Pending manual-sort queue (issue #136)
  getPendingSortTasks: () => Promise<any[]>;
  resolvePendingSortTask: (taskId: string, decision: any) => Promise<{ success: boolean; error?: string; reportId?: string; movedToUnmatched?: boolean }>;
  dismissPendingSortTasks: (taskIds: string[]) => Promise<{ success: boolean }>;
  onPendingSortUpdate: (callback: (tasks: any[]) => void) => () => void;

  // Device Selection (Autodetection Fallback)
  sendDeviceSelectionResult: (result: any) => Promise<void>;
  onDeviceSelectionRequest: (callback: (fileInfo: any) => void) => void;

  // Remembered device-type aliases
  listDeviceTypeAliases: () => Promise<{ manufacturer: string; model: string; type: string; created_at: string }[]>;
  setDeviceTypeAlias: (manufacturer: string, model: string, type: string) => Promise<void>;
  deleteDeviceTypeAlias: (manufacturer: string, model: string) => Promise<void>;

  // External links
  openExternal: (url: string) => Promise<void>;

  // Debug tools
  selectFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | undefined>;
  analyzeBiotronikXml: (filePath: string) => Promise<any>;
  analyzeAbbottLog: (filePath: string) => Promise<any>;

  // Visit Management
  rescanVisit: (visitId: string) => Promise<any>;
  moveVisit: (visitId: string, targetPatientId: string) => Promise<any>;
  exportVisitFiles: (patientId: string, visitId: string, targetDirectory: string) => Promise<any>;

  // Web Panel
  webPanelShow: () => Promise<void>;
  webPanelHide: () => Promise<void>;
  webPanelNavigate: (url: string) => Promise<void>;
  webPanelGoBack: () => Promise<void>;
  webPanelGoForward: () => Promise<void>;
  webPanelReload: () => Promise<void>;
  webPanelGetUrl: () => Promise<string>;
  onWebPanelUrlUpdated: (callback: (url: string) => void) => void;
  onWebPanelLoading: (callback: (loading: boolean) => void) => void;
  onWebPanelDownloadIntercepted: (callback: (info: { filePath: string; filename: string; sourceDomain: string; sourceManufacturer: string }) => void) => void;

  // Web Panel — Bookmarks
  getWebBookmarks: () => Promise<any>;
  setWebBookmarks: (config: any) => Promise<void>;

  // Web Panel — Download Whitelist
  getDownloadWhitelist: () => Promise<any>;
  setDownloadWhitelist: (config: any) => Promise<void>;

  // Web Panel — Download Assignment
  webPanelAssignDownload: (info: { filePath: string; patientId: string; visitMode: 'new' | 'existing'; visitId?: string; visitDate?: string; sourceDomain: string; sourceManufacturer: string }) => Promise<void>;
  webPanelDismissDownload: (filePath: string) => Promise<void>;

  // Web Panel — Credential Prompt
  onWebPanelCredentialsDetected: (callback: (info: { domain: string; username: string }) => void) => void;
  webPanelSavePendingCredential: () => Promise<void>;
  webPanelDismissPendingCredential: () => Promise<void>;

  // Web Panel — Credentials (passwords never sent to renderer — auto-fill is main-process only)
  credentialDelete: (domain: string, username: string) => Promise<void>;
  credentialList: () => Promise<{ domain: string; username: string; updated_at: string }[]>;
  credentialIsAvailable: () => Promise<boolean>;

  // Error Logging
  logRendererError: (data: { message: string; stack?: string; source?: string }) => Promise<void>;
  getLogPath: () => Promise<string>;
  getRecentLogs: (lines?: number) => Promise<string>;
  openLogDirectory: () => Promise<void>;
  buildCrashReportUrl: (data: { message: string; stack?: string; source?: string }) => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAllPatients: (filters: any) => ipcRenderer.invoke('get-all-patients', filters),
  getPatientById: (patientId: string) => ipcRenderer.invoke('get-patient-by-id', patientId),
  createPatient: (patient: any) => ipcRenderer.invoke('create-patient', patient),
  updatePatient: (patient: any) => ipcRenderer.invoke('update-patient', patient),
  rebuildDatabase: () => ipcRenderer.invoke('rebuild-database'),
  dedupReports: () => ipcRenderer.invoke('dedup-reports'),
  getPatientReports: (patientId: string) => ipcRenderer.invoke('get-patient-reports', patientId),
  getPdfData: (filePath: string) => ipcRenderer.invoke('get-pdf-data', filePath),
  readFileText: (filePath: string) => ipcRenderer.invoke('read-file-text', filePath),
  getPreviewPath: (originalPath: string) => ipcRenderer.invoke('get-preview-path', originalPath),
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) =>
    ipcRenderer.send('find-in-page', text, options),
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') =>
    ipcRenderer.send('stop-find-in-page', action),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings: any) => ipcRenderer.invoke('set-settings', settings),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  clearAllData: () => ipcRenderer.invoke('clear-all-data'),
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
  reprocessUnmatched: () => ipcRenderer.invoke('reprocess-unmatched'),
  openPatientDirectory: (patientId: string) => ipcRenderer.invoke('open-patient-directory', patientId),
  getPatientDirectories: () => ipcRenderer.invoke('get-patient-directories'),
  getVisitDirectories: (patientId: string) => ipcRenderer.invoke('get-visit-directories', patientId),
  getVisitFiles: (patientId: string, visitDirName: string) => ipcRenderer.invoke('get-visit-files', patientId, visitDirName),
  getParsedXml: (filePath: string) => ipcRenderer.invoke('get-parsed-xml', filePath),
  getMRIStatus: (patientId: string) => ipcRenderer.invoke('get-mri-status', patientId),

  // Import History & Manual Sorting
  manualSortingResponse: (response: any) => ipcRenderer.invoke('manual-sorting-response', response),
  getImportHistory: () => ipcRenderer.invoke('get-import-history'),
  getImportSessionEvents: (sessionId: string) => ipcRenderer.invoke('get-import-session-events', sessionId),
  moveImportedFile: (eventId: string, newPatientId: string, targetVisitId?: string, newVisitDate?: string, confirmedFilePath?: string) => ipcRenderer.invoke('move-imported-file', eventId, newPatientId, targetVisitId, newVisitDate, confirmedFilePath),
  onRequestManualSorting: (callback: (fileInfo: any) => void) => {
    ipcRenderer.on('request-manual-sorting', (event, fileInfo) => callback(fileInfo));
  },
  onImportSessionUpdate: (callback: (session: any) => void) => {
    ipcRenderer.on('import-session-update', (event, session) => callback(session));
  },

  // Automation Service
  onAutomationStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('automation-status', (event, status) => callback(status));
  },
  onMRIStatusUpdate: (callback: (data: { patientId: string; status: any }) => void) => {
    ipcRenderer.on('mri-status-update', (event, data) => callback(data));
  },
  triggerMriCheck: (patientId: string) => ipcRenderer.invoke('trigger-mri-check', patientId),
  retriggerAllMriChecks: () => ipcRenderer.invoke('retrigger-all-mri-checks'),

  // Visit Management
  rescanVisit: (visitId: string) => ipcRenderer.invoke('rescan-visit', visitId),
  moveVisit: (visitId: string, targetPatientId: string) => ipcRenderer.invoke('move-visit', visitId, targetPatientId),

  // Device Selection (Autodetection Fallback)
  sendDeviceSelectionResult: (result: any) => ipcRenderer.invoke('device-selection-result', result),
  onDeviceSelectionRequest: (callback: (fileInfo: any) => void) => {
    ipcRenderer.on('request-device-selection', (event, fileInfo) => callback(fileInfo));
  },

  // Updates
  checkMedtronicUpdates: () => ipcRenderer.invoke('check-medtronic-updates'),
  checkBostonUpdates: () => ipcRenderer.invoke('check-boston-updates'),
  getDeviceNews: () => ipcRenderer.invoke('get-device-news'),
  onNewsStatus: (callback: (message: string) => void) => ipcRenderer.on('news-status', (_, message) => callback(message)),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateStatus: (callback: (status: any) => void) => {
    const subscription = (_: any, status: any) => callback(status);
    ipcRenderer.on('update-status', subscription);
    return () => ipcRenderer.removeListener('update-status', subscription);
  },
  removeListener: (channel: string, func: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, func);
  },
  exportVisitFiles: (patientId: string, visitId: string, targetDirectory: string) => ipcRenderer.invoke('export-visit-files', patientId, visitId, targetDirectory),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Web Panel
  webPanelShow: () => ipcRenderer.invoke('web-panel-show'),
  webPanelHide: () => ipcRenderer.invoke('web-panel-hide'),
  webPanelNavigate: (url: string) => ipcRenderer.invoke('web-panel-navigate', url),
  webPanelGoBack: () => ipcRenderer.invoke('web-panel-go-back'),
  webPanelGoForward: () => ipcRenderer.invoke('web-panel-go-forward'),
  webPanelReload: () => ipcRenderer.invoke('web-panel-reload'),
  webPanelGetUrl: () => ipcRenderer.invoke('web-panel-get-url'),
  onWebPanelUrlUpdated: (callback: (url: string) => void) => {
    ipcRenderer.on('web-panel-url-updated', (_, url) => callback(url));
  },
  onWebPanelLoading: (callback: (loading: boolean) => void) => {
    ipcRenderer.on('web-panel-loading', (_, loading) => callback(loading));
  },
  onWebPanelDownloadIntercepted: (callback: (info: any) => void) => {
    ipcRenderer.on('web-panel-download-intercepted', (_, info) => callback(info));
  },

  // Web Panel — Bookmarks
  getWebBookmarks: () => ipcRenderer.invoke('get-web-bookmarks'),
  setWebBookmarks: (config: any) => ipcRenderer.invoke('set-web-bookmarks', config),

  // Web Panel — Download Whitelist
  getDownloadWhitelist: () => ipcRenderer.invoke('get-download-whitelist'),
  setDownloadWhitelist: (config: any) => ipcRenderer.invoke('set-download-whitelist', config),

  // Web Panel — Download Assignment
  webPanelAssignDownload: (info: any) => ipcRenderer.invoke('web-panel-assign-download', info),
  webPanelDismissDownload: (filePath: string) => ipcRenderer.invoke('web-panel-dismiss-download', filePath),

  // Web Panel — Credential Prompt
  onWebPanelCredentialsDetected: (callback: (info: { domain: string; username: string }) => void) => {
    ipcRenderer.on('web-panel-credentials-detected', (_, info) => callback(info));
  },
  webPanelSavePendingCredential: () => ipcRenderer.invoke('web-panel-save-pending-credential'),
  webPanelDismissPendingCredential: () => ipcRenderer.invoke('web-panel-dismiss-pending-credential'),

  // Web Panel — Credentials (passwords never sent to renderer — auto-fill is main-process only)
  credentialDelete: (domain: string, username: string) => ipcRenderer.invoke('credential-delete', domain, username),
  credentialList: () => ipcRenderer.invoke('credential-list'),
  credentialIsAvailable: () => ipcRenderer.invoke('credential-is-available'),

  // Debug tools
  selectFile: (filters?: { name: string; extensions: string[] }[]) => ipcRenderer.invoke('select-file', filters),
  analyzeBiotronikXml: (filePath: string) => ipcRenderer.invoke('analyze-biotronik-xml', filePath),
  analyzeAbbottLog: (filePath: string) => ipcRenderer.invoke('analyze-abbott-log', filePath),
});


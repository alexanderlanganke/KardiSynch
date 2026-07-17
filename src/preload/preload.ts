import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Register an IPC listener and return an unsubscribe function. Every on* API
// must return this so renderer effects can clean up on unmount — functions
// passed through the contextBridge are proxied per call, so a generic
// removeListener(channel, fn) can never match the registered handler.
const subscribe = (channel: string, handler: (event: IpcRendererEvent, ...args: any[]) => void): (() => void) => {
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

contextBridge.exposeInMainWorld('electronAPI', {
  getAllPatients: (filters: any) => ipcRenderer.invoke('get-all-patients', filters),
  getPatientById: (patientId: string) => ipcRenderer.invoke('get-patient-by-id', patientId),
  createPatient: (patient: any) => ipcRenderer.invoke('create-patient', patient),
  updatePatient: (patient: any) => ipcRenderer.invoke('update-patient', patient),
  rebuildDatabase: () => ipcRenderer.invoke('rebuild-database'),
  dedupReports: () => ipcRenderer.invoke('dedup-reports'),
  findDuplicatePatients: () => ipcRenderer.invoke('find-duplicate-patients'),
  mergePatients: (keeperId: string, loserIds: string[]) => ipcRenderer.invoke('merge-patients', keeperId, loserIds),
  findOrphanedVisits: () => ipcRenderer.invoke('find-orphaned-visits'),
  moveOrphanedVisits: (reportIds: string[]) => ipcRenderer.invoke('move-orphaned-visits', reportIds),
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
  onUnmatchedFiles: (callback: (files: string[]) => void) =>
    subscribe('unmatched-files', (_event, files) => callback(files)),
  onNotify: (callback: (type: 'info' | 'warning' | 'error', message: string) => void) =>
    subscribe(
      'notify',
      (_event, { type, message }: { type: 'info' | 'warning' | 'error'; message: string }) => callback(type, message)
    ),
  onProcessStatus: (callback: (status: any) => void) =>
    subscribe('process-status', (_event, status) => callback(status)),
  onPatientListUpdate: (callback: () => void) =>
    subscribe('patient-list-update', () => callback()),
  reprocessUnmatched: () => ipcRenderer.invoke('reprocess-unmatched'),
  openPatientDirectory: (patientId: string) => ipcRenderer.invoke('open-patient-directory', patientId),
  getPatientDirectories: () => ipcRenderer.invoke('get-patient-directories'),
  getVisitDirectories: (patientId: string) => ipcRenderer.invoke('get-visit-directories', patientId),
  getVisitFiles: (patientId: string, visitDirName: string) => ipcRenderer.invoke('get-visit-files', patientId, visitDirName),
  getParsedXml: (filePath: string) => ipcRenderer.invoke('get-parsed-xml', filePath),
  // Import History & Manual Sorting
  manualSortingResponse: (response: any) => ipcRenderer.invoke('manual-sorting-response', response),
  getImportHistory: () => ipcRenderer.invoke('get-import-history'),
  getImportSessionEvents: (sessionId: string) => ipcRenderer.invoke('get-import-session-events', sessionId),
  moveImportedFile: (eventId: string, newPatientId: string, targetVisitId?: string, newVisitDate?: string, confirmedFilePath?: string) => ipcRenderer.invoke('move-imported-file', eventId, newPatientId, targetVisitId, newVisitDate, confirmedFilePath),
  onRequestManualSorting: (callback: (fileInfo: any) => void) =>
    subscribe('request-manual-sorting', (_event, fileInfo) => callback(fileInfo)),
  onImportSessionUpdate: (callback: (session: any) => void) =>
    subscribe('import-session-update', (_event, session) => callback(session)),

  // Pending manual-sort queue (issue #136)
  getPendingSortTasks: () => ipcRenderer.invoke('get-pending-sort-tasks'),
  resolvePendingSortTask: (taskId: string, decision: any) => ipcRenderer.invoke('resolve-pending-sort-task', taskId, decision),
  // Bulk sort several queued tasks to the same patient/visit (issue #137)
  resolvePendingSortTasks: (taskIds: string[], decision: any) => ipcRenderer.invoke('resolve-pending-sort-tasks', taskIds, decision),
  dismissPendingSortTasks: (taskIds: string[]) => ipcRenderer.invoke('dismiss-pending-sort-tasks', taskIds),
  onPendingSortUpdate: (callback: (tasks: any[]) => void) =>
    subscribe('pending-sort-update', (_event, tasks: any[]) => callback(tasks)),

  // Visit Management
  rescanVisit: (visitId: string) => ipcRenderer.invoke('rescan-visit', visitId),
  moveVisit: (visitId: string, targetPatientId: string) => ipcRenderer.invoke('move-visit', visitId, targetPatientId),

  // Device Selection (Autodetection Fallback)
  sendDeviceSelectionResult: (result: any) => ipcRenderer.invoke('device-selection-result', result),
  onDeviceSelectionRequest: (callback: (fileInfo: any) => void) =>
    subscribe('request-device-selection', (_event, fileInfo) => callback(fileInfo)),

  // Remembered device-type aliases (shared via {dataPath}/device_types.xml)
  listDeviceTypeAliases: () => ipcRenderer.invoke('list-device-type-aliases'),
  setDeviceTypeAlias: (manufacturer: string, model: string, type: string) =>
    ipcRenderer.invoke('set-device-type-alias', manufacturer, model, type),
  setLeadTypeAlias: (manufacturer: string, model: string, attrs: { type?: string; connector?: string }) =>
    ipcRenderer.invoke('set-lead-type-alias', manufacturer, model, attrs),
  deleteDeviceTypeAlias: (manufacturer: string, model: string, kind?: 'device' | 'lead') =>
    ipcRenderer.invoke('delete-device-type-alias', manufacturer, model, kind),

  // Updates
  checkMedtronicUpdates: () => ipcRenderer.invoke('check-medtronic-updates'),
  checkBostonUpdates: () => ipcRenderer.invoke('check-boston-updates'),
  getDeviceNews: () => ipcRenderer.invoke('get-device-news'),
  onNewsStatus: (callback: (message: string) => void) =>
    subscribe('news-status', (_event, message) => callback(message)),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateStatus: (callback: (status: any) => void) =>
    subscribe('update-status', (_event, status) => callback(status)),
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
  onWebPanelUrlUpdated: (callback: (url: string) => void) =>
    subscribe('web-panel-url-updated', (_event, url) => callback(url)),
  onWebPanelLoading: (callback: (loading: boolean) => void) =>
    subscribe('web-panel-loading', (_event, loading) => callback(loading)),
  onWebPanelDownloadIntercepted: (callback: (info: any) => void) =>
    subscribe('web-panel-download-intercepted', (_event, info) => callback(info)),

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
  onWebPanelCredentialsDetected: (callback: (info: { domain: string; username: string }) => void) =>
    subscribe('web-panel-credentials-detected', (_event, info) => callback(info)),
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

  // Error Logging
  logRendererError: (data: { message: string; stack?: string; source?: string }) => ipcRenderer.invoke('log-renderer-error', data),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  getRecentLogs: (lines?: number) => ipcRenderer.invoke('get-recent-logs', lines),
  openLogDirectory: () => ipcRenderer.invoke('open-log-directory'),
  buildCrashReportUrl: (data: { message: string; stack?: string; source?: string }) => ipcRenderer.invoke('build-crash-report-url', data),
});


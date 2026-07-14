import React from 'react';
import { useAppContext } from './AppContext';
import PatientDashboard from './PatientDashboard';
import PatientDetail from './PatientDetail';
import Settings from './Settings';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { PatientProvider } from './store/PatientStore';
import { Button } from '@/components/ui/button';
import NotificationCenter from '@/components/NotificationCenter';
import { LayoutDashboard, Moon, Settings as SettingsIcon, Sun, Newspaper, Globe, AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import PatientAssignmentModal from '@/components/PatientAssignmentModal';
import DeviceSelectionModal from './components/DeviceSelectionModal';
import DeviceNews from './DeviceNews';
import WebPanel from './WebPanel';
import OnboardingWizard from './components/OnboardingWizard';
import { AppDialogProvider } from './components/AppDialogProvider';
import DownloadAssignmentDialog from '@/components/DownloadAssignmentDialog';
import CredentialSavePrompt from '@/components/CredentialSavePrompt';


const ThemeToggle: React.FC = () => {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="rounded-full hover:bg-primary/10 transition-colors"
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-orange-500" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-blue-400" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
};

const NavItem: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label?: string
}> = ({ active, onClick, icon, label }) => (
  <Button
    variant="ghost"
    size="icon"
    onClick={onClick}
    className={cn(
      "relative w-10 h-10 rounded-xl transition-all duration-300 group",
      active
        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 scale-105"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
    )}
    aria-label={label}
  >
    {icon}
    {active && (
      <span className="absolute -right-1 top-1 flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
      </span>
    )}
  </Button>
);


const App: React.FC = () => {
  const { currentView, setCurrentView, currentPatientId, setCurrentPatientId } = useAppContext();

  // Manual Sorting State
  const [manualSortingOpen, setManualSortingOpen] = React.useState(false);
  const [manualSortingFile, setManualSortingFile] = React.useState<any>(null);

  // Device Selection State
  const [deviceSelectionOpen, setDeviceSelectionOpen] = React.useState(false);
  const [deviceSelectionFile, setDeviceSelectionFile] = React.useState<any>(null);

  // Pending manual-sort queue (issue #136) — replaces the old auto-opening modal
  const [pendingSortTasks, setPendingSortTasks] = React.useState<any[]>([]);

  // Onboarding State
  const [showOnboarding, setShowOnboarding] = React.useState(false);

  // Web Panel Download Interception State
  const [downloadDialogOpen, setDownloadDialogOpen] = React.useState(false);
  const [interceptedDownload, setInterceptedDownload] = React.useState<any>(null);

  // Credential Save Prompt State
  const [credentialPrompt, setCredentialPrompt] = React.useState<{ domain: string; username: string } | null>(null);

  // Transient error toasts (errors also land in the NotificationCenter)
  const [errorToasts, setErrorToasts] = React.useState<{ id: number; message: string }[]>([]);

  React.useEffect(() => {
    // Listen for manual sorting requests
    const cleanupManualSorting = window.electronAPI.onRequestManualSorting((fileInfo) => {
      setManualSortingFile(fileInfo);
      setManualSortingOpen(true);
    });

    // Listen for device selection requests
    const cleanupDeviceSelection = window.electronAPI.onDeviceSelectionRequest((fileInfo) => {
      setDeviceSelectionFile(fileInfo);
      setDeviceSelectionOpen(true);
    });

    // Pending manual-sort queue: load current tasks and subscribe to updates.
    // The sorting dialog is opened on demand from the notification area, never
    // auto-focused (issue #136).
    window.electronAPI.getPendingSortTasks().then((tasks) => setPendingSortTasks(tasks || []));
    const cleanupPendingSort = window.electronAPI.onPendingSortUpdate((tasks) => {
      setPendingSortTasks(tasks || []);
    });

    // Listen for web panel download interceptions
    const cleanupDownloadIntercepted = window.electronAPI.onWebPanelDownloadIntercepted((info) => {
      setInterceptedDownload(info);
      setDownloadDialogOpen(true);
      // Hide the BrowserView so the dialog is visible above the web panel
      window.electronAPI.webPanelHide();
    });

    // Listen for credential detection prompts
    const cleanupCredentials = window.electronAPI.onWebPanelCredentialsDetected((info) => {
      setCredentialPrompt(info);
      // Hide BrowserView so the save prompt is visible above the web panel
      window.electronAPI.webPanelHide();
    });

    // Surface error notifications as a transient toast so failures are visible
    // even when the NotificationCenter popover is closed.
    const toastTimers: ReturnType<typeof setTimeout>[] = [];
    const cleanupNotify = window.electronAPI.onNotify((type, message) => {
      if (type !== 'error') return;
      const id = Date.now() + Math.random();
      setErrorToasts(prev => [...prev, { id, message }]);
      toastTimers.push(setTimeout(() => {
        setErrorToasts(prev => prev.filter(t => t.id !== id));
      }, 6000));
    });

    // Check for first-run onboarding
    const checkOnboarding = async () => {
      try {
        const settings = await window.electronAPI.getSettings();
        if (!settings || !settings.onboardingCompleted) {
          setShowOnboarding(true);
        }
      } catch {
        // If settings fail, don't show onboarding
      }
    };
    checkOnboarding();

    return () => {
      cleanupManualSorting();
      cleanupDeviceSelection();
      cleanupPendingSort();
      cleanupDownloadIntercepted();
      cleanupCredentials();
      cleanupNotify();
      toastTimers.forEach(clearTimeout);
    };
  }, []);

  // Open the sorting dialog for a queued task (chosen from the notification area).
  const openSortTask = (task: any) => {
    setManualSortingFile({
      source: 'pending',
      taskIds: [task.id],
      filename: (task.files && task.files[0]) || 'Unknown file',
      tempPath: (task.filePaths && task.filePaths[0]) || undefined,
      previewData: task.previewData || {},
    });
    setManualSortingOpen(true);
  };

  // Open the sorting dialog once for several selected tasks; the chosen
  // patient/visit is applied to all of them in bulk (issue #137).
  const openSortTasks = (tasks: any[]) => {
    if (!tasks || tasks.length === 0) return;
    if (tasks.length === 1) { openSortTask(tasks[0]); return; }
    const first = tasks[0];
    const totalFiles = tasks.reduce((n, t) => n + ((t.files && t.files.length) || 0), 0);
    setManualSortingFile({
      source: 'pending',
      taskIds: tasks.map(t => t.id),
      bulkCount: tasks.length,
      bulkFileCount: totalFiles,
      filename: (first.files && first.files[0]) || 'Unknown file',
      tempPath: (first.filePaths && first.filePaths[0]) || undefined,
      previewData: first.previewData || {},
    });
    setManualSortingOpen(true);
  };

  const dismissSortTasks = async (taskIds: string[]) => {
    await window.electronAPI.dismissPendingSortTasks(taskIds);
  };

  const handleManualSortingResolve = (decision: any) => {
    window.electronAPI.manualSortingResponse(decision);
    setManualSortingOpen(false);
    setManualSortingFile(null);
  };

  const handleManualSortingCancel = () => {
    // Pending-queue items: closing the dialog just defers — the task stays in
    // the queue, nothing is sent to the watcher (issue #136).
    if (manualSortingFile?.source === 'pending') {
      setManualSortingOpen(false);
      setManualSortingFile(null);
      return;
    }
    const wasRemote = manualSortingFile?.source === 'remote';
    window.electronAPI.manualSortingResponse({ action: 'unmatched' });
    setManualSortingOpen(false);
    setManualSortingFile(null);
    // Re-show BrowserView if cancelling a remote download assignment
    if (wasRemote && currentView === 'webPanel') {
      setInterceptedDownload(null);
      window.electronAPI.webPanelShow();
    }
  };

  const handleDeviceSelectionResolve = (result: any) => {
    window.electronAPI.sendDeviceSelectionResult(result);
    setDeviceSelectionOpen(false);
    setDeviceSelectionFile(null);
  };

  const handleDownloadAssign = () => {
    if (!interceptedDownload) return;
    // Close download dialog and open PatientAssignmentModal with remote source metadata
    setDownloadDialogOpen(false);
    setManualSortingFile({
      fileName: interceptedDownload.filename,
      filePath: interceptedDownload.filePath,
      previewData: {
        patientName: '',
        dob: '',
        date: new Date().toISOString().split('T')[0],
      },
      source: 'remote',
      sourceDomain: interceptedDownload.sourceDomain,
      sourceManufacturer: interceptedDownload.sourceManufacturer,
    });
    setManualSortingOpen(true);
  };

  const handleDownloadDismiss = () => {
    if (interceptedDownload) {
      window.electronAPI.webPanelDismissDownload(interceptedDownload.filePath);
    }
    setDownloadDialogOpen(false);
    setInterceptedDownload(null);
    // Re-show BrowserView if still on web panel
    if (currentView === 'webPanel') {
      window.electronAPI.webPanelShow();
    }
  };

  // Override the manual sorting resolve to handle remote downloads differently
  const handleManualSortingResolveWrapped = (decision: any) => {
    // Pending-queue items resolve through the dedicated pending-sort handler
    // (assign/create patient + visit, or move-to-unmatched) — issue #136.
    if (manualSortingFile?.source === 'pending') {
      window.electronAPI.resolvePendingSortTasks(manualSortingFile.taskIds, decision);
      setManualSortingOpen(false);
      setManualSortingFile(null);
      return;
    }
    if (manualSortingFile?.source === 'remote' && decision.action !== 'unmatched') {
      // Use the web panel assignment flow instead of the watcher flow
      window.electronAPI.webPanelAssignDownload({
        filePath: manualSortingFile.filePath,
        patientId: decision.patientId,
        patientData: decision.action === 'create-patient' ? decision.patientData : undefined,
        visitMode: decision.visitMode || 'new',
        visitId: decision.visitMode === 'existing' ? decision.visitId : undefined,
        visitDate: decision.visitDate || new Date().toISOString().split('T')[0],
        sourceDomain: manualSortingFile.sourceDomain,
        sourceManufacturer: manualSortingFile.sourceManufacturer,
      });
      setManualSortingOpen(false);
      setManualSortingFile(null);
      setInterceptedDownload(null);
      // Re-show BrowserView after remote download assignment
      if (currentView === 'webPanel') {
        window.electronAPI.webPanelShow();
      }
    } else {
      handleManualSortingResolve(decision);
    }
  };

  const handlePatientSelect = (patientId: string) => {
    setCurrentPatientId(patientId);
    setCurrentView('patientDetail');
  };

  const handleBackToDashboard = () => {
    setCurrentPatientId(null);
    setCurrentView('dashboard');
  };

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <PatientDashboard onPatientSelect={handlePatientSelect} />;
      case 'settings':
        return <Settings />;
      case 'news':
        return <DeviceNews />;
      case 'webPanel':
        return <WebPanel />;
      case 'patientDetail':
        if (currentPatientId) {
          return (
            <PatientDetail
              patientId={currentPatientId}
              onBack={handleBackToDashboard}
            />
          );
        }
        return <PatientDashboard onPatientSelect={handlePatientSelect} />;
      default:
        return <PatientDashboard onPatientSelect={handlePatientSelect} />;
    }
  };

  if (showOnboarding) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <AppDialogProvider>
          <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
        </AppDialogProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <AppDialogProvider>
      <PatientProvider>
        <div
          className="flex h-screen bg-background text-foreground overflow-hidden selection:bg-primary/20"
          data-testid="app-container"
        >
          {/* Sidebar */}
          <aside className="w-16 flex flex-col items-center py-6 z-50 glass border-r border-border">
            <nav className="flex flex-col space-y-4 w-full items-center" role="navigation" aria-label="Main navigation">
              <NavItem
                active={currentView === 'dashboard' || currentView === 'patientDetail'}
                onClick={() => setCurrentView('dashboard')}
                icon={<LayoutDashboard className="h-6 w-6" />}
                label="Patient Dashboard"
              />
              <NavItem
                active={currentView === 'news'}
                onClick={() => setCurrentView('news')}
                icon={<Newspaper className="h-6 w-6" />}
                label="Device News"
              />
              <NavItem
                active={currentView === 'webPanel'}
                onClick={() => setCurrentView('webPanel')}
                icon={<Globe className="h-6 w-6" />}
                label="Web Panel"
              />
              <NavItem
                active={currentView === 'settings'}
                onClick={() => setCurrentView('settings')}
                icon={<SettingsIcon className="h-6 w-6" />}
                label="Settings"
              />
            </nav>

            <div className="mt-auto flex flex-col gap-4 items-center">
              <ThemeToggle />
            </div>
          </aside>

          {/* Main Content Area */}
          <main className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-hidden">
              {renderView()}
            </div>
          </main>

          <div style={{ position: 'fixed', top: '0px', right: '0px', zIndex: 100, margin: '4px' }}>
            <NotificationCenter
              pendingSortTasks={pendingSortTasks}
              onSortTask={openSortTask}
              onSortTasks={openSortTasks}
              onDismissSortTasks={dismissSortTasks}
              onOpenChange={(open) => {
              if (currentView === 'webPanel') {
                if (open) window.electronAPI.webPanelHide();
                else window.electronAPI.webPanelShow();
              }
            }} />
          </div>

          {/* Global Modals */}
          <PatientAssignmentModal
            open={manualSortingOpen}
            mode="import"
            sourceItem={manualSortingFile}
            onResolve={handleManualSortingResolveWrapped}
            onCancel={handleManualSortingCancel}
          />

          <DownloadAssignmentDialog
            open={downloadDialogOpen}
            downloadInfo={interceptedDownload}
            onAssign={handleDownloadAssign}
            onDismiss={handleDownloadDismiss}
          />

          <DeviceSelectionModal
            open={deviceSelectionOpen}
            fileInfo={deviceSelectionFile}
            onResolve={handleDeviceSelectionResolve}
          />

          {/* Transient error toasts — errors are also kept in the NotificationCenter */}
          {errorToasts.length > 0 && (
            <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
              {errorToasts.map(toast => (
                <div
                  key={toast.id}
                  className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-background p-3 shadow-lg animate-in slide-in-from-bottom-2"
                  role="alert"
                >
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-xs flex-1 break-words">{toast.message}</p>
                  <button
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => setErrorToasts(prev => prev.filter(t => t.id !== toast.id))}
                    aria-label="Dismiss error"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {credentialPrompt && (
            <CredentialSavePrompt
              domain={credentialPrompt.domain}
              username={credentialPrompt.username}
              onSave={() => {
                window.electronAPI.webPanelSavePendingCredential();
                setCredentialPrompt(null);
                if (currentView === 'webPanel') window.electronAPI.webPanelShow();
              }}
              onDismiss={() => {
                window.electronAPI.webPanelDismissPendingCredential();
                setCredentialPrompt(null);
                if (currentView === 'webPanel') window.electronAPI.webPanelShow();
              }}
            />
          )}
        </div>
      </PatientProvider>
      </AppDialogProvider>
    </ThemeProvider>
  );
};

export default App;

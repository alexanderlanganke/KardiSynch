import React from 'react';
import { useAppContext } from './AppContext';
import PatientDashboard from './PatientDashboard';
import PatientDetail from './PatientDetail';
import Settings from './Settings';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { PatientProvider } from './store/PatientStore';
import { Button } from '@/components/ui/button';
import NotificationCenter from '@/components/NotificationCenter';
import { LayoutDashboard, Moon, Settings as SettingsIcon, Sun, Newspaper, Globe } from 'lucide-react';
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

  // Onboarding State
  const [showOnboarding, setShowOnboarding] = React.useState(false);

  // Web Panel Download Interception State
  const [downloadDialogOpen, setDownloadDialogOpen] = React.useState(false);
  const [interceptedDownload, setInterceptedDownload] = React.useState<any>(null);

  // Credential Save Prompt State
  const [credentialPrompt, setCredentialPrompt] = React.useState<{ domain: string; username: string } | null>(null);

  React.useEffect(() => {
    // Listen for manual sorting requests
    window.electronAPI.onRequestManualSorting((fileInfo) => {
      setManualSortingFile(fileInfo);
      setManualSortingOpen(true);
    });

    // Listen for device selection requests
    window.electronAPI.onDeviceSelectionRequest((fileInfo) => {
      setDeviceSelectionFile(fileInfo);
      setDeviceSelectionOpen(true);
    });

    // Listen for web panel download interceptions
    window.electronAPI.onWebPanelDownloadIntercepted((info) => {
      setInterceptedDownload(info);
      setDownloadDialogOpen(true);
      // Hide the BrowserView so the dialog is visible above the web panel
      window.electronAPI.webPanelHide();
    });

    // Listen for credential detection prompts
    window.electronAPI.onWebPanelCredentialsDetected((info) => {
      setCredentialPrompt(info);
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
  }, []);

  const handleManualSortingResolve = (decision: any) => {
    window.electronAPI.manualSortingResponse(decision);
    setManualSortingOpen(false);
    setManualSortingFile(null);
  };

  const handleManualSortingCancel = () => {
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
    if (manualSortingFile?.source === 'remote' && decision.action !== 'unmatched') {
      // Use the web panel assignment flow instead of the watcher flow
      window.electronAPI.webPanelAssignDownload({
        filePath: manualSortingFile.filePath,
        patientId: decision.patientId,
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
            <NotificationCenter />
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

          {credentialPrompt && (
            <CredentialSavePrompt
              domain={credentialPrompt.domain}
              username={credentialPrompt.username}
              onSave={() => {
                window.electronAPI.webPanelSavePendingCredential();
                setCredentialPrompt(null);
              }}
              onDismiss={() => {
                window.electronAPI.webPanelDismissPendingCredential();
                setCredentialPrompt(null);
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

import React from 'react';
import { useAppContext } from './AppContext';
import PatientDashboard from './PatientDashboard';
import PatientDetail from './PatientDetail';
import Settings from './Settings';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import NotificationCenter from '@/components/NotificationCenter';
import { LayoutDashboard, Moon, Settings as SettingsIcon, Sun, Activity, History, Loader2, Newspaper } from 'lucide-react';
import { cn } from '@/lib/utils';
import icon from './assets/icon.jpg';
import ImportHistory from './ImportHistory';
import ManualSortingModal from './ManualSortingModal';
import DeviceSelectionModal from './components/DeviceSelectionModal';
import DeviceNews from './DeviceNews';


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
        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
    )}
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



// ... (ThemeToggle and NavItem remain the same if not touched by replacement, but we need to supply the imports)

// Since I am replacing the whole file content via tool isn't ideal if I can just edit chunks, 
// but the instruction says "Replace the App component return".
// Let's try to be surgical to avoid re-pasting the ThemeToggle which is fine.

// Actually I will assume the previous chunks are preserved if I target specific lines.
// But to be safe and clean, I will replace the imports and the App component BODY.



const App: React.FC = () => {
  const { currentView, setCurrentView, currentPatientId, setCurrentPatientId } = useAppContext();

  // Manual Sorting State
  const [manualSortingOpen, setManualSortingOpen] = React.useState(false);
  const [manualSortingFile, setManualSortingFile] = React.useState<any>(null);

  // Device Selection State
  const [deviceSelectionOpen, setDeviceSelectionOpen] = React.useState(false);
  const [deviceSelectionFile, setDeviceSelectionFile] = React.useState<any>(null);

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
  }, []);

  const handleManualSortingResolve = (decision: any) => {
    window.electronAPI.manualSortingResponse(decision);
    setManualSortingOpen(false);
    setManualSortingFile(null);
  };

  const handleDeviceSelectionResolve = (result: any) => {
    window.electronAPI.sendDeviceSelectionResult(result);
    setDeviceSelectionOpen(false);
    setDeviceSelectionFile(null);
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
      case 'history':
        return <ImportHistory />;
      case 'news':
        return <DeviceNews />;
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

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <div
        className="flex h-screen bg-background text-foreground overflow-hidden selection:bg-primary/20"
        data-testid="app-container"
      >
        {/* Glassmorphism Sidebar */}
        <aside className="w-16 flex flex-col items-center py-6 z-50 glass border-r border-border/40">
          <div className="mb-8 w-10 h-10 flex items-center justify-center bg-primary/5 rounded-xl">
            <img src={icon} alt="KardiSynch" className="h-6 w-6 object-contain" style={{ width: '1.5rem', height: '1.5rem' }} />
          </div>

          <nav className="flex flex-col space-y-4 w-full items-center">
            <NavItem
              active={currentView === 'dashboard' || currentView === 'patientDetail'}
              onClick={() => setCurrentView('dashboard')}
              icon={<LayoutDashboard className="h-6 w-6" />}
            />
            <NavItem
              active={currentView === 'history'}
              onClick={() => setCurrentView('history')}
              icon={<History className="h-6 w-6" />}
            />
            <NavItem
              active={currentView === 'news'}
              onClick={() => setCurrentView('news')}
              icon={<Newspaper className="h-6 w-6" />}
            />
            <NavItem
              active={currentView === 'settings'}
              onClick={() => setCurrentView('settings')}
              icon={<SettingsIcon className="h-6 w-6" />}
            />
          </nav>

          <div className="mt-auto flex flex-col gap-4 items-center">
            <ThemeToggle />
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-hidden relative flex flex-col">
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 via-transparent to-transparent pointer-events-none" />
          <div className="flex-1 overflow-hidden">
            {renderView()}
          </div>
        </main>

        <div style={{ position: 'fixed', top: '0px', right: '0px', zIndex: 100, margin: '4px' }}>
          <NotificationCenter />
        </div>

        {/* Global Modals */}
        <ManualSortingModal
          open={manualSortingOpen}
          fileInfo={manualSortingFile}
          onResolve={handleManualSortingResolve}
        />

        <DeviceSelectionModal
          open={deviceSelectionOpen}
          fileInfo={deviceSelectionFile}
          onResolve={handleDeviceSelectionResolve}
        />



      </div>
    </ThemeProvider>
  );
};

export default App;

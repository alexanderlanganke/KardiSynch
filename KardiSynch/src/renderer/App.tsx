import React from 'react';
import { useAppContext } from './AppContext';
import PatientDashboard from './PatientDashboard';
import PatientDetail from './PatientDetail';
import Settings from './Settings';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import NotificationArea from './NotificationArea';
import { LayoutDashboard, Moon, Settings as SettingsIcon, Sun, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

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

const App: React.FC = () => {
  const { currentView, setCurrentView, currentPatientId, setCurrentPatientId } = useAppContext();

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
          <div className="mb-8 p-2 bg-primary/5 rounded-2xl">
            <Activity className="h-6 w-6 text-primary animate-pulse" />
          </div>

          <nav className="flex flex-col space-y-4 w-full items-center">
            <NavItem
              active={currentView === 'dashboard'}
              onClick={() => setCurrentView('dashboard')}
              icon={<LayoutDashboard className="h-5 w-5" />}
            />
            <NavItem
              active={currentView === 'settings'}
              onClick={() => setCurrentView('settings')}
              icon={<SettingsIcon className="h-5 w-5" />}
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

        <NotificationArea />
      </div>
    </ThemeProvider>
  );
};

export default App;

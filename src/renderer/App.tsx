import React from 'react';
import { useAppContext } from './AppContext';
import PatientDashboard from './PatientDashboard';
import PatientDetail from './PatientDetail';
import Settings from './Settings';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import NotificationArea from './NotificationArea';
import { LayoutDashboard, Moon, Settings as SettingsIcon, Sun } from 'lucide-react';

const ThemeToggle: React.FC = () => {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
};

const App: React.FC = () => {
  const { currentView, setCurrentView } = useAppContext();

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <PatientDashboard />;
      case 'settings':
        return <Settings />;
      case 'patientDetail':
        return <PatientDetail />;
      default:
        return <PatientDashboard />;
    }
  };

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <div
        className="flex h-screen bg-background text-foreground"
        data-testid="app-container"
      >
        <aside className="w-16 bg-card p-4 border-r flex flex-col items-center">
          <h1 className="text-2xl font-bold mb-8">KS</h1>
          <nav className="flex flex-col space-y-2">
            <Button
              variant={currentView === 'dashboard' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setCurrentView('dashboard')}
            >
              <LayoutDashboard />
            </Button>
            <Button
              variant={currentView === 'settings' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setCurrentView('settings')}
            >
              <SettingsIcon />
            </Button>
          </nav>
          <div className="mt-auto">
            <ThemeToggle />
          </div>
        </aside>
        <main className="flex-1 overflow-auto">{renderView()}</main>
        <NotificationArea />
      </div>
    </ThemeProvider>
  );
};

export default App;

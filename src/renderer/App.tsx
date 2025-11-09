import React from 'react';
import { useAppContext } from './AppContext';
import PatientDashboard from './PatientDashboard';
import PatientDetail from './PatientDetail';
import Settings from './Settings';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import NotificationArea from './NotificationArea';
import { Moon, Sun } from 'lucide-react';

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
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-14 items-center">
            <div className="mr-4 hidden md:flex">
              <a className="mr-6 flex items-center space-x-2" href="/">
                <span className="hidden font-bold sm:inline-block">
                  KardiSynch
                </span>
              </a>
              <nav className="flex items-center space-x-6 text-sm font-medium">
                <Button
                  variant="ghost"
                  onClick={() => setCurrentView('dashboard')}
                  disabled={currentView === 'dashboard'}
                >
                  Dashboard
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setCurrentView('settings')}
                  disabled={currentView === 'settings'}
                >
                  Settings
                </Button>
              </nav>
            </div>
            <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="container flex-1 py-8">{renderView()}</main>
        <NotificationArea />
      </div>
    </ThemeProvider>
  );
};

export default App;

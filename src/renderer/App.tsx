import React from 'react';
import { useAppContext } from './AppContext';
import PatientDashboard from './PatientDashboard';
import PatientDetail from './PatientDetail';
import Settings from './Settings';
import { ThemeProvider } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import NotificationArea from './NotificationArea';

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
      <div className="flex h-screen bg-background text-foreground">
        <aside className="w-64 bg-card p-4 border-r">
          <h1 className="text-2xl font-bold mb-8">KardiSynch</h1>
          <nav className="flex flex-col space-y-2">
            <Button
              variant={currentView === 'dashboard' ? 'secondary' : 'ghost'}
              onClick={() => setCurrentView('dashboard')}
            >
              Dashboard
            </Button>
            <Button
              variant={currentView === 'settings' ? 'secondary' : 'ghost'}
              onClick={() => setCurrentView('settings')}
            >
              Settings
            </Button>
          </nav>
        </aside>
        <main className="flex-1 p-6 overflow-auto">{renderView()}</main>
        <NotificationArea />
      </div>
    </ThemeProvider>
  );
};

export default App;

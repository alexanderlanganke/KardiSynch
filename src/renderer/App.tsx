import React from 'react';
import { useAppContext } from './AppContext';
import PatientDashboard from './PatientDashboard';
import PatientDetail from './PatientDetail';
import Settings from './Settings';

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
    <main>
      <nav>
        <button onClick={() => setCurrentView('dashboard')}>Dashboard</button>
        <button onClick={() => setCurrentView('settings')}>Settings</button>
      </nav>
      {renderView()}
    </main>
  );
};

export default App;

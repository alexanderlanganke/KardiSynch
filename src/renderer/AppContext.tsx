import React, { createContext, useState, useContext } from 'react';

type View = 'dashboard' | 'settings' | 'patientDetail' | 'history' | 'news';

export interface ViewerSlot {
  report: any;
  viewMode: 'pdf' | 'data';
}

interface AppState {
  currentView: View;
  setCurrentView: (view: View) => void;
  currentPatientId: string | null;
  setCurrentPatientId: (id: string | null) => void;
  viewerSlots: (ViewerSlot | null)[];
  setViewerSlots: (slots: (ViewerSlot | null)[]) => void;
}

const AppContext = createContext<AppState | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [currentPatientId, setCurrentPatientId] = useState<string | null>(null);
  const [viewerSlots, setViewerSlots] = useState<(ViewerSlot | null)[]>([null, null, null]);

  return (
    <AppContext.Provider value={{ currentView, setCurrentView, currentPatientId, setCurrentPatientId, viewerSlots, setViewerSlots }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};

import React, { createContext, useContext, useReducer, useCallback } from 'react';

export interface Patient {
  id: string;
  patientId: string;
  hospitalPatientId: string;
  name: string;
  first_name?: string;
  last_name?: string;
  dob: string;
  lastReportDate: string;
  reportCount: number;
  deviceManufacturer?: string;
  deviceModel?: string;
  devices?: any[];
  leads?: any[];
  mriStatus?: { status: string; details: string; timestamp?: string };
  manufacturerWarningStatus?: { status: string; details: string; link?: string; timestamp?: string };
}

export interface Visit {
  id: string;
  directoryName: string;
  interrogation_date: string;
  manufacturer: string;
  files?: string[];
  fileCount?: number;
  // Parsed report data
  batteryStatus?: string;
  batteryVoltage?: string;
  deviceModel?: string;
  deviceSerial?: string;
  leads?: any[];
  measurements?: any;
}

interface PatientState {
  patients: Patient[];
  currentPatient: Patient | null;
  visits: Visit[];
  loading: boolean;
  error: string | null;
}

type PatientAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'LOAD_PATIENTS'; payload: Patient[] }
  | { type: 'SET_CURRENT'; payload: Patient | null }
  | { type: 'LOAD_VISITS'; payload: Visit[] }
  | { type: 'UPDATE_PATIENT'; payload: Patient }
  | { type: 'UPDATE_PATIENT_STATUS'; payload: { patientId: string; field: 'mriStatus' | 'manufacturerWarningStatus'; value: any } }
  | { type: 'CLEAR' };

function patientReducer(state: PatientState, action: PatientAction): PatientState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'LOAD_PATIENTS':
      return { ...state, patients: action.payload, loading: false, error: null };
    case 'SET_CURRENT':
      return { ...state, currentPatient: action.payload };
    case 'LOAD_VISITS':
      return { ...state, visits: action.payload };
    case 'UPDATE_PATIENT': {
      const updated = action.payload;
      return {
        ...state,
        patients: state.patients.map(p => p.id === updated.id ? { ...p, ...updated } : p),
        currentPatient: state.currentPatient?.id === updated.id ? { ...state.currentPatient, ...updated } : state.currentPatient,
      };
    }
    case 'UPDATE_PATIENT_STATUS': {
      const { patientId, field, value } = action.payload;
      return {
        ...state,
        patients: state.patients.map(p => {
          if (p.id === patientId || p.patientId === patientId || p.hospitalPatientId === patientId) {
            return { ...p, [field]: value };
          }
          return p;
        }),
      };
    }
    case 'CLEAR':
      return { patients: [], currentPatient: null, visits: [], loading: false, error: null };
    default:
      return state;
  }
}

interface PatientContextValue extends PatientState {
  dispatch: React.Dispatch<PatientAction>;
  fetchPatients: () => Promise<void>;
  fetchPatientById: (id: string) => Promise<Patient | null>;
  fetchVisits: (patientId: string) => Promise<Visit[]>;
  updatePatient: (data: any) => Promise<void>;
}

const PatientContext = createContext<PatientContextValue | undefined>(undefined);

const initialState: PatientState = {
  patients: [],
  currentPatient: null,
  visits: [],
  loading: false,
  error: null,
};

export const PatientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(patientReducer, initialState);

  const fetchPatients = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const data = await window.electronAPI.getPatientDirectories();
      dispatch({ type: 'LOAD_PATIENTS', payload: data });
    } catch (error) {
      console.error('Error fetching patients:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load patients' });
    }
  }, []);

  const fetchPatientById = useCallback(async (id: string): Promise<Patient | null> => {
    try {
      const patientData = await window.electronAPI.getPatientById(id);
      if (patientData) {
        dispatch({ type: 'SET_CURRENT', payload: patientData });
      }
      return patientData;
    } catch (error) {
      console.error('Failed to load patient:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load patient' });
      return null;
    }
  }, []);

  const fetchVisits = useCallback(async (patientId: string): Promise<Visit[]> => {
    try {
      const visitsData = await window.electronAPI.getVisitDirectories(patientId);
      dispatch({ type: 'LOAD_VISITS', payload: visitsData });
      return visitsData;
    } catch (error) {
      console.error('Failed to load visits:', error);
      return [];
    }
  }, []);

  const updatePatient = useCallback(async (data: any) => {
    await window.electronAPI.updatePatient(data);
    dispatch({ type: 'UPDATE_PATIENT', payload: data });
  }, []);

  return (
    <PatientContext.Provider value={{ ...state, dispatch, fetchPatients, fetchPatientById, fetchVisits, updatePatient }}>
      {children}
    </PatientContext.Provider>
  );
};

export const usePatientStore = () => {
  const context = useContext(PatientContext);
  if (context === undefined) {
    throw new Error('usePatientStore must be used within a PatientProvider');
  }
  return context;
};

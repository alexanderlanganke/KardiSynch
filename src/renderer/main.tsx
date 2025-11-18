import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { AppProvider } from './AppContext';

function mountApp() {
  const target = document.getElementById('app');
  if (!target) {
    console.error('Could not find target element');
    return;
  }
  const root = ReactDOM.createRoot(target);
  root.render(
    <React.StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </React.StrictMode>
  );
}

function waitForElectronAPI() {
  if (window.electronAPI && typeof window.electronAPI.getAllPatients === 'function') {
    mountApp();
  } else {
    // Try again after a short delay
    setTimeout(waitForElectronAPI, 100);
  }
}

// Wait for the DOM to be fully loaded before looking for the API
document.addEventListener('DOMContentLoaded', waitForElectronAPI);

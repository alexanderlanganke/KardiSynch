import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './theme.css';
import { AppProvider } from './AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';

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
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </AppProvider>
    </React.StrictMode>
  );
}

function setupGlobalErrorHandlers() {
  window.onerror = (_message, source, lineno, colno, error) => {
    const msg = error?.message ?? String(_message);
    const stack = error?.stack ?? `at ${source}:${lineno}:${colno}`;
    window.electronAPI?.logRendererError?.({ message: msg, stack, source: 'renderer/onerror' });
  };

  window.onunhandledrejection = (event) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    window.electronAPI?.logRendererError?.({ message: msg, stack, source: 'renderer/unhandledRejection' });
  };
}

function waitForElectronAPI() {
  if (window.electronAPI && typeof window.electronAPI.getAllPatients === 'function') {
    setupGlobalErrorHandlers();
    mountApp();
  } else {
    // Try again after a short delay
    setTimeout(waitForElectronAPI, 100);
  }
}

// Wait for the DOM to be fully loaded before looking for the API
document.addEventListener('DOMContentLoaded', waitForElectronAPI);

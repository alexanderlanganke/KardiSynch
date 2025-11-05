import App from './App.svelte';

function mountApp() {
  const target = document.getElementById('app');
  if (!target) {
    throw new Error('Could not find target element');
  }

  const app = new App({
    target
  });

  return app;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  mountApp();
}

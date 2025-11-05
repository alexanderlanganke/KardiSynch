// e2e/app.spec.ts
import { test, expect, _electron } from '@playwright/test';

test('App launches, displays a window, and renders UI without errors', async () => {
  const electronApp = await _electron.launch({ args: ['.'] });
  const window = await electronApp.firstWindow();

  const pageErrors: Error[] = [];
  window.on('pageerror', (error) => {
    console.error('Renderer Process Error:', error);
    pageErrors.push(error);
  });

  const consoleMessages: string[] = [];
  window.on('console', (msg) => {
    console.log(`Renderer Console: ${msg.text()}`);
    consoleMessages.push(msg.text());
  });

  // Wait for the main Svelte component to be in the DOM
  await window.waitForSelector('main');

  // Check if the Svelte app has rendered content inside the target div
  const appContent = await window.locator('#app').innerHTML();
  expect(appContent).not.toBe('');

  await electronApp.close();

  // Assert that there were no page errors
  expect(pageErrors).toHaveLength(0);

  // Assert that there were no critical console errors
  const hasCriticalError = consoleMessages.some(msg =>
    msg.includes('Failed to load') ||
    msg.includes('Uncaught') ||
    msg.includes('Error')
  );
  expect(hasCriticalError).toBe(false);
});

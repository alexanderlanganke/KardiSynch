// e2e/app.spec.ts
import { test, expect, _electron } from '@playwright/test';

test('App launches and displays a window', async () => {
  const electronApp = await _electron.launch({ args: ['.'] });
  const window = await electronApp.firstWindow();
  await window.waitForSelector('body');
  expect(await window.isVisible('body')).toBe(true);
  await electronApp.close();
});

/**
 * Preload script for the Web Panel BrowserView.
 * Runs in an isolated context (contextIsolation: true, sandbox: true).
 * Detects credential submissions on login forms and notifies main process.
 */
import { ipcRenderer } from 'electron';

function getDomain(): string {
  try {
    return window.location.hostname;
  } catch {
    return '';
  }
}

/**
 * Find the closest password input and a likely username input near it.
 * Returns null if no password field is found or it's empty.
 */
function extractCredentials(): { domain: string; username: string; password: string } | null {
  const passwordInputs = Array.from(
    document.querySelectorAll('input[type="password"]:not([aria-hidden="true"])')
  ) as HTMLInputElement[];

  for (let i = 0; i < passwordInputs.length; i++) {
    const pwInput = passwordInputs[i];
    const password = pwInput.value;
    if (!password) continue;

    // Walk up to find a container (form or ancestor) that also has a text/email input
    const container = pwInput.closest('form') || pwInput.closest('[class*="login"]') || pwInput.parentElement?.parentElement?.parentElement?.parentElement;
    if (!container) continue;

    // Look for username/email fields: text, email, or tel inputs
    const candidates = Array.from(
      container.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])')
    ) as HTMLInputElement[];

    let username = '';
    for (let j = 0; j < candidates.length; j++) {
      const candidate = candidates[j];
      // Skip hidden or irrelevant inputs
      if (candidate.offsetParent === null) continue;
      const name = (candidate.name || candidate.id || candidate.autocomplete || '').toLowerCase();
      if (name.includes('search') || name.includes('captcha')) continue;
      if (candidate.value) {
        username = candidate.value;
        break;
      }
    }

    if (username && password) {
      return { domain: getDomain(), username, password };
    }
  }

  return null;
}

let lastSentCredentials = '';

function trySendCredentials() {
  const creds = extractCredentials();
  if (!creds) return;

  // Deduplicate — don't send the same credentials repeatedly
  const key = `${creds.domain}:${creds.username}:${creds.password}`;
  if (key === lastSentCredentials) return;
  lastSentCredentials = key;

  ipcRenderer.send('web-panel-credentials-detected', creds);
}

// 1. Standard form submission
document.addEventListener('submit', (e) => {
  // Small delay to ensure values are set before form clears
  const form = e.target as HTMLFormElement;
  if (form.querySelector('input[type="password"]')) {
    trySendCredentials();
  }
}, true); // capture phase

// 2. Button/anchor click near password fields (SPA login pattern)
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target) return;

  // Check if the clicked element is a button, input[submit], or a link
  const clickable = target.closest('button, input[type="submit"], a, [role="button"]');
  if (!clickable) return;

  // Check if there's a visible password field on the page
  const passwordInputs = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
  const hasVisiblePassword = Array.from(passwordInputs).some(
    (inp) => inp.offsetParent !== null && inp.value
  );
  if (!hasVisiblePassword) return;

  // Filter: only trigger for elements that look like login/submit buttons
  const text = (clickable.textContent || '').toLowerCase().trim();
  const ariaLabel = (clickable.getAttribute('aria-label') || '').toLowerCase();
  const id = (clickable.id || '').toLowerCase();
  const className = (clickable.className || '').toString().toLowerCase();

  const loginKeywords = ['log in', 'login', 'sign in', 'signin', 'submit', 'continue', 'next', 'anmelden', 'einloggen', 'connexion'];
  const isLoginButton = loginKeywords.some(
    (kw) => text.includes(kw) || ariaLabel.includes(kw) || id.includes(kw) || className.includes(kw)
  );

  // Also trigger for any submit-type button
  const isSubmit = clickable.matches('input[type="submit"]') ||
    (clickable as HTMLButtonElement).type === 'submit';

  if (isLoginButton || isSubmit) {
    // Small delay to let any JS handlers process first
    setTimeout(() => trySendCredentials(), 100);
  }
}, true);

// 3. Enter key in password field
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const target = e.target as HTMLInputElement;
  if (target?.type === 'password' && target.value) {
    setTimeout(() => trySendCredentials(), 100);
  }
}, true);

// Listen for auto-fill requests from main process
ipcRenderer.on('web-panel-autofill', (_event, { username, password }: { username: string; password: string }) => {
  const passwordInputs = Array.from(
    document.querySelectorAll('input[type="password"]')
  ) as HTMLInputElement[];

  for (let i = 0; i < passwordInputs.length; i++) {
    const pwInput = passwordInputs[i];
    if (pwInput.offsetParent === null) continue; // skip hidden

    // Find the container and username field
    const container = pwInput.closest('form') || pwInput.closest('[class*="login"]') || pwInput.parentElement?.parentElement?.parentElement?.parentElement;
    if (!container) continue;

    const candidates = Array.from(
      container.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])')
    ) as HTMLInputElement[];

    for (let j = 0; j < candidates.length; j++) {
      const candidate = candidates[j];
      if (candidate.offsetParent === null) continue;
      const name = (candidate.name || candidate.id || candidate.autocomplete || '').toLowerCase();
      if (name.includes('search') || name.includes('captcha')) continue;

      // Set values using native input value setter to trigger React/Angular change detection
      setNativeValue(candidate, username);
      candidate.dispatchEvent(new Event('input', { bubbles: true }));
      candidate.dispatchEvent(new Event('change', { bubbles: true }));
      break;
    }

    setNativeValue(pwInput, password);
    pwInput.dispatchEvent(new Event('input', { bubbles: true }));
    pwInput.dispatchEvent(new Event('change', { bubbles: true }));
    break;
  }
});

/**
 * Use the native HTMLInputElement value setter to bypass framework getters/setters.
 * This is necessary for React/Angular controlled inputs.
 */
function setNativeValue(el: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'value'
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }
}

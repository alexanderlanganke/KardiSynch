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
 * Searches broadly: first tries form ancestor, then walks progressively up the DOM.
 */
function extractCredentials(): { domain: string; username: string; password: string } | null {
  const passwordInputs = Array.from(
    document.querySelectorAll('input[type="password"]')
  ) as HTMLInputElement[];

  for (let i = 0; i < passwordInputs.length; i++) {
    const pwInput = passwordInputs[i];
    if (pwInput.offsetParent === null) continue; // skip hidden
    const password = pwInput.value;
    if (!password) continue;

    // Try progressively larger scopes to find the username input
    const username = findUsernameNear(pwInput);

    if (username && password) {
      return { domain: getDomain(), username, password };
    }
  }

  return null;
}

/**
 * Search for a username/email input near the given password input.
 * Tries: form > progressively higher ancestors > entire document.
 */
function findUsernameNear(pwInput: HTMLInputElement): string {
  // Strategy 1: Look inside the closest <form>
  const form = pwInput.closest('form');
  if (form) {
    const val = findTextInputValue(form);
    if (val) return val;
  }

  // Strategy 2: Walk up the DOM tree, checking each ancestor
  let ancestor: HTMLElement | null = pwInput.parentElement;
  for (let depth = 0; depth < 10 && ancestor; depth++) {
    const val = findTextInputValue(ancestor);
    if (val) return val;
    ancestor = ancestor.parentElement;
  }

  // Strategy 3: Fall back to searching the entire page
  return findTextInputValue(document.body) || '';
}

/**
 * Find the first visible, non-empty text/email/tel input within a container.
 */
function findTextInputValue(container: Element): string {
  const candidates = Array.from(
    container.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]')
  ) as HTMLInputElement[];

  for (let j = 0; j < candidates.length; j++) {
    const candidate = candidates[j];
    if (candidate.offsetParent === null) continue; // skip hidden
    if (candidate.type === 'password') continue;
    const nameId = (candidate.name || candidate.id || candidate.autocomplete || '').toLowerCase();
    if (nameId.includes('search') || nameId.includes('captcha') || nameId.includes('token')) continue;
    if (candidate.value.trim()) {
      return candidate.value.trim();
    }
  }
  return '';
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
  const form = e.target as HTMLFormElement;
  if (form && form.querySelector('input[type="password"]')) {
    trySendCredentials();
  }
}, true); // capture phase

// 2. Any button/link click when a password field is filled (catches SPA logins)
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target) return;

  // Check if the clicked element is or is within a button, link, or clickable
  const clickable = target.closest('button, input[type="submit"], a, [role="button"], [type="submit"]');
  if (!clickable) return;

  // Check if there's a visible password field with a value anywhere on the page
  const passwordInputs = Array.from(
    document.querySelectorAll('input[type="password"]')
  ) as HTMLInputElement[];
  const hasFilledPassword = passwordInputs.some(
    (inp) => inp.offsetParent !== null && inp.value
  );
  if (!hasFilledPassword) return;

  // Trigger for ANY button click when password field is filled — don't filter by keywords.
  // SPA login forms use diverse button labels across languages and frameworks.
  setTimeout(() => trySendCredentials(), 200);
}, true);

// 3. Enter key in password field
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const target = e.target as HTMLInputElement;
  if (target?.type === 'password' && target.value) {
    setTimeout(() => trySendCredentials(), 200);
  }
}, true);

// 4. XHR interception — catch AJAX-based login submissions
(function interceptXHR() {
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL) {
    (this as any)._credMethod = method;
    (this as any)._credUrl = String(url);
    return origOpen.apply(this, arguments as any);
  };

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    if ((this as any)._credMethod?.toUpperCase() === 'POST') {
      const bodyStr = typeof body === 'string' ? body : '';
      if (bodyStr.includes('password') || bodyStr.includes('Password') || bodyStr.includes('passwd')) {
        setTimeout(() => trySendCredentials(), 300);
      }
    }
    return origSend.call(this, body);
  };
})();

// Listen for auto-fill requests from main process
ipcRenderer.on('web-panel-autofill', (_event, { username, password }: { username: string; password: string }) => {
  // Delay slightly to allow SPA page rendering to complete
  setTimeout(() => fillCredentials(username, password), 500);
  // Retry after 2s for pages that render login forms lazily
  setTimeout(() => fillCredentials(username, password), 2000);
});

function fillCredentials(username: string, password: string) {
  const passwordInputs = Array.from(
    document.querySelectorAll('input[type="password"]')
  ) as HTMLInputElement[];

  for (let i = 0; i < passwordInputs.length; i++) {
    const pwInput = passwordInputs[i];
    if (pwInput.offsetParent === null) continue; // skip hidden
    if (pwInput.value) continue; // already filled

    // Find username field using the same broad search
    const form = pwInput.closest('form');
    const container = form || pwInput.parentElement?.parentElement?.parentElement?.parentElement || document.body;

    const candidates = Array.from(
      container.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]')
    ) as HTMLInputElement[];

    for (let j = 0; j < candidates.length; j++) {
      const candidate = candidates[j];
      if (candidate.offsetParent === null) continue;
      const nameId = (candidate.name || candidate.id || candidate.autocomplete || '').toLowerCase();
      if (nameId.includes('search') || nameId.includes('captcha')) continue;

      setNativeValue(candidate, username);
      candidate.dispatchEvent(new Event('input', { bubbles: true }));
      candidate.dispatchEvent(new Event('change', { bubbles: true }));
      candidate.dispatchEvent(new Event('blur', { bubbles: true }));
      break;
    }

    setNativeValue(pwInput, password);
    pwInput.dispatchEvent(new Event('input', { bubbles: true }));
    pwInput.dispatchEvent(new Event('change', { bubbles: true }));
    pwInput.dispatchEvent(new Event('blur', { bubbles: true }));
    break;
  }
}

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

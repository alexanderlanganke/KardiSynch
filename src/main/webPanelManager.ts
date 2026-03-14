import { BrowserView, BrowserWindow, app, ipcMain, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { getMainWindow } from './windowManager';
import { CredentialStore } from './credentialStore';

const SIDEBAR_WIDTH = 64;
const NAV_BAR_HEIGHT = 88; // nav bar + bookmark bar

const DEBUG = process.env.NODE_ENV === 'development';
function dbg(...args: any[]) { if (DEBUG) console.log('[WebPanel DEBUG]', ...args); }

// JS snippet: extract username + password from the current page
const EXTRACT_CREDENTIALS_JS = `
(function() {
  var pw = null;
  var pwFields = document.querySelectorAll('input[type="password"]');
  for (var i = 0; i < pwFields.length; i++) {
    if (pwFields[i].offsetParent !== null && pwFields[i].value) {
      pw = pwFields[i];
      break;
    }
  }
  if (!pw) return null;

  var username = '';
  var inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]');
  for (var j = 0; j < inputs.length; j++) {
    var inp = inputs[j];
    if (inp.offsetParent === null) continue;
    var n = (inp.name || inp.id || '').toLowerCase();
    if (n.indexOf('search') >= 0 || n.indexOf('captcha') >= 0) continue;
    if (inp.value && inp.value.trim()) { username = inp.value.trim(); break; }
  }

  return { username: username, password: pw.value, domain: window.location.hostname };
})()
`;

// JS snippet: fill username and password fields
function makeAutoFillJS(username: string, password: string): string {
  // Escape for injection into JS string literals
  const u = username.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const p = password.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `
(function() {
  function setVal(el, val) {
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (setter && setter.set) { setter.set.call(el, val); } else { el.value = val; }
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
    el.dispatchEvent(new Event('blur', {bubbles:true}));
  }

  var pwFields = document.querySelectorAll('input[type="password"]');
  for (var i = 0; i < pwFields.length; i++) {
    var pw = pwFields[i];
    if (pw.offsetParent === null || pw.value) continue;

    setVal(pw, '${p}');

    var inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]');
    for (var j = 0; j < inputs.length; j++) {
      var inp = inputs[j];
      if (inp.offsetParent === null) continue;
      var n = (inp.name || inp.id || '').toLowerCase();
      if (n.indexOf('search') >= 0 || n.indexOf('captcha') >= 0) continue;
      setVal(inp, '${u}');
      break;
    }
    break;
  }
})()
`;
}

class WebPanelManager {
  private static instance: WebPanelManager;
  private view: BrowserView | null = null;
  private attached = false;
  private resizeHandler: (() => void) | null = null;
  private pendingCredential: { domain: string; username: string; password: string } | null = null;
  private pendingCredentialTimer: ReturnType<typeof setTimeout> | null = null;
  // Track username across multi-step login flows
  private lastSeenUsername: string = '';
  private lastSeenDomain: string = '';

  static getInstance(): WebPanelManager {
    if (!WebPanelManager.instance) {
      WebPanelManager.instance = new WebPanelManager();
    }
    return WebPanelManager.instance;
  }

  private ensureView(mainWindow: BrowserWindow): BrowserView {
    if (this.view) return this.view;

    const ses = session.fromPartition('persist:webpanel');

    this.view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: 'persist:webpanel',
      },
    });

    const wc = this.view.webContents;

    // Push URL changes to renderer
    const sendUrl = () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('web-panel-url-updated', wc.getURL());
      }
    };
    wc.on('did-navigate', sendUrl);
    wc.on('did-navigate-in-page', sendUrl);

    // Push loading state
    wc.on('did-start-loading', () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('web-panel-loading', true);
    });
    wc.on('did-stop-loading', () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('web-panel-loading', false);
    });

    // Push title updates
    wc.on('page-title-updated', (_e, title) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('web-panel-title-updated', title);
    });

    // Handle new-window requests
    wc.setWindowOpenHandler(({ url }) => {
      dbg('setWindowOpenHandler() url:', url.substring(0, 150), 'current page:', wc.getURL().substring(0, 80));
      if (url.startsWith('blob:')) {
        dbg('setWindowOpenHandler() allowing blob URL');
        return { action: 'allow' };
      }
      // Allow popups from whitelisted domains (CareLink PDF popups)
      if (this.isWhitelistedContext(wc.getURL(), url)) {
        console.log('[WebPanel] Allowing popup:', url.substring(0, 120));
        dbg('setWindowOpenHandler() whitelisted context, allowing popup');
        return { action: 'allow' };
      }
      // Non-whitelisted — navigate in the same view
      dbg('setWindowOpenHandler() not whitelisted, denying popup and navigating in-view');
      if (url.startsWith('http:') || url.startsWith('https:')) {
        wc.loadURL(url);
      }
      return { action: 'deny' };
    });

    // Intercept child windows
    wc.on('did-create-window', (childWindow) => {
      this.handleChildWindow(childWindow);
    });

    // Download interception on the session
    this.setupDownloadInterception(ses);

    // Credential detection — uses executeJavaScript, no preload needed
    this.setupCredentialDetection(wc);

    // Auto-fill saved credentials on page load
    this.setupAutoFill(wc);

    // PDF response interception on the BrowserView itself
    this.setupPdfResponseInterception(ses, wc);

    // Register IPC handlers (once)
    this.registerIpcHandlers();

    return this.view;
  }

  // ─── Credential Detection (main-process only, no preload) ──────

  private setupCredentialDetection(wc: Electron.WebContents) {
    dbg('setupCredentialDetection() registering will-navigate + did-navigate listeners');
    // Before each navigation, try to grab credentials from the current page.
    // This catches form POSTs (ASP.NET postback, standard forms, SPA navigations).
    wc.on('will-navigate', (_event, url) => {
      dbg('will-navigate fired, url:', url.substring(0, 120));
      this.tryExtractCredentials(wc);
    });

    // Also try on did-navigate: if the page had a username but no password
    // (multi-step login step 1), remember the username for step 2.
    wc.on('did-navigate', (_event, url) => {
      dbg('did-navigate fired, url:', url.substring(0, 120), '— scheduling credential extraction in 1500ms');
      // After navigation, check if the new page has a password field
      // with no username — use the remembered username from step 1.
      setTimeout(() => this.tryExtractCredentials(wc), 1500);
    });
  }

  private async tryExtractCredentials(wc: Electron.WebContents) {
    const pageUrl = wc.getURL();
    dbg('tryExtractCredentials() page:', pageUrl.substring(0, 120));
    try {
      const result = await wc.executeJavaScript(EXTRACT_CREDENTIALS_JS);
      dbg('tryExtractCredentials() EXTRACT_CREDENTIALS_JS returned:', result
        ? { username: result.username, domain: result.domain, hasPassword: !!result.password, passwordLength: result.password?.length }
        : null);
      if (!result) {
        // No password field found. Check if there's a username field to remember.
        dbg('tryExtractCredentials() no password field found, checking for username-only field');
        const usernameOnly = await wc.executeJavaScript(`
          (function() {
            var inputs = document.querySelectorAll('input[type="text"], input[type="email"]');
            var debugInfo = [];
            for (var i = 0; i < inputs.length; i++) {
              var inp = inputs[i];
              debugInfo.push({
                type: inp.type,
                name: inp.name || '',
                id: inp.id || '',
                visible: inp.offsetParent !== null,
                hasValue: !!(inp.value && inp.value.trim()),
                valueLength: (inp.value || '').length
              });
              if (inp.offsetParent !== null && inp.value && inp.value.trim()) {
                return { username: inp.value.trim(), fields: debugInfo };
              }
            }
            return { username: null, fields: debugInfo };
          })()
        `);
        dbg('tryExtractCredentials() username-only scan:', JSON.stringify(usernameOnly));
        if (usernameOnly?.username) {
          this.lastSeenUsername = usernameOnly.username;
          try { this.lastSeenDomain = new URL(wc.getURL()).hostname; } catch { /* noop */ }
          console.log('[WebPanel] Remembered username for multi-step login:', usernameOnly.username);
          dbg('tryExtractCredentials() stored lastSeenUsername:', this.lastSeenUsername, 'lastSeenDomain:', this.lastSeenDomain);
        } else {
          dbg('tryExtractCredentials() no username field with value found on page');
        }
        return;
      }

      let { username, password, domain } = result;
      dbg('tryExtractCredentials() extracted — username:', username || '(empty)',
        'password length:', password?.length || 0, 'domain:', domain);

      // For multi-step logins: if no username on current page, use remembered one
      if (!username && this.lastSeenUsername && domain === this.lastSeenDomain) {
        username = this.lastSeenUsername;
        console.log('[WebPanel] Using remembered username from step 1:', username);
        dbg('tryExtractCredentials() using remembered username:', username);
      }

      if (!username || !password || !domain) {
        dbg('tryExtractCredentials() ABORTED: missing field(s) — username:', !!username, 'password:', !!password, 'domain:', !!domain);
        return;
      }

      console.log('[WebPanel] Credentials detected for:', domain, username);

      const store = CredentialStore.getInstance();
      if (!store.isAvailable()) {
        dbg('tryExtractCredentials() ABORTED: CredentialStore not available');
        return;
      }

      // Check if already saved
      const existing = store.get(domain);
      dbg('tryExtractCredentials() existing credentials for domain:', existing.length,
        'matching username+password:', existing.some((c) => c.username === username && c.password === password));
      if (existing.some((c) => c.username === username && c.password === password)) {
        dbg('tryExtractCredentials() credential already saved, skipping prompt');
        return;
      }

      // Show "Save password?" prompt in renderer
      dbg('tryExtractCredentials() setting pendingCredential and sending web-panel-credentials-detected to renderer');
      this.pendingCredential = { domain, username, password };
      if (this.pendingCredentialTimer) clearTimeout(this.pendingCredentialTimer);
      this.pendingCredentialTimer = setTimeout(() => {
        dbg('tryExtractCredentials() pendingCredential timed out after 60s');
        this.pendingCredential = null;
        this.pendingCredentialTimer = null;
      }, 60000);

      const win = getMainWindow();
      dbg('tryExtractCredentials() mainWindow exists:', !!win, 'destroyed:', win?.isDestroyed());
      if (win && !win.isDestroyed()) {
        win.webContents.send('web-panel-credentials-detected', { domain, username });
        dbg('tryExtractCredentials() sent web-panel-credentials-detected IPC');
      }
    } catch (err) {
      // Page might have navigated away already — ignore
      dbg('tryExtractCredentials() ERROR (page may have navigated away):', err);
    }
  }

  // ─── Auto-Fill ─────────────────────────────────────────────────

  private setupAutoFill(wc: Electron.WebContents) {
    dbg('setupAutoFill() registering did-finish-load listener');
    wc.on('did-finish-load', () => {
      const url = wc.getURL();
      dbg('setupAutoFill() did-finish-load fired, url:', url.substring(0, 120));

      const store = CredentialStore.getInstance();
      if (!store.isAvailable()) {
        dbg('setupAutoFill() ABORTED: CredentialStore not available');
        return;
      }

      let domain = '';
      try { domain = new URL(url).hostname; } catch { dbg('setupAutoFill() ABORTED: could not parse URL'); return; }

      dbg('setupAutoFill() looking up credentials for domain:', domain);
      const creds = store.get(domain);
      dbg('setupAutoFill() found', creds.length, 'credentials for', domain);
      if (creds.length === 0) return;

      const { username, password } = creds[0];
      dbg('setupAutoFill() auto-filling with username:', username, 'password length:', password.length);
      const js = makeAutoFillJS(username, password);

      // Try immediately, then again after 1.5s for SPA-rendered forms
      wc.executeJavaScript(js).then(() => {
        dbg('setupAutoFill() immediate injection executed');
      }).catch((err) => {
        dbg('setupAutoFill() immediate injection failed:', err);
      });
      setTimeout(() => {
        if (this.view && !this.view.webContents.isDestroyed()) {
          dbg('setupAutoFill() retrying auto-fill after 1.5s delay');
          wc.executeJavaScript(js).then(() => {
            dbg('setupAutoFill() delayed injection executed');
          }).catch((err) => {
            dbg('setupAutoFill() delayed injection failed:', err);
          });
        }
      }, 1500);
    });
  }

  // ─── IPC Handlers (registered once) ────────────────────────────

  private ipcRegistered = false;
  private registerIpcHandlers() {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;

    ipcMain.handle('web-panel-save-pending-credential', async () => {
      dbg('IPC web-panel-save-pending-credential received, pendingCredential:',
        this.pendingCredential ? { domain: this.pendingCredential.domain, username: this.pendingCredential.username, passwordLength: this.pendingCredential.password?.length } : null);
      if (this.pendingCredential) {
        const { domain, username, password } = this.pendingCredential;
        try {
          CredentialStore.getInstance().save(domain, username, password);
          dbg('IPC web-panel-save-pending-credential: save() completed');
        } catch (err) {
          dbg('IPC web-panel-save-pending-credential: save() FAILED:', err);
          console.error('[WebPanel] Failed to save credential:', err);
        }
        this.pendingCredential = null;
        if (this.pendingCredentialTimer) {
          clearTimeout(this.pendingCredentialTimer);
          this.pendingCredentialTimer = null;
        }
      } else {
        dbg('IPC web-panel-save-pending-credential: no pending credential to save!');
      }
    });

    ipcMain.handle('web-panel-dismiss-pending-credential', async () => {
      dbg('IPC web-panel-dismiss-pending-credential received, had pending:', !!this.pendingCredential);
      this.pendingCredential = null;
      if (this.pendingCredentialTimer) {
        clearTimeout(this.pendingCredentialTimer);
        this.pendingCredentialTimer = null;
      }
    });
  }

  // ─── PDF Interception ──────────────────────────────────────────

  /**
   * Intercept PDF responses on the BrowserView session itself.
   * When the BrowserView navigates to a URL that returns application/pdf,
   * Chromium renders it in its built-in PDF viewer — no download event fires.
   * We detect this via webRequest and extract the PDF.
   */
  private setupPdfResponseInterception(ses: Electron.Session, wc: Electron.WebContents) {
    dbg('setupPdfResponseInterception() registering onHeadersReceived listener');
    ses.webRequest.onHeadersReceived((details, callback) => {
      const contentType = (
        details.responseHeaders?.['content-type'] ||
        details.responseHeaders?.['Content-Type'] ||
        []
      )[0] || '';

      // Log all mainFrame responses in debug mode for visibility
      if (details.resourceType === 'mainFrame') {
        dbg('onHeadersReceived mainFrame — url:', details.url.substring(0, 120),
          'content-type:', contentType, 'status:', details.statusCode);
      }

      if (contentType.includes('application/pdf') && details.resourceType === 'mainFrame') {
        console.log('[WebPanel] PDF response detected in main frame:', details.url.substring(0, 120));

        // Determine source domain
        let sourceDomain = '';
        try { sourceDomain = new URL(details.url).hostname; } catch { /* noop */ }
        if (!sourceDomain) {
          try { sourceDomain = new URL(wc.getURL()).hostname; } catch { /* noop */ }
        }
        dbg('PDF interception — sourceDomain:', sourceDomain);

        const config = this.loadDownloadConfig();
        const whitelisted = this.isDomainWhitelisted(sourceDomain, config);
        dbg('PDF interception — whitelisted:', whitelisted,
          'configured domains:', config.remote_monitoring_domains);
        if (whitelisted) {
          // Fetch the PDF bytes and intercept
          this.interceptPdfFromUrl(details.url, sourceDomain, wc, config);
        } else {
          dbg('PDF interception SKIPPED: domain', sourceDomain, 'not in whitelist');
        }
      }

      callback({ cancel: false });
    });
  }

  private async interceptPdfFromUrl(pdfUrl: string, sourceDomain: string, wc: Electron.WebContents, config: any) {
    dbg('interceptPdfFromUrl() url:', pdfUrl.substring(0, 150), 'domain:', sourceDomain);
    try {
      // Wait for the page to finish loading the PDF
      dbg('interceptPdfFromUrl() waiting 1000ms for page load');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Fetch the PDF bytes using the webContents' session cookies
      dbg('interceptPdfFromUrl() executing fetch() in renderer context with credentials: include');
      const pdfBytes = await wc.executeJavaScript(`
        (async function() {
          try {
            var resp = await fetch('${pdfUrl.replace(/'/g, "\\'")}', { credentials: 'include' });
            console.log('[WebPanel DEBUG fetch] status:', resp.status, 'content-type:', resp.headers.get('content-type'), 'url:', resp.url.substring(0, 100));
            var buf = await resp.arrayBuffer();
            console.log('[WebPanel DEBUG fetch] received', buf.byteLength, 'bytes, first 5 chars:', new TextDecoder().decode(buf.slice(0, 5)));
            return Array.from(new Uint8Array(buf));
          } catch(e) {
            console.error('[WebPanel DEBUG fetch] error:', e.message);
            return null;
          }
        })()
      `).then((arr: number[] | null) => arr ? Buffer.from(arr) : null);

      dbg('interceptPdfFromUrl() fetch result:',
        pdfBytes ? `${pdfBytes.length} bytes, magic: "${pdfBytes.slice(0, 5).toString('ascii')}"` : 'null');

      if (pdfBytes && pdfBytes.length > 4 && pdfBytes.slice(0, 5).toString('ascii').startsWith('%PDF')) {
        dbg('interceptPdfFromUrl() valid PDF, saving and notifying');
        this.savePdfAndNotify(pdfBytes, sourceDomain, config);
        // Navigate back so the user isn't stuck on the PDF viewer
        if (wc.canGoBack()) wc.goBack();
      } else {
        console.log('[WebPanel] Failed to extract PDF from inline response');
        dbg('interceptPdfFromUrl() FAILED: not a valid PDF —',
          pdfBytes ? `got ${pdfBytes.length} bytes, first 20 chars: "${pdfBytes.slice(0, 20).toString('ascii')}"` : 'null response');
      }
    } catch (err) {
      console.error('[WebPanel] PDF inline interception error:', err);
      dbg('interceptPdfFromUrl() ERROR:', err);
    }
  }

  private handleChildWindow(childWindow: BrowserWindow) {
    childWindow.hide();

    const childWc = childWindow.webContents;
    const parentUrl = this.view?.webContents.getURL() || '';
    let handled = false;

    console.log('[WebPanel] Child window created, parent URL:', parentUrl);
    dbg('handleChildWindow() parent URL:', parentUrl);

    childWc.on('did-finish-load', async () => {
      if (handled) { dbg('handleChildWindow() did-finish-load: already handled, skipping'); return; }
      const url = childWc.getURL();
      console.log('[WebPanel] Child window loaded:', url.substring(0, 120));

      const sourceDomain = this.resolveChildDomain(url, parentUrl);
      const config = this.loadDownloadConfig();
      dbg('handleChildWindow() child url:', url.substring(0, 150),
        'sourceDomain:', sourceDomain, 'parentUrl domain:', (() => { try { return new URL(parentUrl).hostname; } catch { return '(parse error)'; } })());

      if (!this.isDomainWhitelisted(sourceDomain, config)) {
        console.log('[WebPanel] Child window domain not whitelisted:', sourceDomain);
        dbg('handleChildWindow() domain NOT whitelisted:', sourceDomain,
          'whitelist:', config.remote_monitoring_domains);
        childWindow.close();
        return;
      }
      dbg('handleChildWindow() domain whitelisted, attempting PDF extraction');

      try {
        let pdfBytes: Buffer | null = null;

        if (url.startsWith('blob:')) {
          dbg('handleChildWindow() blob URL detected, fetching blob content');
          // Blob URL: fetch directly
          pdfBytes = await childWc.executeJavaScript(`
            (async function() {
              console.log('[WebPanel DEBUG child-blob] fetching:', window.location.href);
              var resp = await fetch(window.location.href);
              console.log('[WebPanel DEBUG child-blob] status:', resp.status, 'type:', resp.headers.get('content-type'));
              var buf = await resp.arrayBuffer();
              console.log('[WebPanel DEBUG child-blob] bytes:', buf.byteLength);
              return Array.from(new Uint8Array(buf));
            })()
          `).then((arr: number[]) => Buffer.from(arr));
          dbg('handleChildWindow() blob fetch result:', pdfBytes?.length, 'bytes');
        } else {
          dbg('handleChildWindow() HTTPS URL, trying fetch with credentials');
          // HTTPS URL: try fetching raw PDF, then fall back to printToPDF
          const raw = await childWc.executeJavaScript(`
            (async function() {
              try {
                var resp = await fetch(window.location.href, { credentials: 'include' });
                var ct = resp.headers.get('content-type') || '';
                console.log('[WebPanel DEBUG child-fetch] status:', resp.status, 'content-type:', ct, 'url:', resp.url.substring(0, 100));
                if (ct.indexOf('pdf') >= 0 || ct.indexOf('octet') >= 0) {
                  var buf = await resp.arrayBuffer();
                  console.log('[WebPanel DEBUG child-fetch] got', buf.byteLength, 'bytes');
                  return Array.from(new Uint8Array(buf));
                }
                console.log('[WebPanel DEBUG child-fetch] content-type not pdf/octet, skipping');
              } catch(e) {
                console.error('[WebPanel DEBUG child-fetch] error:', e.message);
              }
              return null;
            })()
          `).then((arr: number[] | null) => arr ? Buffer.from(arr) : null);

          dbg('handleChildWindow() raw fetch result:', raw ? `${raw.length} bytes` : 'null');
          if (!raw) {
            dbg('handleChildWindow() falling back to printToPDF()');
          }
          pdfBytes = raw || await childWc.printToPDF({});
          dbg('handleChildWindow() final pdfBytes:', pdfBytes?.length, 'bytes',
            pdfBytes ? `magic: "${pdfBytes.slice(0, 5).toString('ascii')}"` : '');
        }

        if (pdfBytes && pdfBytes.length > 4 && pdfBytes.slice(0, 5).toString('ascii').startsWith('%PDF')) {
          handled = true;
          dbg('handleChildWindow() valid PDF detected, saving');
          this.savePdfAndNotify(pdfBytes, sourceDomain, config);
        } else if (pdfBytes && pdfBytes.length > 100) {
          // printToPDF always produces valid PDF
          handled = true;
          dbg('handleChildWindow() printToPDF result (>100 bytes), saving');
          this.savePdfAndNotify(pdfBytes, sourceDomain, config);
        } else {
          dbg('handleChildWindow() PDF extraction FAILED: bytes:', pdfBytes?.length,
            pdfBytes ? `first 20: "${pdfBytes.slice(0, 20).toString('ascii')}"` : 'null');
        }
      } catch (err) {
        console.error('[WebPanel] Failed to extract PDF from child window:', err);
        dbg('handleChildWindow() ERROR:', err);
      }

      childWindow.close();
    });

    // Handle child window triggering a download
    childWc.session.on('will-download', (_event, item) => {
      const filename = item.getFilename();
      dbg('handleChildWindow() will-download:', filename, 'handled:', handled,
        'isPdf:', filename.toLowerCase().endsWith('.pdf'), 'url:', item.getURL().substring(0, 100));
      if (filename.toLowerCase().endsWith('.pdf') && !handled) {
        handled = true;
        console.log('[WebPanel] Child window PDF download:', filename);
        const tempDir = path.join(app.getPath('userData'), 'temp_downloads');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempPath = path.join(tempDir, `${Date.now()}_${filename}`);
        item.setSavePath(tempPath);
        dbg('handleChildWindow() saving download to:', tempPath);

        item.on('done', (_e, state) => {
          dbg('handleChildWindow() download done, state:', state);
          if (state === 'completed') {
            const config = this.loadDownloadConfig();
            let domain = '';
            if (parentUrl) try { domain = new URL(parentUrl).hostname; } catch { /* noop */ }
            const manufacturer = config.domain_manufacturer_map?.[domain] || 'Medtronic';
            dbg('handleChildWindow() notifying renderer — file:', tempPath, 'domain:', domain, 'manufacturer:', manufacturer);
            const win = getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('web-panel-download-intercepted', {
                filePath: tempPath,
                filename,
                sourceDomain: domain,
                sourceManufacturer: manufacturer,
              });
            }
          }
          if (!childWindow.isDestroyed()) childWindow.close();
        });
      }
    });

    setTimeout(() => {
      if (!childWindow.isDestroyed()) {
        dbg('handleChildWindow() 30s timeout — closing child window, handled:', handled);
        childWindow.close();
      }
    }, 30000);
  }

  // ─── Download Interception (will-download) ─────────────────────

  private setupDownloadInterception(ses: Electron.Session) {
    dbg('setupDownloadInterception() registering will-download listener');
    ses.on('will-download', (_event, item, _webContents) => {
      const filename = item.getFilename();
      const sourceDomain = this.resolveSourceDomain(item);

      console.log(`[WebPanel] will-download: file=${filename}, domain=${sourceDomain}, url=${item.getURL().substring(0, 100)}`);
      dbg('setupDownloadInterception() will-download details:',
        'filename:', filename, 'domain:', sourceDomain,
        'url:', item.getURL().substring(0, 150),
        'urlChain:', item.getURLChain().map(u => u.substring(0, 80)),
        'mimeType:', item.getMimeType(),
        'totalBytes:', item.getTotalBytes());

      const config = this.loadDownloadConfig();
      const isPdf = filename.toLowerCase().endsWith('.pdf');
      const whitelisted = this.isDomainWhitelisted(sourceDomain, config);
      dbg('setupDownloadInterception() isPdf:', isPdf, 'whitelisted:', whitelisted,
        'auto_prompt:', config.auto_prompt);

      if (whitelisted && isPdf && config.auto_prompt !== false) {
        const tempDir = path.join(app.getPath('userData'), 'temp_downloads');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempPath = path.join(tempDir, `${Date.now()}_${filename}`);
        item.setSavePath(tempPath);
        dbg('setupDownloadInterception() intercepting PDF, saving to:', tempPath);

        item.on('done', (_e, state) => {
          dbg('setupDownloadInterception() download done, state:', state, 'file:', tempPath);
          if (state === 'completed') {
            const manufacturer = config.domain_manufacturer_map?.[sourceDomain] || 'Unknown';
            dbg('setupDownloadInterception() notifying renderer — manufacturer:', manufacturer);
            const win = getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('web-panel-download-intercepted', {
                filePath: tempPath,
                filename,
                sourceDomain,
                sourceManufacturer: manufacturer,
              });
            }
          }
        });
      } else if (isPdf) {
        console.log(`[WebPanel] PDF not intercepted: domain=${sourceDomain} not whitelisted`);
        dbg('setupDownloadInterception() PDF NOT intercepted — domain:', sourceDomain,
          'whitelist:', config.remote_monitoring_domains);
      }
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private loadDownloadConfig(): any {
    const configPath = path.join(app.getPath('userData'), 'web_downloads.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      dbg('loadDownloadConfig() loaded from', configPath,
        'domains:', config.remote_monitoring_domains?.length,
        'manufacturer_map keys:', Object.keys(config.domain_manufacturer_map || {}));
      return config;
    } catch (err) {
      dbg('loadDownloadConfig() failed to load', configPath, '— using defaults. Error:', err);
      return getDefaultDownloadConfig();
    }
  }

  private isDomainWhitelisted(domain: string, config: any): boolean {
    if (!domain) { dbg('isDomainWhitelisted() empty domain'); return false; }
    const domains: string[] = config.remote_monitoring_domains || [];
    const match = domains.some((d: string) => domain === d || domain.endsWith('.' + d));
    dbg('isDomainWhitelisted()', domain, '→', match, '(checked against', domains.length, 'domains)');
    return match;
  }

  private isWhitelistedContext(currentUrl: string, targetUrl: string): boolean {
    let currentDomain = '';
    let targetDomain = '';
    try { currentDomain = new URL(currentUrl).hostname; } catch { /* noop */ }
    try { targetDomain = new URL(targetUrl).hostname; } catch { /* noop */ }

    const config = this.loadDownloadConfig();
    return this.isDomainWhitelisted(currentDomain, config) || this.isDomainWhitelisted(targetDomain, config);
  }

  private resolveSourceDomain(item: Electron.DownloadItem): string {
    const url = item.getURL();
    try {
      if (url.startsWith('blob:')) {
        const h = new URL(url.slice(5)).hostname;
        if (h) return h;
      } else {
        const h = new URL(url).hostname;
        if (h) return h;
      }
    } catch { /* noop */ }

    for (const chainUrl of item.getURLChain()) {
      try {
        const prefix = chainUrl.startsWith('blob:') ? chainUrl.slice(5) : chainUrl;
        const h = new URL(prefix).hostname;
        if (h) return h;
      } catch { /* noop */ }
    }

    if (this.view) {
      try { return new URL(this.view.webContents.getURL()).hostname; } catch { /* noop */ }
    }
    return '';
  }

  private resolveChildDomain(childUrl: string, parentUrl: string): string {
    if (childUrl.startsWith('blob:')) {
      try { return new URL(childUrl.slice(5)).hostname; } catch { /* noop */ }
    }
    try {
      const h = new URL(childUrl).hostname;
      if (h) return h;
    } catch { /* noop */ }
    try { return new URL(parentUrl).hostname; } catch { /* noop */ }
    return '';
  }

  private savePdfAndNotify(pdfBytes: Buffer, sourceDomain: string, config: any) {
    const tempDir = path.join(app.getPath('userData'), 'temp_downloads');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const filename = `CareLink_Report_${new Date().toISOString().split('T')[0]}.pdf`;
    const tempPath = path.join(tempDir, `${Date.now()}_${filename}`);
    dbg('savePdfAndNotify() writing', pdfBytes.length, 'bytes to', tempPath);
    fs.writeFileSync(tempPath, pdfBytes);

    const manufacturer = config.domain_manufacturer_map?.[sourceDomain] || 'Medtronic';
    dbg('savePdfAndNotify() domain:', sourceDomain, 'manufacturer:', manufacturer,
      'domain_manufacturer_map has key:', sourceDomain in (config.domain_manufacturer_map || {}));
    const win = getMainWindow();
    dbg('savePdfAndNotify() mainWindow exists:', !!win, 'destroyed:', win?.isDestroyed());
    if (win && !win.isDestroyed()) {
      win.webContents.send('web-panel-download-intercepted', {
        filePath: tempPath,
        filename,
        sourceDomain,
        sourceManufacturer: manufacturer,
      });
      dbg('savePdfAndNotify() sent web-panel-download-intercepted IPC');
    } else {
      dbg('savePdfAndNotify() WARNING: no mainWindow to send IPC to!');
    }
    console.log('[WebPanel] PDF saved:', filename, 'from', sourceDomain);
  }

  // ─── View Management ──────────────────────────────────────────

  private updateBounds(mainWindow: BrowserWindow) {
    if (!this.view || !this.attached) return;
    const { width, height } = mainWindow.getContentBounds();
    this.view.setBounds({
      x: SIDEBAR_WIDTH,
      y: NAV_BAR_HEIGHT,
      width: width - SIDEBAR_WIDTH,
      height: height - NAV_BAR_HEIGHT,
    });
  }

  show(mainWindow: BrowserWindow) {
    const view = this.ensureView(mainWindow);
    if (!this.attached) {
      mainWindow.addBrowserView(view);
      this.attached = true;
    }
    this.updateBounds(mainWindow);

    if (!this.resizeHandler) {
      this.resizeHandler = () => this.updateBounds(mainWindow);
      mainWindow.on('resize', this.resizeHandler);
    }
  }

  hide(mainWindow: BrowserWindow) {
    if (this.view && this.attached) {
      mainWindow.removeBrowserView(this.view);
      this.attached = false;
    }
    if (this.resizeHandler) {
      mainWindow.removeListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  navigate(url: string) {
    if (!this.view) return;
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(normalizedUrl)) {
        normalizedUrl = 'https://' + normalizedUrl;
      } else {
        normalizedUrl = 'https://' + normalizedUrl;
      }
    }
    this.view.webContents.loadURL(normalizedUrl).catch((err) => {
      console.error('[WebPanel] Navigation failed:', err.message);
    });
  }

  goBack() { this.view?.webContents.goBack(); }
  goForward() { this.view?.webContents.goForward(); }
  reload() { this.view?.webContents.reload(); }

  getURL(): string {
    return this.view?.webContents.getURL() || '';
  }

  canGoBack(): boolean {
    return this.view?.webContents.canGoBack() ?? false;
  }

  canGoForward(): boolean {
    return this.view?.webContents.canGoForward() ?? false;
  }

  destroy() {
    if (this.view) {
      const win = getMainWindow();
      if (win && !win.isDestroyed() && this.attached) {
        win.removeBrowserView(this.view);
      }
      (this.view.webContents as any)?.close?.();
      this.view = null;
      this.attached = false;
    }
  }
}

function getDefaultDownloadConfig() {
  return {
    remote_monitoring_domains: [
      'carelink.medtronic.com',
      'europe.medtroniccarelink.net',
      'biotronik-homemonitoring.com',
      'www.merlin.net',
      'merlin.net',
      'latitude.bostonscientific.com',
      'www.latitude.bostonscientific.com',
    ],
    intercept_file_types: ['.pdf'],
    auto_prompt: true,
    domain_manufacturer_map: {
      'carelink.medtronic.com': 'Medtronic',
      'europe.medtroniccarelink.net': 'Medtronic',
      'biotronik-homemonitoring.com': 'Biotronik',
      'merlin.net': 'Abbott',
      'www.merlin.net': 'Abbott',
      'latitude.bostonscientific.com': 'Boston Scientific',
      'www.latitude.bostonscientific.com': 'Boston Scientific',
    } as Record<string, string>,
  };
}

export { WebPanelManager, getDefaultDownloadConfig };

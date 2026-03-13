import { BrowserView, BrowserWindow, app, ipcMain, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { getMainWindow } from './windowManager';
import { CredentialStore } from './credentialStore';

const SIDEBAR_WIDTH = 64;
const NAV_BAR_HEIGHT = 88; // nav bar + bookmark bar

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
      if (url.startsWith('blob:')) {
        return { action: 'allow' };
      }
      // Allow popups from whitelisted domains (CareLink PDF popups)
      if (this.isWhitelistedContext(wc.getURL(), url)) {
        console.log('[WebPanel] Allowing popup:', url.substring(0, 120));
        return { action: 'allow' };
      }
      // Non-whitelisted — navigate in the same view
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
    // Before each navigation, try to grab credentials from the current page.
    // This catches form POSTs (ASP.NET postback, standard forms, SPA navigations).
    wc.on('will-navigate', (_event, _url) => {
      this.tryExtractCredentials(wc);
    });

    // Also try on did-navigate: if the page had a username but no password
    // (multi-step login step 1), remember the username for step 2.
    wc.on('did-navigate', () => {
      // After navigation, check if the new page has a password field
      // with no username — use the remembered username from step 1.
      setTimeout(() => this.tryExtractCredentials(wc), 1500);
    });
  }

  private async tryExtractCredentials(wc: Electron.WebContents) {
    try {
      const result = await wc.executeJavaScript(EXTRACT_CREDENTIALS_JS);
      if (!result) {
        // No password field found. Check if there's a username field to remember.
        const usernameOnly = await wc.executeJavaScript(`
          (function() {
            var inputs = document.querySelectorAll('input[type="text"], input[type="email"]');
            for (var i = 0; i < inputs.length; i++) {
              if (inputs[i].offsetParent !== null && inputs[i].value && inputs[i].value.trim()) {
                return inputs[i].value.trim();
              }
            }
            return null;
          })()
        `);
        if (usernameOnly) {
          this.lastSeenUsername = usernameOnly;
          try { this.lastSeenDomain = new URL(wc.getURL()).hostname; } catch { /* noop */ }
          console.log('[WebPanel] Remembered username for multi-step login:', usernameOnly);
        }
        return;
      }

      let { username, password, domain } = result;

      // For multi-step logins: if no username on current page, use remembered one
      if (!username && this.lastSeenUsername && domain === this.lastSeenDomain) {
        username = this.lastSeenUsername;
        console.log('[WebPanel] Using remembered username from step 1:', username);
      }

      if (!username || !password || !domain) return;

      console.log('[WebPanel] Credentials detected for:', domain, username);

      const store = CredentialStore.getInstance();
      if (!store.isAvailable()) return;

      // Check if already saved
      const existing = store.get(domain);
      if (existing.some((c) => c.username === username && c.password === password)) return;

      // Show "Save password?" prompt in renderer
      this.pendingCredential = { domain, username, password };
      if (this.pendingCredentialTimer) clearTimeout(this.pendingCredentialTimer);
      this.pendingCredentialTimer = setTimeout(() => {
        this.pendingCredential = null;
        this.pendingCredentialTimer = null;
      }, 60000);

      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('web-panel-credentials-detected', { domain, username });
      }
    } catch {
      // Page might have navigated away already — ignore
    }
  }

  // ─── Auto-Fill ─────────────────────────────────────────────────

  private setupAutoFill(wc: Electron.WebContents) {
    wc.on('did-finish-load', () => {
      const store = CredentialStore.getInstance();
      if (!store.isAvailable()) return;

      let domain = '';
      try { domain = new URL(wc.getURL()).hostname; } catch { return; }

      const creds = store.get(domain);
      if (creds.length === 0) return;

      const { username, password } = creds[0];
      const js = makeAutoFillJS(username, password);

      // Try immediately, then again after 1.5s for SPA-rendered forms
      wc.executeJavaScript(js).catch(() => {});
      setTimeout(() => {
        if (this.view && !this.view.webContents.isDestroyed()) {
          wc.executeJavaScript(js).catch(() => {});
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
      if (this.pendingCredential) {
        const { domain, username, password } = this.pendingCredential;
        CredentialStore.getInstance().save(domain, username, password);
        this.pendingCredential = null;
        if (this.pendingCredentialTimer) {
          clearTimeout(this.pendingCredentialTimer);
          this.pendingCredentialTimer = null;
        }
      }
    });

    ipcMain.handle('web-panel-dismiss-pending-credential', async () => {
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
    ses.webRequest.onHeadersReceived((details, callback) => {
      const contentType = (
        details.responseHeaders?.['content-type'] ||
        details.responseHeaders?.['Content-Type'] ||
        []
      )[0] || '';

      if (contentType.includes('application/pdf') && details.resourceType === 'mainFrame') {
        console.log('[WebPanel] PDF response detected in main frame:', details.url.substring(0, 120));

        // Determine source domain
        let sourceDomain = '';
        try { sourceDomain = new URL(details.url).hostname; } catch { /* noop */ }
        if (!sourceDomain) {
          try { sourceDomain = new URL(wc.getURL()).hostname; } catch { /* noop */ }
        }

        const config = this.loadDownloadConfig();
        if (this.isDomainWhitelisted(sourceDomain, config)) {
          // Fetch the PDF bytes and intercept
          this.interceptPdfFromUrl(details.url, sourceDomain, wc, config);
        }
      }

      callback({ cancel: false });
    });
  }

  private async interceptPdfFromUrl(pdfUrl: string, sourceDomain: string, wc: Electron.WebContents, config: any) {
    try {
      // Wait for the page to finish loading the PDF
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Fetch the PDF bytes using the webContents' session cookies
      const pdfBytes = await wc.executeJavaScript(`
        (async function() {
          try {
            var resp = await fetch('${pdfUrl.replace(/'/g, "\\'")}', { credentials: 'include' });
            var buf = await resp.arrayBuffer();
            return Array.from(new Uint8Array(buf));
          } catch(e) { return null; }
        })()
      `).then((arr: number[] | null) => arr ? Buffer.from(arr) : null);

      if (pdfBytes && pdfBytes.length > 4 && pdfBytes.slice(0, 5).toString('ascii').startsWith('%PDF')) {
        this.savePdfAndNotify(pdfBytes, sourceDomain, config);
        // Navigate back so the user isn't stuck on the PDF viewer
        if (wc.canGoBack()) wc.goBack();
      } else {
        console.log('[WebPanel] Failed to extract PDF from inline response');
      }
    } catch (err) {
      console.error('[WebPanel] PDF inline interception error:', err);
    }
  }

  private handleChildWindow(childWindow: BrowserWindow) {
    childWindow.hide();

    const childWc = childWindow.webContents;
    const parentUrl = this.view?.webContents.getURL() || '';
    let handled = false;

    console.log('[WebPanel] Child window created, parent URL:', parentUrl);

    childWc.on('did-finish-load', async () => {
      if (handled) return;
      const url = childWc.getURL();
      console.log('[WebPanel] Child window loaded:', url.substring(0, 120));

      const sourceDomain = this.resolveChildDomain(url, parentUrl);
      const config = this.loadDownloadConfig();

      if (!this.isDomainWhitelisted(sourceDomain, config)) {
        console.log('[WebPanel] Child window domain not whitelisted:', sourceDomain);
        childWindow.close();
        return;
      }

      try {
        let pdfBytes: Buffer | null = null;

        if (url.startsWith('blob:')) {
          // Blob URL: fetch directly
          pdfBytes = await childWc.executeJavaScript(`
            (async function() {
              var resp = await fetch(window.location.href);
              var buf = await resp.arrayBuffer();
              return Array.from(new Uint8Array(buf));
            })()
          `).then((arr: number[]) => Buffer.from(arr));
        } else {
          // HTTPS URL: try fetching raw PDF, then fall back to printToPDF
          const raw = await childWc.executeJavaScript(`
            (async function() {
              try {
                var resp = await fetch(window.location.href, { credentials: 'include' });
                var ct = resp.headers.get('content-type') || '';
                if (ct.indexOf('pdf') >= 0 || ct.indexOf('octet') >= 0) {
                  var buf = await resp.arrayBuffer();
                  return Array.from(new Uint8Array(buf));
                }
              } catch(e) {}
              return null;
            })()
          `).then((arr: number[] | null) => arr ? Buffer.from(arr) : null);

          pdfBytes = raw || await childWc.printToPDF({});
        }

        if (pdfBytes && pdfBytes.length > 4 && pdfBytes.slice(0, 5).toString('ascii').startsWith('%PDF')) {
          handled = true;
          this.savePdfAndNotify(pdfBytes, sourceDomain, config);
        } else if (pdfBytes && pdfBytes.length > 100) {
          // printToPDF always produces valid PDF
          handled = true;
          this.savePdfAndNotify(pdfBytes, sourceDomain, config);
        }
      } catch (err) {
        console.error('[WebPanel] Failed to extract PDF from child window:', err);
      }

      childWindow.close();
    });

    // Handle child window triggering a download
    childWc.session.on('will-download', (_event, item) => {
      const filename = item.getFilename();
      if (filename.toLowerCase().endsWith('.pdf') && !handled) {
        handled = true;
        console.log('[WebPanel] Child window PDF download:', filename);
        const tempDir = path.join(app.getPath('userData'), 'temp_downloads');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempPath = path.join(tempDir, `${Date.now()}_${filename}`);
        item.setSavePath(tempPath);

        item.on('done', (_e, state) => {
          if (state === 'completed') {
            const config = this.loadDownloadConfig();
            let domain = '';
            if (parentUrl) try { domain = new URL(parentUrl).hostname; } catch { /* noop */ }
            const manufacturer = config.domain_manufacturer_map?.[domain] || 'Medtronic';
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
      if (!childWindow.isDestroyed()) childWindow.close();
    }, 30000);
  }

  // ─── Download Interception (will-download) ─────────────────────

  private setupDownloadInterception(ses: Electron.Session) {
    ses.on('will-download', (_event, item, _webContents) => {
      const filename = item.getFilename();
      const sourceDomain = this.resolveSourceDomain(item);

      console.log(`[WebPanel] will-download: file=${filename}, domain=${sourceDomain}, url=${item.getURL().substring(0, 100)}`);

      const config = this.loadDownloadConfig();
      const isPdf = filename.toLowerCase().endsWith('.pdf');

      if (this.isDomainWhitelisted(sourceDomain, config) && isPdf && config.auto_prompt !== false) {
        const tempDir = path.join(app.getPath('userData'), 'temp_downloads');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempPath = path.join(tempDir, `${Date.now()}_${filename}`);
        item.setSavePath(tempPath);

        item.on('done', (_e, state) => {
          if (state === 'completed') {
            const manufacturer = config.domain_manufacturer_map?.[sourceDomain] || 'Unknown';
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
      }
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private loadDownloadConfig(): any {
    try {
      const configPath = path.join(app.getPath('userData'), 'web_downloads.json');
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return getDefaultDownloadConfig();
    }
  }

  private isDomainWhitelisted(domain: string, config: any): boolean {
    if (!domain) return false;
    const domains: string[] = config.remote_monitoring_domains || [];
    return domains.some((d: string) => domain === d || domain.endsWith('.' + d));
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
    fs.writeFileSync(tempPath, pdfBytes);

    const manufacturer = config.domain_manufacturer_map?.[sourceDomain] || 'Medtronic';
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('web-panel-download-intercepted', {
        filePath: tempPath,
        filename,
        sourceDomain,
        sourceManufacturer: manufacturer,
      });
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

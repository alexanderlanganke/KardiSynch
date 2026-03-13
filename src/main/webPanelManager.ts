import { BrowserView, BrowserWindow, app, ipcMain, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { getMainWindow } from './windowManager';
import { CredentialStore } from './credentialStore';

const SIDEBAR_WIDTH = 64;
const NAV_BAR_HEIGHT = 88; // nav bar + bookmark bar

class WebPanelManager {
  private static instance: WebPanelManager;
  private view: BrowserView | null = null;
  private attached = false;
  private resizeHandler: (() => void) | null = null;

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
        preload: path.join(__dirname, '../preload/webPanelPreload.js'),
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

    // Handle new-window requests (target="_blank" links, CareLink PDF popups)
    wc.setWindowOpenHandler(({ url }) => {
      // Allow blob URLs so we can intercept PDF blobs
      if (url.startsWith('blob:')) {
        return { action: 'allow' };
      }

      // Check if the current page is on a whitelisted domain.
      // CareLink uses window.open() to serve PDFs in a popup — we need to
      // allow the child window so we can intercept the PDF response.
      let currentDomain = '';
      try { currentDomain = new URL(wc.getURL()).hostname; } catch { /* noop */ }

      let targetDomain = '';
      try { targetDomain = new URL(url).hostname; } catch { /* noop */ }

      const config = this.loadDownloadConfig();
      const domains: string[] = config.remote_monitoring_domains;
      const isFromWhitelisted = domains.some((d: string) =>
        currentDomain === d || currentDomain.endsWith('.' + d)
      );
      const isToWhitelisted = domains.some((d: string) =>
        targetDomain === d || targetDomain.endsWith('.' + d)
      );

      if (isFromWhitelisted || isToWhitelisted) {
        // Allow child window — handleChildWindow will check for PDF content
        console.log(`[WebPanel] Allowing popup from whitelisted domain: ${url.substring(0, 100)}`);
        return { action: 'allow' };
      }

      // Non-whitelisted — navigate in the same view
      if (url.startsWith('http:') || url.startsWith('https:')) {
        wc.loadURL(url);
      }
      return { action: 'deny' };
    });

    // Intercept child windows (PDF exports, blob windows)
    wc.on('did-create-window', (childWindow) => {
      this.handleChildWindow(childWindow);
    });

    // Download interception
    this.setupDownloadInterception(ses);

    // Credential detection from preload
    this.setupCredentialDetection(wc);

    // Auto-fill saved credentials on page load
    this.setupAutoFill(wc);

    return this.view;
  }

  private handleChildWindow(childWindow: BrowserWindow) {
    // Hide the child window — we only need it to resolve blob/PDF content
    childWindow.hide();

    const childWc = childWindow.webContents;
    const parentUrl = this.view?.webContents.getURL() || '';
    let pdfIntercepted = false;

    console.log('[WebPanel] Child window created, parent URL:', parentUrl);

    // Use webRequest to detect PDF content-type responses in the child window
    childWc.session.webRequest.onHeadersReceived(
      { urls: ['*://*/*'] },
      (details, callback) => {
        const contentType = (details.responseHeaders?.['content-type'] || details.responseHeaders?.['Content-Type'] || [])[0] || '';
        if (contentType.includes('application/pdf') && !pdfIntercepted) {
          console.log('[WebPanel] Child window received PDF response:', details.url.substring(0, 100));
          // Let it load — we'll capture it in did-finish-load via printToPDF or fetch
        }
        callback({ cancel: false });
      }
    );

    childWc.on('did-finish-load', async () => {
      if (pdfIntercepted) return;
      const url = childWc.getURL();
      console.log('[WebPanel] Child window loaded:', url.substring(0, 100));

      // Determine source domain: try blob origin, child URL, then parent URL
      const sourceDomain = this.resolveChildDomain(url, parentUrl);
      console.log('[WebPanel] Resolved child window domain:', sourceDomain);

      const downloadConfig = this.loadDownloadConfig();
      const domains: string[] = downloadConfig.remote_monitoring_domains;
      const isWhitelisted = domains.some((d: string) =>
        sourceDomain === d || sourceDomain.endsWith('.' + d)
      );

      if (!isWhitelisted) {
        console.log('[WebPanel] Child window domain not whitelisted:', sourceDomain);
        childWindow.close();
        return;
      }

      try {
        // Try extracting PDF content.
        // For blob URLs: fetch the blob. For HTTPS URLs: the page IS the PDF.
        let pdfBytes: Buffer;
        if (url.startsWith('blob:')) {
          pdfBytes = await childWc.executeJavaScript(`
            (async () => {
              const resp = await fetch(window.location.href);
              const buf = await resp.arrayBuffer();
              return Array.from(new Uint8Array(buf));
            })()
          `).then((arr: number[]) => Buffer.from(arr));
        } else {
          // For server-rendered PDFs (CareLink .aspx), use printToPDF first,
          // but also try re-fetching the URL to get raw PDF bytes
          pdfBytes = await childWc.executeJavaScript(`
            (async () => {
              try {
                const resp = await fetch(window.location.href, { credentials: 'include' });
                const ct = resp.headers.get('content-type') || '';
                if (ct.includes('pdf') || ct.includes('octet-stream')) {
                  const buf = await resp.arrayBuffer();
                  return Array.from(new Uint8Array(buf));
                }
              } catch(e) {}
              return null;
            })()
          `).then((arr: number[] | null) => {
            if (arr) return Buffer.from(arr);
            // Fallback: use printToPDF (captures rendered content as PDF)
            return childWc.printToPDF({});
          });
        }

        // Verify it's a PDF (starts with %PDF)
        if (pdfBytes.length > 4 && pdfBytes.slice(0, 5).toString('ascii').startsWith('%PDF')) {
          pdfIntercepted = true;
          this.savePdfAndNotify(pdfBytes, sourceDomain, downloadConfig);
        } else if (pdfBytes.length > 100) {
          // printToPDF output is always a valid PDF
          pdfIntercepted = true;
          this.savePdfAndNotify(pdfBytes, sourceDomain, downloadConfig);
        } else {
          console.log('[WebPanel] Child window content is not a PDF');
        }
      } catch (err) {
        console.error('[WebPanel] Failed to extract PDF from child window:', err);
      }

      childWindow.close();
    });

    // Handle if the child window triggers a will-download instead of loading content
    childWc.session.on('will-download', (_event, item) => {
      const filename = item.getFilename();
      if (filename.toLowerCase().endsWith('.pdf') && !pdfIntercepted) {
        pdfIntercepted = true;
        console.log('[WebPanel] Child window triggered PDF download:', filename);
        const tempDir = path.join(app.getPath('userData'), 'temp_downloads');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempPath = path.join(tempDir, `${Date.now()}_${filename}`);
        item.setSavePath(tempPath);

        item.on('done', (_e, state) => {
          if (state === 'completed') {
            const downloadConfig = this.loadDownloadConfig();
            let domain = '';
            if (parentUrl) try { domain = new URL(parentUrl).hostname; } catch { /* noop */ }
            const manufacturer = downloadConfig.domain_manufacturer_map?.[domain] || 'Medtronic';

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

    // Safety: close after timeout if load never finishes
    setTimeout(() => {
      if (!childWindow.isDestroyed()) childWindow.close();
    }, 30000);
  }

  private resolveChildDomain(childUrl: string, parentUrl: string): string {
    if (childUrl.startsWith('blob:')) {
      try { return new URL(childUrl.slice(5)).hostname; } catch { /* noop */ }
    }
    try {
      const hostname = new URL(childUrl).hostname;
      if (hostname) return hostname;
    } catch { /* noop */ }
    try { return new URL(parentUrl).hostname; } catch { /* noop */ }
    return '';
  }

  private savePdfAndNotify(pdfBytes: Buffer, sourceDomain: string, downloadConfig: any) {
    const tempDir = path.join(app.getPath('userData'), 'temp_downloads');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const filename = `CareLink_Report_${new Date().toISOString().split('T')[0]}.pdf`;
    const tempPath = path.join(tempDir, `${Date.now()}_${filename}`);
    fs.writeFileSync(tempPath, pdfBytes);

    const manufacturer = downloadConfig.domain_manufacturer_map?.[sourceDomain] || 'Medtronic';
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('web-panel-download-intercepted', {
        filePath: tempPath,
        filename,
        sourceDomain,
        sourceManufacturer: manufacturer,
      });
    }
    console.log('[WebPanel] PDF intercepted:', filename, 'from', sourceDomain);
  }

  private loadDownloadConfig(): any {
    try {
      const configPath = path.join(app.getPath('userData'), 'web_downloads.json');
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return getDefaultDownloadConfig();
    }
  }

  private resolveSourceDomain(item: Electron.DownloadItem): string {
    // 1. Try the download URL itself
    const url = item.getURL();
    try {
      // Blob URLs: blob:https://domain/uuid → extract origin
      if (url.startsWith('blob:')) {
        const hostname = new URL(url.slice(5)).hostname;
        if (hostname) return hostname;
      } else {
        const hostname = new URL(url).hostname;
        if (hostname) return hostname;
      }
    } catch { /* noop */ }

    // 2. Walk the URL chain (referrer chain)
    for (const chainUrl of item.getURLChain()) {
      try {
        if (chainUrl.startsWith('blob:')) {
          const hostname = new URL(chainUrl.slice(5)).hostname;
          if (hostname) return hostname;
        } else {
          const hostname = new URL(chainUrl).hostname;
          if (hostname) return hostname;
        }
      } catch { /* noop */ }
    }

    // 3. Check referrer header
    try {
      const referrer = (item as any).getReferrer?.();
      if (referrer) {
        const hostname = new URL(referrer).hostname;
        if (hostname) return hostname;
      }
    } catch { /* noop */ }

    // 4. Fall back to the BrowserView's current page URL
    if (this.view) {
      try {
        return new URL(this.view.webContents.getURL()).hostname;
      } catch { /* noop */ }
    }

    return '';
  }

  private setupDownloadInterception(ses: Electron.Session) {
    ses.on('will-download', (_event, item, _webContents) => {
      const filename = item.getFilename();
      const sourceDomain = this.resolveSourceDomain(item);

      console.log(`[WebPanel] Download intercepted: filename=${filename}, domain=${sourceDomain}, url=${item.getURL().substring(0, 100)}`);

      const downloadConfig = this.loadDownloadConfig();

      // Check domain: exact match or subdomain match against whitelist
      const domains: string[] = downloadConfig.remote_monitoring_domains;
      const isWhitelisted = domains.some((d: string) =>
        sourceDomain === d || sourceDomain.endsWith('.' + d)
      );
      const isPdf = filename.toLowerCase().endsWith('.pdf');

      if (isWhitelisted && isPdf && downloadConfig.auto_prompt !== false) {
        // Intercept: save to temp directory
        const tempDir = path.join(app.getPath('userData'), 'temp_downloads');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempPath = path.join(tempDir, `${Date.now()}_${filename}`);
        item.setSavePath(tempPath);

        item.on('done', (_e, state) => {
          if (state === 'completed') {
            const manufacturer = downloadConfig.domain_manufacturer_map?.[sourceDomain] || 'Unknown';
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
        console.log(`[WebPanel] PDF download not intercepted: domain=${sourceDomain} not in whitelist`);
      }
    });
  }

  private setupCredentialDetection(wc: Electron.WebContents) {
    const viewWebContentsId = wc.id;

    // The webPanelPreload sends this when it detects a login form submission
    ipcMain.on('web-panel-credentials-detected', (event, creds: { domain: string; username: string; password: string }) => {
      // Verify sender is our BrowserView — reject messages from other renderers
      if (event.sender.id !== viewWebContentsId) return;

      // Basic validation
      if (!creds?.domain || !creds?.username || !creds?.password) return;
      if (typeof creds.domain !== 'string' || typeof creds.username !== 'string' || typeof creds.password !== 'string') return;

      const store = CredentialStore.getInstance();
      if (!store.isAvailable()) return;

      // Check if we already have this exact credential saved
      const existing = store.get(creds.domain);
      const alreadySaved = existing.some(
        (c) => c.username === creds.username && c.password === creds.password
      );
      if (alreadySaved) return;

      // Forward to renderer for "Save password?" prompt (no password sent)
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('web-panel-credentials-detected', {
          domain: creds.domain,
          username: creds.username,
        });
      }

      // Store temporarily so the renderer can confirm without re-sending the password
      this.pendingCredential = creds;

      // Auto-expire pending credential after 60s
      if (this.pendingCredentialTimer) clearTimeout(this.pendingCredentialTimer);
      this.pendingCredentialTimer = setTimeout(() => {
        this.pendingCredential = null;
        this.pendingCredentialTimer = null;
      }, 60000);
    });

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

  private setupAutoFill(wc: Electron.WebContents) {
    wc.on('did-finish-load', () => {
      const store = CredentialStore.getInstance();
      if (!store.isAvailable()) return;

      let domain = '';
      try {
        domain = new URL(wc.getURL()).hostname;
      } catch { return; }

      const creds = store.get(domain);
      if (creds.length === 0) return;

      // Use the first saved credential for this domain
      const { username, password } = creds[0];

      // Send to the preload script which will fill the form
      wc.send('web-panel-autofill', { username, password });
    });
  }

  private pendingCredential: { domain: string; username: string; password: string } | null = null;
  private pendingCredentialTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Keep bounds in sync on resize
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
    // Add protocol if missing
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      // If it looks like a domain, add https
      if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(normalizedUrl)) {
        normalizedUrl = 'https://' + normalizedUrl;
      } else {
        // Treat as search query — skip for now, just prefix
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
      // webContents is destroyed with the view
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

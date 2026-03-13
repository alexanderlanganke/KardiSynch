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

    // Handle new-window requests (target="_blank" links)
    wc.setWindowOpenHandler(({ url }) => {
      // Allow blob URLs so we can intercept PDF blobs (e.g. CareLink exports)
      if (url.startsWith('blob:')) {
        return { action: 'allow' };
      }
      // Regular URLs — navigate in the same view
      if (url.startsWith('http:') || url.startsWith('https:')) {
        wc.loadURL(url);
      }
      return { action: 'deny' };
    });

    // Intercept child windows (blob PDF exports from CareLink etc.)
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
    // Hide the child window — we only need it to resolve the blob
    childWindow.hide();

    const childWc = childWindow.webContents;
    // Capture the parent BrowserView's current URL for domain fallback
    const parentUrl = this.view?.webContents.getURL() || '';

    console.log('[WebPanel] Child window created, parent URL:', parentUrl);

    childWc.on('did-finish-load', async () => {
      const url = childWc.getURL();
      console.log('[WebPanel] Child window loaded:', url.substring(0, 100));

      // Determine source domain: try blob origin, then child URL, then parent URL
      let sourceDomain = '';
      if (url.startsWith('blob:')) {
        try {
          sourceDomain = new URL(url.slice(5)).hostname;
        } catch { /* noop */ }
      }
      if (!sourceDomain) {
        try { sourceDomain = new URL(url).hostname; } catch { /* noop */ }
      }
      if (!sourceDomain && parentUrl) {
        try { sourceDomain = new URL(parentUrl).hostname; } catch { /* noop */ }
      }

      console.log('[WebPanel] Resolved child window domain:', sourceDomain);

      // Load whitelist
      let downloadConfig: any;
      try {
        const configPath = path.join(app.getPath('userData'), 'web_downloads.json');
        downloadConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {
        downloadConfig = getDefaultDownloadConfig();
      }

      const domains: string[] = downloadConfig.remote_monitoring_domains;
      const isWhitelisted = domains.some((d: string) =>
        sourceDomain === d || sourceDomain.endsWith('.' + d)
      );

      if (isWhitelisted) {
        try {
          // Extract PDF bytes from the blob URL via JS in the child window
          const pdfBytes: Buffer = await childWc.executeJavaScript(`
            (async () => {
              const resp = await fetch(window.location.href);
              const buf = await resp.arrayBuffer();
              return Array.from(new Uint8Array(buf));
            })()
          `).then((arr: number[]) => Buffer.from(arr));

          // Verify it's a PDF (starts with %PDF)
          if (pdfBytes.length > 4 && pdfBytes.slice(0, 5).toString('ascii').startsWith('%PDF')) {
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
            console.log('[WebPanel] PDF extracted from child window:', filename);
          } else {
            console.log('[WebPanel] Child window content is not a PDF (no %PDF header)');
          }
        } catch (err) {
          console.error('[WebPanel] Failed to extract PDF from blob window:', err);
        }
      } else {
        console.log('[WebPanel] Child window domain not whitelisted:', sourceDomain);
      }

      childWindow.close();
    });

    // Also handle if the child window triggers a download instead of loading content
    childWindow.webContents.session.on('will-download', (_event, item) => {
      const filename = item.getFilename();
      if (filename.toLowerCase().endsWith('.pdf')) {
        console.log('[WebPanel] Child window triggered PDF download:', filename);
        const tempDir = path.join(app.getPath('userData'), 'temp_downloads');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempPath = path.join(tempDir, `${Date.now()}_${filename}`);
        item.setSavePath(tempPath);

        item.on('done', (_e, state) => {
          if (state === 'completed') {
            let downloadConfig: any;
            try {
              const configPath = path.join(app.getPath('userData'), 'web_downloads.json');
              downloadConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            } catch {
              downloadConfig = getDefaultDownloadConfig();
            }

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
        });
      }
    });

    // Safety: close after timeout if load never finishes
    setTimeout(() => {
      if (!childWindow.isDestroyed()) childWindow.close();
    }, 30000);
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

      // Load whitelist config
      let downloadConfig: any;
      try {
        const configPath = path.join(app.getPath('userData'), 'web_downloads.json');
        downloadConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {
        downloadConfig = getDefaultDownloadConfig();
      }

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

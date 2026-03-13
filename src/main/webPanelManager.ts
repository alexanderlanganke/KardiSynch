import { BrowserView, BrowserWindow, app, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { getMainWindow } from './windowManager';

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

    return this.view;
  }

  private handleChildWindow(childWindow: BrowserWindow) {
    // Hide the child window — we only need it to resolve the blob
    childWindow.hide();

    const childWc = childWindow.webContents;

    childWc.on('did-finish-load', async () => {
      const url = childWc.getURL();

      // Determine source domain from the blob origin (blob:https://domain/...)
      let sourceDomain = '';
      if (url.startsWith('blob:')) {
        try {
          sourceDomain = new URL(url.slice(5)).hostname;
        } catch { /* noop */ }
      } else {
        try {
          sourceDomain = new URL(url).hostname;
        } catch { /* noop */ }
      }

      // Load whitelist
      let downloadConfig: any;
      try {
        const configPath = path.join(app.getPath('userData'), 'web_downloads.json');
        downloadConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {
        downloadConfig = getDefaultDownloadConfig();
      }

      const isWhitelisted = downloadConfig.remote_monitoring_domains.includes(sourceDomain);

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
          }
        } catch (err) {
          console.error('[WebPanel] Failed to extract PDF from blob window:', err);
        }
      }

      childWindow.close();
    });

    // Safety: close after timeout if load never finishes
    setTimeout(() => {
      if (!childWindow.isDestroyed()) childWindow.close();
    }, 30000);
  }

  private setupDownloadInterception(ses: Electron.Session) {
    ses.on('will-download', (_event, item, _webContents) => {
      const url = item.getURL();
      const filename = item.getFilename();
      let sourceDomain = '';
      try {
        sourceDomain = new URL(url).hostname;
      } catch {
        // Referrer URL may give us the domain
        const referer = item.getURLChain()[0];
        try { sourceDomain = new URL(referer).hostname; } catch { /* noop */ }
      }

      // Load whitelist config
      let downloadConfig: any;
      try {
        const configPath = path.join(app.getPath('userData'), 'web_downloads.json');
        downloadConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {
        downloadConfig = getDefaultDownloadConfig();
      }

      const isWhitelisted = downloadConfig.remote_monitoring_domains.includes(sourceDomain);
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
      }
      // Non-whitelisted or non-PDF: default Chromium download behavior
    });
  }

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

import { BrowserWindow } from 'electron';

export class ScraperService {
    private static instance: ScraperService;
    private window: BrowserWindow | null = null;
    private keepAlive: boolean = false;

    private constructor() { }

    static getInstance(): ScraperService {
        if (!ScraperService.instance) {
            ScraperService.instance = new ScraperService();
        }
        return ScraperService.instance;
    }

    /**
     * Initializes the service, ensuring a window is ready to go.
     */
    init() {
        this.keepAlive = true;
        this.getWindow();
    }

    /**
     * Gets the active scraper window or creates one if it doesn't exist.
     */
    getWindow(): BrowserWindow {
        if (!this.window || this.window.isDestroyed()) {
            this.window = new BrowserWindow({
                show: false, // Keep hidden
                width: 1280,
                height: 900,
                webPreferences: {
                    offscreen: false, // Stability
                    nodeIntegration: false,
                    contextIsolation: true
                }
            });

            console.log('[ScraperService] Created new background window.');
        }
        return this.window;
    }

    /**
     * Resets the window to a blank state to clear previous page scripts/DOM.
     * Does NOT clear cookies/storage by default to keep sessions if needed, 
     * but navigates away to ensure clean slate for next check.
     */
    async resetWindow() {
        if (this.window && !this.window.isDestroyed()) {
            try {
                await this.window.loadURL('about:blank');
            } catch (e) {
                console.warn('[ScraperService] Failed to reset window:', e);
            }
        }
    }

    /**
     * Stops the service and destroys the window.
     */
    close() {
        this.keepAlive = false;
        if (this.window && !this.window.isDestroyed()) {
            this.window.destroy();
            this.window = null;
            console.log('[ScraperService] Destroyed background window.');
        }
    }
}

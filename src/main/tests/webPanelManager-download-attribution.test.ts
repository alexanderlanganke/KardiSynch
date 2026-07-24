import { describe, it, expect, vi } from 'vitest';

// webPanelManager.ts imports Electron APIs at module scope (BrowserView,
// app, ipcMain, session) — stub them minimally so the module can load in a
// non-Electron test environment. None of these are actually invoked by the
// pure-logic methods under test here.
vi.mock('electron', () => ({
    BrowserView: class { },
    BrowserWindow: class { },
    app: { getPath: () => '/tmp/kardisynch_test_userdata' },
    ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
    session: { defaultSession: {} },
}));

import { WebPanelManager, getDefaultDownloadConfig } from '../webPanelManager';

describe('WebPanelManager download-manufacturer attribution (#149)', () => {
    // resolveManufacturerForDomain/isDomainWhitelisted are private, but pure
    // (no Electron/filesystem access) — exercised via the singleton instance.
    const manager = WebPanelManager.getInstance() as any;
    const config = getDefaultDownloadConfig();

    it('resolves an exact domain match', () => {
        expect(manager.resolveManufacturerForDomain('latitude.bostonscientific.com', config)).toBe('Boston Scientific');
        expect(manager.resolveManufacturerForDomain('carelink.medtronic.com', config)).toBe('Medtronic');
    });

    it('resolves a session-specific subdomain to the base domain\'s manufacturer', () => {
        // The bug: PDFs intercepted from a subdomain that doesn't exactly
        // match a domain_manufacturer_map key used to silently default to
        // 'Medtronic' even for a Boston Scientific LATITUDE subdomain.
        expect(manager.resolveManufacturerForDomain('home.latitude.bostonscientific.com', config)).toBe('Boston Scientific');
    });

    it('falls back to Unknown, not Medtronic, for a domain with no map entry', () => {
        expect(manager.resolveManufacturerForDomain('some-other-portal.example.com', config)).toBe('Unknown');
        expect(manager.resolveManufacturerForDomain('', config)).toBe('Unknown');
    });
});

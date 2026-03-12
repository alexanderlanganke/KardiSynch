import { BrowserWindow, shell } from 'electron';
import { ScraperService } from './ScraperService';

export interface WarningStatusResult {
    manufacturer: string;
    status: 'safe' | 'advisory' | 'recall' | 'manual_check' | 'unknown' | 'error';
    details: string;
    link?: string;
    timestamp: string;
    components?: { type: 'device' | 'lead'; model: string; serial: string; status: string }[];
}

const isDev = process.env.NODE_ENV === 'development';

// --- Manufacturer advisory portal links ---

const ADVISORY_LINKS: Record<string, string> = {
    medtronic: 'https://productperformance.production.argo-prd.eks.mdtcloud.io/productperformance/customer-communications.html',
    abbott: 'https://www.cardiovascular.abbott/us/en/hcp/product-advisories.html',
    boston: 'https://www.bostonscientific.com/en-US/pprc/device-lookup-tool/device-lookup-tool-eu-de.html',
    biotronik: 'https://www.biotronik.com/en-int/professionals/services/device-lookup-tool',
    microport: 'https://www.crm.microport.com/en/healthcare-professionals/product-performance',
};

// --- Production: all manufacturers return manual_check with link ---

function manualCheckResult(manufacturer: string, link: string, details?: string): WarningStatusResult {
    return {
        manufacturer,
        status: 'manual_check',
        details: details || `Please check the ${manufacturer} advisory portal.`,
        link,
        timestamp: new Date().toISOString()
    };
}

// --- Debug-only Biotronik scraper (dev mode only) ---
// Automated scraping classifies results as safe/advisory/recall, which has
// regulatory implications (clinical decision support). This is kept for
// personal debugging only and never runs in production builds.

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForElement(win: BrowserWindow, selector: string, timeout = 10000) {
    const start = Date.now();
    let interval = 100;
    while (Date.now() - start < timeout) {
        try {
            const found = await win.webContents.executeJavaScript(
                `!!document.querySelector('${selector}')`
            );
            if (found) return true;
        } catch (e) { /* ignore */ }
        await wait(interval);
        interval = Math.min(interval * 1.5, 500);
    }
    return false;
}

async function waitForCondition(win: BrowserWindow, jsExpr: string, timeout = 10000): Promise<boolean> {
    const start = Date.now();
    let interval = 150;
    while (Date.now() - start < timeout) {
        try {
            const result = await win.webContents.executeJavaScript(jsExpr);
            if (result) return true;
        } catch (e) { /* ignore */ }
        await wait(interval);
        interval = Math.min(interval * 1.5, 500);
    }
    return false;
}

async function safeType(win: BrowserWindow, selector: string, text: string) {
    const exists = await waitForElement(win, selector);
    if (!exists) throw new Error(`Timeout waiting for element: ${selector}`);

    const safeSelector = selector.replace(/'/g, "\\'");
    const safeText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    await win.webContents.executeJavaScript(`
        (function() {
            try {
                const el = document.querySelector('${safeSelector}');
                if (el) {
                    el.focus();
                    el.value = '${safeText}';
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } catch(e) {}
        })()
    `);
    for (const char of text) {
        try {
            await win.webContents.sendInputEvent({ type: 'char', keyCode: char });
        } catch (e) { /* ignore */ }
    }
    await wait(200);
}

async function checkBiotronikWarningDebug(serial: string): Promise<WarningStatusResult> {
    console.log(`[Warning Service DEBUG] Checking Biotronik Serial: ${serial}`);

    const scraper = ScraperService.getInstance();
    await scraper.resetWindow();
    const win = scraper.getWindow();

    try {
        await win.loadURL('https://www.biotronik.com/en-int/professionals/services/device-lookup-tool');

        await waitForCondition(win, `
            (function() {
                const btns = Array.from(document.querySelectorAll('button'));
                const accept = btns.find(b => b.innerText.includes('Accept') || b.innerText.includes('Alle akzeptieren'));
                if (accept) { accept.click(); return true; }
                return !!document.querySelector('input#input');
            })()
        `, 5000);

        await waitForElement(win, 'input#input');
        await safeType(win, 'input#input', serial);

        await win.webContents.executeJavaScript(`
            (function() {
                const btns = Array.from(document.querySelectorAll('button'));
                const find = btns.find(b => b.innerText.includes('FIND') || b.innerText.includes('FindEN'));
                if (find) find.click();
            })()
        `);

        // Wait for results — try multiple selectors since page structure may change
        const resultsFound = await waitForCondition(win, `
            (function() {
                var selectors = ['.results-container', '.result', '[class*="result"]', '[class*="lookup-result"]', '.alert', '.message'];
                for (var i = 0; i < selectors.length; i++) {
                    var el = document.querySelector(selectors[i]);
                    if (el && el.innerText.trim().length > 10) return true;
                }
                return false;
            })()
        `, 10000);

        if (!resultsFound) {
            console.warn('[Warning Service DEBUG] No results container found. Page structure may have changed.');
            return manualCheckResult('Biotronik', ADVISORY_LINKS.biotronik, 'Could not locate results on page. Please check manually.');
        }

        // Scrape result — NEVER fall back to document.body
        const scraping = await win.webContents.executeJavaScript(`
            (function() {
                var selectors = ['.results-container', '.result', '[class*="result"]', '[class*="lookup-result"]', '.alert', '.message'];
                var results = null;
                for (var i = 0; i < selectors.length; i++) {
                    var el = document.querySelector(selectors[i]);
                    if (el && el.innerText.trim().length > 10) { results = el; break; }
                }
                if (!results) return { status: 'no_container', text: '' };

                var rawText = results.innerText;
                var text = rawText.replace(/\\s+/g, ' ').trim().toLowerCase();

                if (
                    text.includes('no advisories') ||
                    text.includes('not affected') ||
                    text.includes('could not be associated') ||
                    text.includes('no product advisory') ||
                    text.includes('no active advisory')
                ) {
                    return { status: 'safe', text: rawText };
                }

                if (
                    text.includes('is affected') ||
                    text.includes('active recall') ||
                    (text.includes('advisory') && (text.includes('affected') || text.includes('action') || text.includes('contact')))
                ) {
                    return { status: 'advisory', text: rawText };
                }

                if (text.includes('not found') || text.includes('invalid')) {
                    return { status: 'unknown', text: rawText };
                }

                if (text.length < 20) return { status: 'manual_check', text: 'Error: Content too short/empty' };

                return { status: 'manual_check', text: rawText };
            })()
        `);

        console.log(`[Warning Service DEBUG] Biotronik scrape result: status=${scraping.status}, text=${scraping.text?.substring(0, 200)}`);

        if (scraping.status === 'safe') {
            return {
                manufacturer: 'Biotronik',
                status: 'safe',
                details: 'No active advisories found for this serial number.',
                link: ADVISORY_LINKS.biotronik,
                timestamp: new Date().toISOString()
            };
        } else if (scraping.status === 'advisory') {
            return {
                manufacturer: 'Biotronik',
                status: 'advisory',
                details: 'Advisories found! Please check details on manufacturer site.',
                link: ADVISORY_LINKS.biotronik,
                timestamp: new Date().toISOString()
            };
        }

        return manualCheckResult('Biotronik', ADVISORY_LINKS.biotronik, 'Could not automatically verify status. Please check manually.');

    } catch (e: any) {
        console.error('[Warning Service DEBUG] Biotronik Check Error', e);
        return manualCheckResult('Biotronik', ADVISORY_LINKS.biotronik, `Automation Error: ${e.message}`);
    } finally {
        // Do not destroy
    }
}

// --- Public API ---

export const checkWarningStatus = async (
    manufacturer: string,
    model: string,
    serial?: string
): Promise<WarningStatusResult> => {
    const manuLower = (manufacturer || '').toLowerCase();
    const safeModel = (model || '').trim();
    const safeSerial = (serial || '').trim();

    if (!safeModel) {
        return {
            manufacturer: manufacturer || 'Unknown',
            status: 'error',
            details: 'Missing Model Number',
            timestamp: new Date().toISOString()
        };
    }

    try {
        if (manuLower.includes('medtronic'))
            return manualCheckResult('Medtronic', ADVISORY_LINKS.medtronic, 'Medtronic advisories are document-based. Please search by model name in the opened portal.');

        if (manuLower.includes('abbott') || manuLower.includes('st. jude'))
            return manualCheckResult('Abbott', ADVISORY_LINKS.abbott, 'Abbott utilizes advisory-specific lookup tools. Please check the portal for applicable advisories.');

        if (manuLower.includes('boston') || manuLower.includes('guidant'))
            return manualCheckResult('Boston Scientific', ADVISORY_LINKS.boston, 'Boston Scientific lookup requires specific Model UPN. Please check manually.');

        if (manuLower.includes('biotronik')) {
            // Debug mode: run automated scraper for personal use
            if (isDev && safeSerial) {
                return await checkBiotronikWarningDebug(safeSerial);
            }
            return manualCheckResult('Biotronik', ADVISORY_LINKS.biotronik, safeSerial
                ? 'Please check the Biotronik device lookup tool with your serial number.'
                : 'Missing serial number for Biotronik lookup.');
        }

        if (manuLower.includes('microport') || manuLower.includes('sorin') || manuLower.includes('ela'))
            return manualCheckResult('Microport', ADVISORY_LINKS.microport, 'Microport provides semi-annual performance reports.');

        return {
            manufacturer,
            status: 'unknown',
            details: 'Manufacturer not supported for advisory lookup.',
            timestamp: new Date().toISOString()
        };

    } catch (e: any) {
        return {
            manufacturer,
            status: 'error',
            details: `Service Error: ${e.message}`,
            timestamp: new Date().toISOString()
        };
    }
};

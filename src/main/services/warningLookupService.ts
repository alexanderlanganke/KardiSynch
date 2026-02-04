import { BrowserWindow, shell } from 'electron';
import { checkMRIStatus } from './mriLookupService';
// Reusing some types/logic if possible, or defining new ones.

export interface WarningStatusResult {
    manufacturer: string;
    status: 'safe' | 'advisory' | 'recall' | 'manual_check' | 'unknown' | 'error';
    details: string;
    link?: string; // Link to the specific advisory page or general lookup
    timestamp: string;
    components?: { type: 'device' | 'lead'; model: string; serial: string; status: string }[];
}

// Helper: Wait function
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Wait for element
async function waitForElement(win: BrowserWindow, selector: string, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const found = await win.webContents.executeJavaScript(`
                !!document.querySelector('${selector}')
            `);
            if (found) return true;
        } catch (e) {
            // Ignore execution errors during navigation
        }
        await wait(500);
    }
    return false;
}

async function safeType(win: BrowserWindow, selector: string, text: string) {
    const exists = await waitForElement(win, selector);
    if (!exists) throw new Error(`Timeout waiting for element: ${selector}`);

    await win.webContents.executeJavaScript(`
        (function() {
            try {
                const el = document.querySelector('${selector}');
                if (el) {
                    el.focus();
                    el.value = '${text}';
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } catch(e) {}
        })()
    `);
    // Fallback typing just in case
    for (const char of text) {
        try {
            await win.webContents.sendInputEvent({ type: 'char', keyCode: char });
        } catch (e) { /* ignore */ }
    }
    await wait(500);
}

// --- Manufacturer Implementations ---

async function checkMedtronicWarning(model: string): Promise<WarningStatusResult> {
    // Strategy: Document Search. Return Manual Check + Link.
    // We could try to automate the search, but results are PDFs.
    // Safest bet is to direct user to the search page pre-filled or just the hub.
    // The Argo URL is: https://productperformance.production.argo-prd.eks.mdtcloud.io/productperformance/customer-communications.html

    return {
        manufacturer: 'Medtronic',
        status: 'manual_check',
        details: 'Medtronic advisories are document-based. Please search by model name in the opened portal.',
        link: 'https://productperformance.production.argo-prd.eks.mdtcloud.io/productperformance/customer-communications.html',
        timestamp: new Date().toISOString()
    };
}

async function checkAbbottWarning(model: string, serial: string): Promise<WarningStatusResult> {
    // Strategy: Advisory Specific. Return Manual Check + Link.
    return {
        manufacturer: 'Abbott',
        status: 'manual_check',
        details: 'Abbott utilizes advisory-specific lookup tools. Please check the portal for applicable advisories.',
        link: 'https://www.cardiovascular.abbott/us/en/hcp/product-advisories.html',
        timestamp: new Date().toISOString()
    };
}

async function checkBostonWarning(model: string, serial: string): Promise<WarningStatusResult> {
    // Strategy: Automatable. UPN + Serial.
    // Retracting automation for Boston to avoid false negatives/errors due to strict UPN requirement.
    return {
        manufacturer: 'Boston Scientific',
        status: 'manual_check',
        details: 'Boston Scientific lookup requires specific Model UPN. Please check manually.',
        link: 'https://www.bostonscientific.com/en-US/pprc/device-lookup-tool/device-lookup-tool-eu-de.html',
        timestamp: new Date().toISOString()
    };
}

async function checkBiotronikWarning(serial: string): Promise<WarningStatusResult> {
    // Strategy: Automatable (Serial only). 
    // This is robust.

    console.log(`[Warning Service] Checking Biotronik Serial: ${serial}`);

    let win: BrowserWindow | null = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: { offscreen: false, nodeIntegration: false, contextIsolation: true }
    });

    try {
        await win.loadURL('https://www.biotronik.com/en-int/professionals/services/device-lookup-tool');

        // Handle Cookie Banner logic
        await wait(2000);
        await win.webContents.executeJavaScript(`
            (function() {
                const btns = Array.from(document.querySelectorAll('button'));
                const accept = btns.find(b => b.innerText.includes('Accept') || b.innerText.includes('Alle akzeptieren'));
                if (accept) accept.click();
            })()
        `);
        await wait(1000);

        await waitForElement(win, 'input#input'); // From subagent
        await safeType(win, 'input#input', serial);

        // Click Find
        await win.webContents.executeJavaScript(`
            (function() {
                const btns = Array.from(document.querySelectorAll('button'));
                const find = btns.find(b => b.innerText.includes('FIND') || b.innerText.includes('FindEN'));
                if (find) find.click();
            })()
        `);

        await wait(3000);

        // Scrape result
        const scraping = await win.webContents.executeJavaScript(`
            (function() {
                const results = document.querySelector('.results-container') || document.body;
                const rawText = results.innerText;
                const text = rawText.replace(/\\s+/g, ' ').trim().toLowerCase();
                
                // HEURISTICS
                // Safe Phrases
                if (
                    text.includes('no advisories') || 
                    text.includes('not affected') || 
                    text.includes('could not be associated') ||
                    text.includes('no product advisory') 
                ) {
                    return { status: 'safe', text: rawText };
                }
                
                // Advisory Phrases
                // Be careful: "product advisory" might appear in the safe message!
                // We rely on the Safe check returning *first* above.
                if (
                    text.includes('advisory') || 
                    text.includes('recall') || 
                    text.includes('affected')
                ) {
                    return { status: 'advisory', text: rawText };
                }

                // Fallback
                if (text.includes('not found') || text.includes('invalid')) {
                     return { status: 'unknown', text: rawText };
                }

                // If we see text but can't classify, default to manual for safety, but log it.
                // If the text is very short, maybe we missed the load.
                if (text.length < 20) return { status: 'manual_check', text: 'Error: Content too short/empty' };

                return { status: 'manual_check', text: rawText };
            })()
        `);

        if (scraping.status === 'safe') {
            return {
                manufacturer: 'Biotronik',
                status: 'safe',
                details: 'No active advisories found for this serial number.',
                link: 'https://www.biotronik.com/en-int/professionals/services/device-lookup-tool',
                timestamp: new Date().toISOString()
            };
        } else if (scraping.status === 'advisory') {
            return {
                manufacturer: 'Biotronik',
                status: 'advisory',
                details: 'Advisories found! Please check details on manufacturer site.',
                link: 'https://www.biotronik.com/en-int/professionals/services/device-lookup-tool',
                timestamp: new Date().toISOString()
            };
        }

        // Default fallthrough
        return {
            manufacturer: 'Biotronik',
            status: 'manual_check',
            details: 'Could not automatically verify status. Please check manually.',
            link: 'https://www.biotronik.com/en-int/professionals/services/device-lookup-tool',
            timestamp: new Date().toISOString()
        };

    } catch (e: any) {
        console.error('Biotronik Check Error', e);
        return {
            manufacturer: 'Biotronik',
            status: 'manual_check',
            details: `Automation Error: ${e.message}`,
            link: 'https://www.biotronik.com/en-int/professionals/services/device-lookup-tool',
            timestamp: new Date().toISOString()
        };
    } finally {
        if (win && !win.isDestroyed()) win.destroy();
    }
}

async function checkMicroportWarning(model: string): Promise<WarningStatusResult> {
    return {
        manufacturer: 'Microport',
        status: 'manual_check',
        details: 'Microport provides semi-annual performance reports.',
        link: 'https://www.crm.microport.com/en/healthcare-professionals/product-performance',
        timestamp: new Date().toISOString()
    };
}


export const checkWarningStatus = async (
    manufacturer: string,
    model: string,
    serial?: string
): Promise<WarningStatusResult> => {
    const manuLower = (manufacturer || '').toLowerCase();

    // Normalize string to avoid known issues
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
        if (manuLower.includes('medtronic')) return await checkMedtronicWarning(safeModel);
        if (manuLower.includes('abbott') || manuLower.includes('st. jude')) return await checkAbbottWarning(safeModel, safeSerial);
        if (manuLower.includes('boston') || manuLower.includes('guidant')) return await checkBostonWarning(safeModel, safeSerial);
        if (manuLower.includes('biotronik')) return await checkBiotronikWarning(safeSerial || '');
        if (manuLower.includes('microport') || manuLower.includes('sorin') || manuLower.includes('ela')) return await checkMicroportWarning(safeModel);

        return {
            manufacturer,
            status: 'unknown',
            details: 'Manufacturer not supported for automatic warning lookup.',
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

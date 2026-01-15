import { BrowserWindow } from 'electron';

export interface MRIStatusResult {
    manufacturer: string;
    status: 'conditional' | 'unsafe' | 'unknown' | 'checking';
    details?: string;
    source?: string;
    timestamp: string;
    warning?: string;
}

// Helper to wait
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to wait for element
async function waitForElement(win: BrowserWindow, id: string, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const found = await win.webContents.executeJavaScript(`
                !!document.getElementById('${id}')
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
    // Wait for element first
    const exists = await waitForElement(win, selector);
    if (!exists) throw new Error(`Timeout waiting for element: ${selector}`);

    const focusResult = await win.webContents.executeJavaScript(`
        (function() {
            try {
                const el = document.getElementById('${selector}');
                if (!el) return 'Element not found';
                el.focus();
                el.click();
                return 'OK';
            } catch(e) { return 'Error: ' + e.toString(); }
        })()
    `);

    if (focusResult !== 'OK') {
        throw new Error(`Failed to focus ${selector}: ${focusResult}`);
    }

    // Type char by char
    for (const char of text) {
        await win.webContents.sendInputEvent({ type: 'char', keyCode: char });
        await wait(50);
    }
    await wait(500);

    // Select first option
    await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
    await wait(500);
    await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    await wait(1000);
}

async function checkBiotronik(model: string, leads: any[] = [], country: string = 'Germany'): Promise<MRIStatusResult> {
    let win: BrowserWindow | null = new BrowserWindow({
        show: false, // Keep hidden for production
        width: 1280,
        height: 900,
        webPreferences: {
            offscreen: true,
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    try {
        console.log('[MRI Service] Navigate to ProMRI Check...');
        await win.loadURL('https://www.promricheck.com');

        // 1. Enter System Check
        await waitForElement(win, 'openSystemCheck');
        await win.webContents.executeJavaScript(`
            document.getElementById('openSystemCheck').click();
        `);
        // Wait for next section (Country input)
        await waitForElement(win, 'checkProMriFrom:country_input');

        // 2. Select Country
        console.log(`[MRI Service] Setting Country: ${country}...`);
        await safeType(win, 'checkProMriFrom:country_input', country);

        // Click Continue
        const hasCountryBtn = await waitForElement(win, 'checkProMriFrom:enter-country');
        if (hasCountryBtn) {
            await win.webContents.executeJavaScript(`
                document.getElementById('checkProMriFrom:enter-country').click();
            `);
        }

        // Wait for Device input
        await waitForElement(win, 'checkProMriFrom:device_input');

        // 3. Enter Device
        console.log(`[MRI Service] Setting Device: ${model}...`);
        await safeType(win, 'checkProMriFrom:device_input', model);

        // Click Continue
        const hasDeviceBtn = await waitForElement(win, 'checkProMriFrom:enter-device');
        if (hasDeviceBtn) {
            await win.webContents.executeJavaScript(`
                document.getElementById('checkProMriFrom:enter-device').click();
            `);
        }

        await wait(2000); // Give it a moment to define next step (Lead vs Result)

        // 4. Enter Leads (if prompt appears)
        // We need to check if we are on the Lead page or Result page or if Lead input exists
        // Wait up to 5s for either Lead input or Result
        let needsLeads = false;
        const startLeadCheck = Date.now();
        while (Date.now() - startLeadCheck < 5000) {
            needsLeads = await win.webContents.executeJavaScript(`
               !!document.getElementById('checkProMriFrom:inLead1_input')
            `).catch(() => false);
            if (needsLeads) break;

            // Also check if result is already there
            const resultReady = await win.webContents.executeJavaScript(`
               !!document.getElementById('posText') || !!document.getElementById('pos')
            `).catch(() => false);
            if (resultReady) break;

            await wait(500);
        }

        if (needsLeads) {
            console.log('[MRI Service] Device requires leads. Inputting...');
            if (!leads || leads.length === 0) {
                // Return unknown instead of throwing, so we cache the result as 'check_failed' effectively?
                // Or "no_info"
                console.warn('Device requires leads but none found.');
                return {
                    manufacturer: 'Biotronik',
                    status: 'unknown',
                    details: 'Device requires leads but none found in patient data.',
                    timestamp: new Date().toISOString()
                };
            }

            // Fill Leads (Loop through potential inputs 1-4)
            for (let i = 1; i <= 4; i++) {
                const leadInputId = `checkProMriFrom:inLead${i}_input`;

                // Check existence with small wait
                const inputExists = await win.webContents.executeJavaScript(`
                    !!document.getElementById('${leadInputId}')
                `).catch(() => false);

                if (inputExists) {
                    const leadData = leads[i - 1]; // 0-indexed array vs 1-indexed DOM ID
                    if (leadData) {
                        const leadModel = leadData.model || '';
                        console.log(`[MRI Service] Inputting Lead ${i}: ${leadModel}`);
                        await safeType(win, leadInputId, leadModel);
                    }
                } else {
                    if (i > 1) break;
                }
            }

            // Submit Leads
            await waitForElement(win, 'checkProMriFrom:enter-inLead');
            await win.webContents.executeJavaScript(`
                document.getElementById('checkProMriFrom:enter-inLead').click();
            `);
            await wait(3000);
        }

        // 5. Scrape Result
        const resultData = await win.webContents.executeJavaScript(`
            (function() {
                const posText = document.getElementById('posText');
                if (posText) return { text: posText.innerText, source: '#posText' };
                
                const pos = document.getElementById('pos');
                if (pos) return { text: pos.innerText.trim(), source: '#pos' };
                
                const h2 = document.querySelector('.result h2') || document.querySelector('h2');
                if (h2 && h2.innerText.includes('MR')) return { text: h2.innerText, source: 'h2' };
                
                /* Check for error messages */
                const errorMsg = document.querySelector('.ui-messages-error-summary');
                if (errorMsg) return { text: 'ERROR: ' + errorMsg.innerText, source: 'error' };

                return { text: document.body.innerText.substring(0, 500), source: 'body' };
            })()
        `);

        console.log('[MRI Service] Raw Scrape Result:', resultData);
        const resultText = resultData.text.toLowerCase();

        let status: 'conditional' | 'unsafe' | 'unknown' = 'unknown';
        if (resultText.includes('mr conditional') || resultText.includes('mr-conditional') || resultText.includes('bedingt mr-sicher')) status = 'conditional';
        else if (resultText.includes('unsafe') || resultText.includes('not conditional') || resultText.includes('nicht mr-sicher')) status = 'unsafe';

        const pageTitle = await win.getTitle();
        console.log('[MRI Service] Result Page Title:', pageTitle);

        return {
            manufacturer: 'Biotronik',
            status,
            details: status === 'unknown' ? `Unable to parse status. Page text snippet: ${resultText.substring(0, 100)}` : `Biotronik Status: ${status}`,
            source: 'https://www.promricheck.com',
            timestamp: new Date().toISOString()
        };

    } catch (err: any) {
        console.error('Biotronik Scrape Error:', err);
        throw err;
    } finally {
        if (win) {
            win.destroy();
            win = null;
        }
    }
}

export const checkMRIStatus = async (
    manufacturer: string,
    model: string,
    serial?: string,
    leads: any[] = [],
    country: string = 'Germany'
): Promise<MRIStatusResult> => {
    console.log(`[MRI Service] Checking status for ${manufacturer} ${model}...`);

    try {
        const manu = manufacturer.toLowerCase();

        if (manu.includes('biotronik')) {
            return await checkBiotronik(model, leads, country);
        }
        // Add other manufacturers here

        return {
            manufacturer,
            status: 'unknown',
            details: 'Manufacturer automation not yet implemented.',
            timestamp: new Date().toISOString()
        };

    } catch (error: any) {
        console.error('[MRI Service] Error:', error);
        return {
            manufacturer,
            status: 'unknown',
            details: `Automation Error: ${error.message}`,
            timestamp: new Date().toISOString()
        };
    }
};

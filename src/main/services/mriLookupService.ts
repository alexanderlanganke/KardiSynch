import { BrowserWindow } from 'electron';
import { checkMedtronic } from './medtronicLogic';

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

async function checkAbbott(model: string, leads: any[]): Promise<MRIStatusResult> {
    const modelLower = model.toLowerCase();

    // Direct Exceptions for Leadless / ILR
    if (modelLower.includes('aveir') || modelLower.includes('nanostim') || modelLower.includes('lcp')) {
        return {
            manufacturer: 'Abbott',
            status: 'conditional',
            details: `System is MR Conditional (Leadless Pacemaker). Device: ${model}.`,
            timestamp: new Date().toISOString()
        };
    }
    if (modelLower.includes('confirm rx')) {
        return {
            manufacturer: 'Abbott',
            status: 'conditional',
            details: `System is MR Conditional (Insertable Cardiac Monitor). Device: ${model}.`,
            timestamp: new Date().toISOString()
        };
    }

    return {
        manufacturer: 'Abbott',
        status: 'unknown',
        details: 'Abbott automation not fully implemented yet.',
        timestamp: new Date().toISOString()
    };
}

async function checkBiotronik(model: string, leads: any[] = [], country: string = 'Germany', onProgress?: (msg: string) => void): Promise<MRIStatusResult> {
    // 0. Direct Exception for BioMonitor (ILR)
    if (model.toLowerCase().includes('biomonitor')) {
        return {
            manufacturer: 'Biotronik',
            status: 'conditional',
            details: `System is MR Conditional (Insertable Cardiac Monitor). Device: ${model}.`,
            timestamp: new Date().toISOString()
        };
    }

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
    // ... rest of function ...


    try {
        console.log('[MRI Service] Navigate to ProMRI Check...');
        if (onProgress) onProgress('Connecting to ProMRI Check...');
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
        if (onProgress) onProgress(`Selecting Region: ${country}...`);
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
        if (onProgress) onProgress(`Finding Device: ${model}...`);
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
        while (Date.now() - startLeadCheck < 10000) { // Increased timeout to 10s for safety
            // Check for VISIBLE lead input
            needsLeads = await win.webContents.executeJavaScript(`
               (function() {
                   const el = document.getElementById('checkProMriFrom:inLead1_input');
                   return el && el.offsetParent !== null && el.style.display !== 'none';
               })()
            `).catch(() => false);

            if (needsLeads) {
                console.log('[MRI Service] Visible lead input detected.');
                break;
            }

            // Check for VISIBLE result (posText or pos)
            // posText/pos exist hidden on the lead page, so we MUST check visibility
            const resultReady = await win.webContents.executeJavaScript(`
               (function() {
                   const posText = document.getElementById('posText');
                   const pos = document.getElementById('pos');
                   
                   const isVisible = (el) => el && el.offsetParent !== null && el.style.display !== 'none' && el.innerText.trim().length > 0;
                   
                   return isVisible(posText) || isVisible(pos);
               })()
            `).catch(() => false);

            if (resultReady) {
                console.log('[MRI Service] Visible result detected.');
                break;
            }

            await wait(500);
        }

        if (needsLeads) {
            console.log('[MRI Service] Device requires leads. Inputting...');
            if (onProgress) onProgress('Device requires leads. Inputting lead data...');
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

// Helper: Estimate port count from model name
function getEstimatedPortCount(modelName: string): number | null {
    const name = modelName.toUpperCase();
    if (name.includes('CRT') || name.includes('HF') || name.includes('QUAD')) return 3;
    // DX Systems (Biotronik) -> Single lead that acts as Dual, so we expect 1 lead entry
    if (name.includes('DX')) return 1;
    if (name.includes('DR') || name.includes('DUAL') || name.includes('DC')) return 2;
    if (name.includes('SR') || name.includes('VR') || name.includes('SINGLE') || name.includes('SC')) return 1;
    return null;
}

// Helper: Pre-validate MRI prerequisites
function validateMRIPrerequisites(manufacturer: string, model: string, leads: any[]): { valid: boolean; result?: MRIStatusResult } {
    const manuLower = String(manufacturer || '').toLowerCase();
    const modelLower = String(model || '').toLowerCase();

    // 1. Leadless Systems (Manufacturer Specific) -> Must have 0 leads
    let isLeadlessPacer = false;
    let isILR = false;
    let isLeadless = false; // Combined flag

    if (manuLower.includes('medtronic')) {
        // Medtronic Leadless Pacer: Micra (including model numbers MC1/MC2)
        isLeadlessPacer = modelLower.includes('micra') || modelLower.startsWith('mc1') || modelLower.startsWith('mc2');
        // Medtronic ILR: Reveal, LINQ
        isILR = modelLower.includes('reveal') || modelLower.includes('linq');
    } else if (manuLower.includes('abbott') || manuLower.includes('st. jude') || manuLower.includes('sjm')) {
        // Abbott Leadless Pacer: Aveir, Nanostim
        isLeadlessPacer = modelLower.includes('aveir') || modelLower.includes('nanostim');
        // Abbott ILR: Confirm Rx
        isILR = modelLower.includes('confirm rx');
    } else if (manuLower.includes('biotronik')) {
        // Biotronik ILR: BioMonitor
        isILR = modelLower.includes('biomonitor');
    }

    isLeadless = isLeadlessPacer || isILR;

    if (isLeadless) {
        if (leads.length > 0) {
            return {
                valid: false,
                result: {
                    manufacturer,
                    status: 'unsafe',
                    details: `Leadless device (${model}) detected, but patient has ${leads.length} recorded leads. This implies abandoned leads or data error.`,
                    timestamp: new Date().toISOString()
                }
            };
        }
        return { valid: true }; // Proceed to specific lookup
    }

    // 2. Impulse Dynamics (Optimizer) -> Exception
    if (manuLower.includes('impulse') || manuLower.includes('optimizer')) {
        return { valid: true };
    }

    // 3. Standard Devices (Not Leadless/ILR) -> Must have > 0 leads
    if (!leads || leads.length === 0) {
        return {
            valid: false,
            result: {
                manufacturer,
                status: 'unknown',
                details: 'Device requires leads but none found in patient data. Please ensure leads are entered.',
                timestamp: new Date().toISOString()
            }
        };
    }

    // 4. Manufacturer Mismatch (General Rule)
    const mismatchedLead = leads.find(l => {
        const leadManu = l.manufacturer ? l.manufacturer.toLowerCase() : '';
        return leadManu && !leadManu.includes(manuLower) && !manuLower.includes(leadManu);
    });

    if (mismatchedLead) {
        return {
            valid: false,
            result: {
                manufacturer,
                status: 'unsafe',
                details: `Manufacturer mismatch detected. Device: ${manufacturer}, Lead: ${mismatchedLead.manufacturer || 'Unknown'}. System is likely Non-MRI Conditional.`,
                timestamp: new Date().toISOString()
            }
        };
    }

    // 5. Port Count / Lead Mismatch
    const portCount = getEstimatedPortCount(model);
    if (portCount !== null) {
        if (leads.length > portCount) {
            return {
                valid: false,
                result: {
                    manufacturer,
                    status: 'unsafe',
                    details: `More leads (${leads.length}) found than device ports (${portCount}). Implies abandoned leads.`,
                    timestamp: new Date().toISOString()
                }
            };
        }
        if (leads.length < portCount) {
            return {
                valid: false,
                result: {
                    manufacturer,
                    status: 'unsafe',
                    details: `Fewer leads (${leads.length}) found than device ports (${portCount}). Plugged ports are generally not MRI conditional.`,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }

    return { valid: true };
}


async function checkSorin(model: string, leads: any[]): Promise<MRIStatusResult> {
    return {
        manufacturer: 'Microport (Sorin/ELA)',
        status: 'unknown',
        details: 'Microport/Sorin automation not fully implemented yet. Please check AutoMRI manually.',
        timestamp: new Date().toISOString()
    };
}

export const checkMRIStatus = async (
    manufacturer: string,
    model: string,
    serial?: string,
    leads: any[] = [],
    country: string = 'Germany',
    onProgress?: (msg: string) => void
): Promise<MRIStatusResult> => {
    // Ensure inputs are strings (handle potential parsing artifacts)
    const safeManu = String(manufacturer || '').trim();
    const safeModel = String(model || '').trim();

    console.log(`[MRI Service] Checking status for ${safeManu} ${safeModel}...`);

    if (!safeManu || !safeModel || safeManu === 'Unknown' || safeManu === 'undefined') {
        return {
            manufacturer: safeManu || 'Unknown',
            status: 'unknown',
            details: 'Device manufacturer or model information is missing.',
            timestamp: new Date().toISOString()
        };
    }

    // 1. Run Pre-Validation
    const preCheck = validateMRIPrerequisites(safeManu, safeModel, leads);
    if (!preCheck.valid && preCheck.result) {
        console.warn('[MRI Service] Pre-validation failed:', preCheck.result.details);
        return preCheck.result;
    }

    try {
        const manu = safeManu.toLowerCase();

        if (manu.includes('biotronik')) {
            return await checkBiotronik(model, leads, country, onProgress);
        }

        if (manu.includes('medtronic')) {
            return await checkMedtronic(model, leads);
        }

        if (manu.includes('abbott') || manu.includes('st. jude') || manu.includes('sjm')) {
            return await checkAbbott(model, leads);
        }

        if (manu.includes('sorin') || manu.includes('ela') || manu.includes('microport')) {
            return await checkSorin(model, leads);
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


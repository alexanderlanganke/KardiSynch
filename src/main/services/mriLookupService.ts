import { BrowserWindow } from 'electron';
import { checkMedtronic } from './medtronicLogic';
import { checkBoston } from './bostonLogic';
import { ScraperService } from './ScraperService';

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

// Helper to wait for element by ID, with fast polling that backs off
async function waitForElement(win: BrowserWindow, id: string, timeout = 10000) {
    const start = Date.now();
    let interval = 100; // Start fast, back off
    while (Date.now() - start < timeout) {
        try {
            const found = await win.webContents.executeJavaScript(`
                !!document.getElementById('${id}')
            `);
            if (found) return true;
        } catch (e) {
            // Ignore execution errors during navigation
        }
        await wait(interval);
        interval = Math.min(interval * 1.5, 500); // Back off to max 500ms
    }
    return false;
}

// Helper to wait for any visible element matching a JS condition
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

    // Type char by char (needed for PrimeFaces autocomplete)
    for (const char of text) {
        await win.webContents.sendInputEvent({ type: 'char', keyCode: char });
        await wait(30);
    }
    await wait(300);

    // Select first option
    await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
    await wait(200);
    await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    await wait(500);
}

// Helper to interact with Select2 components (common in Abbott site)
async function interactWithSelect2(win: BrowserWindow, selectId: string, text: string) {
    // 1. Open the dropdown using jQuery (safest on this site)
    const openResult = await win.webContents.executeJavaScript(`
        (function() {
            try {
                const $el = $('#' + '${selectId}');
                if (!$el.length) return 'Select element not found';
                $el.select2('open');
                return 'OK';
            } catch(e) { return 'Error opening select2: ' + e.toString(); }
        })()
    `);

    if (openResult !== 'OK') {
        throw new Error(`Failed to open Select2 #${selectId}: ${openResult}`);
    }

    // Wait for search field to appear
    await waitForCondition(win, `!!document.querySelector('.select2-container--open input.select2-search__field')`, 3000);

    // 2. Type into the search field
    const searchSelector = '.select2-container--open input.select2-search__field';
    const typeResult = await win.webContents.executeJavaScript(`
        (function() {
            const input = document.querySelector('${searchSelector}');
            if (!input) return 'Search input not found';
            input.value = '${text}';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return 'OK';
        })()
    `);

    if (typeResult !== 'OK') {
        console.log(`[Abbott] Direct input failed, trying keystrokes for ${selectId}`);
        for (const char of text) {
            await win.webContents.sendInputEvent({ type: 'char', keyCode: char });
            await wait(30);
        }
    } else {
        await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' });
    }

    // Wait for results to appear
    await waitForCondition(win, `!!document.querySelector('.select2-results__option')`, 3000);

    // 3. Select the first result
    await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    await wait(500); // Brief settle for selection to apply
}

async function checkAbbott(model: string, leads: any[], country: string = 'Germany'): Promise<MRIStatusResult> {
    console.log(`[MRI Service] Abbott Check: ${model} with ${leads.length} leads...`);

    const scraper = ScraperService.getInstance();
    await scraper.resetWindow();
    const win = scraper.getWindow();

    try {
        // Safe Load URL
        try {
            await win.loadURL('https://mri.merlin.net/');
        } catch (loadErr: any) {
            console.error('[Abbott] Load failed (Network/Env issue):', loadErr.message);
            return {
                manufacturer: 'Abbott',
                status: 'unknown',
                details: `Network/Connection failure: ${loadErr.message}. Cannot verify MRI status online.`,
                timestamp: new Date().toISOString()
            };
        }

        // 1. Select Country (Mandatory first step)
        console.log('[Abbott] Measuring Country...');
        await interactWithSelect2(win, 'country', country);

        // 2. Select Device
        console.log(`[Abbott] Setting Device: ${model}...`);
        await interactWithSelect2(win, 'device', model);

        // 3. Select Leads
        // The site has lead1, lead2, lead3.
        // We need to map our leads to these slots.
        // Logic: Try to find each patient lead in the dropdown.
        // If we have more leads than slots (3), warn.

        const slots = ['lead1', 'lead2', 'lead3'];
        let leadsMatched = 0;

        for (let i = 0; i < leads.length && i < slots.length; i++) {
            const leadModel = leads[i].model || leads[i].name || '';
            if (!leadModel) continue;

            console.log(`[Abbott] Setting Lead ${i + 1}: ${leadModel}...`);
            try {
                // Check if lead exists in options before trying to select?
                // interactWithSelect2 will try to filter. If not found, it might select matched "nothing" or first irrelevant option.
                // Robustness: We should check if the search resulted in a match.
                // For now, let's try to select it.
                await interactWithSelect2(win, slots[i], leadModel);
                leadsMatched++;
            } catch (e) {
                console.warn(`[Abbott] Failed to set lead ${leadModel}`, e);
            }
        }

        // 4. Check Results — wait for result table or timeout
        await waitForCondition(win, `!!document.querySelector('table.table-striped')`, 5000);

        const resultData = await win.webContents.executeJavaScript(`
            (function() {
                const table = document.querySelector('table.table-striped'); // Heuristic class
                if (!table) {
                    // Check for "No MR Conditional" messages?
                    return { found: false, text: document.body.innerText };
                }
                return { found: true, text: table.innerText };
            })()
        `);

        if (!resultData.found) {
            // If we selected devices but no table appeared, it usually means "Not MRI Conditional"
            // Or inputs were invalid.
            return {
                manufacturer: 'Abbott',
                status: 'unsafe',
                details: 'Device combination not found or not MRI Conditional (no results table appeared).',
                timestamp: new Date().toISOString()
            };
        }

        const text = resultData.text.toLowerCase();
        let status: 'conditional' | 'unsafe' | 'unknown' = 'conditional';
        let details = resultData.text.substring(0, 200).replace(/\s+/g, ' ').trim(); // Summary

        // Analyze text for keywords
        // "MR Conditional" is usually implied by the presence of the table with scan parameters.
        // Look for specific exclusions or "Non-Conditional" text?
        // Usually the table *lists* the conditional zones.
        // e.g. "Full Body", "Exclusion Zone", etc.

        if (text.includes('non-mri') || text.includes('unsafe') || text.includes('conditional not met')) {
            status = 'unsafe';
        }

        // Capture specific scan parameters if possible
        const scanRegion = text.includes('ganzkörper') || text.includes('full body') ? 'Full Body' : 'Restricted';
        details = `System is MR Conditional (${scanRegion}). Table data found.`;

        return {
            manufacturer: 'Abbott',
            status: status,
            details: details,
            timestamp: new Date().toISOString()
        };

    } catch (e: any) {
        console.error('[Abbott] Check failed:', e);
        return {
            manufacturer: 'Abbott',
            status: 'unknown',
            details: `Abbott online check failed: ${e.message}`,
            timestamp: new Date().toISOString()
        };
    } finally {
        // Do not destroy window
    }
}

async function checkBiotronik(model: string, leads: any[] = [], country: string = 'Germany', onProgress?: (msg: string) => void): Promise<MRIStatusResult> {
    // 0. Direct Exception for BioMonitor (ILR)
    if ((model || '').toLowerCase().includes('biomonitor')) {
        return {
            manufacturer: 'Biotronik',
            status: 'conditional',
            details: `System is MR Conditional (Insertable Cardiac Monitor). Device: ${model}.`,
            timestamp: new Date().toISOString()
        };
    }

    const scraper = ScraperService.getInstance();
    await scraper.resetWindow();
    const win = scraper.getWindow();

    // ... rest of function ...


    try {
        console.log('[MRI Service] Navigate to ProMRI Check...');
        if (onProgress) onProgress('Connecting to ProMRI Check...');

        try {
            await win.loadURL('https://www.promricheck.com');
        } catch (loadErr: any) {
            console.error('[Biotronik] Load failed (Network/Env issue):', loadErr.message);
            return {
                manufacturer: 'Biotronik',
                status: 'unknown',
                details: `Network/Connection failure: ${loadErr.message}. Cannot verify MRI status online.`,
                timestamp: new Date().toISOString()
            };
        }

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

        // 4. Enter Leads (if prompt appears)
        // Poll for either lead input or result — no fixed wait needed
        let needsLeads = false;
        const startLeadCheck = Date.now();
        while (Date.now() - startLeadCheck < 12000) {
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
            // Wait for result to become visible instead of fixed 3s
            await waitForCondition(win, `
                (function() {
                    const posText = document.getElementById('posText');
                    const pos = document.getElementById('pos');
                    const isVisible = (el) => el && el.offsetParent !== null && el.style.display !== 'none' && el.innerText.trim().length > 0;
                    return isVisible(posText) || isVisible(pos);
                })()
            `, 10000);
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
        // Do not destroy
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
        const leadManu = String(l.manufacturer || '').toLowerCase();
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
            return await checkBiotronik(safeModel, leads, country, onProgress);
        }

        if (manu.includes('medtronic')) {
            return await checkMedtronic(safeModel, leads);
        }

        if (manu.includes('abbott') || manu.includes('st. jude') || manu.includes('sjm')) {
            return await checkAbbott(safeModel, leads);
        }

        if (manu.includes('boston') || manu.includes('guidant')) {
            return await checkBoston(safeModel, leads);
        }

        if (manu.includes('sorin') || manu.includes('ela') || manu.includes('microport')) {
            return await checkSorin(safeModel, leads);
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


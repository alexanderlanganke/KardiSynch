import { BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';

const MEDTRONIC_URL = 'https://www.medtronic.com/en-us/healthcare-professionals/mri-resources/mr-conditional-search-tool.html';
const ASSETS_PATH = path.join(__dirname, '../assets');
const LOCAL_DATA_PATH = path.join(ASSETS_PATH, 'medtronic_data.json');

export async function checkForMedtronicUpdates(): Promise<{ updated: boolean; count: number; error?: string }> {
    console.log('[Medtronic Updater] Checking for updates...');
    let win: BrowserWindow | null = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: {
            offscreen: true,
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    try {
        await win.loadURL(MEDTRONIC_URL);

        // Wait for list to load
        // The list is in <ul class="list"> and has <li> elements
        await win.webContents.executeJavaScript(`
            new Promise((resolve) => {
                const check = () => {
                    const list = document.querySelector('ul.list');
                    if (list && list.querySelectorAll('li').length > 50) resolve();
                    else setTimeout(check, 500);
                };
                check();
            })
        `);

        // Scrape Data
        const scrapedData = await win.webContents.executeJavaScript(`
            (function() {
                const items = [];
                const listItems = document.querySelectorAll('ul.list > li');
                
                listItems.forEach(li => {
                    const modelName = li.querySelector('.modelName')?.innerText?.trim() || '';
                    const modelNumber = li.querySelector('.model')?.innerText?.trim() || '';
                    const pacingLeads = li.querySelector('.pacingLeads')?.innerText?.trim() || '';
                    const pacing6725 = li.querySelector('.pacing6725')?.innerText?.trim() || '';
                    const defibLeads = li.querySelector('.defibLeads')?.innerText?.trim() || '';
                    const crtPacingLeads = li.querySelector('.crtPacingLeads')?.innerText?.trim() || '';
            
                    if (modelName) {
                        items.push({
                            modelName,
                            modelNumber,
                            pacingLeads,
                            pacing6725,
                            defibLeads,
                            crtPacingLeads
                        });
                    }
                });
                return items;
            })()
        `);

        console.log(`[Medtronic Updater] Scraped ${scrapedData.length} items from website.`);

        if (scrapedData.length === 0) {
            return { updated: false, count: 0, error: 'Failed to scrape data or website changed.' };
        }

        // Compare with local data (basic count check or full deep compare?)
        // Let's do a basic JSON stringify compare for simplicity and robustness.
        let localData = [];
        try {
            if (fs.existsSync(LOCAL_DATA_PATH)) {
                localData = JSON.parse(fs.readFileSync(LOCAL_DATA_PATH, 'utf8'));
            }
        } catch (e) {
            console.warn('[Medtronic Updater] Local data missing or corrupt.', e);
        }

        // Normalize for comparison (order might differ, but usually scraping order is consistent-ish?)
        // Actually, let's just save it. If it's same, we can report "No meaningful changes" if we want,
        // but overwriting with fresh data is always safe.
        // To report "Updated" vs "Already up to date", we can compare JSON strings.

        const newJson = JSON.stringify(scrapedData, null, 2);
        const oldJson = JSON.stringify(localData, null, 2);

        if (newJson === oldJson) {
            console.log('[Medtronic Updater] Local data is already up to date.');
            return { updated: false, count: scrapedData.length };
        }

        // Save new data
        if (!fs.existsSync(ASSETS_PATH)) {
            fs.mkdirSync(ASSETS_PATH, { recursive: true });
        }

        fs.writeFileSync(LOCAL_DATA_PATH, newJson);
        console.log(`[Medtronic Updater] Updated local database with ${scrapedData.length} items.`);

        return { updated: true, count: scrapedData.length };

    } catch (error: any) {
        console.error('[Medtronic Updater] Error:', error);
        return { updated: false, count: 0, error: error.message };
    } finally {
        if (win) {
            win.destroy();
            win = null;
        }
    }
}

import { BrowserWindow, app } from 'electron';
import fs from 'fs';
import path from 'path';

// Define the shape of our scraped data
export interface BostonDeviceData {
    modelName: string;
    modelNumbers: string[]; // ["D532", "D533"]
    mriModality: string;    // "1.5T", "3T", "1.5T & 3T"
    type: 'generator' | 'lead' | 'sicd' | 'icm';
}

const BOSTON_URL = 'https://www.bostonscientific.com/imageready/en-US/model-lookup.html';

// Lazy path getter
const getLocalDataPath = () => path.join(app.getPath('userData'), 'boston_data.json');

export async function checkForBostonUpdates(): Promise<{ updated: boolean; count: number; error?: string }> {
    console.log('[Boston Updater] Checking for updates...');
    const localDataPath = getLocalDataPath();

    let win: BrowserWindow | null = new BrowserWindow({
        show: false,
        width: 1280,
        height: 1000,
        webPreferences: {
            offscreen: true,
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    try {
        await win.loadURL(BOSTON_URL);

        // Wait for main content
        await win.webContents.executeJavaScript(`
            new Promise((resolve) => {
                const check = () => {
                    // Check for a known footer or main table
                    if (document.querySelector('footer') || document.querySelectorAll('table').length > 5) resolve();
                    else setTimeout(check, 500);
                };
                check();
            })
        `);

        // Scrape logic
        const scrapedItems: BostonDeviceData[] = await win.webContents.executeJavaScript(`
            (function() {
                try {
                    const items = [];
                    const clean = (t) => t ? t.innerText.trim().replace(/\\n/g, ' ') : '';

                    // 1. Scrape Tables with Grid Expansion for Rowspan
                    const tables = document.querySelectorAll('table');
                    
                    tables.forEach((table, tableIdx) => {
                        const rows = Array.from(table.querySelectorAll('tr'));
                        if (rows.length === 0) return;

                        // Build Grid
                        // We don't know exact col count, but let's assume max 10.
                        const grid = [];
                        
                        // Initialize grid rows
                        for (let r = 0; r < rows.length; r++) {
                            grid[r] = [];
                        }

                        rows.forEach((row, rIdx) => {
                            const cells = Array.from(row.children); // th or td
                            let cIdx = 0;
                            
                            cells.forEach(cell => {
                                // Find next free slot in this row
                                while (grid[rIdx][cIdx]) {
                                    cIdx++;
                                }

                                const content = clean(cell);
                                const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10);
                                const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);

                                // Fill current slot and downward if rowspan > 1
                                for (let rSpan = 0; rSpan < rowspan; rSpan++) {
                                    for (let cSpan = 0; cSpan < colspan; cSpan++) {
                                        if (grid[rIdx + rSpan]) {
                                            grid[rIdx + rSpan][cIdx + cSpan] = {
                                                text: content,
                                                isHeader: cell.tagName === 'TH'
                                            };
                                        }
                                    }
                                }
                                cIdx += colspan;
                            });
                        });

                        // Now read data from Grid
                        // Assuming Row 0 is headers
                        if (grid.length < 2) return;
                        
                        const headerRow = grid[0].map(c => c ? c.text.toLowerCase() : '');
                        const modelIdx = headerRow.findIndex(h => h.includes('model numbers'));
                        const nameIdx = headerRow.findIndex(h => h.includes('device name'));
                        // 'configuration' matches 'mri system configuration'
                        const mriIdx = headerRow.findIndex(h => h.includes('mri') || h.includes('configuration'));

                        if (modelIdx === -1 || nameIdx === -1) return; // Not a relevant table

                        // Iterate data rows
                        for (let i = 1; i < grid.length; i++) {
                            const row = grid[i];
                            if (!row) continue;

                            const name = row[nameIdx] ? row[nameIdx].text : '';
                            const modelsStr = row[modelIdx] ? row[modelIdx].text : '';
                            const mri = row[mriIdx] ? row[mriIdx].text : '';

                            if (!modelsStr || !name) continue;

                            // Split models
                            const models = modelsStr.split(/[,\\n]/).map(s => s.trim()).filter(s => s.length > 0);
                            
                            // Determine type based on explicit "Therapy" column? 
                            // Or heuristic: Name/Content.
                            let type = 'generator';
                            if (name.toLowerCase().includes('lead') || name.toLowerCase().includes('cap') || name.toLowerCase().includes('port') || modelsStr.length > 50) {
                                // High chance of lead if model string is super long text block?
                                // Table data usually has clean CSV models.
                                type = 'lead';
                            }
                            if (headerRow.some(h => h.includes('therapy'))) {
                                const therapyIdx = headerRow.findIndex(h => h.includes('therapy'));
                                const therapy = (row[therapyIdx] ? row[therapyIdx].text : '').toLowerCase();
                                if (therapy.includes('defibrillator') || therapy.includes('icd') || therapy.includes('crt')) type = 'generator';
                                if (therapy.includes('monitor') || therapy.includes('icm')) type = 'icm';
                                if (therapy.includes('lead')) type = 'lead';
                            }

                            items.push({
                                modelName: name,
                                modelNumbers: models,
                                mriModality: mri,
                                type: type
                            });
                        }
                    });

                    // 2. Text Block Parsing for Leads (Fallback/Supplementary)
                    const mainContent = document.querySelector('main') || document.body;
                    const textBlocks = mainContent.querySelectorAll('p, li');
                    textBlocks.forEach(block => {
                         const txt = clean(block);
                         if (txt.includes(':') && /[0-9]+/.test(txt)) {
                             const parts = txt.split(':');
                             if (parts.length >= 2) {
                                  const namePart = parts[0].trim();
                                  const output = parts[1].trim(); 
                                  if (output.length > 0 && output.length < 200) { 
                                      const models = output.split(',').map(s => s.trim()).filter(Boolean);
                                      if (models.length > 0) {
                                          const isClean = models.every(m => m.split(' ').length < 3); 
                                          if (isClean && namePart.length < 50) {
                                              items.push({
                                                  modelName: namePart,
                                                  modelNumbers: models,
                                                  mriModality: 'Conditional (See Manual)', 
                                                  type: 'lead'
                                              });
                                          }
                                      }
                                  }
                             }
                         }
                     });

                    return items;

                } catch (err) {
                    return { error: err.toString(), stack: err.stack };
                }
            })()
        `);

        if (scrapedItems && (scrapedItems as any).error) {
            console.error('[Boston Updater] Script Error:', (scrapedItems as any).error);
            return { updated: false, count: 0, error: (scrapedItems as any).error };
        }

        console.log(`[Boston Updater] Scraped ${scrapedItems.length} entries.`);

        if (scrapedItems.length === 0) {
            return { updated: false, count: 0, error: 'No data scraped.' };
        }

        // Save
        const dir = path.dirname(localDataPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(localDataPath, JSON.stringify(scrapedItems, null, 2));

        return { updated: true, count: scrapedItems.length };

    } catch (e: any) {
        console.error('[Boston Updater] Error:', e);
        return { updated: false, count: 0, error: e.message };
    } finally {
        if (win) win.destroy();
    }
}

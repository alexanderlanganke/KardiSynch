import { BrowserWindow, ipcMain } from 'electron';
import crypto from 'crypto';
import { getDb, updatePatientMRIStatus } from '../database';
import { checkMRIStatus } from './mriLookupService';
import { getAllSettings } from '../settingsService';

interface QueueItem {
    patientId: string;
    manufacturer: string;
    model: string;
    serial?: string;
    leads: any[];
    hash: string;
}

export class AutomationManager {
    private static instance: AutomationManager;
    private queue: QueueItem[] = [];
    private isProcessing = false;
    private win: BrowserWindow | null = null;

    private constructor() { }

    static getInstance(): AutomationManager {
        if (!AutomationManager.instance) {
            AutomationManager.instance = new AutomationManager();
        }
        return AutomationManager.instance;
    }

    setWindow(win: BrowserWindow) {
        this.win = win;
    }

    // Calculate hash of MRI-relevant data
    private calculateHash(manufacturer: string, model: string, serial: string, leads: any[]): string {
        const data = `${manufacturer}|${model}|${serial}|${JSON.stringify(leads)}`;
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    // Start periodic scanning (e.g. every hour)
    startMonitoring() {
        console.log('[AutomationManager] Starting background monitoring...');
        this.scanAndQueue();

        // Check every 6 hours
        setInterval(() => {
            this.scanAndQueue();
        }, 6 * 60 * 60 * 1000);
    }

    // Scan all patients and queue updates if needed
    async scanAndQueue() {
        if (this.isProcessing) return; // Don't scan if busy processing? Actually scanning is fast, processing is slow.
        // But if queue is full, maybe wait? No, queue handles it.

        console.log('[AutomationManager] Accessing DB to scan patients...');
        const db = getDb();

        // Fetch all patients with their MRI hash and latest device data
        // We need a complex query to get device data from Reports or cached columns?
        // Current Patients table doesn't have device info directly (it's in Reports).
        // We need to disable this check if no reports exist.

        // Efficient query: Get Patient + Latest Report Device Data
        // We'll process in chunks or all at once (20 patients is small, but 2000?)
        // SQLite can handle it.

        db.all(`
      SELECT p.id, p.mri_data_hash, 
             r.manufacturer, r.device_model, r.device_serial_number, r.data
      FROM Patients p
      LEFT JOIN Reports r ON r.patient_id = p.id
      GROUP BY p.id
      HAVING r.interrogation_date = MAX(r.interrogation_date) OR r.id IS NULL
    `, async (err, rows: any[]) => {
            if (err) {
                console.error('[AutomationManager] Scan failed:', err);
                return;
            }

            console.log(`[AutomationManager] Scanned ${rows.length} patients.`);
            const settings = await getAllSettings();
            // Parse settings.mri.allowed? Need to implement that setting structure first.

            for (const row of rows) {
                if (!row.manufacturer) continue; // No device data

                // Check Settings
                const allowed = settings.mriManufacturers?.[row.manufacturer] ?? false;
                if (!allowed) continue;

                let leads: any[] = [];
                try {
                    if (row.data) {
                        const parsed = JSON.parse(row.data);
                        leads = parsed.leads || [];
                    }
                } catch (e) { /* ignore */ }

                const hash = this.calculateHash(row.manufacturer, row.device_model, row.device_serial_number || '', leads);

                // If Changed or Never Checked
                if (row.mri_data_hash !== hash) {
                    console.log(`[AutomationManager] Queueing MRI check for ${row.id} (Hash mismatch)`);
                    this.addToQueue({
                        patientId: row.id,
                        manufacturer: row.manufacturer,
                        model: row.device_model,
                        serial: row.device_serial_number,
                        leads,
                        hash
                    });
                }
            }
        });
    }

    addToQueue(item: QueueItem) {
        // Avoid duplicates
        if (this.queue.some(q => q.patientId === item.patientId)) return;

        this.queue.push(item);
        this.processQueue();
        this.broadcastStatus();
    }

    private async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const item = this.queue[0]; // Peek

        try {
            this.broadcastStatus(`Checking MRI: ${item.manufacturer} device...`, item.patientId);
            this.broadcastProcessStatus('start', item, 'Initializing check...', 0);

            // 1. Validate Leads (Pre-check)
            const validation = this.validateLeadCount(item.model, item.leads);
            if (!validation.valid) {
                console.log(`[AutomationManager] Validation Failed for ${item.patientId}: ${validation.reason}`);

                // Save 'unknown' status immediately
                const result = {
                    manufacturer: item.manufacturer,
                    status: 'unknown' as const,
                    details: `Validation Failed: ${validation.reason}`,
                    timestamp: new Date().toISOString()
                };

                await updatePatientMRIStatus(item.patientId, result, item.hash);

                if (this.win) this.win.webContents.send('patient-list-update');
                this.broadcastProcessStatus('complete', item, `Skipped: ${validation.reason}`, 100);

                // Skip to finally
                return;
            }

            const settings = await getAllSettings();
            const country = settings.mriCountry || 'Germany';

            this.broadcastProcessStatus('progress', item, 'Scraping manufacturer portal...', 30);

            // Call the scraper
            const result = await checkMRIStatus(
                item.manufacturer,
                item.model,
                item.serial,
                item.leads,
                country
            );

            this.broadcastProcessStatus('progress', item, 'Processing result...', 90);

            // Save to DB
            await updatePatientMRIStatus(item.patientId, result, item.hash);
            console.log(`[AutomationManager] Completed ${item.patientId}: ${result.status}`);

            // Notify UI to refresh data
            if (this.win) this.win.webContents.send('patient-list-update');
            this.broadcastProcessStatus('complete', item, `Completed: ${result.status}`, 100);

        } catch (error) {
            console.error(`[AutomationManager] Error processing ${item.patientId}:`, error);
            // Save error state
            await updatePatientMRIStatus(item.patientId, { status: 'check_failed', details: String(error) }, item.hash);

            this.broadcastProcessStatus('error', item, 'Check failed', 100);
        } finally {
            this.queue.shift(); // Remove
            this.isProcessing = false;
            this.processQueue(); // Next
            this.broadcastStatus();
        }
    }

    // Force a specific patient check
    async forceCheck(patientId: string) {
        console.log(`[AutomationManager] Force checking ${patientId}...`);
        const db = getDb();

        db.get(`
           SELECT p.id, r.manufacturer, r.device_model, r.device_serial_number, r.data
           FROM Patients p
           LEFT JOIN Reports r ON r.patient_id = p.id
           WHERE p.id = ?
           ORDER BY r.interrogation_date DESC LIMIT 1
        `, [patientId], async (err, row: any) => {
            if (err || !row) return;

            let leads: any[] = [];
            try {
                if (row.data) {
                    const parsed = JSON.parse(row.data);
                    leads = parsed.leads || [];
                }
            } catch (e) { /* ignore */ }

            const hash = this.calculateHash(row.manufacturer, row.device_model, row.device_serial_number || '', leads);

            this.addToQueue({
                patientId: row.id,
                manufacturer: row.manufacturer,
                model: row.device_model,
                serial: row.device_serial_number,
                leads,
                hash
            });
        });
    }

    private broadcastProcessStatus(type: 'start' | 'progress' | 'complete' | 'error', item: QueueItem, message: string, progress?: number) {
        if (this.win) {
            this.win.webContents.send('process-status', {
                taskId: `mri-${item.patientId}`,
                type,
                title: `MRI Check: ${item.manufacturer}`,
                message,
                progress
            });
        }
    }

    private broadcastStatus(message?: string, currentId?: string) {
        if (this.win) {
            this.win.webContents.send('automation-status', {
                queueLength: this.queue.length,
                isProcessing: this.isProcessing,
                currentMessage: message,
                currentPatientId: currentId
            });
        }
    }

    private validateLeadCount(model: string, leads: any[]): { valid: boolean; reason?: string } {
        // 1. No leads -> Unknown
        if (!leads || leads.length === 0) {
            return { valid: false, reason: 'No lead data available' };
        }

        const m = (model || '').toUpperCase();
        console.log(`[AutomationManager] Validating leads for ${m}, LeadCount: ${leads.length}`);

        const count = leads.length;

        // 2. Mismatch Logic based on common suffixes/types
        // Single Chamber (VR, SR, S) -> Expects 1
        if (m.match(/\b(VR|SR|S)(-T)?\b/) && count !== 1) {
            return { valid: false, reason: `Model ${model} expects 1 lead, found ${count}` };
        }

        // Dual Chamber (DR, D) -> Expects 2
        if (m.match(/\b(DR|D)(-T)?\b/) && count !== 2) {
            return { valid: false, reason: `Model ${model} expects 2 leads, found ${count}` };
        }

        // CRT (HF, CRT, QP) -> Expects >= 3
        if (m.match(/\b(CRT|HF|QP)\b/) && count < 3) {
            return { valid: false, reason: `Model ${model} expects 3+ leads, found ${count}` };
        }

        return { valid: true };
    }
}

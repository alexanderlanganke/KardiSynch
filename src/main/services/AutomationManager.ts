import { app, BrowserWindow } from 'electron';
import { checkMRIStatus } from './mriLookupService';
import { checkWarningStatus } from './warningLookupService';
import { getDb } from '../database';
import { sendNotification, sendProcessStatus } from '../windowManager';
import { ScraperService } from './ScraperService';
import fs from 'fs';
import path from 'path';

const SCRAPER_TIMEOUT_MS = 60000; // 60s timeout per scraper check

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
        promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
}

// Manufacturers whose MRI check requires the scraper (browser automation)
const SCRAPER_MRI_MANUFACTURERS = ['biotronik', 'abbott', 'st. jude', 'sjm'];
// Manufacturers whose warning check requires the scraper
const SCRAPER_WARNING_MANUFACTURERS = ['biotronik'];

function needsScraper(item: any): boolean {
    const manu = (item.manufacturer || '').toLowerCase();
    if (item.type === 'mri') {
        return SCRAPER_MRI_MANUFACTURERS.some(s => manu.includes(s));
    }
    if (item.type === 'warning') {
        return SCRAPER_WARNING_MANUFACTURERS.some(s => manu.includes(s));
    }
    return false;
}

export class AutomationManager {
    private static instance: AutomationManager;
    private checkQueue: any[] = [];
    private isProcessing = false;
    private mainWindow: BrowserWindow | null = null;
    private monitoringInterval: NodeJS.Timeout | null = null;
    private processedHashes: Set<string> = new Set();
    private processedWarningHashes: Set<string> = new Set();

    // Leadless keywords alignment with mriLookupService
    private LEADLESS_KEYWORDS = ['Micra', 'Leadless', 'Nanostim', 'Aveir', 'MC1', 'MC2', 'LCP'];

    private constructor() { }

    static getInstance(): AutomationManager {
        if (!AutomationManager.instance) {
            AutomationManager.instance = new AutomationManager();
        }
        return AutomationManager.instance;
    }

    setWindow(window: BrowserWindow) {
        this.mainWindow = window;
    }

    // Phase 2: Persist processed hashes to disk so we don't re-check across restarts
    private get hashCachePath(): string {
        return path.join(app.getPath('userData'), 'automation_hash_cache.json');
    }

    private loadHashCache() {
        try {
            if (fs.existsSync(this.hashCachePath)) {
                const data = JSON.parse(fs.readFileSync(this.hashCachePath, 'utf8'));
                this.processedHashes = new Set(data.mri || []);
                this.processedWarningHashes = new Set(data.warning || []);
                console.log(`[AutomationManager] Loaded hash cache: ${this.processedHashes.size} MRI, ${this.processedWarningHashes.size} warning hashes.`);
            }
        } catch (e) {
            console.warn('[AutomationManager] Failed to load hash cache:', e);
        }
    }

    private saveHashCache() {
        try {
            const data = {
                mri: Array.from(this.processedHashes),
                warning: Array.from(this.processedWarningHashes)
            };
            fs.writeFileSync(this.hashCachePath, JSON.stringify(data));
        } catch (e) {
            console.warn('[AutomationManager] Failed to save hash cache:', e);
        }
    }

    startMonitoring() {
        if (this.monitoringInterval) return;
        console.log('[AutomationManager] Starting background monitoring...');

        // Phase 2: Load persisted hash cache
        this.loadHashCache();

        // Initialize Scraper Service (Background Window)
        ScraperService.getInstance().init();

        // Phase 4: Defer initial full scan to let UI settle
        setTimeout(() => {
            this.scanForPendingPatients();
        }, 10000);

        // Phase 4: Check every 15 minutes (was 5m — hash dedup makes frequent scans wasteful)
        this.monitoringInterval = setInterval(() => {
            this.scanForPendingPatients();
        }, 15 * 60 * 1000);
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        // Phase 2: Persist hashes on shutdown
        this.saveHashCache();
        ScraperService.getInstance().close();
    }

    // Phase 4: Queue checks for a single patient (called after import)
    async queuePatient(patientId: string) {
        const db = getDb();
        const query = `
            SELECT p.id, p.first_name, p.last_name, p.mri_status, p.mri_data_hash,
                   p.manufacturer_warning_status, p.manufacturer_warning_hash,
                   r.manufacturer, r.device_model, r.device_serial_number, r.data
            FROM Patients p
            LEFT JOIN Reports r ON r.patient_id = p.id
            WHERE p.id = ?
            ORDER BY r.interrogation_date DESC
            LIMIT 1
        `;

        db.get(query, [patientId], (err, row: any) => {
            if (err || !row) return;
            this.enqueueFromRow(row, false);
        });
    }

    private async scanForPendingPatients(force: boolean = false) {
        const db = getDb();
        console.log(`[AutomationManager] Scanning patients... (Force: ${force})`);

        if (force) sendNotification('Scanning database for patients to re-validate...', 'info');

        let query = `
            SELECT p.id, p.first_name, p.last_name, p.mri_status, p.mri_data_hash,
                   p.manufacturer_warning_status, p.manufacturer_warning_hash,
                   r.manufacturer, r.device_model, r.device_serial_number, r.data
            FROM Patients p
            LEFT JOIN Reports r ON r.patient_id = p.id
        `;

        // If NOT forcing, only check unknown/missing
        if (!force) {
            query += ` WHERE (p.mri_status IS NULL OR p.mri_status = '{"status":"unknown"}' OR p.mri_status = '')
                        OR (p.manufacturer_warning_status IS NULL OR p.manufacturer_warning_status = '{"status":"unknown"}' OR p.manufacturer_warning_status = '') `;
        }

        query += ` ORDER BY r.interrogation_date DESC`;

        db.all(query, [], (err, rows: any[]) => {
            if (err) {
                console.error('[AutomationManager] DB Scan failed:', err);
                return;
            }

            console.log(`[AutomationManager] Found ${rows.length} rows to evaluate.`);
            if (force) sendNotification(`Found ${rows.length} patients. Queuing checks...`, 'info');

            rows.forEach(row => this.enqueueFromRow(row, force));
        });
    }

    private enqueueFromRow(row: any, force: boolean) {
        if (!row.manufacturer || !row.device_model) return;

        let leads: any[] = [];
        try {
            if (row.data) {
                const parsed = JSON.parse(row.data);
                leads = parsed.leads || [];
            }
        } catch (e) { /* ignore */ }

        const hash = this.calculateHash(row.manufacturer, row.device_model, row.device_serial_number || '', leads);
        const warningHash = this.calculateWarningHash(row.manufacturer, row.device_model, row.device_serial_number || '', leads);

        // Phase 2: Skip if hash matches what's already stored AND status isn't empty
        // This prevents re-checking patients whose config hasn't changed,
        // even if their status is 'unknown' (e.g. from a previous network failure)
        const mriHashMatch = row.mri_data_hash === hash && row.mri_status;
        const warningHashMatch = row.manufacturer_warning_hash === warningHash && row.manufacturer_warning_status;

        // MRI Check
        if (force || (!mriHashMatch && !this.processedHashes.has(hash))) {
            this.addToQueue({
                type: 'mri',
                patientId: row.id,
                patientName: `${row.last_name}, ${row.first_name}`,
                manufacturer: row.manufacturer,
                model: row.device_model,
                serial: row.device_serial_number,
                leads,
                hash
            });
        }

        // Warning Check
        if (force || (!warningHashMatch && !this.processedWarningHashes.has(warningHash))) {
            this.addToQueue({
                type: 'warning',
                patientId: row.id,
                patientName: `${row.last_name}, ${row.first_name}`,
                manufacturer: row.manufacturer,
                model: row.device_model,
                serial: row.device_serial_number,
                leads,
                hash: warningHash
            });
        }
    }

    private calculateHash(manufacturer: string, model: string, serial: string, leads: any[]): string {
        const data = `${manufacturer}|${model}|${serial}|${leads.length}|${leads.map(l => l.model).join(',')}`;
        return Buffer.from(data).toString('base64');
    }

    private calculateWarningHash(manufacturer: string, model: string, serial: string, leads: any[] = []): string {
        const leadData = leads.map(l => `${l.manufacturer || manufacturer}:${l.model}:${l.serial}`).join('|');
        const data = `${manufacturer}|${model}|${serial}|${leadData}`;
        return Buffer.from(data).toString('base64');
    }

    addToQueue(item: any) {
        if (this.checkQueue.some(i => i.patientId === item.patientId && i.type === item.type)) return;

        console.log(`[AutomationManager] Queueing ${item.type.toUpperCase()} check for ${item.patientId}`);
        this.checkQueue.push(item);

        if (item.type === 'mri') this.processedHashes.add(item.hash);
        if (item.type === 'warning') this.processedWarningHashes.add(item.hash);

        this.broadcastStatus();

        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    // Force check all patients (e.g. valid cache)
    forceCheckAll() {
        console.log('[AutomationManager] Re-triggering all checks...');
        this.processedHashes.clear();
        this.processedWarningHashes.clear();
        this.scanForPendingPatients(true);
    }

    // Phase 1: Process all local (non-scraper) items first, then scraper items with delay
    private async processQueue() {
        if (this.checkQueue.length === 0) {
            this.isProcessing = false;
            this.broadcastStatus();
            // Phase 2: Save hash cache after draining queue
            this.saveHashCache();
            return;
        }

        this.isProcessing = true;

        // Phase 1: Drain all local (non-scraper) items first without delay
        while (this.checkQueue.length > 0 && !needsScraper(this.checkQueue[0])) {
            const item = this.checkQueue.shift();
            this.broadcastStatus();
            await this.processItem(item);
        }

        // Process next scraper item (if any)
        if (this.checkQueue.length > 0) {
            const item = this.checkQueue.shift();
            this.broadcastStatus();
            await this.processItem(item);

            // Delay between scraper items to be polite to manufacturer websites
            setTimeout(() => {
                this.processQueue();
            }, 500);
        } else {
            // Queue fully drained
            this.isProcessing = false;
            this.broadcastStatus();
            this.saveHashCache();
        }
    }

    private async processItem(item: any) {
        const checkType = item.type || 'mri';
        const taskId = `${checkType}-${item.patientId}-${Date.now()}`;

        sendProcessStatus({
            type: 'start',
            message: taskId,
            taskId: taskId,
            title: `${checkType.toUpperCase()} Check: ${item.patientName}`,
            progress: 0
        });

        const isScraper = needsScraper(item);
        try {
            if (checkType === 'mri') {
                console.log(`[MRI Service] Checking status for ${item.manufacturer} ${item.model}...`);
                const mriPromise = checkMRIStatus(
                    item.manufacturer,
                    item.model,
                    item.serial,
                    item.leads || [],
                    'Germany',
                    (msg) => {
                        sendProcessStatus({
                            type: 'progress',
                            taskId: taskId,
                            message: msg,
                            progress: 0
                        });
                    }
                );
                const result = isScraper
                    ? await withTimeout(mriPromise, SCRAPER_TIMEOUT_MS, `MRI check ${item.patientName}`)
                    : await mriPromise;

                const notifType = (result.status === 'unsafe' || result.status === 'unknown') ? 'warning' : 'info';
                sendNotification(`MRI Check for ${item.patientName}: ${result.status.toUpperCase()}`, notifType);

                sendProcessStatus({
                    type: 'complete',
                    taskId: taskId,
                    progress: 100,
                    message: `Result: ${result.status}`
                });

                const db = getDb();
                db.run(
                    'UPDATE Patients SET mri_status = ?, mri_data_hash = ? WHERE id = ?',
                    [JSON.stringify(result), item.hash, item.patientId],
                    async (err) => {
                        if (!err) this.persistToXML(item.patientId, { mriStatus: result, mriDataHash: item.hash });
                        this.broadcastUpdate(item.patientId, { type: 'mri', status: result });
                    }
                );

            } else if (checkType === 'warning') {
                console.log(`[Warning Service] Checking status for ${item.manufacturer} (Device + ${item.leads?.length || 0} Leads)...`);

                const warningCheck = async () => {
                    const components: any[] = [];
                    let worstStatus = 'safe';

                    // 1. Check Device
                    if (item.model) {
                        const devRes = await checkWarningStatus(item.manufacturer, item.model, item.serial);
                        components.push({ ...devRes, type: 'device', model: item.model, serial: item.serial });

                        if (devRes.status === 'recall') worstStatus = 'recall';
                        else if (devRes.status === 'advisory' && worstStatus !== 'recall') worstStatus = 'advisory';
                        else if (devRes.status === 'manual_check' && worstStatus === 'safe') worstStatus = 'manual_check';
                    }

                    // 2. Check Leads
                    if (item.leads && item.leads.length > 0) {
                        for (const lead of item.leads) {
                            const leadManu = lead.manufacturer || item.manufacturer;
                            const leadRes = await checkWarningStatus(leadManu, lead.model, lead.serial);
                            components.push({ ...leadRes, type: 'lead', model: lead.model, serial: lead.serial });

                            if (leadRes.status === 'recall') worstStatus = 'recall';
                            else if (leadRes.status === 'advisory' && worstStatus !== 'recall') worstStatus = 'advisory';
                            else if (leadRes.status === 'manual_check' && worstStatus === 'safe') worstStatus = 'manual_check';
                        }
                    }
                    return { components, worstStatus };
                };

                const { components, worstStatus } = isScraper
                    ? await withTimeout(warningCheck(), SCRAPER_TIMEOUT_MS, `Warning check ${item.patientName}`)
                    : await warningCheck();

                const details = components.map(c => `${c.type === 'device' ? 'Device' : 'Lead ' + c.model}: ${c.status.toUpperCase()}`).join('; ');
                const primaryLink = components.find(c => c.link)?.link;

                const result: any = {
                    manufacturer: item.manufacturer,
                    status: worstStatus,
                    details: details,
                    link: primaryLink,
                    timestamp: new Date().toISOString(),
                    components: components
                };

                const notifType = (result.status === 'recall' || result.status === 'advisory') ? 'error' : 'info';
                if (result.status !== 'safe') {
                    sendNotification(`Warning Check for ${item.patientName}: ${result.status.toUpperCase()}`, notifType);
                }

                console.log(`[AutomationManager] Warning Check Complete for ${item.patientName}:`, result);

                sendProcessStatus({
                    type: 'complete',
                    taskId: taskId,
                    progress: 100,
                    message: `Result: ${result.status}`
                });

                const db = getDb();
                db.run(
                    'UPDATE Patients SET manufacturer_warning_status = ?, manufacturer_warning_hash = ? WHERE id = ?',
                    [JSON.stringify(result), item.hash, item.patientId],
                    async (err) => {
                        if (!err) this.persistToXML(item.patientId, { manufacturerWarningStatus: result, manufacturerWarningHash: item.hash });
                        this.broadcastUpdate(item.patientId, { type: 'warning', status: result });
                    }
                );
            }

        } catch (error: any) {
            console.error(`[AutomationManager] Error processing ${item.patientId}:`, error);

            sendProcessStatus({
                type: 'error',
                taskId: taskId,
                message: error.message || 'Check Failed'
            });
        }
    }

    private broadcastStatus() {
        if (this.mainWindow) {
            this.mainWindow.webContents.send('mri-queue-update', {
                processing: this.isProcessing,
                queueLength: this.checkQueue.length
            });
        }
    }

    private broadcastUpdate(patientId: string, result: any) {
        if (this.mainWindow) {
            const type = result.type || (result.manufacturer ? 'mri' : 'unknown');
            const statusPayload = result.status || result;

            console.log(`[AutomationManager] Broadcasting update for ${patientId} type=${type}`);

            this.mainWindow.webContents.send('mri-status-update', {
                patientId,
                type,
                status: statusPayload
            });
        }
    }

    async persistToXML(patientId: string, updates: any) {
        try {
            const { getPatientById } = await import('../database');
            const { updatePatientXML } = await import('../storage');

            const patient = await getPatientById(patientId);
            if (patient) {
                await updatePatientXML(patient.id, {
                    first_name: patient.first_name,
                    last_name: patient.last_name,
                    dob: patient.dob,
                    hospitalPatientId: patient.hospitalPatientId,
                    devices: patient.devices,
                    leads: patient.leads,
                    mriStatus: updates.mriStatus !== undefined ? updates.mriStatus : patient.mriStatus,
                    mriDataHash: updates.mriDataHash !== undefined ? updates.mriDataHash : patient.mriDataHash,
                    manufacturerWarningStatus: updates.manufacturerWarningStatus !== undefined ? updates.manufacturerWarningStatus : patient.manufacturerWarningStatus,
                    manufacturerWarningHash: updates.manufacturerWarningHash !== undefined ? updates.manufacturerWarningHash : patient.manufacturerWarningHash
                });
                console.log(`[AutomationManager] Persisted updates for ${patient.name} to XML.`);
            }
        } catch (e) {
            console.error('[AutomationManager] Failed to persist XML:', e);
        }
    }

    async forceCheck(patientId: string) {
        console.log(`[AutomationManager] Force checking ${patientId}...`);

        try {
            const { getPatientById } = await import('../database');
            const patient = await getPatientById(patientId);

            if (!patient.deviceManufacturer || !patient.deviceModel) {
                console.warn(`[AutomationManager] Cannot force check ${patientId}: Missing manufacturer/model.`);
                return;
            }

            // Queue Both
            const mriHash = this.calculateHash(patient.deviceManufacturer, patient.deviceModel, patient.deviceSerial || '', patient.leads || []);
            this.addToQueue({
                type: 'mri',
                patientId: patient.id,
                patientName: patient.name,
                manufacturer: patient.deviceManufacturer,
                model: patient.deviceModel,
                serial: patient.deviceSerial,
                leads: patient.leads || [],
                hash: mriHash
            });

            const warningHash = this.calculateWarningHash(patient.deviceManufacturer, patient.deviceModel, patient.deviceSerial || '', patient.leads || []);
            this.addToQueue({
                type: 'warning',
                patientId: patient.id,
                patientName: patient.name,
                manufacturer: patient.deviceManufacturer,
                model: patient.deviceModel,
                serial: patient.deviceSerial,
                leads: patient.leads || [],
                hash: warningHash
            });

        } catch (e) {
            console.error(`[AutomationManager] Force check failed for ${patientId}:`, e);
        }
    }
}

import { BrowserWindow } from 'electron';
import { checkMRIStatus } from './mriLookupService';
import { checkWarningStatus } from './warningLookupService';
import { getDb } from '../database';
import { sendNotification, sendProcessStatus } from '../windowManager';

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

    startMonitoring() {
        if (this.monitoringInterval) return;
        console.log('[AutomationManager] Starting background monitoring...');

        // Initial scan
        this.scanForPendingPatients();

        // Check every 5 minutes
        this.monitoringInterval = setInterval(() => {
            this.scanForPendingPatients();
        }, 5 * 60 * 1000);
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }

    private async scanForPendingPatients(force: boolean = false) {
        const db = getDb();
        console.log(`[AutomationManager] Accessing DB to scan patients... (Force: ${force})`);

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

            console.log(`[AutomationManager] Scanned ${rows.length} patients.`);
            if (force) sendNotification(`Found ${rows.length} patients. Queuing for MRI check...`, 'info');

            rows.forEach(row => {
                if (!row.manufacturer || !row.device_model) return;

                let leads: any[] = [];
                try {
                    if (row.data) {
                        const parsed = JSON.parse(row.data);
                        leads = parsed.leads || [];
                    }
                } catch (e) { /* ignore */ }

                const hash = this.calculateHash(row.manufacturer, row.device_model, row.device_serial_number || '', leads);
                const warningHash = this.calculateWarningHash(row.manufacturer, row.device_model, row.device_serial_number || '');

                // 1. MRI Check Logic
                let mriNeeded = false;
                if (force || (row.mri_status === '{"status":"unknown"}' || !row.mri_status) || row.mri_data_hash !== hash) {
                    if (!this.processedHashes.has(hash)) mriNeeded = true;
                }

                if (mriNeeded) {
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

                // 2. Warning Check Logic
                let warningNeeded = false;
                // If warning hash mismatches OR status unknown OR force
                if (force || (row.manufacturer_warning_status === '{"status":"unknown"}' || !row.manufacturer_warning_status) || row.manufacturer_warning_hash !== warningHash) {
                    if (!this.processedWarningHashes.has(warningHash)) warningNeeded = true;
                }

                if (warningNeeded) {
                    this.addToQueue({
                        type: 'warning',
                        patientId: row.id,
                        patientName: `${row.last_name}, ${row.first_name}`,
                        manufacturer: row.manufacturer,
                        model: row.device_model,
                        serial: row.device_serial_number, // leads not needed for warning usually
                        hash: warningHash
                    });
                }
            });
        });
    }

    private calculateHash(manufacturer: string, model: string, serial: string, leads: any[]): string {
        const data = `${manufacturer}|${model}|${serial}|${leads.length}|${leads.map(l => l.model).join(',')}`;
        return Buffer.from(data).toString('base64');
    }

    private calculateWarningHash(manufacturer: string, model: string, serial: string): string {
        const data = `${manufacturer}|${model}|${serial}`;
        return Buffer.from(data).toString('base64');
    }

    addToQueue(item: any) {
        if (this.checkQueue.some(i => i.patientId === item.patientId && i.type === item.type)) return; // Already queued

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

    private async processQueue() {
        if (this.checkQueue.length === 0) {
            this.isProcessing = false;
            this.broadcastStatus();
            // sendNotification('All MRI compliance checks completed.', 'info');
            return;
        }

        this.isProcessing = true;
        const item = this.checkQueue.shift();
        this.broadcastStatus();

        const checkType = item.type || 'mri'; // Default for backward compat

        // 1. Start Task
        const taskId = `${checkType}-${item.patientId}-${Date.now()}`;
        sendProcessStatus({
            type: 'start',
            message: taskId,
            taskId: taskId,
            title: `${checkType.toUpperCase()} Check: ${item.patientName}`,
            progress: 0
        });

        try {
            if (checkType === 'mri') {
                console.log(`[MRI Service] Checking status for ${item.manufacturer} ${item.model}...`);
                const result = await checkMRIStatus(
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
                console.log(`[Warning Service] Checking status for ${item.manufacturer} ${item.model}...`);
                const result = await checkWarningStatus(
                    item.manufacturer,
                    item.model,
                    item.serial
                );

                const notifType = (result.status === 'recall' || result.status === 'advisory') ? 'error' : (result.status === 'manual_check' ? 'info' : 'info');
                // Only notify if significant?
                if (result.status !== 'safe') {
                    sendNotification(`Warning Check for ${item.patientName}: ${result.status.toUpperCase()}`, notifType);
                }

                console.log(`[AutomationManager] Warning Check Complete for ${item.patientName}:`, result); // DEBUG

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

            // Error Task
            sendProcessStatus({
                type: 'error',
                taskId: taskId,
                message: error.message || 'Check Failed'
            });

        } finally {
            // Wait a bit to be polite to websites?
            setTimeout(() => {
                this.processQueue(); // Loop
            }, 2000);
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
            console.log(`[AutomationManager] Broadcasting update for ${patientId} type=${result.type || 'mri'}`); // DEBUG
            this.mainWindow.webContents.send('mri-status-update', {
                patientId,
                type: result.type, // 'mri' or 'warning'
                status: result.status
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
                    // Merge existing with updates
                    mriStatus: updates.mriStatus !== undefined ? updates.mriStatus : patient.mriStatus,
                    mriDataHash: updates.mriDataHash !== undefined ? updates.mriDataHash : patient.mriDataHash, // Note: patient object might not have hash exposed, check DB
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

            const warningHash = this.calculateWarningHash(patient.deviceManufacturer, patient.deviceModel, patient.deviceSerial || '');
            this.addToQueue({
                type: 'warning',
                patientId: patient.id,
                patientName: patient.name,
                manufacturer: patient.deviceManufacturer,
                model: patient.deviceModel,
                serial: patient.deviceSerial,
                hash: warningHash
            });

        } catch (e) {
            console.error(`[AutomationManager] Force check failed for ${patientId}:`, e);
        }
    }
}

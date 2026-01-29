import { BrowserWindow } from 'electron';
import { checkMRIStatus } from './mriLookupService';
import { getDb } from '../database';
import { sendNotification, sendProcessStatus } from '../windowManager';

export class AutomationManager {
    private static instance: AutomationManager;
    private checkQueue: any[] = [];
    private isProcessing = false;
    private mainWindow: BrowserWindow | null = null;
    private monitoringInterval: NodeJS.Timeout | null = null;
    private processedHashes: Set<string> = new Set();

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
                   r.manufacturer, r.device_model, r.device_serial_number, r.data
            FROM Patients p
            LEFT JOIN Reports r ON r.patient_id = p.id
        `;

        // If NOT forcing, only check unknown/missing
        if (!force) {
            query += ` WHERE p.mri_status IS NULL OR p.mri_status = '{"status":"unknown"}' OR p.mri_status = '' `;
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

                // If hash matches what we already checked, skip (unless mri_status is missing/unknown which logic above selected)
                // Actually, the main purpose of hash is to see if DATA changed since last check.
                // If DB says mri_data_hash == current hash, AND status is unknown, maybe we failed before? 
                // Let's retry anyway if unknown.
                if (!force && row.mri_data_hash === hash && row.mri_status && row.mri_status !== '{"status":"unknown"}') {
                    return;
                }

                if (this.processedHashes.has(hash)) return; // Already queued in this session

                // Queue it
                this.addToQueue({
                    patientId: row.id,
                    patientName: `${row.last_name}, ${row.first_name}`,
                    manufacturer: row.manufacturer,
                    model: row.device_model,
                    serial: row.device_serial_number,
                    leads,
                    hash
                });
            });
        });
    }

    private calculateHash(manufacturer: string, model: string, serial: string, leads: any[]): string {
        const data = `${manufacturer}|${model}|${serial}|${leads.length}|${leads.map(l => l.model).join(',')}`;
        return Buffer.from(data).toString('base64');
    }

    addToQueue(item: any) {
        if (this.checkQueue.some(i => i.patientId === item.patientId)) return; // Already queued

        console.log(`[AutomationManager] Queueing ${item.patientId} (${item.hash ? 'Hash mismatch' : 'Force'})`);
        this.checkQueue.push(item);
        this.processedHashes.add(item.hash);
        this.broadcastStatus();

        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    // Force check all patients (e.g. valid cache)
    forceCheckAll() {
        console.log('[AutomationManager] Re-triggering all checks...');
        this.processedHashes.clear();
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

        // 1. Start Task
        const taskId = `mri-${item.patientId}-${Date.now()}`;
        sendProcessStatus({
            type: 'start',
            message: taskId, // Protocol: message handles title/id sometimes, but let's stick to standard if possible
            taskId: taskId,
            title: `MRI Check: ${item.patientName}`,
            progress: 0
        });

        try {
            console.log(`[MRI Service] Checking status for ${item.manufacturer} ${item.model}...`);
            const result = await checkMRIStatus(
                item.manufacturer,
                item.model,
                item.serial,
                item.leads || [],
                'Germany', // Default country
                (msg) => {
                    // Update Progress
                    sendProcessStatus({
                        type: 'progress',
                        taskId: taskId,
                        message: msg,
                        progress: 0 // We assume unknown progress unless we map messages to %
                        // Ideally we'd improve mriLookupService to pass % back
                    });
                }
            );

            // Notify result
            const notifType = (result.status === 'unsafe' || result.status === 'unknown') ? 'warning' : 'info';
            // Only send toast on completion
            sendNotification(`MRI Check for ${item.patientName}: ${result.status.toUpperCase()}`, notifType);

            // Complete Task
            sendProcessStatus({
                type: 'complete',
                taskId: taskId,
                progress: 100,
                message: `Result: ${result.status}`
            });

            // Update DB
            const db = getDb();
            db.run(
                'UPDATE Patients SET mri_status = ?, mri_data_hash = ? WHERE id = ?',
                [JSON.stringify(result), item.hash, item.patientId],
                async (err) => {
                    if (err) console.error('[AutomationManager] Failed to update DB:', err);
                    else {
                        // Persist to XML
                        try {
                            const { getPatientById } = await import('../database');
                            const { updatePatientXML } = await import('../storage');

                            const patient = await getPatientById(item.patientId);
                            if (patient) {
                                await updatePatientXML(patient.id, {
                                    first_name: patient.first_name,
                                    last_name: patient.last_name,
                                    dob: patient.dob,
                                    hospitalPatientId: patient.hospitalPatientId,
                                    // Use data from DB/Patient object as it's the source of truth now
                                    devices: patient.devices,
                                    leads: patient.leads,
                                    mriStatus: result,
                                    mriDataHash: item.hash
                                });
                                console.log(`[AutomationManager] Persisted MRI status for ${patient.name} to XML.`);
                            }
                        } catch (e) {
                            console.error('[AutomationManager] Failed to persist XML:', e);
                        }

                        // Notify Store/UI
                        this.broadcastUpdate(item.patientId, result);
                    }
                }
            );

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
            this.mainWindow.webContents.send('mri-status-update', {
                patientId,
                status: result
            });
        }
    }

    async forceCheck(patientId: string) {
        console.log(`[AutomationManager] Force checking ${patientId}...`);

        try {
            // Updated import path
            const { getPatientById } = await import('../database');

            // 1. Get Patient (Triggers Read-Repair if stale, returns Normalized Data)
            const patient = await getPatientById(patientId);
            console.log(`[AutomationManager] Force Check Debug - Patient:`, JSON.stringify(patient, null, 2));

            // 2. Use Data Directly from Database (Lazy Load System source of truth)
            const manufacturer = patient.deviceManufacturer;
            const model = patient.deviceModel;
            const serial = patient.deviceSerial;
            const leads = patient.leads || [];

            if (!manufacturer || !model) {
                console.warn(`[AutomationManager] Cannot force check ${patientId}: Missing manufacturer/model.`);
                return;
            }

            // 3. Hash & Queue
            const hash = this.calculateHash(manufacturer, model, serial || '', leads);
            this.addToQueue({
                patientId: patient.id,
                patientName: patient.name,
                manufacturer: manufacturer,
                model: model,
                serial: serial,
                leads,
                hash
            });

        } catch (e) {
            console.error(`[AutomationManager] Force check failed for ${patientId}:`, e);
        }
    }
}

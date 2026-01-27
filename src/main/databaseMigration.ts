import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getConfig, saveConfig } from './config';

/**
 * Ensures the database exists at the standard local location.
 * Migrates from legacy paths if necessary.
 * 
 * Standard Path: <userData>/database.db
 * 
 * Migration Logic:
 * 1. If standard DB exists, use it.
 * 2. If config has custom 'dbPath', try to copy it to standard.
 * 3. If legacy default '_DATA/database.db' exists, try to copy it to standard.
 * 4. Remove 'dbPath' from config to enforce standard location.
 * 
 * @returns The absolute path to the standard database file.
 */
export const ensureDatabaseLocation = (): string => {
    const userDataPath = app.getPath('userData');
    const STANDARD_DB_PATH = path.join(userDataPath, 'database.db');

    // 1. Check if standard database already exists
    if (fs.existsSync(STANDARD_DB_PATH)) {
        console.log('[Database Migration] Standard database found:', STANDARD_DB_PATH);
        cleanupConfig(); // Ensure config is clean even if we found the file
        return STANDARD_DB_PATH;
    }

    console.log('[Database Migration] Standard database NOT found. Checking for migration sources...');

    const config = getConfig();
    let sourcePath: string | null = null;

    // 2. Check for Custom Config Path
    if (config.dbPath && fs.existsSync(config.dbPath)) {
        console.log('[Database Migration] Found custom DB path in config:', config.dbPath);
        sourcePath = config.dbPath;
    }
    // 3. Check for Legacy Default Path (userData/_DATA/database.db)
    else {
        const legacyDefaultPath = path.join(userDataPath, '_DATA', 'database.db');
        if (fs.existsSync(legacyDefaultPath)) {
            console.log('[Database Migration] Found legacy default DB:', legacyDefaultPath);
            sourcePath = legacyDefaultPath;
        }
    }

    // Attempt Migration
    if (sourcePath) {
        try {
            console.log(`[Database Migration] Migrating from ${sourcePath} to ${STANDARD_DB_PATH}...`);
            fs.copyFileSync(sourcePath, STANDARD_DB_PATH);
            console.log('[Database Migration] Migration successful.');
        } catch (error) {
            console.error('[Database Migration] FAILED to copy database:', error);
            // We continue, returning the standard path. initializeDatabase will create a fresh one.
        }
    } else {
        console.log('[Database Migration] No previous database found. A new one will be created.');
    }

    // 4. Cleanup Config
    cleanupConfig();

    return STANDARD_DB_PATH;
};

const cleanupConfig = () => {
    try {
        const config = getConfig();
        if (config.dbPath) {
            console.log('[Database Migration] Removing dbPath from config to enforce standard location.');
            delete config.dbPath;
            saveConfig(config);
        }
    } catch (error) {
        console.error('[Database Migration] Failed to cleanup config:', error);
    }
};

import { app } from 'electron';
import path from 'path';
import { getSettings as getDbSettings, setSettings as setDbSettings } from './database';
import { getConfig, saveConfig } from './config';

export interface AppSettings {
    importDir: string;
    unmatchedDir: string;
    dataPath: string;
    dbPath: string;
    theme?: 'light' | 'dark' | 'system';
}

const DEFAULT_SETTINGS: AppSettings = {
    importDir: path.join(app.getPath('userData'), '_IMPORT'),
    unmatchedDir: path.join(app.getPath('userData'), '_UNMATCHED'),
    dataPath: path.join(app.getPath('userData'), '_DATA'),
    dbPath: path.join(app.getPath('userData'), '_DATA', 'database.db'),
    theme: 'system',
};

export const getAllSettings = async (): Promise<AppSettings> => {
    try {
        const dbSettings = await getDbSettings();
        const config = getConfig();

        // Merge defaults, DB settings, and Config (config takes precedence for dbPath)
        return {
            ...DEFAULT_SETTINGS,
            ...dbSettings,
            dbPath: config.dbPath || DEFAULT_SETTINGS.dbPath,
        };
    } catch (error) {
        console.error('Error retrieving settings:', error);
        return DEFAULT_SETTINGS;
    }
};

export const saveSettings = async (settings: Partial<AppSettings>): Promise<void> => {
    try {
        const { dbPath, ...otherSettings } = settings;

        // Save DB path to config file if it changed
        if (dbPath) {
            const config = getConfig();
            config.dbPath = dbPath;
            saveConfig(config);
        }

        // Save other settings to SQLite
        if (Object.keys(otherSettings).length > 0) {
            await setDbSettings(otherSettings);
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        throw error;
    }
};

export const resetSettings = async (): Promise<AppSettings> => {
    try {
        // Reset config file
        const config = getConfig();
        config.dbPath = DEFAULT_SETTINGS.dbPath;
        saveConfig(config);

        // Reset SQLite settings
        // We need to manually set each default value to ensure it overrides existing data
        const { dbPath, ...settingsToSave } = DEFAULT_SETTINGS;
        await setDbSettings(settingsToSave);

        return DEFAULT_SETTINGS;
    } catch (error) {
        console.error('Error resetting settings:', error);
        throw error;
    }
};

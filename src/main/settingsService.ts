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
    usbSourceDirectories: string[];
    usbTargetDirectory: string;
    updateChannel: 'stable' | 'beta';
    mriCountry: string;
    mriManufacturers: Record<string, boolean>;
}

const isDev = process.env.NODE_ENV === 'development';

const DEFAULT_SETTINGS: AppSettings = {
    importDir: isDev ? path.join(process.cwd(), '_IMPORT') : path.join(app.getPath('userData'), '_IMPORT'),
    unmatchedDir: isDev ? path.join(process.cwd(), '_UNMATCHED') : path.join(app.getPath('userData'), '_UNMATCHED'),
    dataPath: isDev ? path.join(process.cwd(), '_DATA') : path.join(app.getPath('userData'), '_DATA'),
    dbPath: isDev ? path.join(process.cwd(), '_DATA', 'database.db') : path.join(app.getPath('userData'), '_DATA', 'database.db'),
    theme: 'system',
    usbSourceDirectories: [],
    usbTargetDirectory: '',
    updateChannel: 'stable',
    mriCountry: 'Germany',
    mriManufacturers: {
        'Biotronik': true,
        'Medtronic': false,
        'Abbott': false,
        'Boston Scientific': false,
        'Impulse Dynamics': false,
        'MicroPort': false
    }
};

export const getAllSettings = async (): Promise<AppSettings> => {
    try {
        const dbSettings = await getDbSettings();
        const config = getConfig();

        // Parse JSON strings for array/object fields
        const parsedDbSettings = { ...dbSettings };
        if (parsedDbSettings.usbSourceDirectories) {
            try {
                parsedDbSettings.usbSourceDirectories = JSON.parse(parsedDbSettings.usbSourceDirectories);
            } catch (e) {
                parsedDbSettings.usbSourceDirectories = [];
            }
        }
        if (parsedDbSettings.mriManufacturers) {
            try {
                parsedDbSettings.mriManufacturers = JSON.parse(parsedDbSettings.mriManufacturers);
            } catch (e) {
                parsedDbSettings.mriManufacturers = DEFAULT_SETTINGS.mriManufacturers;
            }
        }

        // Merge defaults, DB settings, and Config (config takes precedence for dbPath)
        return {
            ...DEFAULT_SETTINGS,
            ...parsedDbSettings,
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
            // Stringify arrays/objects
            const settingsToSave: any = { ...otherSettings };
            if (settingsToSave.usbSourceDirectories) {
                settingsToSave.usbSourceDirectories = JSON.stringify(settingsToSave.usbSourceDirectories);
            }
            if (settingsToSave.mriManufacturers) {
                settingsToSave.mriManufacturers = JSON.stringify(settingsToSave.mriManufacturers);
            }
            await setDbSettings(settingsToSave);
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

        // Stringify arrays
        const dbReadySettings: any = { ...settingsToSave };
        if (dbReadySettings.usbSourceDirectories) {
            dbReadySettings.usbSourceDirectories = JSON.stringify(dbReadySettings.usbSourceDirectories);
        }

        await setDbSettings(dbReadySettings);

        return DEFAULT_SETTINGS;
    } catch (error) {
        console.error('Error resetting settings:', error);
        throw error;
    }
};

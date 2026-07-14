
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { writeFileAtomicSync } from './utils/atomicFile';

const configPath = path.join(app.getPath('userData'), 'settings.json');

interface AppConfig {
  // dbPath removed - database is always at fixed location
  [key: string]: any;
}

export const getConfig = (): AppConfig => {
  try {
    if (fs.existsSync(configPath)) {
      const rawData = fs.readFileSync(configPath);
      return JSON.parse(rawData.toString());
    }
  } catch (error) {
    console.error('Error reading config file:', error);
  }
  return {};
};

export const saveConfig = (config: AppConfig) => {
  try {
    // Atomic write: a crash mid-write must not truncate settings.json
    // (getConfig would then silently reset the config to {}).
    writeFileAtomicSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error saving config file:', error);
  }
};

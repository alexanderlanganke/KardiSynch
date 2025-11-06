
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

const configPath = path.join(app.getPath('userData'), 'settings.json');

interface AppConfig {
  dbPath?: string;
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
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error saving config file:', error);
  }
};

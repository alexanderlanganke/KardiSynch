import fs from 'fs';
import path from 'path';
import { routeFiles } from './router';

const importDir = path.join(__dirname, '..', '..', '_IMPORT');

export const initializeWatcher = () => {
  // Ensure the _IMPORT directory exists
  if (!fs.existsSync(importDir)) {
    fs.mkdirSync(importDir, { recursive: true });
  }

  console.log(`Watching for file changes on ${importDir}`);

  fs.watch(importDir, (eventType, filename) => {
    if (filename && eventType === 'rename') {
      console.log(`File added: ${filename}`);
      routeFiles(filename);
    }
  });
};

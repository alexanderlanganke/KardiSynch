import fs from 'fs';
import path from 'path';
import { routeFiles } from './router';

const importDir = path.join(__dirname, '..', '..', '_IMPORT');

const processFiles = () => {
  fs.readdir(importDir, (err, files) => {
    if (err) {
      console.error(`Error reading import directory: ${err}`);
      return;
    }

    // Group files by patient
    const patientFolders = files.reduce((acc, file) => {
      const patientName = path.basename(file, path.extname(file)).split('_')[0];
      if (!acc[patientName]) {
        acc[patientName] = [];
      }
      acc[patientName].push(file);
      return acc;
    }, {} as Record<string, string[]>);

    // Process each patient's files
    for (const patientName in patientFolders) {
      const patientFiles = patientFolders[patientName];
      const bnkFile = patientFiles.find(file => path.extname(file).toLowerCase() === '.bnk');
      const pdfFiles = patientFiles.filter(file => path.extname(file).toLowerCase() === '.pdf');

      if (bnkFile && pdfFiles.length > 0) {
        // Create a subdirectory for the patient
        const patientDir = path.join(importDir, patientName);
        if (!fs.existsSync(patientDir)) {
          fs.mkdirSync(patientDir, { recursive: true });
        }

        // Move the files to the subdirectory
        patientFiles.forEach(file => {
          const oldPath = path.join(importDir, file);
          const newPath = path.join(patientDir, file);
          fs.renameSync(oldPath, newPath);
        });

        // Route the files for processing
        routeFiles(patientDir);
      }
    }
  });
};

export const initializeWatcher = () => {
  // Ensure the _IMPORT directory exists
  if (!fs.existsSync(importDir)) {
    fs.mkdirSync(importDir, { recursive: true });
  }

  console.log(`Watching for file changes on ${importDir}`);

  // Process existing files on startup
  processFiles();

  fs.watch(importDir, (eventType, filename) => {
    if (filename && eventType === 'rename') {
      console.log(`File added: ${filename}`);
      processFiles();
    }
  });
};

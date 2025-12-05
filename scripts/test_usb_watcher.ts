
import * as fs from 'fs';
import * as path from 'path';
import { startUsbWatcher, stopUsbWatcher } from '../src/main/usbWatcher';
import { AppSettings } from '../src/main/settingsService';

// Mock Settings
const MOCK_USB_SOURCE = path.resolve('./mock_usb_source');
const MOCK_USB_TARGET = path.resolve('./mock_usb_target');
const MOCK_IMPORT_DIR = path.resolve('./mock_import_dir');

const mockSettings: AppSettings = {
    theme: 'light',
    language: 'en',
    zoomLevel: 1,
    windowBounds: { x: 0, y: 0, width: 800, height: 600 },
    dbPath: './mock_db.sqlite',
    importDir: MOCK_IMPORT_DIR,
    unmatchedDir: './mock_unmatched',
    dataPath: './mock_data',
    usbSourceDirectories: [MOCK_USB_SOURCE],
    usbTargetDirectory: MOCK_USB_TARGET,
    minimizeToTray: false,
    autoStart: false
};

// Setup Directories
const setup = () => {
    [MOCK_USB_SOURCE, MOCK_USB_TARGET, MOCK_IMPORT_DIR].forEach(dir => {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
    });
    console.log('Setup complete. Directories created.');
};

// Teardown
const teardown = () => {
    stopUsbWatcher();
    // [MOCK_USB_SOURCE, MOCK_USB_TARGET, MOCK_IMPORT_DIR].forEach(dir => {
    //     if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    // });
    console.log('Teardown complete.');
};

// Test
const runTest = async () => {
    setup();

    console.log('Starting USB Watcher...');
    startUsbWatcher(mockSettings);

    // Simulate file creation on USB
    const testFile = path.join(MOCK_USB_SOURCE, 'test_report.pdf');
    console.log(`Creating test file at ${testFile}...`);
    fs.writeFileSync(testFile, 'Dummy PDF Content');

    // Wait for polling (interval is 3000ms)
    console.log('Waiting for watcher to pick up file (5s)...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check results
    const targetFile = path.join(MOCK_USB_TARGET, 'test_report.pdf');
    const importFile = path.join(MOCK_IMPORT_DIR, 'test_report.pdf');

    const targetExists = fs.existsSync(targetFile);
    const importExists = fs.existsSync(importFile);
    const sourceExists = fs.existsSync(testFile);

    console.log('--- Results ---');
    console.log(`Target File Exists: ${targetExists}`);
    console.log(`Import File Exists: ${importExists}`);
    console.log(`Source File Deleted: ${!sourceExists}`);

    if (targetExists && importExists && !sourceExists) {
        console.log('SUCCESS: File was moved correctly.');
    } else {
        console.error('FAILURE: File operation failed.');
    }

    teardown();
};

runTest();

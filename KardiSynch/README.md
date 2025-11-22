# KardiSynch
A self contained electron based database, renderer and pdf viewer for IECD interrogations

Project Outline ~<*>~

Project Outline: ~<*>~ (Codename: KardiSynch)
This outline details the building blocks, recommended technologies, and a phased approach to building your device report management system.

The core choice to satisfy your "no install, no admin" and "modern UI" constraints is Electron.

An Electron app is, in essence, a self-contained website (Chromium) running on a small server (Node.js) packaged into a single executable file (.exe). It can be run from any folder (including a USB drive), requires no installation, and has full access to the local file system to manage files and databases—all as a standard user.

1. Recommended Technology Stack
Core Framework: Electron. It is the only mature technology that perfectly satisfies all your constraints (cross-platform, modern UI via web tech, no install, no admin).

Language: TypeScript. For a project with data parsing and a database, you want type safety. It will save you from countless bugs.

UI Library: React. A robust and widely-used library for building user interfaces. Its component-based architecture and strong community support make it a solid choice for a modern UI.

Database: SQLite. This is a single, file-based database (database.db) that is fast, robust, and perfect for an embedded app. It will store the patient list, metadata, and all parsed report data.

PDF Viewing: PDF.js (by Mozilla). This is the standard for rendering PDFs in a web-based UI.

2. Project Architecture & Building Blocks
The application will be self-contained in a single folder.

KardiSynch/
├── KardiSynch.exe         <-- The entire application
├── _IMPORT/                 <-- Folder to drop new reports into
│   ├── (files from your PowerShell script)
│
├── _DATA/                   <-- The main data store
│   ├── database.db          <-- The SQLite database file
│   └── Patients/
│       ├── [Patient_UUID_1]/
│       │   ├── [Visit_UUID_A]/
│       │   │   ├── report_1.pdf
│       │   │   └── report_2.pdf
│       │   └── [Visit_UUID_B]/
│       │       └── report_1.pdf
│       └── [Patient_UUID_2]/
│           └── ...
│
└── (Electron config files)
3. Phased Development Plan
Phase 0: The "Ingestor" (Helper Tool)
Component: The PowerShell script.

Status: Complete.

Function: Its only job is to poll the USB drives and move all files (PDFs, text) into the KardiSynch/_IMPORT/ folder.

Phase 1: The "Core" (Application Shell & Data)
Electron Shell:

Set up the main Electron project with TypeScript and Svelte.

Create the main browser window.

Establish the "bridge" (IPC) to send data between the UI and the Node.js backend.

Database Module (database.ts):

Integrate the sqlite3 library.

Write functions to initialize the database (database.db) on first launch.

Schema Definition:

Patients: id (UUID), name, dob, last_device_model, last_seen_date.

Reports: id (UUID), patient_id (FK), visit_date, device_manufacturer, pdf_paths (JSON array), data (JSON object).

Phase 2: The "Ingestion Engine" (The Core Logic)
File Watcher (watcher.ts):

The Electron app will use Node.js's fs.watch to monitor the _IMPORT/ folder.

If files are not able to be matched to a report, the user is notified via a dismissible message in the UI.

File Router (router.ts):

When new files appear, this module's job is to "group" them into a single "Visit."

Parser Pipeline (parser.ts):

This is the most complex module. It will be a switch statement based on the file content or name.

case 'MEDTRONIC_TXT': Run parseMedtronic(file).

case 'BIOTRONIK_TXT': Run parseBiotronik(file).

case 'ABBOTT_TXT': Run parseAbbott(file).

Each parse... function will:

Read the proprietary text file.

Extract key data (patient name, device model, parameters, etc.).

Return a single, standardized JSON object.

We will have to add these parsers one by one as we learn their formats.

File Storage (storage.ts):

Once a "Visit" is grouped and parsed:

Check the DB if the patient exists (by name/DOB). If not, create a new Patient and a new UUID folder.

Create a new Report entry in the DB, storing the parsed data in the `data` column.

Create a new Visit UUID folder (e.g., _DATA/Patients/[Patient_UUID]/[Visit_UUID]/).

Move all associated PDFs (report_1.pdf, etc.) into this folder.

Delete the original files from _IMPORT/.

Phase 3: The "UI" (The User Application)
This is the React app the user sees. It uses React's Context API for state management.

Component 1: Patient Dashboard (Main View)

A simple, clean list of all patients from the Patients table.

Includes a search/filter bar.

Displays Name, DOB, Last Seen, etc.

Component 2: Patient Detail (Drill-down View)

When a patient is clicked, this view shows their details.

It also shows a timeline of all their Reports (visits), sorted by date.

Component 3: Report Viewer (The "Compare" View)

This is the core feature.

A multi-pane view that allows the user to view PDF reports and the structured data side-by-side.

Component 4: Unmatched Files Notification

A dismissible notification that appears at the top of the application window to inform the user when files in the `_IMPORT` directory cannot be matched to a patient.

Phase 4: Packaging & Deployment
Use electron-builder or electron-forge to package the entire application.

This tool will bundle everything (the Electron app, your Svelte/React code, and the Node.js backend) into a single KardiSynch.exe file.

The final "product" will be a .zip file. The user just unzips it anywhere and double-clicks the .exe to run. All data is stored locally in its sub-folders.

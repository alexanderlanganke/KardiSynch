# KardiSynch
**Cardiac Data Synchronization & Management System**

KardiSynch is a modern, self-contained application designed to streamline the management and analysis of cardiac interrogation reports. Built with Electron, React, and TypeScript, it provides a seamless workflow for importing, parsing, and visualizing data from major device manufacturers including Medtronic, Biotronik, Boston Scientific, and Abbott.

<p align="center">
  <img src="docs/assets/wordmark.jpg" width="400" alt="KardiSynch Wordmark">
</p>

## 🚀 Features

### 📂 Filesystem-Based Data Access
- **No Database Server Required**: KardiSynch runs entirely from a local folder, making it portable and easy to deploy without administrative privileges.
- **Direct File Management**: Patient data is stored in a structured directory hierarchy (`Reports/PatientID/VisitID`), allowing for easy backup and external access.
- **XML Metadata**: Automatically generates `patient.xml` and `visit.xml` metadata files for interoperability.

### ⚡ Automated Ingestion & Sorting
- **Smart Import**: Simply drop files into the `_IMPORT` directory. KardiSynch automatically detects, parses, and organizes them.
- **Manual Sorting Interface**: A unified interface (`PatientAssignmentModal`) handles files that cannot be automatically matched, allowing users to:
  - Assign files to existing patients.
  - Create new patients on the fly.
  - Link files to existing visits or create new ones.
- **Multi-Manufacturer Support**:
  - **Medtronic**: PDF, proprietary formats (PDD), and ZIP archives.
  - **Biotronik**: XML and PDF reports.
  - **Boston Scientific**: PDF and ZIP exports.
  - **Abbott**: PDF reports.

### 🛠️ Data Management Tools
- **Rescan Visit**: Re-process existing visit folders to extract fresh data (demographics, devices, leads). Includes a **Data Merge** interface to resolve conflicts between current records and scanned data.
- **Move Visit**: Easily reassign an entire visit (and its files) to a different patient in case of import errors.
- **Device & Lead Editor**: Manually edit patient device and lead history with a dedicated editor.

### 🛡️ Safety & Compliance
- **MRI Compatibility Links**: Quick links to manufacturer MRI compatibility check tools (Medtronic SureScan, Biotronik ProMRI Check, Abbott Merlin MRI, Boston Scientific ImageReady). MRI compatibility must always be verified by the responsible physician using the manufacturer's official resources.
- **Activity & Notifications**: Real-time feedback on import status, warnings, and background processes via a notification center.

### 📊 Advanced Parsing & Visualization
- **PDF Intelligence**: Extracts patient demographics, device details, and interrogation dates directly from PDF reports using advanced regex patterns.
- **Timeline View**: Visualizes a patient's history with a chronological timeline of all visits.
- **Side-by-Side Comparison**: View the original PDF report alongside structured data for verification.

### 🎨 Modern UI
- **Dark Mode**: Sleek, dark-themed interface designed for low-light reading environments.
- **Responsive Design**: Glassmorphism effects and smooth animations for a premium user experience.

## 🛠️ Technology Stack

- **Core**: [Electron](https://www.electronjs.org/) (Chromium + Node.js)
- **Frontend**: [React](https://reactjs.org/), [Tailwind CSS](https://tailwindcss.com/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Data**: Filesystem + SQLite (for fast indexing)
- **PDF Engine**: [PDF.js](https://mozilla.github.io/pdf.js/)

## 📦 Installation & Usage

1.  **Download**: Get the latest release (or build from source).
2.  **Run**: Double-click `KardiSynch.exe`. No installation required.
3.  **Import**: Copy your report files to the `_IMPORT` folder.
4.  **View**: Open the dashboard to see your patient list populated automatically.

## 🏗️ Building from Source

```bash
# Clone the repository
git clone https://github.com/alexanderlanganke/KardiSynch.git

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

## 🔮 Planned Features

- [ ] **DICOM Integration**: Support for imaging data.

---

## Important Regulatory Notice

**KardiSynch is NOT a medical device and is NOT intended for clinical decision-making.**

This software is a data management and organizational tool only. It does not provide medical advice, diagnoses, or treatment recommendations. Specifically:

- **MRI compatibility** must always be independently verified by the responsible physician using the device manufacturer's official tools and documentation. KardiSynch only provides convenience links to manufacturer resources — it does not determine or display MRI safety status.
- **Device advisories and warnings** shown in this application are sourced from manufacturer websites and may be incomplete, delayed, or inaccurate. Always consult the manufacturer directly and relevant regulatory authorities (e.g., BfArM, FDA) for authoritative safety information.
- **Patient data parsing** is based on heuristic extraction from manufacturer report files. Extracted data (demographics, device parameters, measurements) may contain errors and must not be relied upon as the sole source of clinical information.
- **Clinical decisions** regarding patient care, device programming, or procedural planning must be made by qualified healthcare professionals based on verified source data, not on information displayed by this software.

This software has not been certified, cleared, or approved under any medical device regulation (including EU MDR 2017/745, FDA 21 CFR 820, or equivalent). It is provided as-is for organizational purposes only, with no warranty of fitness for any clinical use.

---
*KardiSynch is a tool for data management and visualization. It is not a medical product.*

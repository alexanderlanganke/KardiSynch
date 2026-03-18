import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { findPatient, createPatient, createReport, findReportByDate, getSettings } from './database';
import { UnifiedReport } from './reports';
import { app } from 'electron';
import { sendNotification, sendPatientListUpdate } from './windowManager';
import { XMLParser } from 'fast-xml-parser';

function escapeXml(value: string | number | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

let dataDir: string;

/**
 * Initializes the storage module by setting the data directory path.
 */
export const initializeStorage = async () => {
  const settings = await getSettings();
  dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  await fs.mkdir(dataDir, { recursive: true });
};

/**
 * Generates patient.xml content
 */
/**
 * Generates patient.xml content
 */
const generatePatientXML = (
  patient: { id: string; first_name: string; last_name: string; dob: string; hospitalPatientId: string | null },
  devices: any[] = [],
  leads: any[] = [],
  mriStatus: any = null,
  mriDataHash: string | null = null,
  manufacturerWarningStatus: any = null,
  manufacturerWarningHash: string | null = null
): string => {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<patient>
  <id>${escapeXml(patient.id)}</id>
  <first_name>${escapeXml(patient.first_name || '')}</first_name>
  <last_name>${escapeXml(patient.last_name)}</last_name>
  <dob>${escapeXml(patient.dob)}</dob>
  <hospitalPatientId>${escapeXml(patient.hospitalPatientId || '')}</hospitalPatientId>`;

  if (devices && devices.length > 0) {
    xml += `
  <devices>`;
    devices.forEach(d => {
      xml += `
    <device>
      <model>${escapeXml(d.model || 'Unknown')}</model>
      <serial>${escapeXml(d.serial || 'Unknown')}</serial>
      <manufacturer>${escapeXml(d.manufacturer || 'Unknown')}</manufacturer>
      <implant_date>${escapeXml(d.implant_date || 'Unknown')}</implant_date>
      <type>${escapeXml(d.type || 'Unknown')}</type>
    </device>`;
    });
    xml += `
  </devices>`;
  }

  if (leads && leads.length > 0) {
    xml += `
  <leads>`;
    leads.forEach(l => {
      xml += `
    <lead>
      <model>${escapeXml(l.model || 'Unknown')}</model>
      <serial>${escapeXml(l.serial || 'Unknown')}</serial>
      <manufacturer>${escapeXml(l.manufacturer || 'Unknown')}</manufacturer>
      <implant_date>${escapeXml(l.implant_date || 'Unknown')}</implant_date>
      <type>${escapeXml(l.type || 'Unknown')}</type>
      <connector>${escapeXml(l.connector || 'Unknown')}</connector>
    </lead>`;
    });
    xml += `
  </leads>`;
  }

  if (mriStatus) {
    xml += `
  <mri_status>${escapeXml(JSON.stringify(mriStatus))}</mri_status>`;
  }

  if (mriDataHash) {
    xml += `
  <mri_data_hash>${escapeXml(mriDataHash)}</mri_data_hash>`;
  }

  if (manufacturerWarningStatus) {
    xml += `
  <manufacturer_warning_status>${escapeXml(JSON.stringify(manufacturerWarningStatus))}</manufacturer_warning_status>`;
  }

  if (manufacturerWarningHash) {
    xml += `
  <manufacturer_warning_hash>${escapeXml(manufacturerWarningHash)}</manufacturer_warning_hash>`;
  }

  xml += `
</patient>`;
  return xml;
};

/**
 * Generates visit.xml content
 */
const generateVisitXML = (report: UnifiedReport, reportId: string): string => {
  // Check for remote visit metadata (attached by web panel download flow)
  const remoteSource = (report as any)?._remoteSource as
    | { visit_type: string; source_domain: string; source_manufacturer: string }
    | undefined;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<visit>
  <report_id>${escapeXml(reportId)}</report_id>
  <interrogation_date>${escapeXml(report.interrogation_date)}</interrogation_date>
  <manufacturer>${escapeXml(report.manufacturer || '')}</manufacturer>`;

  if (remoteSource) {
    xml += `
  <visit_type>${escapeXml(remoteSource.visit_type)}</visit_type>
  <source_domain>${escapeXml(remoteSource.source_domain)}</source_domain>
  <source_manufacturer>${escapeXml(remoteSource.source_manufacturer)}</source_manufacturer>`;
  }

  xml += `
  <device_type>${escapeXml(report.device?.type || '')}</device_type>
  <device_model>${escapeXml(report.device?.model || '')}</device_model>
  <device_serial>${escapeXml(report.device?.serial_number || '')}</device_serial>`;

  if (report.battery) {
    xml += `
  <battery>
    <voltage value="${escapeXml(report.battery.voltage?.value || '')}" unit="${escapeXml(report.battery.voltage?.unit || '')}" />
    <last_charge_time value="${escapeXml(report.battery.lastChargeTime?.value || '')}" unit="${escapeXml(report.battery.lastChargeTime?.unit || '')}" />
    <status>${escapeXml(report.battery.status || '')}</status>
  </battery>`;
  }

  if (report.leads && report.leads.length > 0) {
    xml += `
  <leads>`;
    report.leads.forEach(lead => {
      xml += `
    <lead>
      <name>${escapeXml(lead.name || '')}</name>
      <model>${escapeXml((lead as any).model || '')}</model>
      <serial>${escapeXml((lead as any).serial || '')}</serial>
      <anatomic_location>${escapeXml(lead.anatomic_location || '')}</anatomic_location>
      <impedance value="${escapeXml(lead.impedance?.value || '')}" unit="${escapeXml(lead.impedance?.unit || '')}" />
      <sensing value="${escapeXml(lead.sensing?.value || '')}" unit="${escapeXml(lead.sensing?.unit || '')}" />
      <pacing_threshold value="${escapeXml(lead.pacing_threshold?.value || '')}" unit="${escapeXml(lead.pacing_threshold?.unit || '')}" />
      <pacing_amplitude value="${escapeXml(lead.pacing_amplitude?.value || '')}" unit="${escapeXml(lead.pacing_amplitude?.unit || '')}" />
      <shock_impedance value="${escapeXml(lead.shock_impedance?.value || '')}" unit="${escapeXml(lead.shock_impedance?.unit || '')}" />
    </lead>`;
    });
    xml += `
  </leads>`;
  }

  xml += `
</visit>`;
  return xml;
};

/**
 * Stores a unified report in the database, creating a new patient if necessary.
 * @param report The UnifiedReport object to store.
 * @returns The ID of the newly created report.
 */
export const storeReport = async (report: UnifiedReport): Promise<{ reportId: string; patient: any }> => {
  const { patient: patientData } = report;

  if (!patientData || !patientData.last_name || !patientData.dob) {
    throw new Error('Cannot store report without patient last name and DOB.');
  }

  // Find or create the patient.
  let patient = await findPatient(patientData.last_name, patientData.dob);
  let isNewPatient = false;
  if (!patient) {
    const newPatientId = uuidv4();
    patient = {
      id: newPatientId,
      first_name: patientData.first_name || '',
      last_name: patientData.last_name,
      dob: patientData.dob,
      hospitalPatientId: patientData.hospitalPatientId || null
    };
    await createPatient(patient);
    sendNotification(`New patient created: ${patient.first_name} ${patient.last_name}`);
    isNewPatient = true;
  }

  // Check for existing report on the same date to prevent duplicate visits
  const datePrefix = report.interrogation_date ? report.interrogation_date.split('T')[0] : '';
  if (datePrefix) {
    const existingReport = await findReportByDate(patient.id, datePrefix);
    if (existingReport) {
      console.log(`[Storage] Found existing report ${existingReport.id} for patient ${patient.id} on ${datePrefix}. Reusing.`);
      return { reportId: existingReport.id, patient };
    }
  }

  // Create the report record in the database.
  const reportId = uuidv4();
  await createReport({
    id: reportId,
    patient_id: patient.id,
    ...report
  });

  // Notify the renderer to refresh the patient list
  if (isNewPatient) {
    sendPatientListUpdate();
  }

  return { reportId, patient };
}


/**
 * Moves a file from its source path to the permanent data storage directory.
 * @param sourcePath The original path of the file.
 * @param reportId The ID of the report this file is associated with.
 * @param patientId The ID of the patient.
 * @param patientName Patient name to include in the directory name for readability.
 * @param interrogationDate The interrogation date to use in the visit subdirectory name.
 */
export const storeFile = async (
  sourcePath: string,
  reportId: string,
  patientId: string,
  patientName?: string,
  interrogationDate?: string,
  patient?: any,
  report?: UnifiedReport
): Promise<void> => {
  // Sanitize patient name for filesystem
  const safeName = patientName ? patientName.replace(/[^a-zA-Z0-9]/g, '_') : 'Unknown';

  // Create patient directory: PatientId_PatientName
  const patientDir = path.join(dataDir, 'Reports', `${patientId}_${safeName}`);

  // Extract date from interrogation_date (format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
  let dateString = 'Unknown';
  if (interrogationDate) {
    const date = new Date(interrogationDate);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      dateString = `${year}_${month}_${day}`;
    }
  }

  // Create visit subdirectory: YYYY_MM_DD_reportId
  const visitDir = path.join(patientDir, `${dateString}_${reportId}`);

  await fs.mkdir(visitDir, { recursive: true });

  /*
   * Handle cross-device moves (EXDEV) by falling back to copy+unlink.
   */
  const destPath = path.join(visitDir, path.basename(sourcePath));
  try {
    await fs.rename(sourcePath, destPath);
  } catch (error: any) {
    if (error.code === 'EXDEV') {
      await fs.copyFile(sourcePath, destPath);
      await fs.unlink(sourcePath);
    } else {
      throw error;
    }
  }

  // Generate or update patient.xml with device history
  if (patient) {
    const patientXmlPath = path.join(patientDir, 'patient.xml');
    let existingDevices: any[] = [];
    let existingLeads: any[] = [];

    // Read existing data if available (single read for devices, leads, MRI, warnings)
    let mriStatus: any = null;
    let mriDataHash: string | null = null;
    try {
      const xmlContent = await fs.readFile(patientXmlPath, 'utf-8');
      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse(xmlContent);

      if (parsed.patient) {
        if (parsed.patient.devices && parsed.patient.devices.device) {
          existingDevices = Array.isArray(parsed.patient.devices.device)
            ? parsed.patient.devices.device
            : [parsed.patient.devices.device];
        }
        if (parsed.patient.leads && parsed.patient.leads.lead) {
          existingLeads = Array.isArray(parsed.patient.leads.lead)
            ? parsed.patient.leads.lead
            : [parsed.patient.leads.lead];
        }
        if (parsed.patient.mri_status) {
          try { mriStatus = JSON.parse(parsed.patient.mri_status); } catch { }
        }
        mriDataHash = parsed.patient.mri_data_hash || null;
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT') console.error('Error reading existing patient.xml:', e);
    }

    // Append new device if from a report
    if (report && report.device && report.device.serial_number && report.manufacturer !== 'Unknown') {
      const newDevice = {
        model: report.device.model,
        serial: report.device.serial_number,
        manufacturer: report.manufacturer,
        implant_date: report.device.implant_date || 'Unknown'
      };

      // Sanity check: Don't add if THIS device is Unknown
      if (newDevice.serial !== 'Unknown' && newDevice.serial !== '') {
        // 1. CLEANUP: Remove any existing "Unknown" placeholders
        existingDevices = existingDevices.filter(d => d.serial && String(d.serial) !== 'Unknown');

        // 2. DEDUPLICATE: Check if already exists (by serial)
        const index = existingDevices.findIndex(d => String(d.serial) === String(newDevice.serial));
        if (index !== -1) {
          // Update existing entry with potentially newer metadata (e.g. better model name)
          existingDevices[index] = { ...existingDevices[index], ...newDevice };
        } else {
          existingDevices.push(newDevice);
        }
      }
    }

    // Append new leads if from a report
    if (report && report.leads) {
      report.leads.forEach(l => {
        if (l.serial && String(l.serial) !== 'Unknown' && l.serial !== '.') {
          const newLead = {
            model: l.model,
            serial: l.serial,
            manufacturer: l.manufacturer || report.manufacturer,
            implant_date: l.implant_date || 'Unknown'
          };

          // 1. CLEANUP: Remove "Unknown" leads? (Less critical for leads, but consistency is good)
          existingLeads = existingLeads.filter(lead => lead.serial && String(lead.serial) !== 'Unknown');

          // 2. DEDUPLICATE
          const index = existingLeads.findIndex(existing => String(existing.serial) === String(newLead.serial));
          if (index !== -1) {
            existingLeads[index] = { ...existingLeads[index], ...newLead };
          } else {
            existingLeads.push(newLead);
          }
        }
      });
    }

    await fs.writeFile(patientXmlPath, generatePatientXML(patient, existingDevices, existingLeads, mriStatus, mriDataHash, null, null));
  }

  // Generate or update visit.xml if report data provided
  if (report) {
    const visitXmlPath = path.join(visitDir, 'visit.xml');
    let finalReport = report;
    let existingLeads: any[] = [];

    // Read existing visit.xml to merge logic
    try {
      const xmlContent = await fs.readFile(visitXmlPath, 'utf-8');
      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse(xmlContent);
      if (parsed.visit && parsed.visit.leads && parsed.visit.leads.lead) {
        existingLeads = Array.isArray(parsed.visit.leads.lead)
          ? parsed.visit.leads.lead
          : [parsed.visit.leads.lead];
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT') console.error('Error reading existing visit.xml for merge:', e);
    }

    // Merge new leads with existing leads
    if (report.leads && report.leads.length > 0) {
      report.leads.forEach(l => {
        // Deduplicate by serial/model
        const exists = existingLeads.some(ex =>
          (ex.serial && String(ex.serial) === String(l.serial)) ||
          (ex.model && String(ex.model) === String(l.model) && ex.name === l.name)
        );
        if (!exists) {
          existingLeads.push(l);
        }
      });
      // Update the report object used for generation to include ALL leads
      finalReport = { ...report, leads: existingLeads };
    } else if (existingLeads.length > 0) {
      // If current report has no leads but existing one did, preserve them
      finalReport = { ...report, leads: existingLeads };
    }

    await fs.writeFile(visitXmlPath, generateVisitXML(finalReport, reportId));
  }

};

/**
 * Extracts a ZIP file's contents into a visit directory, generates visit.xml
 * and patient.xml metadata, then removes the source ZIP.
 */
export const storeZipContents = async (
  zipPath: string,
  reportId: string,
  patientId: string,
  patientName?: string,
  interrogationDate?: string,
  patient?: any,
  report?: UnifiedReport
): Promise<void> => {
  const AdmZip = (await import('adm-zip')).default;

  const safeName = patientName ? patientName.replace(/[^a-zA-Z0-9]/g, '_') : 'Unknown';
  const patientDir = path.join(dataDir, 'Reports', `${patientId}_${safeName}`);

  let dateString = 'Unknown';
  if (interrogationDate) {
    const date = new Date(interrogationDate);
    if (!isNaN(date.getTime())) {
      dateString = `${date.getFullYear()}_${String(date.getMonth() + 1).padStart(2, '0')}_${String(date.getDate()).padStart(2, '0')}`;
    }
  }

  const visitDir = path.join(patientDir, `${dateString}_${reportId}`);
  await fs.mkdir(visitDir, { recursive: true });

  // Extract all files (flatten nested directories)
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const entryName = path.basename(entry.entryName);
    if (!entryName) continue;
    await fs.writeFile(path.join(visitDir, entryName), entry.getData());
  }

  // Generate metadata XML
  if (report) {
    await fs.writeFile(path.join(visitDir, 'visit.xml'), generateVisitXML(report, reportId));
  }
  if (patient) {
    await fs.writeFile(path.join(patientDir, 'patient.xml'), generatePatientXML(patient));
  }

  // Clean up source ZIP
  await fs.unlink(zipPath).catch(() => {});
};

/**
 * Updates the patient.xml file with new patient details, preserving device/lead history.
 */
export const updatePatientXML = async (
  patientId: string,
  updatedData: {
    first_name: string;
    last_name: string;
    dob: string;
    hospitalPatientId: string | null;
    devices?: any[];
    leads?: any[];
    mriStatus?: any;
    mriDataHash?: string;
    manufacturerWarningStatus?: any;
    manufacturerWarningHash?: string;
  }
): Promise<void> => {
  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  const reportsDir = path.join(dataDir, 'Reports');

  // Find patient directory
  const dirs = await fs.readdir(reportsDir);
  const patientDirName = dirs.find(dir => dir.startsWith(patientId));

  if (!patientDirName) {
    throw new Error(`Patient directory not found for ID: ${patientId}`);
  }

  const patientDir = path.join(reportsDir, patientDirName);
  const patientXmlPath = path.join(patientDir, 'patient.xml');

  let devices = updatedData.devices;
  let leads = updatedData.leads;
  let mriStatus = updatedData.mriStatus;
  let mriDataHash = updatedData.mriDataHash;
  let manufacturerWarningStatus = updatedData.manufacturerWarningStatus;
  let manufacturerWarningHash = updatedData.manufacturerWarningHash;

  // If devices, leads, MRI, or Warning data NOT provided, read existing data to preserve it
  if (!devices || !leads || !mriStatus || !mriDataHash || !manufacturerWarningStatus || !manufacturerWarningHash) {
    let existingDevices: any[] = [];
    let existingLeads: any[] = [];

    try {
      const xmlContent = await fs.readFile(patientXmlPath, 'utf-8');
      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse(xmlContent);

      if (parsed.patient) {
        if (parsed.patient.devices && parsed.patient.devices.device) {
          existingDevices = Array.isArray(parsed.patient.devices.device)
            ? parsed.patient.devices.device
            : [parsed.patient.devices.device];
        }
        if (parsed.patient.leads && parsed.patient.leads.lead) {
          existingLeads = Array.isArray(parsed.patient.leads.lead)
            ? parsed.patient.leads.lead
            : [parsed.patient.leads.lead];
        }

        // Preserve existing MRI data if not provided
        if (!mriStatus && parsed.patient.mri_status) {
          try {
            mriStatus = JSON.parse(parsed.patient.mri_status);
          } catch (e) { }
        }
        if (!mriDataHash && parsed.patient.mri_data_hash) {
          mriDataHash = parsed.patient.mri_data_hash;
        }
        // Preserve Warning Data
        if (!manufacturerWarningStatus && parsed.patient.manufacturer_warning_status) {
          try {
            manufacturerWarningStatus = JSON.parse(parsed.patient.manufacturer_warning_status);
          } catch (e) { }
        }
        if (!manufacturerWarningHash && parsed.patient.manufacturer_warning_hash) {
          manufacturerWarningHash = parsed.patient.manufacturer_warning_hash;
        }
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT') console.error('Error reading existing patient.xml during update:', e);
    }

    if (!devices) devices = existingDevices;
    if (!leads) leads = existingLeads;
  }

  // Generate new XML with updated patient info and devices/leads
  const newXml = generatePatientXML(
    {
      id: patientId,
      first_name: updatedData.first_name,
      last_name: updatedData.last_name,
      dob: updatedData.dob,
      hospitalPatientId: updatedData.hospitalPatientId
    },
    devices,
    leads,
    mriStatus,
    mriDataHash,
    manufacturerWarningStatus,
    manufacturerWarningHash
  );

  await fs.writeFile(patientXmlPath, newXml);
};

/**
 * Moves a report (visit) to a different patient.
 */
export const moveReport = async (reportId: string, oldPatientId: string, newPatientId: string): Promise<void> => {
  const { getPatientById, updateReportPatient } = await import('./database');
  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  const reportsDir = path.join(dataDir, 'Reports');

  // Find old patient directory
  const patientDirs = await fs.readdir(reportsDir);
  const oldPatientDirName = patientDirs.find(d => d.startsWith(oldPatientId));
  if (!oldPatientDirName) throw new Error('Old patient directory not found');
  const oldPatientPath = path.join(reportsDir, oldPatientDirName);

  // Find visit directory
  const visitDirs = await fs.readdir(oldPatientPath);
  const visitDirName = visitDirs.find(d => d.includes(reportId));
  if (!visitDirName) throw new Error('Visit directory not found');
  const visitPath = path.join(oldPatientPath, visitDirName);

  // Get new patient details
  const newPatient = await getPatientById(newPatientId);
  if (!newPatient) throw new Error('New patient not found');

  // Create/Get new patient directory
  const safeName = `${newPatient.last_name}_${newPatient.first_name}`.replace(/[^a-zA-Z0-9]/g, '_');
  const newPatientDirName = `${newPatient.id}_${safeName}`;
  const newPatientPath = path.join(reportsDir, newPatientDirName);

  await fs.mkdir(newPatientPath, { recursive: true });

  // Move visit directory
  const newVisitPath = path.join(newPatientPath, visitDirName);
  try {
    await fs.rename(visitPath, newVisitPath);
  } catch (error: any) {
    if (error.code === 'EXDEV') {
      await fs.cp(visitPath, newVisitPath, { recursive: true });
      await fs.rm(visitPath, { recursive: true, force: true });
    } else {
      throw error;
    }
  }

  // Update Database
  await updateReportPatient(reportId, newPatientId);
};

/**
 * Exports all files from a visit directory to a target directory, excluding visit.xml.
 */
export const exportVisitFiles = async (
  patientId: string,
  visitId: string,
  targetDirectory: string
): Promise<{ count: number; success: boolean; message?: string }> => {
  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  const reportsDir = path.join(dataDir, 'Reports');

  // Find patient directory
  const dirs = await fs.readdir(reportsDir);
  const patientDirName = dirs.find(dir => dir.startsWith(patientId));

  if (!patientDirName) {
    throw new Error(`Patient directory not found for ID: ${patientId}`);
  }

  const patientPath = path.join(reportsDir, patientDirName);

  // Find visit directory
  const visitDirs = await fs.readdir(patientPath);
  const visitDirName = visitDirs.find(dir => dir.includes(visitId));

  if (!visitDirName) {
    throw new Error(`Visit directory not found for ID: ${visitId}`);
  }

  const visitPath = path.join(patientPath, visitDirName);

  // Validate target directory
  try {
    await fs.mkdir(targetDirectory, { recursive: true });
  } catch {
    throw new Error(`Target directory does not exist and could not be created: ${targetDirectory}`);
  }

  const files = await fs.readdir(visitPath);
  let copiedCount = 0;

  for (const file of files) {
    if (file === 'visit.xml') continue;

    const sourceFile = path.join(visitPath, file);
    const destFile = path.join(targetDirectory, file);

    const stats = await fs.stat(sourceFile);
    if (stats.isFile()) {
      await fs.copyFile(sourceFile, destFile);
      copiedCount++;
    }
  }

  return { count: copiedCount, success: true };
};

const PARSEABLE_EXTENSIONS = new Set(['.pdf', '.xml', '.txt', '.log', '.pkg', '.bnk', '.pdd']);
const METADATA_FILES = new Set(['visit.xml', 'patient.xml']);

/**
 * Reads all parseable files in a visit directory, parses them, and returns
 * a single aggregated UnifiedReport with best-of-each-field strategy.
 */
export const aggregateVisitFiles = async (visitPath: string): Promise<UnifiedReport | null> => {
  const { parseFile } = await import('./parser');

  const files = (await fs.readdir(visitPath)).filter(f => {
    if (METADATA_FILES.has(f.toLowerCase())) return false;
    const ext = path.extname(f).toLowerCase();
    return PARSEABLE_EXTENSIONS.has(ext);
  });

  const reports: UnifiedReport[] = [];
  for (const file of files) {
    try {
      const result = await parseFile(path.join(visitPath, file));
      if (result) reports.push(result);
    } catch (e) {
      console.warn(`[aggregateVisitFiles] Failed to parse ${file}:`, e);
    }
  }

  if (reports.length === 0) return null;

  const patient = reports.find(r => r.patient?.last_name)?.patient || reports[0].patient;
  const device = reports.find(r => r.device?.model && r.device.model !== 'Unknown')?.device
    || reports.find(r => r.device?.serial_number && r.device.serial_number !== 'Unknown')?.device
    || reports[0].device;
  const manufacturer = reports.find(r => r.manufacturer && r.manufacturer !== 'Unknown')?.manufacturer || reports[0].manufacturer;
  const interrogation_date = reports.find(r => r.interrogation_date)?.interrogation_date || reports[0].interrogation_date;
  const battery = reports.find(r => r.battery?.voltage?.value || r.battery?.status)?.battery || reports[0].battery;

  // Collect all leads and deduplicate by serial (fallback: model name)
  const allLeads = reports.flatMap(r => r.leads || []);
  const leadMap = new Map<string, any>();
  for (const lead of allLeads) {
    const key = lead.serial && lead.serial !== 'Unknown' && lead.serial !== '.'
      ? lead.serial
      : (lead.model || lead.name || '');
    if (key && !leadMap.has(key)) {
      leadMap.set(key, lead);
    }
  }

  return {
    patient,
    device,
    manufacturer,
    interrogation_date,
    battery,
    leads: Array.from(leadMap.values()),
  };
};

/**
 * Re-reads all files in a visit directory and rewrites visit.xml and patient.xml
 * with fully aggregated data. Preserves remote source metadata.
 */
export const refreshVisitMetadata = async (
  visitPath: string,
  reportId: string,
  patient: { id: string; first_name: string; last_name: string; dob: string; hospitalPatientId?: string | null }
): Promise<void> => {
  const aggregated = await aggregateVisitFiles(visitPath);
  if (!aggregated) return;

  // --- Rewrite visit.xml ---
  const visitXmlPath = path.join(visitPath, 'visit.xml');

  // Preserve _remoteSource metadata from existing visit.xml
  try {
    const existingXml = await fs.readFile(visitXmlPath, 'utf-8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(existingXml);
    if (parsed.visit) {
      const remote: any = {};
      if (parsed.visit.visit_type) remote.visit_type = parsed.visit.visit_type;
      if (parsed.visit.source_domain) remote.source_domain = parsed.visit.source_domain;
      if (parsed.visit.source_manufacturer) remote.source_manufacturer = parsed.visit.source_manufacturer;
      if (Object.keys(remote).length > 0) {
        (aggregated as any)._remoteSource = remote;
      }
    }
  } catch (e: any) {
    if (e.code !== 'ENOENT') console.warn('[refreshVisitMetadata] Error reading existing visit.xml:', e);
  }

  await fs.writeFile(visitXmlPath, generateVisitXML(aggregated, reportId));

  // --- Update patient.xml ---
  const patientDir = path.dirname(visitPath);
  const patientXmlPath = path.join(patientDir, 'patient.xml');

  let existingDevices: any[] = [];
  let existingLeads: any[] = [];
  let mriStatus: any = null;
  let mriDataHash: string | null = null;
  let manufacturerWarningStatus: any = null;
  let manufacturerWarningHash: string | null = null;

  try {
    const xmlContent = await fs.readFile(patientXmlPath, 'utf-8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xmlContent);
    if (parsed.patient) {
      if (parsed.patient.devices?.device) {
        existingDevices = Array.isArray(parsed.patient.devices.device)
          ? parsed.patient.devices.device : [parsed.patient.devices.device];
      }
      if (parsed.patient.leads?.lead) {
        existingLeads = Array.isArray(parsed.patient.leads.lead)
          ? parsed.patient.leads.lead : [parsed.patient.leads.lead];
      }
      if (parsed.patient.mri_status) {
        try { mriStatus = JSON.parse(parsed.patient.mri_status); } catch { }
      }
      mriDataHash = parsed.patient.mri_data_hash || null;
      if (parsed.patient.manufacturer_warning_status) {
        try { manufacturerWarningStatus = JSON.parse(parsed.patient.manufacturer_warning_status); } catch { }
      }
      manufacturerWarningHash = parsed.patient.manufacturer_warning_hash || null;
    }
  } catch (e: any) {
    if (e.code !== 'ENOENT') console.warn('[refreshVisitMetadata] Error reading existing patient.xml:', e);
  }

  // Merge device from aggregated report
  if (aggregated.device?.serial_number && aggregated.device.serial_number !== 'Unknown' && aggregated.manufacturer !== 'Unknown') {
    const newDevice = {
      model: aggregated.device.model,
      serial: aggregated.device.serial_number,
      manufacturer: aggregated.manufacturer,
      implant_date: aggregated.device.implant_date || 'Unknown'
    };
    existingDevices = existingDevices.filter(d => d.serial && String(d.serial) !== 'Unknown');
    const idx = existingDevices.findIndex(d => String(d.serial) === String(newDevice.serial));
    if (idx !== -1) {
      existingDevices[idx] = { ...existingDevices[idx], ...newDevice };
    } else {
      existingDevices.push(newDevice);
    }
  }

  // Merge leads from aggregated report
  if (aggregated.leads) {
    for (const l of aggregated.leads) {
      if (l.serial && String(l.serial) !== 'Unknown' && l.serial !== '.') {
        const newLead = {
          model: l.model,
          serial: l.serial,
          manufacturer: l.manufacturer || aggregated.manufacturer,
          implant_date: l.implant_date || 'Unknown'
        };
        existingLeads = existingLeads.filter(lead => lead.serial && String(lead.serial) !== 'Unknown');
        const idx = existingLeads.findIndex(ex => String(ex.serial) === String(newLead.serial));
        if (idx !== -1) {
          existingLeads[idx] = { ...existingLeads[idx], ...newLead };
        } else {
          existingLeads.push(newLead);
        }
      }
    }
  }

  await fs.writeFile(patientXmlPath, generatePatientXML(
    { id: patient.id, first_name: patient.first_name, last_name: patient.last_name, dob: patient.dob, hospitalPatientId: patient.hospitalPatientId || null },
    existingDevices,
    existingLeads,
    mriStatus,
    mriDataHash,
    manufacturerWarningStatus,
    manufacturerWarningHash
  ));

  console.log(`[refreshVisitMetadata] Updated metadata for visit ${reportId}`);
};

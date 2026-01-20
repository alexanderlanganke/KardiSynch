import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { findPatient, createPatient, createReport, getSettings } from './database';
import { UnifiedReport } from './reports';
import { app } from 'electron';
import { sendNotification, sendPatientListUpdate } from './windowManager';
import { XMLParser } from 'fast-xml-parser';

let dataDir: string;

/**
 * Initializes the storage module by setting the data directory path.
 */
export const initializeStorage = async () => {
  const settings = await getSettings();
  dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
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
  leads: any[] = []
): string => {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<patient>
  <id>${patient.id}</id>
  <first_name>${patient.first_name || ''}</first_name>
  <last_name>${patient.last_name}</last_name>
  <dob>${patient.dob}</dob>
  <hospitalPatientId>${patient.hospitalPatientId || ''}</hospitalPatientId>`;

  if (devices && devices.length > 0) {
    xml += `
  <devices>`;
    devices.forEach(d => {
      xml += `
    <device>
      <model>${d.model || 'Unknown'}</model>
      <serial>${d.serial || 'Unknown'}</serial>
      <manufacturer>${d.manufacturer || 'Unknown'}</manufacturer>
      <implant_date>${d.implant_date || 'Unknown'}</implant_date>
      <type>${d.type || 'Unknown'}</type>
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
      <model>${l.model || 'Unknown'}</model>
      <serial>${l.serial || 'Unknown'}</serial>
      <manufacturer>${l.manufacturer || 'Unknown'}</manufacturer>
      <implant_date>${l.implant_date || 'Unknown'}</implant_date>
      <type>${l.type || 'Unknown'}</type>
      <connector>${l.connector || 'Unknown'}</connector>
    </lead>`;
    });
    xml += `
  </leads>`;
  }

  xml += `
</patient>`;
  return xml;
};

/**
 * Generates visit.xml content
 */
const generateVisitXML = (report: UnifiedReport, reportId: string): string => {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<visit>
  <report_id>${reportId}</report_id>
  <interrogation_date>${report.interrogation_date}</interrogation_date>
  <manufacturer>${report.manufacturer || ''}</manufacturer>
  <device_type>${report.device?.type || ''}</device_type>
  <device_model>${report.device?.model || ''}</device_model>
  <device_serial>${report.device?.serial_number || ''}</device_serial>`;

  if (report.battery) {
    xml += `
  <battery>
    <voltage value="${report.battery.voltage?.value || ''}" unit="${report.battery.voltage?.unit || ''}" />
    <last_charge_time value="${report.battery.lastChargeTime?.value || ''}" unit="${report.battery.lastChargeTime?.unit || ''}" />
    <status>${report.battery.status || ''}</status>
  </battery>`;
  }

  if (report.leads && report.leads.length > 0) {
    xml += `
  <leads>`;
    report.leads.forEach(lead => {
      xml += `
    <lead>
      <name>${lead.name || ''}</name>
      <model>${(lead as any).model || ''}</model>
      <serial>${(lead as any).serial || ''}</serial>
      <anatomic_location>${lead.anatomic_location || ''}</anatomic_location>
      <impedance value="${lead.impedance?.value || ''}" unit="${lead.impedance?.unit || ''}" />
      <sensing value="${lead.sensing?.value || ''}" unit="${lead.sensing?.unit || ''}" />
      <pacing_threshold value="${lead.pacing_threshold?.value || ''}" unit="${lead.pacing_threshold?.unit || ''}" />
      <pacing_amplitude value="${lead.pacing_amplitude?.value || ''}" unit="${lead.pacing_amplitude?.unit || ''}" />
      <shock_impedance value="${lead.shock_impedance?.value || ''}" unit="${lead.shock_impedance?.unit || ''}" />
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

  if (!fs.existsSync(visitDir)) {
    fs.mkdirSync(visitDir, { recursive: true });
  }

  /*
   * Handle cross-device moves (EXDEV) by falling back to copy+unlink.
   */
  const destPath = path.join(visitDir, path.basename(sourcePath));
  try {
    fs.renameSync(sourcePath, destPath);
  } catch (error: any) {
    if (error.code === 'EXDEV') {
      fs.copyFileSync(sourcePath, destPath);
      fs.unlinkSync(sourcePath);
    } else {
      throw error;
    }
  }

  // Generate or update patient.xml with device history
  if (patient) {
    const patientXmlPath = path.join(patientDir, 'patient.xml');
    let existingDevices: any[] = [];
    let existingLeads: any[] = [];

    // Read existing data if available
    if (fs.existsSync(patientXmlPath)) {
      try {
        const xmlContent = fs.readFileSync(patientXmlPath, 'utf-8');
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
        }
      } catch (e) {
        console.error('Error reading existing patient.xml:', e);
      }
    }

    // Append new device if from a report
    if (report && report.device && report.device.serial_number) {
      const newDevice = {
        model: report.device.model,
        serial: report.device.serial_number,
        manufacturer: report.manufacturer,
        implant_date: report.device.implant_date || 'Unknown'
      };

      // Check if already exists (by serial)
      const exists = existingDevices.some(d => d.serial === newDevice.serial);
      if (!exists) {
        existingDevices.push(newDevice);
      }
    }

    // Append new leads if from a report
    if (report && report.leads) {
      report.leads.forEach(l => {
        if (l.serial) { // Only track leads with serials
          const newLead = {
            model: l.model,
            serial: l.serial,
            manufacturer: l.manufacturer || report.manufacturer,
            implant_date: l.implant_date || 'Unknown'
          };

          const exists = existingLeads.some(existing => existing.serial === newLead.serial);
          if (!exists) {
            existingLeads.push(newLead);
          }
        }
      });
    }

    // Write updated XML
    fs.writeFileSync(patientXmlPath, generatePatientXML(patient, existingDevices, existingLeads));
  }

  // Generate visit.xml if report data provided
  if (report) {
    const visitXmlPath = path.join(visitDir, 'visit.xml');
    fs.writeFileSync(visitXmlPath, generateVisitXML(report, reportId));
  }

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
  }
): Promise<void> => {
  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  const reportsDir = path.join(dataDir, 'Reports');

  // Find patient directory
  const dirs = await fs.promises.readdir(reportsDir);
  const patientDirName = dirs.find(dir => dir.startsWith(patientId));

  if (!patientDirName) {
    throw new Error(`Patient directory not found for ID: ${patientId}`);
  }

  const patientDir = path.join(reportsDir, patientDirName);
  const patientXmlPath = path.join(patientDir, 'patient.xml');

  let devices = updatedData.devices;
  let leads = updatedData.leads;

  // If devices or leads NOT provided, read existing data to preserve it
  if (!devices || !leads) {
    let existingDevices: any[] = [];
    let existingLeads: any[] = [];

    if (fs.existsSync(patientXmlPath)) {
      try {
        const xmlContent = fs.readFileSync(patientXmlPath, 'utf-8');
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
        }
      } catch (e) {
        console.error('Error reading existing patient.xml during update:', e);
      }
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
    leads
  );

  fs.writeFileSync(patientXmlPath, newXml);
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
  const patientDirs = fs.readdirSync(reportsDir);
  const oldPatientDirName = patientDirs.find(d => d.startsWith(oldPatientId));
  if (!oldPatientDirName) throw new Error('Old patient directory not found');
  const oldPatientPath = path.join(reportsDir, oldPatientDirName);

  // Find visit directory
  const visitDirs = fs.readdirSync(oldPatientPath);
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

  if (!fs.existsSync(newPatientPath)) {
    fs.mkdirSync(newPatientPath, { recursive: true });
  }

  // Move visit directory
  const newVisitPath = path.join(newPatientPath, visitDirName);
  try {
    fs.renameSync(visitPath, newVisitPath);
  } catch (error: any) {
    if (error.code === 'EXDEV') {
      fs.cpSync(visitPath, newVisitPath, { recursive: true });
      fs.rmSync(visitPath, { recursive: true, force: true });
    } else {
      throw error;
    }
  }

  // Update Database
  await updateReportPatient(reportId, newPatientId);
};

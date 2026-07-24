import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { findOrCreatePatient, createReport, getSettings } from './database';
import { UnifiedReport } from './reports';
import { app } from 'electron';
import { sendNotification, sendPatientListUpdate } from './windowManager';
import { XMLParser } from 'fast-xml-parser';
import { writeFileAtomic } from './utils/atomicFile';

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
 * Derives the YYYY_MM_DD directory-name component for a visit date.
 *
 * ISO strings are sliced textually: `new Date('YYYY-MM-DD')` parses as UTC
 * midnight while getFullYear()/getMonth()/getDate() are LOCAL — in any
 * timezone west of UTC that shifted every visit folder to the previous day.
 * Non-ISO strings fall back to Date parsing with local getters (those are
 * parsed as local time, so local getters are correct for them).
 */
export const visitDirDateString = (dateStr?: string | null): string => {
  if (!dateStr) return 'Unknown';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}_${m[2]}_${m[3]}`;
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}_${month}_${day}`;
  }
  return 'Unknown';
};

/**
 * Initializes the storage module by setting the data directory path.
 */
export const initializeStorage = async () => {
  const settings = await getSettings();
  dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  await fs.mkdir(dataDir, { recursive: true });

  // Idempotent/additive — safe to run every time storage (re-)points at a
  // dataPath, including a freshly chosen one.
  try {
    const { seedDeviceTypeAliases } = await import('./deviceTypeAliases');
    await seedDeviceTypeAliases();
  } catch (e) {
    console.warn('[Storage] Failed to seed device type aliases:', e);
  }
};

/**
 * Generates patient.xml content
 */
/**
 * Generates patient.xml content
 */
export const generatePatientXML = (
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
      <status>${escapeXml(d.status === 'explanted' ? 'explanted' : 'current')}</status>
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
  // Check for visit source metadata (attached by web panel download or intraoperative import)
  const remoteSource = (report as any)?._remoteSource as
    | { visit_type: string; source_domain?: string; source_manufacturer?: string }
    | undefined;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<visit>
  <report_id>${escapeXml(reportId)}</report_id>
  <interrogation_date>${escapeXml(report.interrogation_date)}</interrogation_date>
  <manufacturer>${escapeXml(report.manufacturer || '')}</manufacturer>`;

  if (remoteSource) {
    xml += `
  <visit_type>${escapeXml(remoteSource.visit_type)}</visit_type>`;
    if (remoteSource.source_domain) {
      xml += `
  <source_domain>${escapeXml(remoteSource.source_domain)}</source_domain>`;
    }
    if (remoteSource.source_manufacturer) {
      xml += `
  <source_manufacturer>${escapeXml(remoteSource.source_manufacturer)}</source_manufacturer>`;
    }
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

  if (report.additional_fields && Object.keys(report.additional_fields).length > 0) {
    xml += `
  <additional_fields>`;
    for (const [key, value] of Object.entries(report.additional_fields)) {
      xml += `
    <field name="${escapeXml(key)}">${escapeXml(String(value))}</field>`;
    }
    xml += `
  </additional_fields>`;
  }

  xml += `
</visit>`;
  return xml;
};

/**
 * Reads the <additional_fields><field name="...">value</field>...</additional_fields>
 * block back from a parsed (fast-xml-parser) visit.xml document into a plain map.
 */
const parseAdditionalFieldsXml = (additionalFieldsNode: any): Record<string, string | number> => {
  if (!additionalFieldsNode || !additionalFieldsNode.field) return {};
  const fields = Array.isArray(additionalFieldsNode.field) ? additionalFieldsNode.field : [additionalFieldsNode.field];
  const result: Record<string, string | number> = {};
  for (const f of fields) {
    const name = f?.['@_name'];
    if (!name) continue;
    const value = typeof f === 'object' ? f['#text'] : f;
    if (value !== undefined && value !== null) result[name] = value;
  }
  return result;
};

/**
 * Reads the existing patient.xml (if any), merges in the device/lead data from
 * `report`, and atomically rewrites the file — preserving MRI status/hash AND
 * manufacturer-warning status/hash. Shared by storeFile and storeZipContents so
 * every write path merges instead of clobbering the on-disk device history.
 */
const writeMergedPatientXML = async (
  patientDir: string,
  patient: any,
  report?: UnifiedReport
): Promise<void> => {
  const patientXmlPath = path.join(patientDir, 'patient.xml');
  let existingDevices: any[] = [];
  let existingLeads: any[] = [];

  // Read existing data if available (single read for devices, leads, MRI, warnings)
  let mriStatus: any = null;
  let mriDataHash: string | null = null;
  let manufacturerWarningStatus: any = null;
  let manufacturerWarningHash: string | null = null;
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
      if (parsed.patient.manufacturer_warning_status) {
        try { manufacturerWarningStatus = JSON.parse(parsed.patient.manufacturer_warning_status); } catch { }
      }
      manufacturerWarningHash = parsed.patient.manufacturer_warning_hash || null;
    }
  } catch (e: any) {
    if (e.code !== 'ENOENT') console.error('Error reading existing patient.xml:', e);
  }

  // Append new device if from a report. A device without a serial number
  // (a parser's identity extraction can miss it while model/manufacturer
  // still resolve) used to be dropped entirely — mirrors the lead-merge fix
  // below: build it whenever a model is known, and dedupe/refresh by
  // (manufacturer, model) instead of serial when serial is missing.
  if (report && report.device && (report.device.model || report.device.serial_number) && report.manufacturer !== 'Unknown') {
    const hasSerial = !!(report.device.serial_number && report.device.serial_number !== 'Unknown' && report.device.serial_number !== '');
    const newDevice: any = {
      model: report.device.model,
      serial: hasSerial ? report.device.serial_number : undefined,
      manufacturer: report.manufacturer,
      implant_date: report.device.implant_date || 'Unknown',
      // Only carry the type key when the report actually knows it — an
      // undefined key in the merge spread below would wipe a curated type.
      ...(report.device.type && report.device.type !== 'Unknown' ? { type: report.device.type } : {})
    };

    if (hasSerial || newDevice.model) {
      // 1. CLEANUP: drop stale "Unknown"-serial entries for this same
      //    (manufacturer, model) — left alone for any other model so an
      //    unrelated serial-less device isn't wiped out.
      existingDevices = existingDevices.filter(d =>
        (d.serial && String(d.serial) !== 'Unknown') ||
        !(d.manufacturer === newDevice.manufacturer && d.model === newDevice.model)
      );

      // 2. DEDUPLICATE
      const index = existingDevices.findIndex(d => hasSerial
        ? String(d.serial) === String(newDevice.serial)
        : (!d.serial || String(d.serial) === 'Unknown') && d.manufacturer === newDevice.manufacturer && d.model === newDevice.model
      );
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
    // Some real logs (e.g. certain Abbott coded-log revisions) don't report
    // a lead's serial number even though model/manufacturer/measurements
    // are present — requiring a serial here silently dropped those leads
    // from the patient record entirely, sometimes the device's *only* lead
    // (issue #152). Leads without a usable serial are deduped/refreshed by
    // chamber name instead (a patient has at most one active lead per
    // chamber) rather than being skipped.
    const incomingChamberNames = new Set(
      report.leads
        .filter(l => !(l.serial && String(l.serial) !== 'Unknown' && l.serial !== '.'))
        .map(l => l.name)
        .filter(Boolean)
    );

    // 1. CLEANUP (once, before the loop below — doing this per-lead would
    //    wipe out a same-report lead's serial-less entry on the very next
    //    iteration): drop existing "Unknown"-serial entries for chambers
    //    this import is about to refresh; leave alone serial-less entries
    //    for chambers this import doesn't mention.
    existingLeads = existingLeads.filter(lead =>
      (lead.serial && String(lead.serial) !== 'Unknown') || !incomingChamberNames.has(lead.name)
    );

    for (const l of report.leads) {
      const hasSerial = !!(l.serial && String(l.serial) !== 'Unknown' && l.serial !== '.');
      if (!hasSerial && !l.name) continue; // nothing to identify this lead by at all

      const newLead: any = {
        model: l.model,
        serial: hasSerial ? l.serial : undefined,
        manufacturer: l.manufacturer || report.manufacturer,
        implant_date: l.implant_date || 'Unknown',
        ...(hasSerial ? {} : { name: l.name })
      };

      // 2. DEDUPLICATE
      const index = existingLeads.findIndex(existing => hasSerial
        ? String(existing.serial) === String(newLead.serial)
        : (!existing.serial || String(existing.serial) === 'Unknown') && existing.name === newLead.name
      );
      if (index !== -1) {
        existingLeads[index] = { ...existingLeads[index], ...newLead };
      } else {
        existingLeads.push(newLead);
      }

      // 3. ENRICH: parsers don't emit lead type/connector, so fill them from
      //    the shared alias store — a correction made once on any patient's
      //    editor (issue #142) then applies to every future import of the
      //    same lead model.
      const merged = index !== -1 ? existingLeads[index] : existingLeads[existingLeads.length - 1];
      if ((!merged.type || merged.type === 'Unknown') || (!merged.connector || merged.connector === 'Unknown')) {
        try {
          const { lookupLeadAlias } = await import('./deviceTypeAliases');
          const alias = await lookupLeadAlias(merged.manufacturer, merged.model);
          if (alias) {
            if (alias.type && (!merged.type || merged.type === 'Unknown')) merged.type = alias.type;
            if (alias.connector && (!merged.connector || merged.connector === 'Unknown')) merged.connector = alias.connector;
          }
        } catch (e) {
          console.warn('[Storage] Lead alias lookup failed:', e);
        }
      }
    }
  }

  await writeFileAtomic(
    patientXmlPath,
    generatePatientXML(patient, existingDevices, existingLeads, mriStatus, mriDataHash, manufacturerWarningStatus, manufacturerWarningHash)
  );
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

  // Find or create the patient (atomic dedup — see findOrCreatePatient).
  const { patient, created: isNewPatient } = await findOrCreatePatient({
    first_name: patientData.first_name || '',
    last_name: patientData.last_name,
    dob: patientData.dob,
    hospitalPatientId: patientData.hospitalPatientId || null
  });
  if (isNewPatient) {
    sendNotification(`New patient created: ${patient.first_name} ${patient.last_name}`);
  }

  // Each call to storeReport creates a new visit. Within-batch grouping (a PKG
  // and its extracted PDFs, or a pkg + sidecar arriving together) is handled in
  // watcher.ts via the activeVisits map. Cross-batch DB-wide date merging is
  // deliberately NOT done here — a patient can have multiple surgeries and
  // interrogations on the same day, and each import session is its own visit.
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
/**
 * Pick a destination path in the visit dir that doesn't overwrite an existing
 * file. Returns null when the incoming file is byte-identical to the one
 * already stored under the same name (or a suffixed variant) — the caller
 * should then discard the source instead of storing a duplicate.
 */
const collisionFreeDestPath = async (visitDir: string, baseName: string, sourcePath: string): Promise<string | null> => {
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length);
  for (let i = 0; ; i++) {
    const candidate = path.join(visitDir, i === 0 ? baseName : `${stem}_${i + 1}${ext}`);
    let existingStat;
    try {
      existingStat = await fs.stat(candidate);
    } catch {
      return candidate;
    }
    if (existingStat.size === (await fs.stat(sourcePath)).size) {
      const [a, b] = await Promise.all([fs.readFile(candidate), fs.readFile(sourcePath)]);
      if (a.equals(b)) return null;
    }
  }
};

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

  // Single source of truth for the visit date. The directory name and visit.xml
  // are both derived from this one value so they can never diverge — previously
  // the dir used the `interrogationDate` param while visit.xml used
  // report.interrogation_date, so a caller passing the chosen date as the param
  // alongside a date-less report produced a correctly-dated directory but a
  // blank visit.xml date, which the timeline then showed as "unknown".
  const effectiveDate = (interrogationDate && interrogationDate.trim()) || report?.interrogation_date || '';

  // Extract date from effectiveDate (format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS).
  // Sliced textually (see visitDirDateString) to avoid the UTC-parse/local-getter
  // mismatch that shifted folders one day back in timezones west of UTC.
  const dateString = visitDirDateString(effectiveDate);

  // Create visit subdirectory: YYYY_MM_DD_reportId
  const visitDir = path.join(patientDir, `${dateString}_${reportId}`);

  await fs.mkdir(visitDir, { recursive: true });

  /*
   * Handle cross-device moves (EXDEV) by falling back to copy+unlink.
   * Strip the INTRAOP__ staging prefix (used by the intraop watcher to mark
   * origin through the parse/match pipeline) so it doesn't appear in stored filenames.
   */
  const destBaseName = path.basename(sourcePath).replace(/^INTRAOP__/, '');
  // Never clobber a file already stored in the visit dir: two same-day reports
  // can carry identical basenames (issue #145). An identical file is deduped
  // (source dropped); a different one gets a numbered suffix.
  const destPath = await collisionFreeDestPath(visitDir, destBaseName, sourcePath);
  if (destPath === null) {
    await fs.unlink(sourcePath);
  } else {
    try {
      await fs.rename(sourcePath, destPath);
    } catch (error: any) {
      if (error.code === 'EXDEV') {
        await fs.copyFile(sourcePath, destPath);
        // Verify copy before deleting source
        const [srcStat, destStat] = await Promise.all([fs.stat(sourcePath), fs.stat(destPath)]);
        if (destStat.size !== srcStat.size) {
          throw new Error(`Cross-device copy verification failed: ${srcStat.size} vs ${destStat.size} bytes`);
        }
        await fs.unlink(sourcePath);
      } else {
        throw error;
      }
    }
  }

  // Generate or update patient.xml with device history (merges with the
  // existing file and preserves MRI + manufacturer-warning fields)
  if (patient) {
    await writeMergedPatientXML(patientDir, patient, report);
  }

  // Generate or update visit.xml if report data provided
  if (report) {
    const visitXmlPath = path.join(visitDir, 'visit.xml');
    let finalReport = report;

    // Read the existing visit.xml (if any) so a second file merged into the
    // same visit — e.g. a same-day PDF alongside an XML export, or two files
    // from one same-day-reused interrogation (#155) — doesn't silently wipe
    // out data the first file already contributed. Previously only
    // leads/additional_fields were unioned; battery, device identity, and
    // manufacturer were simply overwritten by whichever file was stored last,
    // even when that file didn't carry that data at all.
    const { parseFile } = await import('./parser');
    const existingReport = await parseFile(visitXmlPath).catch(() => null);

    if (existingReport) {
      const existingLeads = existingReport.leads || [];
      let mergedLeads = existingLeads;
      if (report.leads && report.leads.length > 0) {
        mergedLeads = [...existingLeads];
        report.leads.forEach(l => {
          // Deduplicate by serial/model
          const exists = mergedLeads.some(ex =>
            (ex.serial && String(ex.serial) === String(l.serial)) ||
            (ex.model && String(ex.model) === String(l.model) && ex.name === l.name)
          );
          if (!exists) mergedLeads.push(l);
        });
      }

      const mergedAdditionalFields = { ...(existingReport.additional_fields || {}), ...(report.additional_fields || {}) };
      const hasBatteryData = (b?: UnifiedReport['battery']) => !!(b && (b.voltage?.value || b.lastChargeTime?.value || b.status));
      const hasIdentity = (v?: string) => !!(v && v !== 'Unknown');

      finalReport = {
        ...report,
        leads: mergedLeads,
        ...(Object.keys(mergedAdditionalFields).length > 0 ? { additional_fields: mergedAdditionalFields } : {}),
        battery: hasBatteryData(report.battery) ? report.battery : existingReport.battery,
        manufacturer: hasIdentity(report.manufacturer) ? report.manufacturer : (existingReport.manufacturer || report.manufacturer),
        device: {
          ...report.device,
          type: hasIdentity(report.device?.type) ? report.device.type : (existingReport.device?.type || report.device?.type),
          model: hasIdentity(report.device?.model) ? report.device.model : (existingReport.device?.model || report.device?.model),
          serial_number: hasIdentity(report.device?.serial_number) ? report.device.serial_number : (existingReport.device?.serial_number || report.device?.serial_number),
        },
      };
    }

    // Force the visit.xml date to match the directory's date (see effectiveDate
    // above) so the two never disagree.
    finalReport = { ...finalReport, interrogation_date: effectiveDate || finalReport.interrogation_date };

    await writeFileAtomic(visitXmlPath, generateVisitXML(finalReport, reportId));
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

  // Textual date slicing — see visitDirDateString (avoids the timezone shift).
  const dateString = visitDirDateString(interrogationDate);

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

  // Generate metadata XML.
  // visit.xml: only write the skeleton when the visit has none yet — assigning
  // a download to an EXISTING visit must not clobber its parsed metadata.
  if (report) {
    const visitXmlPath = path.join(visitDir, 'visit.xml');
    const visitXmlExists = await fs.access(visitXmlPath).then(() => true).catch(() => false);
    if (!visitXmlExists) {
      await writeFileAtomic(visitXmlPath, generateVisitXML(report, reportId));
    }
  }
  // patient.xml: merge with the existing file (device/lead history, MRI and
  // warning fields) exactly like storeFile — never overwrite with a skeleton.
  if (patient) {
    await writeMergedPatientXML(patientDir, patient, report);
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

  await writeFileAtomic(patientXmlPath, newXml);
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

  // Reuse the destination patient's EXISTING directory, located by ID prefix the
  // same way the rest of the app finds patient dirs (getPatientById,
  // removePatientDirectory, etc.). Only derive a fresh name if none exists yet.
  // Rebuilding the name unconditionally from the current DB record was a bug: if
  // the on-disk name had drifted from the DB (e.g. the patient's first name was
  // filled in after the folder was created), a SECOND directory was spawned and
  // the moved visits ended up split across the two — so a merge left visits out
  // of the keeper the app actually reads.
  let newPatientDirName = patientDirs.find(d => d === newPatientId || d.startsWith(`${newPatientId}_`));
  if (!newPatientDirName) {
    const safeName = `${newPatient.last_name}_${newPatient.first_name}`.replace(/[^a-zA-Z0-9]/g, '_');
    newPatientDirName = `${newPatient.id}_${safeName}`;
  }
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
 * Parse a JSON-encoded array column (devices/leads) into an array. Tolerates
 * null, a bare object, or malformed JSON.
 */
const parseJsonArray = (value: any): any[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) return parsed;
    return parsed ? [parsed] : [];
  } catch {
    return [];
  }
};

/**
 * Union two device/lead lists, deduplicating by serial number where
 * available. An entry with no usable serial (real logs sometimes lack one —
 * issue #152) is deduped/merged by (manufacturer, model) instead of being
 * dropped: this is shared between devices and leads, so it's less precise
 * than the chamber-name key writeMergedPatientXML uses for leads
 * specifically, but still preserves real data instead of discarding it.
 * Entries from `incoming` fill in fields missing on an existing entry with
 * the same key.
 */
const unionBySerial = (existing: any[], incoming: any[]): any[] => {
  const hasSerial = (d: any) => !!(d && d.serial && String(d.serial) !== 'Unknown');
  const hasIdentity = (d: any) => !!(d && (hasSerial(d) || d.model || d.manufacturer || d.name));
  const sameFallbackKey = (a: any, b: any) => !hasSerial(a) && !hasSerial(b) && a.manufacturer === b.manufacturer && a.model === b.model && (a.model || a.manufacturer);

  const merged = existing.filter(hasIdentity);
  for (const item of incoming) {
    if (!hasIdentity(item)) continue;
    const idx = merged.findIndex(d => hasSerial(item) ? String(d.serial) === String(item.serial) : sameFallbackKey(d, item));
    if (idx !== -1) {
      merged[idx] = { ...item, ...merged[idx] };
    } else {
      merged.push(item);
    }
  }
  return merged;
};

/**
 * Merge the patient-level device/lead history (and missing demographic fields)
 * of one or more "loser" patients into a "keeper" patient, then rewrite the
 * keeper's patient.xml so the on-disk summary stays authoritative. Reports/visits
 * are moved separately (see {@link moveReport}); this only consolidates the
 * aggregate device history shown on the patient profile.
 *
 * Call this BEFORE deleting the loser patients, while their directories still
 * exist. getPatientById read-repairs each patient from its patient.xml, so the
 * device/lead arrays reflect the on-disk source of truth.
 */
export const mergePatientProfiles = async (keeperId: string, loserIds: string[]): Promise<void> => {
  const { getPatientById, updatePatient } = await import('./database');
  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  const reportsDir = path.join(dataDir, 'Reports');

  const keeper = await getPatientById(keeperId).catch(() => null);
  if (!keeper) return;

  let devices = parseJsonArray(keeper.devices);
  let leads = parseJsonArray(keeper.leads);
  let hospitalPatientId: string | null = keeper.hospitalPatientId || null;

  for (const loserId of loserIds) {
    const loser = await getPatientById(loserId).catch(() => null);
    if (!loser) continue;
    devices = unionBySerial(devices, parseJsonArray(loser.devices));
    leads = unionBySerial(leads, parseJsonArray(loser.leads));
    if (!hospitalPatientId && loser.hospitalPatientId) hospitalPatientId = loser.hospitalPatientId;
  }

  // Persist merged aggregate to the DB row...
  await updatePatient({
    id: keeper.id,
    first_name: keeper.first_name || '',
    last_name: keeper.last_name,
    dob: keeper.dob,
    hospitalPatientId,
    device_manufacturer: keeper.device_manufacturer || null,
    device_model: keeper.device_model || null,
    device_serial: keeper.device_serial || null,
    leads: leads.length > 0 ? JSON.stringify(leads) : null,
    devices: devices.length > 0 ? devices : null,
  });

  // ...and rewrite patient.xml (the read-repair source of truth).
  try {
    const dirs = await fs.readdir(reportsDir);
    const keeperDirName = dirs.find(d => d.startsWith(keeperId));
    if (keeperDirName) {
      const keeperXmlPath = path.join(reportsDir, keeperDirName, 'patient.xml');
      let mriStatus: any = null;
      let mriDataHash: string | null = null;
      let warningStatus: any = null;
      let warningHash: string | null = null;
      try {
        const xmlContent = await fs.readFile(keeperXmlPath, 'utf-8');
        const parsed = new XMLParser({ ignoreAttributes: false }).parse(xmlContent);
        if (parsed.patient) {
          if (parsed.patient.mri_status) { try { mriStatus = JSON.parse(parsed.patient.mri_status); } catch { } }
          mriDataHash = parsed.patient.mri_data_hash || null;
          if (parsed.patient.manufacturer_warning_status) { try { warningStatus = JSON.parse(parsed.patient.manufacturer_warning_status); } catch { } }
          warningHash = parsed.patient.manufacturer_warning_hash || null;
        }
      } catch (e: any) {
        if (e.code !== 'ENOENT') console.warn('[mergePatientProfiles] Could not read keeper patient.xml:', e.message);
      }
      await writeFileAtomic(
        keeperXmlPath,
        generatePatientXML(
          { id: keeper.id, first_name: keeper.first_name || '', last_name: keeper.last_name, dob: keeper.dob, hospitalPatientId },
          devices,
          leads,
          mriStatus,
          mriDataHash,
          warningStatus,
          warningHash
        )
      );
    }
  } catch (e: any) {
    console.warn('[mergePatientProfiles] Failed to rewrite keeper patient.xml:', e.message);
  }
};

/**
 * Remove a patient's directory (and its now-empty contents) from disk. Used
 * after a merge has moved all visits away and the DB row has been deleted.
 */
export const removePatientDirectory = async (patientId: string): Promise<boolean> => {
  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  const reportsDir = path.join(dataDir, 'Reports');
  try {
    const dirs = await fs.readdir(reportsDir);
    const patientDirName = dirs.find(d => d.startsWith(patientId));
    if (!patientDirName) return false;
    await fs.rm(path.join(reportsDir, patientDirName), { recursive: true, force: true });
    return true;
  } catch (e: any) {
    console.warn('[removePatientDirectory] Failed to remove directory for', patientId, e.message);
    return false;
  }
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
  let interrogation_date = reports.find(r => r.interrogation_date)?.interrogation_date || reports[0].interrogation_date;
  // Fallback: extract date from directory name (format: YYYY_MM_DD_reportId)
  if (!interrogation_date) {
    const dirName = path.basename(visitPath);
    const match = dirName.match(/^(\d{4})_(\d{2})_(\d{2})_/);
    if (match) {
      interrogation_date = `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
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

  // Union additional_fields across every file in the visit — different
  // source files can each contribute different manufacturer-specific fields.
  const additionalFields: Record<string, string | number> = {};
  for (const r of reports) {
    if (r.additional_fields) Object.assign(additionalFields, r.additional_fields);
  }

  return {
    patient,
    device,
    manufacturer,
    interrogation_date,
    battery,
    leads: Array.from(leadMap.values()),
    ...(Object.keys(additionalFields).length > 0 ? { additional_fields: additionalFields } : {}),
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

  // Preserve fields from existing visit.xml when aggregation produces weaker data
  try {
    const existingXml = await fs.readFile(visitXmlPath, 'utf-8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(existingXml);
    if (parsed.visit) {
      // Preserve remote source metadata
      const remote: any = {};
      if (parsed.visit.visit_type) remote.visit_type = parsed.visit.visit_type;
      if (parsed.visit.source_domain) remote.source_domain = parsed.visit.source_domain;
      if (parsed.visit.source_manufacturer) remote.source_manufacturer = parsed.visit.source_manufacturer;
      if (Object.keys(remote).length > 0) {
        (aggregated as any)._remoteSource = remote;
      }

      // Preserve any additional_fields the existing visit.xml carries that the
      // fresh re-parse didn't recover (e.g. an older parser version extracted
      // them but the current one's field name/wiring differs) — freshly
      // re-parsed values win when both sides have the same key.
      const existingAdditionalFields = parseAdditionalFieldsXml(parsed.visit.additional_fields);
      if (Object.keys(existingAdditionalFields).length > 0) {
        aggregated.additional_fields = { ...existingAdditionalFields, ...(aggregated.additional_fields || {}) };
      }

      // Preserve existing date/manufacturer/device if aggregation produced empty values
      if (!aggregated.interrogation_date && parsed.visit.interrogation_date) {
        aggregated.interrogation_date = String(parsed.visit.interrogation_date);
      }
      if ((!aggregated.manufacturer || aggregated.manufacturer === 'Unknown') && parsed.visit.manufacturer) {
        aggregated.manufacturer = String(parsed.visit.manufacturer);
      }
      if (aggregated.device) {
        if ((!aggregated.device.model || aggregated.device.model === 'Unknown') && parsed.visit.device_model) {
          aggregated.device.model = String(parsed.visit.device_model);
        }
        if ((!aggregated.device.serial_number || aggregated.device.serial_number === 'Unknown') && parsed.visit.device_serial) {
          aggregated.device.serial_number = String(parsed.visit.device_serial);
        }
        if ((!aggregated.device.type || aggregated.device.type === 'Unknown') && parsed.visit.device_type) {
          aggregated.device.type = String(parsed.visit.device_type);
        }
      }
    }
  } catch (e: any) {
    if (e.code !== 'ENOENT') console.warn('[refreshVisitMetadata] Error reading existing visit.xml:', e);
  }

  await writeFileAtomic(visitXmlPath, generateVisitXML(aggregated, reportId));

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

  // Merge device from aggregated report. Same fallback as
  // writeMergedPatientXML above: dedupe/refresh by (manufacturer, model)
  // when serial is missing, instead of dropping the device entirely.
  if (aggregated.device && (aggregated.device.model || aggregated.device.serial_number) && aggregated.manufacturer !== 'Unknown') {
    const hasSerial = !!(aggregated.device.serial_number && aggregated.device.serial_number !== 'Unknown' && aggregated.device.serial_number !== '');
    const newDevice: any = {
      model: aggregated.device.model,
      serial: hasSerial ? aggregated.device.serial_number : undefined,
      manufacturer: aggregated.manufacturer,
      implant_date: aggregated.device.implant_date || 'Unknown'
    };
    if (hasSerial || newDevice.model) {
      existingDevices = existingDevices.filter(d =>
        (d.serial && String(d.serial) !== 'Unknown') ||
        !(d.manufacturer === newDevice.manufacturer && d.model === newDevice.model)
      );
      const idx = existingDevices.findIndex(d => hasSerial
        ? String(d.serial) === String(newDevice.serial)
        : (!d.serial || String(d.serial) === 'Unknown') && d.manufacturer === newDevice.manufacturer && d.model === newDevice.model
      );
      if (idx !== -1) {
        existingDevices[idx] = { ...existingDevices[idx], ...newDevice };
      } else {
        existingDevices.push(newDevice);
      }
    }
  }

  // Merge leads from aggregated report. Leads without a usable serial (see
  // writeMergedPatientXML above for why real logs sometimes lack one,
  // issue #152) are deduped/refreshed by chamber name instead of being
  // skipped entirely.
  if (aggregated.leads) {
    const incomingChamberNames = new Set(
      aggregated.leads
        .filter((l: any) => !(l.serial && String(l.serial) !== 'Unknown' && l.serial !== '.'))
        .map((l: any) => l.name)
        .filter(Boolean)
    );
    existingLeads = existingLeads.filter(lead =>
      (lead.serial && String(lead.serial) !== 'Unknown') || !incomingChamberNames.has(lead.name)
    );

    for (const l of aggregated.leads) {
      const hasSerial = !!(l.serial && String(l.serial) !== 'Unknown' && l.serial !== '.');
      if (!hasSerial && !l.name) continue;

      const newLead = {
        model: l.model,
        serial: hasSerial ? l.serial : undefined,
        manufacturer: l.manufacturer || aggregated.manufacturer,
        implant_date: l.implant_date || 'Unknown',
        ...(hasSerial ? {} : { name: l.name })
      };
      const idx = existingLeads.findIndex(ex => hasSerial
        ? String(ex.serial) === String(newLead.serial)
        : (!ex.serial || String(ex.serial) === 'Unknown') && ex.name === newLead.name
      );
      if (idx !== -1) {
        existingLeads[idx] = { ...existingLeads[idx], ...newLead };
      } else {
        existingLeads.push(newLead);
      }
    }
  }

  await writeFileAtomic(patientXmlPath, generatePatientXML(
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

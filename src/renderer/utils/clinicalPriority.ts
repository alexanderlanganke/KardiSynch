interface PatientLike {
  manufacturerWarningStatus?: { status: string; details: string; link?: string };
  lastReportDate?: string;
  deviceManufacturer?: string;
}

interface ReportLike {
  batteryStatus?: string;
  batteryVoltage?: string;
  interrogation_date?: string;
}

const NOTABLE_DAYS = 180; // Surface "last report" fact when older than this

export interface PatientFlag {
  label: string;
  link?: string;
}

/** Returns factual data points to surface on a patient card. */
export function getPatientFlags(patient: PatientLike, latestReport?: ReportLike): PatientFlag[] {
  const flags: PatientFlag[] = [];

  // Factual: manufacturer has posted an advisory or recall
  const warningStatus = patient.manufacturerWarningStatus?.status;
  const warningLink = patient.manufacturerWarningStatus?.link;
  if (warningStatus === 'advisory') {
    flags.push({ label: 'Manufacturer advisory posted', link: warningLink });
  } else if (warningStatus === 'recall') {
    flags.push({ label: 'Manufacturer recall posted', link: warningLink });
  }

  // Factual: battery status reported by device
  if (latestReport?.batteryStatus) {
    const bs = latestReport.batteryStatus.toLowerCase();
    if (bs.includes('eri') || bs.includes('eos') || bs.includes('eol')) {
      flags.push({ label: `Battery status: ${latestReport.batteryStatus}` });
    }
  }

  // Factual: no reports on file
  const dateStr = latestReport?.interrogation_date || patient.lastReportDate;
  if (!dateStr) {
    flags.push({ label: 'No reports on file' });
  } else {
    const days = daysSinceLastVisit(patient, latestReport);
    if (days !== null && days > NOTABLE_DAYS) {
      flags.push({ label: `Last report: ${days} days ago` });
    }
  }

  return flags;
}

export function hasActiveWarning(patient: PatientLike): boolean {
  const status = patient.manufacturerWarningStatus?.status;
  return status === 'advisory' || status === 'recall';
}

export function daysSinceLastVisit(patient: PatientLike, latestReport?: ReportLike): number | null {
  const dateStr = latestReport?.interrogation_date || patient.lastReportDate;
  if (!dateStr) return null;

  const lastDate = new Date(dateStr);
  if (isNaN(lastDate.getTime())) return null;

  return Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
}


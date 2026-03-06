export type PriorityLevel = 'urgent' | 'attention' | 'normal';

interface PatientLike {
  mriStatus?: { status: string; details: string };
  manufacturerWarningStatus?: { status: string; details: string; link?: string };
  lastReportDate?: string;
  deviceManufacturer?: string;
}

interface ReportLike {
  batteryStatus?: string;
  batteryVoltage?: string;
  interrogation_date?: string;
}

const OVERDUE_DAYS = 180; // 6 months

export function classifyPatient(patient: PatientLike, latestReport?: ReportLike): PriorityLevel {
  // Urgent: manufacturer safety warnings or critical battery only
  if (hasActiveWarning(patient)) return 'urgent';
  if (hasCriticalBattery(latestReport)) return 'urgent';

  // Attention: overdue follow-up
  if (isOverdueFollowUp(patient, latestReport)) return 'attention';

  return 'normal';
}

export function hasActiveWarning(patient: PatientLike): boolean {
  const status = patient.manufacturerWarningStatus?.status;
  return status === 'advisory' || status === 'recall';
}

export function hasCriticalBattery(report?: ReportLike): boolean {
  if (!report?.batteryStatus) return false;
  const status = report.batteryStatus.toLowerCase();
  return status.includes('eri') || status.includes('eos') || status.includes('eol');
}

export function hasUnsafeMri(patient: PatientLike): boolean {
  return patient.mriStatus?.status === 'unsafe';
}

export function isOverdueFollowUp(patient: PatientLike, latestReport?: ReportLike): boolean {
  const dateStr = latestReport?.interrogation_date || patient.lastReportDate;
  if (!dateStr) return true; // No report at all = overdue

  const lastDate = new Date(dateStr);
  if (isNaN(lastDate.getTime())) return false;

  const daysSince = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
  return daysSince > OVERDUE_DAYS;
}

export function daysSinceLastVisit(patient: PatientLike, latestReport?: ReportLike): number | null {
  const dateStr = latestReport?.interrogation_date || patient.lastReportDate;
  if (!dateStr) return null;

  const lastDate = new Date(dateStr);
  if (isNaN(lastDate.getTime())) return null;

  return Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
}

export function getPriorityLabel(level: PriorityLevel): string {
  switch (level) {
    case 'urgent': return 'Urgent';
    case 'attention': return 'Needs Attention';
    case 'normal': return 'Normal';
  }
}

export function getPriorityColor(level: PriorityLevel): string {
  switch (level) {
    case 'urgent': return 'var(--status-urgent)';
    case 'attention': return 'var(--status-attention)';
    case 'normal': return 'var(--status-normal)';
  }
}

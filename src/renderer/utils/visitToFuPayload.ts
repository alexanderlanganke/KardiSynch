// KNOWN STOPGAP: this payload is plaintext JSON embedded directly in an
// on-screen QR code — no encryption, no signing, no expiry. It carries
// patient name/DOB and device identity alongside clinical measurements, so
// anyone who photographs the screen has a durable, re-identifiable medical
// record. Shipped this way deliberately to unblock the CardioPal integration;
// needs revisiting (short-lived token and/or encrypted payload, coordinated
// with CardioPal's decoder) before this is exposed beyond a controlled pilot.

interface LeadInput {
  location?: string;
  type?: string;
  impedance?: string;
  sensing?: string;
  threshold?: string;
  pulseWidth?: string;
}

interface ReportInput {
  interrogation_date?: string;
  manufacturer?: string;
  device_type?: string;
  deviceModel?: string;
  deviceSerial?: string;
  batteryVoltage?: string;
  batteryStatus?: string;
  batteryLongevity?: string;
  additionalFields?: Record<string, string>;
  leads?: LeadInput[];
}

interface PatientInput {
  first_name?: string;
  last_name?: string;
  dob?: string;
  devices?: Array<{ serial?: string; implant_date?: string; status?: string }>;
}

interface CompactMeasurement {
  ta?: number;
  tp?: number;
  se?: number;
  im?: number;
}

interface FuPayload {
  date: string;
  fn?: string;
  ln?: string;
  dob?: string;
  dt?: string;
  dm?: string;
  mn?: string;
  ds?: string;
  di?: string;
  a?: CompactMeasurement;
  rv?: CompactMeasurement;
  lv?: CompactMeasurement;
  bv?: number;
  bs?: string;
  lo?: number;
}

type Channel = 'a' | 'rv' | 'lv';

const CHANNEL_PATTERNS: Array<{ channel: Channel; type: RegExp; location: RegExp }> = [
  {
    channel: 'a',
    type: /atri|^A$|^RA$|A-Lead/i,
    location: /right\s*atri|\bRA\b|\bA\b/i,
  },
  {
    channel: 'rv',
    type: /^RV$|RV-Lead|^RV\s/i,
    location: /right\s*ventri|\bRV\b/i,
  },
  {
    channel: 'lv',
    type: /^LV$|LV-Lead|^LV\s/i,
    location: /left\s*ventri|\bLV\b|coronary\s*sinus/i,
  },
];

function classifyLead(lead: LeadInput): Channel | null {
  for (const { channel, type, location } of CHANNEL_PATTERNS) {
    if ((lead.type && type.test(lead.type)) || (lead.location && location.test(lead.location))) {
      return channel;
    }
  }
  return null;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

function buildMeasurement(lead: LeadInput): CompactMeasurement | undefined {
  const m: CompactMeasurement = {};
  const ta = num(lead.threshold);
  if (ta !== undefined) m.ta = ta;
  const tp = num(lead.pulseWidth);
  if (tp !== undefined) m.tp = tp;
  const se = num(lead.sensing);
  if (se !== undefined) m.se = se;
  const im = num(lead.impedance);
  if (im !== undefined) m.im = im;
  return Object.keys(m).length > 0 ? m : undefined;
}

function parseLongevity(report: ReportInput): number | undefined {
  const raw = report.batteryLongevity
    || report.additionalFields?.['Estimated Longevity'];
  if (!raw) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

const DEVICE_TYPE_MAP: Record<string, string> = {
  'pacemaker': 'PM',
  'icd': 'ICD',
  'crt-d': 'CRT-D',
  'crt-p': 'CRT-P',
  's-icd': 'S-ICD',
  'leadless pacemaker': 'LR',
  'ccm': 'CCM',
};

const MANUFACTURER_MAP: Record<string, string> = {
  'biotronik': 'BIO',
  'medtronic': 'MDT',
  'abbott': 'ABT',
  'boston scientific': 'BSC',
  'microport': 'MIC',
  'sorin': 'SOR',
};

export function compactDeviceType(type: string | undefined): string | undefined {
  if (!type) return undefined;
  return DEVICE_TYPE_MAP[type.toLowerCase()] || type;
}

export function compactManufacturer(mfr: string | undefined): string | undefined {
  if (!mfr) return undefined;
  return MANUFACTURER_MAP[mfr.toLowerCase()] || mfr;
}

export function buildFuQrPayload(report: ReportInput, patient?: PatientInput): string {
  const d: FuPayload = {
    date: report.interrogation_date || '',
  };

  if (patient) {
    if (patient.first_name) d.fn = patient.first_name;
    if (patient.last_name) d.ln = patient.last_name;
    if (patient.dob) d.dob = patient.dob;
  }

  const dt = compactDeviceType(report.device_type);
  if (dt) d.dt = dt;
  const dm = compactManufacturer(report.manufacturer);
  if (dm) d.dm = dm;
  if (report.deviceModel) d.mn = report.deviceModel;
  if (report.deviceSerial) d.ds = report.deviceSerial;

  if (report.deviceSerial && patient?.devices) {
    const matchingDevice = patient.devices.find(
      dev => dev.serial === report.deviceSerial && dev.status !== 'explanted'
    );
    if (matchingDevice?.implant_date) d.di = matchingDevice.implant_date;
  }

  if (report.leads) {
    for (const lead of report.leads) {
      const ch = classifyLead(lead);
      if (!ch) continue;
      const m = buildMeasurement(lead);
      if (m) d[ch] = m;
    }
  }

  const bv = num(report.batteryVoltage);
  if (bv !== undefined) d.bv = bv;
  if (report.batteryStatus) d.bs = report.batteryStatus;

  const lo = parseLongevity(report);
  if (lo !== undefined) d.lo = lo;

  return JSON.stringify({ v: 1, t: 'fu', ts: Math.floor(Date.now() / 1000), d });
}

export function hasClinicalData(report: ReportInput): boolean {
  if (report.batteryVoltage || report.batteryStatus) return true;
  if (report.leads?.some(l => l.impedance || l.sensing || l.threshold)) return true;
  return false;
}

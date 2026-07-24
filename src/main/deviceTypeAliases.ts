import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { XMLParser } from 'fast-xml-parser';
import { getSettings } from './database';
import { logInfo, logError } from './logger';

/**
 * Persistent map of (manufacturer, model) → device type, shared across all
 * workstations that point at the same dataPath. Lives in
 * `{dataPath}/device_types.xml` alongside the visit storage so that one user's
 * disambiguation curates the whole clinic.
 *
 * File format:
 *   <device_types>
 *     <alias manufacturer="..." model="..." type="..." created_at="..." />
 *     <alias manufacturer="..." model="..." type="..." kind="lead" connector="..." role="LV" verified="false" created_at="..." />
 *     ...
 *   </device_types>
 * Entries without a `kind` attribute are device aliases (legacy files).
 *
 * `verified`: entries seeded from seedDeviceTypeAliases() (public
 * manufacturer documentation, not this clinic's own confirmation) are
 * written `verified="false"`. Entries without the attribute — every entry
 * that predates this field, and anything written by setAlias/setLeadAlias
 * (i.e. a clinician actually confirmed it in the editor) — are treated as
 * verified. A clinician editing a seeded entry flips it to verified: true,
 * and from then on it's indistinguishable from a from-scratch manual entry.
 *
 * Read-on-demand (file is tiny). Writes go through write-tmp + rename for
 * atomicity. Concurrent writes are last-write-wins, which is acceptable for
 * this low-frequency reference data.
 */

export interface DeviceTypeAlias {
  manufacturer: string;
  model: string;
  type: string;
  created_at: string;
  /** 'device' (default, also for legacy entries without the attribute) or 'lead' */
  kind?: 'device' | 'lead';
  /** Lead entries only: IS-1 / DF-1 / DF-4 / IS-4 */
  connector?: string;
  /** Lead entries only, seed data only: which port this lead's connector matters for (currently only 'LV' is used, for CRT generator-change planning). Not a clinician-editable field. */
  role?: string;
  /** false only for not-yet-confirmed seed entries; true (including implicit, when the attribute is absent) for anything a clinician has actually confirmed. */
  verified?: boolean;
}

const FILE_NAME = 'device_types.xml';

function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function getFilePath(): Promise<string> {
  const settings = await getSettings();
  const dataDir = settings.dataPath || path.join(app.getPath('userData'), '_DATA');
  return path.join(dataDir, FILE_NAME);
}

function normalizeKey(manufacturer: string, model: string): string {
  return `${manufacturer.trim().toLowerCase()}|${model.trim().toLowerCase()}`;
}

export async function listAliases(): Promise<DeviceTypeAlias[]> {
  const filePath = await getFilePath();
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (e: any) {
    if (e.code === 'ENOENT') return [];
    console.warn('[deviceTypeAliases] Failed to read aliases file:', e);
    return [];
  }
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const parsed = parser.parse(content);
    const root = parsed?.device_types;
    if (!root || !root.alias) return [];
    const rows = Array.isArray(root.alias) ? root.alias : [root.alias];
    return rows
      .filter((r: any) => r && r.manufacturer && r.model && (r.type || r.connector))
      .map((r: any) => ({
        manufacturer: String(r.manufacturer),
        model: String(r.model),
        type: String(r.type || ''),
        created_at: String(r.created_at || ''),
        kind: (r.kind === 'lead' ? 'lead' : 'device') as 'device' | 'lead',
        ...(r.connector ? { connector: String(r.connector) } : {}),
        ...(r.role ? { role: String(r.role) } : {}),
        // Absent verified attribute = pre-existing / manually-confirmed entry.
        verified: r.verified === 'false' ? false : true,
      }));
  } catch (e) {
    console.warn('[deviceTypeAliases] Malformed device_types.xml — treating as empty:', e);
    return [];
  }
}

export async function lookupAlias(manufacturer: string, model: string): Promise<string | null> {
  if (!manufacturer || !model) return null;
  const aliases = await listAliases();
  const key = normalizeKey(manufacturer, model);
  const hit = aliases.find(a => (a.kind ?? 'device') === 'device' && normalizeKey(a.manufacturer, a.model) === key);
  return hit && hit.type ? hit.type : null;
}

export interface LeadAliasAttrs {
  type?: string;
  connector?: string;
}

export async function lookupLeadAlias(manufacturer: string, model: string): Promise<LeadAliasAttrs | null> {
  if (!manufacturer || !model) return null;
  const aliases = await listAliases();
  const key = normalizeKey(manufacturer, model);
  const hit = aliases.find(a => a.kind === 'lead' && normalizeKey(a.manufacturer, a.model) === key);
  if (!hit) return null;
  return {
    ...(hit.type ? { type: hit.type } : {}),
    ...(hit.connector ? { connector: hit.connector } : {}),
  };
}

async function writeAll(aliases: DeviceTypeAlias[]): Promise<void> {
  const filePath = await getFilePath();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<device_types>',
    ...aliases.map(a => {
      const kindAttr = a.kind === 'lead' ? ' kind="lead"' : '';
      const connectorAttr = a.connector ? ` connector="${escapeXml(a.connector)}"` : '';
      const roleAttr = a.role ? ` role="${escapeXml(a.role)}"` : '';
      // Omit the attribute entirely for verified entries — keeps existing
      // (pre-this-field) files byte-for-byte unchanged when nothing in them
      // actually needed re-writing, and matches listAliases()'s "absent = verified" default.
      const verifiedAttr = a.verified === false ? ' verified="false"' : '';
      return `  <alias manufacturer="${escapeXml(a.manufacturer)}" model="${escapeXml(a.model)}" type="${escapeXml(a.type)}"${kindAttr}${connectorAttr}${roleAttr}${verifiedAttr} created_at="${escapeXml(a.created_at)}" />`;
    }),
    '</device_types>',
    '',
  ];
  const tmpPath = `${filePath}.tmp`;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tmpPath, lines.join('\n'), 'utf-8');
    await fs.rename(tmpPath, filePath);
    logInfo('deviceTypeAliases', `Wrote ${aliases.length} alias(es) to ${filePath}`);
  } catch (e: any) {
    logError('deviceTypeAliases', `Failed to write ${filePath}: ${e?.message || e}`, e?.stack);
    throw e;
  }
}

export async function setAlias(manufacturer: string, model: string, type: string): Promise<void> {
  if (!manufacturer || !model || !type) {
    throw new Error(`setAlias requires manufacturer, model, and type — got manufacturer="${manufacturer}" model="${model}" type="${type}"`);
  }
  logInfo('deviceTypeAliases', `setAlias("${manufacturer}", "${model}", "${type}")`);
  const aliases = await listAliases();
  const key = normalizeKey(manufacturer, model);
  const idx = aliases.findIndex(a => (a.kind ?? 'device') === 'device' && normalizeKey(a.manufacturer, a.model) === key);
  const entry: DeviceTypeAlias = {
    manufacturer: manufacturer.trim(),
    model: model.trim(),
    type: type.trim(),
    created_at: new Date().toISOString(),
    kind: 'device',
  };
  if (idx >= 0) aliases[idx] = entry;
  else aliases.push(entry);
  await writeAll(aliases);
}

export async function setLeadAlias(manufacturer: string, model: string, attrs: LeadAliasAttrs): Promise<void> {
  const type = (attrs.type || '').trim();
  const connector = (attrs.connector || '').trim();
  if (!manufacturer || !model || (!type && !connector)) {
    throw new Error(`setLeadAlias requires manufacturer, model, and at least one of type/connector — got manufacturer="${manufacturer}" model="${model}"`);
  }
  logInfo('deviceTypeAliases', `setLeadAlias("${manufacturer}", "${model}", type="${type}", connector="${connector}")`);
  const aliases = await listAliases();
  const key = normalizeKey(manufacturer, model);
  const idx = aliases.findIndex(a => a.kind === 'lead' && normalizeKey(a.manufacturer, a.model) === key);
  const existing = idx >= 0 ? aliases[idx] : null;
  const entry: DeviceTypeAlias = {
    manufacturer: manufacturer.trim(),
    model: model.trim(),
    // Merge with the stored entry so setting only the connector doesn't drop
    // a previously learned type (and vice versa).
    type: type || existing?.type || '',
    created_at: new Date().toISOString(),
    kind: 'lead',
    ...((connector || existing?.connector) ? { connector: connector || existing?.connector } : {}),
    // A clinician confirming a lead (via this function) always marks it
    // verified, whether they're starting fresh or upgrading a seeded guess —
    // but the seed data's role classification (shock/LV) isn't something
    // they're editing here, so carry it forward unchanged.
    ...(existing?.role ? { role: existing.role } : {}),
  };
  if (idx >= 0) aliases[idx] = entry;
  else aliases.push(entry);
  await writeAll(aliases);
}

export async function deleteAlias(manufacturer: string, model: string, kind: 'device' | 'lead' = 'device'): Promise<void> {
  const aliases = await listAliases();
  const key = normalizeKey(manufacturer, model);
  const next = aliases.filter(a => !((a.kind ?? 'device') === kind && normalizeKey(a.manufacturer, a.model) === key));
  if (next.length === aliases.length) return;
  await writeAll(next);
}

/**
 * Starting lead-connector data (issue #153), sourced from public
 * manufacturer documentation — not this clinic's own data, hence
 * verified: false. Scope is deliberately narrow: only the two cases the
 * Patient page actually highlights (DF-1 shock-coil leads, and IS-1
 * non-quadripolar LV leads), for the four manufacturers with model numbers
 * concrete enough to seed with confidence. No device-type (kind="device")
 * seed data yet — each parser already infers device type reasonably well
 * from the raw model string, and building a trustworthy model->type table
 * across five manufacturers' full device catalogs is a separate, much
 * larger research task.
 *
 * Model strings are the bare manufacturer model number/name as it typically
 * appears in a parsed report — exact match only (this store has no pattern
 * matching), so coverage is necessarily partial. A model not listed here
 * simply gets no suggestion, which is the correct behavior for something
 * we're not confident about.
 */
const SEED_LEAD_ALIASES: { manufacturer: string; model: string; type?: string; connector: string; role?: string; source: string }[] = [
  // --- Medtronic --- https://wwwp.medtronic.com/productperformance/model/6935-sprint-quattro-secure-s.html ; FDA recall records
  { manufacturer: 'Medtronic', model: '6935', connector: 'DF-1', source: 'Medtronic CRHF Product Performance — Sprint Quattro Secure S 6935' },
  { manufacturer: 'Medtronic', model: '6947', connector: 'DF-1', source: 'Medtronic CRHF Product Performance — Sprint Quattro Secure 6947' },
  { manufacturer: 'Medtronic', model: '6935M', connector: 'DF-4', source: 'Medtronic CRHF Product Performance — Sprint Quattro Secure S MRI 6935M (DF4-LLHO)' },
  { manufacturer: 'Medtronic', model: '6946M', connector: 'DF-4', source: 'Medtronic CRHF Product Performance — 6946M Sprint Quattro' },
  { manufacturer: 'Medtronic', model: '6947M', connector: 'DF-4', source: 'Medtronic CRHF Product Performance — Sprint Quattro Secure MRI 6947M (DF4-LLHH)' },
  // Attain bipolar LV leads (IS-1) — https://accessgudid.nlm.nih.gov
  { manufacturer: 'Medtronic', model: '4193', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'AccessGUDID — Attain OTW 4193' },
  { manufacturer: 'Medtronic', model: '4194', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'AccessGUDID — Attain Bipolar OTW 4194' },
  { manufacturer: 'Medtronic', model: '4195', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'FDA P060039 — Attain StarFix 4195' },
  { manufacturer: 'Medtronic', model: '4196', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'Medtronic IFU — Attain Ability 4196 (IS-1I)' },
  // NOTE: Attain Performa / Attain Stability Quad are IS4 quadripolar — deliberately not seeded here.

  // --- Boston Scientific --- Endotak Reliance Physician's Lead Manual (358079-079)
  ...['0127', '0128', '0129', '0137', '0138', '0139', '0143', '0147', '0148', '0149', '0153', '0157', '0158', '0159', '0170', '0171', '0172', '0173', '0174', '0175', '0176', '0177', '0180', '0181', '0182', '0183', '0184', '0185', '0186', '0187']
    .map(model => ({ manufacturer: 'Boston Scientific', model, connector: 'DF-1', source: "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)" })),
  ...['0262', '0263', '0265', '0266', '0272', '0273', '0275', '0276', '0282', '0283', '0285', '0286', '0292', '0293', '0295', '0296']
    .map(model => ({ manufacturer: 'Boston Scientific', model, connector: 'DF-4', source: "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual" })),
  ...['0636', '0650', '0651', '0652', '0653', '0654', '0655', '0657', '0658', '0662', '0663', '0665', '0672', '0673', '0675', '0676', '0682', '0683', '0685', '0686', '0692', '0693', '0695', '0696']
    .map(model => ({ manufacturer: 'Boston Scientific', model, connector: 'DF-4', source: 'Boston Scientific Reliance 4-Front spec sheet (CRM-348801)' })),
  // Acuity bipolar LV leads (IS-1)
  ...['4554', '4555', '4591', '4592', '4593']
    .map(model => ({ manufacturer: 'Boston Scientific', model, type: 'Bipolar', connector: 'IS-1', role: 'LV', source: "Boston Scientific Acuity Spiral Physician's Lead Manual (357272-032); CIA Medical catalog (4554/4555)" })),
  // NOTE: Acuity X4 is IS4 quadripolar — deliberately not seeded here.

  // --- Abbott / St. Jude Medical --- Durata Lead Model Numbers and Ordering Information (cardiovascular.abbott)
  ...['7120', '7121', '7122', '7170', '7171', '7172']
    .map(model => ({ manufacturer: 'Abbott', model, connector: 'DF-1', source: 'Abbott Durata Lead Model Numbers and Ordering Information' })),
  ...['7120Q', '7121Q', '7122Q', '7170Q', '7171Q', '7172Q']
    .map(model => ({ manufacturer: 'Abbott', model, connector: 'DF-4', source: 'Abbott Durata Lead Model Numbers and Ordering Information' })),
  ...['LDA220', 'LDA230', 'LDP220', 'LDP230']
    .map(model => ({ manufacturer: 'Abbott', model, connector: 'DF-1', source: 'Abbott Optisure Post Approval Study protocol (NCT02235545)' })),
  ...['LDA210Q', 'LDA220Q', 'LDA230Q', 'LDP220Q', 'LDP230Q']
    .map(model => ({ manufacturer: 'Abbott', model, connector: 'DF-4', source: 'Abbott Optisure Post Approval Study protocol (NCT02235545); LDA210Q-65 listing (DF4-LLHO)' })),
  // QuickFlex bipolar LV leads (IS-1)
  ...['1056T', '1058T', '1156T', '1158T', '1258T']
    .map(model => ({ manufacturer: 'Abbott', model, type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'St. Jude Medical QuickFlex/QuickFlex μ safety communications; QuickFlex Micro Post Approval Study (NCT01179477)' })),
  // NOTE: Quartet is IS4 quadripolar — deliberately not seeded here.

  // --- Biotronik --- Plexa product page (biotronik.com); MAUDE report for Plexa ProMRI DF-1 S DX
  // Lower confidence than the numeric-model entries above — Biotronik model
  // strings vary more in exact formatting, so these may match less reliably.
  { manufacturer: 'Biotronik', model: 'Plexa ProMRI DF-1 S 65', connector: 'DF-1', source: 'Biotronik Plexa product page' },
  { manufacturer: 'Biotronik', model: 'Plexa ProMRI DF-1 S 75', connector: 'DF-1', source: 'Biotronik Plexa product page' },
  { manufacturer: 'Biotronik', model: 'Plexa ProMRI DF-1 SD 65/16', connector: 'DF-1', source: 'Biotronik Plexa product page' },
  { manufacturer: 'Biotronik', model: 'Plexa ProMRI DF-1 SD 65/18', connector: 'DF-1', source: 'Biotronik Plexa product page' },
  { manufacturer: 'Biotronik', model: 'Plexa ProMRI DF-1 SD 75/18', connector: 'DF-1', source: 'Biotronik Plexa product page' },
  { manufacturer: 'Biotronik', model: 'Plexa ProMRI DF-1 S DX 65/15', connector: 'DF-1', source: 'MAUDE adverse event report — Plexa ProMRI DF-1 S DX 65/15' },
  { manufacturer: 'Biotronik', model: 'Plexa ProMRI DF-1 S DX 65/17', connector: 'DF-1', source: 'Biotronik Plexa product page' },
  { manufacturer: 'Biotronik', model: 'Plexa S 60', connector: 'DF-4', source: 'Biotronik Plexa product page' },
  { manufacturer: 'Biotronik', model: 'Plexa SD 60/16', connector: 'DF-4', source: 'Biotronik Plexa product page' },
  // Corox/Sentus bipolar LV leads (IS-1)
  { manufacturer: 'Biotronik', model: 'Corox OTW BP 75', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'Biotronik CRT Leads catalog' },
  { manufacturer: 'Biotronik', model: 'Corox OTW BP 85', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'Biotronik CRT Leads catalog' },
  { manufacturer: 'Biotronik', model: 'Corox OTW-S BP 75', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'Biotronik CRT Leads catalog' },
  { manufacturer: 'Biotronik', model: 'Corox OTW-S BP 85', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'Biotronik CRT Leads catalog' },
  { manufacturer: 'Biotronik', model: 'Corox OTW-L BP 75', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'Biotronik CRT Leads catalog' },
  { manufacturer: 'Biotronik', model: 'Corox OTW-L BP 85', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'Biotronik CRT Leads catalog' },
  { manufacturer: 'Biotronik', model: 'Sentus OTW BP L 75', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'Biotronik CRT Leads catalog' },
  { manufacturer: 'Biotronik', model: 'Sentus OTW BP L 85', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'Biotronik CRT Leads catalog' },
  { manufacturer: 'Biotronik', model: 'Sentus OTW BP L 95', type: 'Bipolar', connector: 'IS-1', role: 'LV', source: 'Biotronik CRT Leads catalog' },
  // NOTE: Sentus ProMRI QP ("IS4-LLLL (LV)") is IS4 quadripolar — deliberately not seeded here.
];

/**
 * Idempotent, additive-only: inserts each seed row that has no existing
 * entry (seeded or clinician-confirmed) for the same (kind, manufacturer,
 * model) key, and never touches a key that's already present — so a
 * clinician's manual correction, or a previous run of this same function,
 * is never overwritten. Safe to call on every app startup.
 */
export async function seedDeviceTypeAliases(): Promise<{ added: number }> {
  const aliases = await listAliases();
  const existingKeys = new Set(aliases.map(a => `${a.kind ?? 'device'}|${normalizeKey(a.manufacturer, a.model)}`));
  const toAdd: DeviceTypeAlias[] = [];
  const seenSeedKeys = new Set<string>();

  for (const seed of SEED_LEAD_ALIASES) {
    const key = `lead|${normalizeKey(seed.manufacturer, seed.model)}`;
    if (existingKeys.has(key)) continue;
    if (seenSeedKeys.has(key)) {
      logError('deviceTypeAliases', `Duplicate seed key within SEED_LEAD_ALIASES, skipping: ${seed.manufacturer} / ${seed.model}`);
      continue;
    }
    seenSeedKeys.add(key);
    toAdd.push({
      manufacturer: seed.manufacturer,
      model: seed.model,
      type: seed.type || '',
      connector: seed.connector,
      ...(seed.role ? { role: seed.role } : {}),
      kind: 'lead',
      verified: false,
      created_at: new Date().toISOString(),
    });
  }

  if (toAdd.length === 0) return { added: 0 };
  await writeAll([...aliases, ...toAdd]);
  logInfo('deviceTypeAliases', `Seeded ${toAdd.length} lead connector suggestion(s).`);
  return { added: toAdd.length };
}

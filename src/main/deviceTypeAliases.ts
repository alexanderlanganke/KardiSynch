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
 *     <alias manufacturer="..." model="..." type="..." kind="lead" connector="..." created_at="..." />
 *     ...
 *   </device_types>
 * Entries without a `kind` attribute are device aliases (legacy files).
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
      return `  <alias manufacturer="${escapeXml(a.manufacturer)}" model="${escapeXml(a.model)}" type="${escapeXml(a.type)}"${kindAttr}${connectorAttr} created_at="${escapeXml(a.created_at)}" />`;
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

import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { XMLParser } from 'fast-xml-parser';
import { getSettings } from './database';

/**
 * Persistent map of (manufacturer, model) → device type, shared across all
 * workstations that point at the same dataPath. Lives in
 * `{dataPath}/device_types.xml` alongside the visit storage so that one user's
 * disambiguation curates the whole clinic.
 *
 * File format:
 *   <device_types>
 *     <alias manufacturer="..." model="..." type="..." created_at="..." />
 *     ...
 *   </device_types>
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
      .filter((r: any) => r && r.manufacturer && r.model && r.type)
      .map((r: any) => ({
        manufacturer: String(r.manufacturer),
        model: String(r.model),
        type: String(r.type),
        created_at: String(r.created_at || ''),
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
  const hit = aliases.find(a => normalizeKey(a.manufacturer, a.model) === key);
  return hit ? hit.type : null;
}

async function writeAll(aliases: DeviceTypeAlias[]): Promise<void> {
  const filePath = await getFilePath();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<device_types>',
    ...aliases.map(a =>
      `  <alias manufacturer="${escapeXml(a.manufacturer)}" model="${escapeXml(a.model)}" type="${escapeXml(a.type)}" created_at="${escapeXml(a.created_at)}" />`
    ),
    '</device_types>',
    '',
  ];
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, lines.join('\n'), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

export async function setAlias(manufacturer: string, model: string, type: string): Promise<void> {
  if (!manufacturer || !model || !type) {
    throw new Error('setAlias requires manufacturer, model, and type');
  }
  const aliases = await listAliases();
  const key = normalizeKey(manufacturer, model);
  const idx = aliases.findIndex(a => normalizeKey(a.manufacturer, a.model) === key);
  const entry: DeviceTypeAlias = {
    manufacturer: manufacturer.trim(),
    model: model.trim(),
    type: type.trim(),
    created_at: new Date().toISOString(),
  };
  if (idx >= 0) aliases[idx] = entry;
  else aliases.push(entry);
  await writeAll(aliases);
}

export async function deleteAlias(manufacturer: string, model: string): Promise<void> {
  const aliases = await listAliases();
  const key = normalizeKey(manufacturer, model);
  const next = aliases.filter(a => normalizeKey(a.manufacturer, a.model) !== key);
  if (next.length === aliases.length) return;
  await writeAll(next);
}

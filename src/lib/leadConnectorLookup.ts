/**
 * Pure helpers for the DF-1 / IS-1-in-CRT-LV-port lead highlight (#153).
 *
 * The actual data lives in the main process's device_types.xml (see
 * src/main/deviceTypeAliases.ts) — a starting set of entries seeded from
 * public manufacturer documentation (verified: false), which a clinician
 * can confirm or correct via DeviceLeadEditor (verified: true from then
 * on). This module just decides, given a lead and the full alias list
 * (fetched once via window.electronAPI.listDeviceTypeAliases()), what to
 * show — it holds no lead data of its own.
 */

export interface DeviceTypeAliasLike {
  manufacturer: string;
  model: string;
  kind?: 'device' | 'lead';
  connector?: string;
  /** Only meaningful for kind: 'lead'. Currently only 'LV' is used. */
  role?: string;
  verified?: boolean;
}

// Callers pass lead/device data sourced from parsed files and the DB, which
// cross an untyped IPC boundary — a malformed source file can put a
// non-string (object/array) in a manufacturer/model field. Coerce with
// String() rather than trusting the `string` type, or `.trim()` throws
// on a truthy non-string value that `|| ''` doesn't catch (#162).
const normalizeKey = (manufacturer: string, model: string) =>
  `${String(manufacturer ?? '').trim().toLowerCase()}|${String(model ?? '').trim().toLowerCase()}`;

export function findLeadAlias(
  aliases: DeviceTypeAliasLike[],
  manufacturer: string | undefined,
  model: string | undefined
): DeviceTypeAliasLike | null {
  if (!manufacturer || !model) return null;
  const key = normalizeKey(manufacturer, model);
  return aliases.find(a => a.kind === 'lead' && normalizeKey(a.manufacturer, a.model) === key) || null;
}

export interface ConnectorFlag {
  connector: string;
  confirmed: boolean;
}

/**
 * Decides whether a lead should get the prominent DF-1 / IS-1-in-LV-port
 * highlight. `role` (shock vs LV) has no field on the lead itself — it only
 * ever comes from the alias entry, even when the lead's own connector value
 * was already confirmed (patient.xml's lead schema has nowhere to put role).
 */
export function getConnectorFlag(
  lead: { manufacturer?: string; model?: string; connector?: string },
  aliases: DeviceTypeAliasLike[]
): ConnectorFlag | null {
  const alias = findLeadAlias(aliases, lead.manufacturer, lead.model);
  const leadConnector = lead.connector && lead.connector !== 'Unknown' ? lead.connector : null;
  const connector = leadConnector || alias?.connector;
  if (!connector) return null;

  const isFlagged = connector === 'DF-1' || (connector === 'IS-1' && alias?.role === 'LV');
  if (!isFlagged) return null;

  // No matching alias at all (e.g. legacy patient.xml data predating this
  // feature) — trust whatever's already stored rather than second-guess it.
  const confirmed = alias ? alias.verified !== false : true;
  return { connector, confirmed };
}

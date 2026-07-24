import { describe, it, expect } from 'vitest';
import { findLeadAlias, getConnectorFlag, DeviceTypeAliasLike } from '../lib/leadConnectorLookup';

const aliases: DeviceTypeAliasLike[] = [
  { manufacturer: 'Medtronic', model: '6935', kind: 'lead', connector: 'DF-1', verified: false },
  { manufacturer: 'Medtronic', model: '6935M', kind: 'lead', connector: 'DF-4', verified: false },
  { manufacturer: 'Medtronic', model: '4194', kind: 'lead', connector: 'IS-1', role: 'LV', verified: false },
  { manufacturer: 'Medtronic', model: 'CapSureSense 5076', kind: 'lead', connector: 'IS-1', verified: true },
  { manufacturer: 'Abbott', model: '7120', kind: 'lead', connector: 'DF-1', verified: true },
  { manufacturer: 'Medtronic', model: 'Some Device', kind: 'device', type: 'Pacemaker' } as any,
];

describe('findLeadAlias', () => {
  it('finds a lead alias by manufacturer + model, case/whitespace insensitive', () => {
    expect(findLeadAlias(aliases, 'medtronic', ' 6935 ')).toEqual(expect.objectContaining({ connector: 'DF-1' }));
  });

  it('does not match a device-kind entry', () => {
    expect(findLeadAlias(aliases, 'Medtronic', 'Some Device')).toBeNull();
  });

  it('returns null for missing manufacturer/model or no match', () => {
    expect(findLeadAlias(aliases, undefined, '6935')).toBeNull();
    expect(findLeadAlias(aliases, 'Medtronic', undefined)).toBeNull();
    expect(findLeadAlias(aliases, 'Medtronic', 'Unrecognized')).toBeNull();
  });
});

describe('getConnectorFlag', () => {
  it('flags a DF-1 lead as unconfirmed when only an unverified alias matches', () => {
    const flag = getConnectorFlag({ manufacturer: 'Medtronic', model: '6935' }, aliases);
    expect(flag).toEqual({ connector: 'DF-1', confirmed: false });
  });

  it('flags a DF-1 lead as confirmed when the matching alias is verified', () => {
    const flag = getConnectorFlag({ manufacturer: 'Abbott', model: '7120' }, aliases);
    expect(flag).toEqual({ connector: 'DF-1', confirmed: true });
  });

  it('flags an IS-1 lead only when the alias role is LV', () => {
    expect(getConnectorFlag({ manufacturer: 'Medtronic', model: '4194' }, aliases)).toEqual({ connector: 'IS-1', confirmed: false });
  });

  it('does not flag an IS-1 lead whose alias has no LV role (most pace/sense leads)', () => {
    // CapSureSense 5076 is a verified IS-1 alias with no role — the vast
    // majority of leads in the app are ordinary IS-1 atrial/RV pace/sense
    // leads, which must never false-positive as "LV".
    expect(getConnectorFlag({ manufacturer: 'Medtronic', model: 'CapSureSense 5076' }, aliases)).toBeNull();
  });

  it('does not flag DF-4 leads', () => {
    expect(getConnectorFlag({ manufacturer: 'Medtronic', model: '6935M' }, aliases)).toBeNull();
  });

  it('prefers the lead\'s own stored connector over the alias connector, but still takes role from the alias', () => {
    // A lead whose patient.xml connector was already enriched to DF-1 for a
    // model not in the alias list at all — no alias, so "confirmed" trusts
    // the stored value as-is (legacy data predating this feature).
    const flag = getConnectorFlag({ manufacturer: 'Medtronic', model: 'UnseenModel', connector: 'DF-1' }, aliases);
    expect(flag).toEqual({ connector: 'DF-1', confirmed: true });
  });

  it('returns null when there is no connector data at all', () => {
    expect(getConnectorFlag({ manufacturer: 'Medtronic', model: 'TotallyUnknown' }, aliases)).toBeNull();
  });
});

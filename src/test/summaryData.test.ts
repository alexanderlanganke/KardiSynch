import { describe, it, expect } from 'vitest';
import {
  toNumber,
  sortChronological,
  buildTrendPoints,
  getLeadLocations,
  buildLeadMetricPoints,
  mergeAdditionalFields,
} from '../renderer/utils/summaryData';

describe('toNumber', () => {
  it('parses numeric strings', () => {
    expect(toNumber('3.2')).toBe(3.2);
  });

  it('returns undefined for missing/empty/non-numeric values', () => {
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber('')).toBeUndefined();
    expect(toNumber('n/a')).toBeUndefined();
  });

  it('best-effort parses a leading numeric portion out of a composite string (e.g. "0.8 @ 0.4")', () => {
    // BSC pacing_threshold is stored as "amplitude @ pulseWidth" — this is a
    // known, accepted approximation (charts the amplitude, ignores pulse
    // width) rather than a new limitation introduced by the Summary view.
    expect(toNumber('0.8 @ 0.4')).toBe(0.8);
  });
});

describe('sortChronological', () => {
  it('sorts ascending by date and drops reports with no date', () => {
    const reports = [
      { id: '2', interrogation_date: '2024-01-01' },
      { id: '1', interrogation_date: '2023-01-01' },
      { id: '3', interrogation_date: '' },
      { id: '4' },
    ];
    expect(sortChronological(reports).map(r => r.id)).toEqual(['1', '2']);
  });
});

describe('buildTrendPoints', () => {
  it('extracts numeric points and skips reports where the extractor yields nothing', () => {
    const chronological = [
      { interrogation_date: '2023-01-01', batteryVoltage: '3.2' },
      { interrogation_date: '2023-06-01', batteryVoltage: undefined },
      { interrogation_date: '2024-01-01', batteryVoltage: '2.9' },
    ];
    const points = buildTrendPoints(chronological, r => r.batteryVoltage);
    expect(points).toEqual([
      { date: '2023-01-01', value: 3.2 },
      { date: '2024-01-01', value: 2.9 },
    ]);
  });

  it('collapses multiple visits on the same date into one averaged point (#154/#155)', () => {
    // Two visits sharing a date land on the same x-position in a time-based
    // chart — plotting them as separate points draws a meaningless zigzag
    // that can look like the value jumped up and back down for no reason.
    const chronological = [
      { interrogation_date: '2023-01-01', batteryVoltage: '3.0' },
      { interrogation_date: '2023-01-01', batteryVoltage: '3.2' },
      { interrogation_date: '2024-01-01', batteryVoltage: '2.9' },
    ];
    const points = buildTrendPoints(chronological, r => r.batteryVoltage);
    expect(points).toEqual([
      { date: '2023-01-01', value: 3.1 },
      { date: '2024-01-01', value: 2.9 },
    ]);
  });

  it('attaches a device serial per point when a deviceExtractor is given (#154)', () => {
    const chronological = [
      { interrogation_date: '2023-01-01', batteryVoltage: '2.6', deviceSerial: 'DEV-OLD' },
      { interrogation_date: '2024-01-01', batteryVoltage: '3.1', deviceSerial: 'DEV-NEW' },
    ];
    const points = buildTrendPoints(chronological, r => r.batteryVoltage, r => r.deviceSerial);
    expect(points).toEqual([
      { date: '2023-01-01', value: 2.6, deviceSerial: 'DEV-OLD' },
      { date: '2024-01-01', value: 3.1, deviceSerial: 'DEV-NEW' },
    ]);
  });

  it('leaves deviceSerial unset for a date where readings disagree on which device produced them', () => {
    const chronological = [
      { interrogation_date: '2023-01-01', batteryVoltage: '3.0', deviceSerial: 'DEV-A' },
      { interrogation_date: '2023-01-01', batteryVoltage: '3.2', deviceSerial: 'DEV-B' },
    ];
    const points = buildTrendPoints(chronological, r => r.batteryVoltage, r => r.deviceSerial);
    expect(points[0].deviceSerial).toBeUndefined();
  });
});

describe('getLeadLocations', () => {
  it('collects the union of lead locations across all visits, deduplicated', () => {
    const chronological = [
      { leads: [{ location: 'RV' }, { location: 'Atrium' }] },
      { leads: [{ location: 'RV' }] },
      { leads: [{ type: 'LV' }] },
    ];
    expect(getLeadLocations(chronological)).toEqual(['RV', 'Atrium', 'LV']);
  });
});

describe('buildLeadMetricPoints', () => {
  it('tracks a metric for a given anatomic location even when the underlying lead object changes across visits (e.g. lead replacement)', () => {
    const chronological = [
      { interrogation_date: '2023-01-01', leads: [{ location: 'RV', serial: 'A', impedance: '500' }] },
      { interrogation_date: '2024-01-01', leads: [{ location: 'RV', serial: 'B', impedance: '540' }] },
    ];
    expect(buildLeadMetricPoints(chronological, 'RV', 'impedance')).toEqual([
      { date: '2023-01-01', value: 500 },
      { date: '2024-01-01', value: 540 },
    ]);
  });

  it('returns an empty array when no visit has that location', () => {
    const chronological = [{ interrogation_date: '2023-01-01', leads: [{ location: 'Atrium', impedance: '500' }] }];
    expect(buildLeadMetricPoints(chronological, 'RV', 'impedance')).toEqual([]);
  });
});

describe('mergeAdditionalFields', () => {
  it('takes the newest value when the same key appears on multiple visits', () => {
    const chronological = [
      { interrogation_date: '2023-01-01', additionalFields: { ejection_fraction: '35%' } },
      { interrogation_date: '2024-01-01', additionalFields: { ejection_fraction: '30%', nyha_class: 'II' } },
    ];
    expect(mergeAdditionalFields(chronological)).toEqual({
      ejection_fraction: { value: '30%', date: '2024-01-01' },
      nyha_class: { value: 'II', date: '2024-01-01' },
    });
  });

  it('handles visits with no additionalFields at all', () => {
    const chronological = [{ interrogation_date: '2023-01-01' }];
    expect(mergeAdditionalFields(chronological)).toEqual({});
  });
});

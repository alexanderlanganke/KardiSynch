import { describe, it, expect } from 'vitest';
import { buildFuQrPayload, hasClinicalData, compactDeviceType, compactManufacturer } from '../renderer/utils/visitToFuPayload';

function parseEnvelope(json: string) {
  const obj = JSON.parse(json);
  expect(obj.v).toBe(1);
  expect(obj.t).toBe('fu');
  expect(typeof obj.ts).toBe('number');
  expect(obj.d).toBeTruthy();
  expect(typeof obj.d).toBe('object');
  return obj;
}

describe('buildFuQrPayload', () => {
  it('produces a valid HCP envelope with RA/RV leads and battery', () => {
    const report = {
      interrogation_date: '2025-06-10',
      batteryVoltage: '3.18',
      batteryStatus: 'BOL',
      leads: [
        { type: 'RA', location: 'Right Atrium', impedance: '490', sensing: '2.5', threshold: '0.75', pulseWidth: '0.4' },
        { type: 'RV', location: 'RV Septum', impedance: '505', sensing: '11.2', threshold: '0.5', pulseWidth: '0.4' },
      ],
    };
    const env = parseEnvelope(buildFuQrPayload(report));
    expect(env.d.date).toBe('2025-06-10');
    expect(env.d.bv).toBe(3.18);
    expect(env.d.bs).toBe('BOL');
    expect(env.d.a).toEqual({ ta: 0.75, tp: 0.4, se: 2.5, im: 490 });
    expect(env.d.rv).toEqual({ ta: 0.5, tp: 0.4, se: 11.2, im: 505 });
    expect(env.d.lv).toBeUndefined();
  });

  it('maps Medtronic lead names (Atrial Lead / RV Lead)', () => {
    const report = {
      interrogation_date: '2024-01-01',
      leads: [
        { type: 'Atrial Lead', location: 'A', impedance: '500' },
        { type: 'RV Lead', location: 'RV', impedance: '480' },
      ],
    };
    const env = parseEnvelope(buildFuQrPayload(report));
    expect(env.d.a).toEqual({ im: 500 });
    expect(env.d.rv).toEqual({ im: 480 });
  });

  it('maps Abbott lead names (Atrium / RV / LV)', () => {
    const report = {
      interrogation_date: '2024-01-01',
      leads: [
        { type: 'Atrium', impedance: '510' },
        { type: 'RV', impedance: '482' },
        { type: 'LV', impedance: '680' },
      ],
    };
    const env = parseEnvelope(buildFuQrPayload(report));
    expect(env.d.a).toEqual({ im: 510 });
    expect(env.d.rv).toEqual({ im: 482 });
    expect(env.d.lv).toEqual({ im: 680 });
  });

  it('maps Biotronik lead names (A-Lead / RV-Lead)', () => {
    const report = {
      interrogation_date: '2024-01-01',
      leads: [
        { type: 'A-Lead', impedance: '490' },
        { type: 'RV-Lead', impedance: '520' },
      ],
    };
    const env = parseEnvelope(buildFuQrPayload(report));
    expect(env.d.a).toEqual({ im: 490 });
    expect(env.d.rv).toEqual({ im: 520 });
  });

  it('maps leads by location when type is absent', () => {
    const report = {
      interrogation_date: '2024-01-01',
      leads: [
        { location: 'Right Atrial Appendage', impedance: '545' },
        { location: 'Right Ventricle', impedance: '498' },
        { location: 'Coronary Sinus (lateral vein)', impedance: '680' },
      ],
    };
    const env = parseEnvelope(buildFuQrPayload(report));
    expect(env.d.a).toEqual({ im: 545 });
    expect(env.d.rv).toEqual({ im: 498 });
    expect(env.d.lv).toEqual({ im: 680 });
  });

  it('produces minimal envelope with just date when no clinical data', () => {
    const report = { interrogation_date: '2024-01-01' };
    const env = parseEnvelope(buildFuQrPayload(report));
    expect(env.d.date).toBe('2024-01-01');
    expect(env.d.a).toBeUndefined();
    expect(env.d.rv).toBeUndefined();
    expect(env.d.lv).toBeUndefined();
    expect(env.d.bv).toBeUndefined();
  });

  it('parses battery longevity from batteryLongevity string', () => {
    const report = {
      interrogation_date: '2024-01-01',
      batteryLongevity: '8.5 years',
    };
    const env = parseEnvelope(buildFuQrPayload(report));
    expect(env.d.lo).toBe(8.5);
  });

  it('parses battery longevity from additionalFields', () => {
    const report = {
      interrogation_date: '2024-01-01',
      additionalFields: { 'Estimated Longevity': '12.5 years' },
    };
    const env = parseEnvelope(buildFuQrPayload(report));
    expect(env.d.lo).toBe(12.5);
  });

  it('omits fields with empty or invalid values', () => {
    const report = {
      interrogation_date: '2024-01-01',
      batteryVoltage: '',
      batteryStatus: '',
      leads: [
        { type: 'RA', impedance: '', sensing: 'invalid', threshold: '', pulseWidth: '' },
      ],
    };
    const env = parseEnvelope(buildFuQrPayload(report));
    expect(env.d.bv).toBeUndefined();
    expect(env.d.bs).toBeUndefined();
    expect(env.d.a).toBeUndefined();
  });

  it('keeps payload under 2953 bytes for a fully populated report', () => {
    const report = {
      interrogation_date: '2025-09-15',
      batteryVoltage: '3.25',
      batteryStatus: 'BOL',
      batteryLongevity: '11.8 years',
      leads: [
        { type: 'RA', location: 'Right Atrium', impedance: '510', sensing: '2.6', threshold: '0.5', pulseWidth: '0.4' },
        { type: 'RV Coil', location: 'RV Septum', impedance: '482', sensing: '8.2', threshold: '0.75', pulseWidth: '0.4' },
        { type: 'LV', location: 'Coronary Sinus (lateral vein)', impedance: '680', sensing: '12.5', threshold: '1.0', pulseWidth: '0.5' },
      ],
    };
    const payload = buildFuQrPayload(report);
    expect(payload.length).toBeLessThan(2953);
  });

  it('includes patient demographics when patient is provided', () => {
    const report = {
      interrogation_date: '2025-06-10',
      manufacturer: 'Biotronik',
      device_type: 'Pacemaker',
      deviceModel: 'Edora 8 DR-T ProMRI',
      deviceSerial: 'BIO-2025-78441',
      batteryVoltage: '3.18',
      batteryStatus: 'BOL',
      leads: [
        { type: 'RA', impedance: '490', sensing: '2.5', threshold: '0.75', pulseWidth: '0.4' },
      ],
    };
    const patient = {
      first_name: 'Erika',
      last_name: 'Hoffmann',
      dob: '1952-09-14',
      devices: [
        { serial: 'BIO-2025-78441', implant_date: '2025-06-10', status: 'current' },
      ],
    };
    const env = parseEnvelope(buildFuQrPayload(report, patient));
    expect(env.d.fn).toBe('Erika');
    expect(env.d.ln).toBe('Hoffmann');
    expect(env.d.dob).toBe('1952-09-14');
    expect(env.d.dt).toBe('PM');
    expect(env.d.dm).toBe('BIO');
    expect(env.d.mn).toBe('Edora 8 DR-T ProMRI');
    expect(env.d.ds).toBe('BIO-2025-78441');
    expect(env.d.di).toBe('2025-06-10');
    expect(env.d.a).toEqual({ ta: 0.75, tp: 0.4, se: 2.5, im: 490 });
    expect(env.d.bv).toBe(3.18);
  });

  it('omits patient fields when patient is not provided', () => {
    const report = {
      interrogation_date: '2025-06-10',
      manufacturer: 'Medtronic',
      device_type: 'ICD',
      batteryVoltage: '3.10',
    };
    const env = parseEnvelope(buildFuQrPayload(report));
    expect(env.d.fn).toBeUndefined();
    expect(env.d.ln).toBeUndefined();
    expect(env.d.dob).toBeUndefined();
    expect(env.d.dt).toBe('ICD');
    expect(env.d.dm).toBe('MDT');
  });

  it('includes device identity from report without patient', () => {
    const report = {
      interrogation_date: '2024-04-22',
      manufacturer: 'Abbott',
      device_type: 'CRT-D',
      deviceModel: 'Gallant CRT-D',
      deviceSerial: 'ABT-2025-34918',
    };
    const env = parseEnvelope(buildFuQrPayload(report));
    expect(env.d.dt).toBe('CRT-D');
    expect(env.d.dm).toBe('ABT');
    expect(env.d.mn).toBe('Gallant CRT-D');
    expect(env.d.ds).toBe('ABT-2025-34918');
    expect(env.d.di).toBeUndefined();
  });

  it('resolves implant date from patient devices matching report serial', () => {
    const report = {
      interrogation_date: '2025-09-15',
      deviceSerial: 'ABT-2025-34918',
    };
    const patient = {
      first_name: 'Markus',
      last_name: 'Steinberg',
      dob: '1968-03-22',
      devices: [
        { serial: 'MDT-2019-67401', implant_date: '2019-08-12', status: 'explanted' },
        { serial: 'ABT-2025-34918', implant_date: '2025-09-15', status: 'current' },
      ],
    };
    const env = parseEnvelope(buildFuQrPayload(report, patient));
    expect(env.d.di).toBe('2025-09-15');
  });

  it('does not match explanted device for implant date', () => {
    const report = {
      interrogation_date: '2024-04-22',
      deviceSerial: 'MDT-2019-67401',
    };
    const patient = {
      first_name: 'Markus',
      last_name: 'Steinberg',
      dob: '1968-03-22',
      devices: [
        { serial: 'MDT-2019-67401', implant_date: '2019-08-12', status: 'explanted' },
      ],
    };
    const env = parseEnvelope(buildFuQrPayload(report, patient));
    expect(env.d.di).toBeUndefined();
  });

  it('keeps enriched payload under 2953 bytes', () => {
    const report = {
      interrogation_date: '2025-09-15',
      manufacturer: 'Boston Scientific',
      device_type: 'CRT-P',
      deviceModel: 'Valitude X4 CRT-P',
      deviceSerial: 'BSC-2026-59831',
      batteryVoltage: '3.20',
      batteryStatus: 'BOL',
      batteryLongevity: '13.2 years',
      leads: [
        { type: 'RA', impedance: '542', sensing: '1.9', threshold: '1.0', pulseWidth: '0.4' },
        { type: 'RV', impedance: '500', sensing: '7.4', threshold: '0.75', pulseWidth: '0.4' },
        { type: 'LV', impedance: '710', sensing: '10.0', threshold: '1.25', pulseWidth: '0.5' },
      ],
    };
    const patient = {
      first_name: 'Helga',
      last_name: 'Petersen',
      dob: '1945-11-28',
      devices: [
        { serial: 'BSC-2026-59831', implant_date: '2026-03-18', status: 'current' },
      ],
    };
    const payload = buildFuQrPayload(report, patient);
    expect(payload.length).toBeLessThan(2953);
  });
});

describe('compactDeviceType', () => {
  it.each([
    ['Pacemaker', 'PM'],
    ['ICD', 'ICD'],
    ['CRT-D', 'CRT-D'],
    ['CRT-P', 'CRT-P'],
    ['S-ICD', 'S-ICD'],
    ['Leadless Pacemaker', 'LR'],
    ['CCM', 'CCM'],
  ])('maps %s → %s', (input, expected) => {
    expect(compactDeviceType(input)).toBe(expected);
  });

  it('returns undefined for undefined input', () => {
    expect(compactDeviceType(undefined)).toBeUndefined();
  });

  it('passes through unknown types', () => {
    expect(compactDeviceType('Event Recorder')).toBe('Event Recorder');
  });
});

describe('compactManufacturer', () => {
  it.each([
    ['Biotronik', 'BIO'],
    ['Medtronic', 'MDT'],
    ['Abbott', 'ABT'],
    ['Boston Scientific', 'BSC'],
    ['Microport', 'MIC'],
    ['Sorin', 'SOR'],
  ])('maps %s → %s', (input, expected) => {
    expect(compactManufacturer(input)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(compactManufacturer('BIOTRONIK')).toBe('BIO');
    expect(compactManufacturer('boston scientific')).toBe('BSC');
  });

  it('passes through unknown manufacturers', () => {
    expect(compactManufacturer('LivaNova')).toBe('LivaNova');
  });
});

describe('hasClinicalData', () => {
  it('returns true when battery voltage is present', () => {
    expect(hasClinicalData({ batteryVoltage: '3.2' })).toBe(true);
  });

  it('returns true when lead impedance is present', () => {
    expect(hasClinicalData({ leads: [{ type: 'RA', impedance: '500' }] })).toBe(true);
  });

  it('returns false when no clinical data', () => {
    expect(hasClinicalData({ interrogation_date: '2024-01-01' })).toBe(false);
  });
});

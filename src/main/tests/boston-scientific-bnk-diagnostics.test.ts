import { describe, it, expect } from 'vitest';
import { parseBostonScientificBnk } from '../parsers/boston-scientific-parser';

// Every real PACEART .bnk export we've been able to test against
// (test/boston bnk/, anonymized samples) uses a '#' comment header for
// interrogation date + device model/serial, and flat `PatientXxx` key/value
// lines rather than the `Patient.PatientXxx` / `Device.Model` namespaced
// schema the parser originally assumed (and which no real file has ever
// matched). These tests cover the real format's quirks.

const header = (saveDate: string, deviceModel: string, deviceSerial = '000000') => [
  `# TYPE: PACEART           SAVE DATE: ${saveDate}`,
  '# PROGRAMMER      MODEL: 3300 SERIAL: 000000 APP   MODEL: 3868 VERSION: 2.03',
  `# DEVICE          MODEL: ${deviceModel}  SERIAL: ${deviceSerial}`,
  '# RAM VERSION: H_v1.00.00',
  '# ROM VERSION: ROM_v5.04',
  '# APPLICATION     MODEL: 2868 VERSION: 2.03',
].join('\n');

describe('Boston Scientific .bnk parser (real PACEART export format)', () => {
  it('reads patient/device identity from the header + flat key lines, not the invented Patient./Device. namespace', () => {
    const content = [
      header('29 Jun 2026', 'D321-200-0'),
      'PatientFirstName,James',
      'PatientLastName,Doe',
      'PatientBirthDay,1',
      'PatientBirthMonth,Jan',
      'PatientBirthYear,1970',
    ].join('\n');

    const result = parseBostonScientificBnk(content);
    expect(result).not.toBeNull();
    expect(result?.patient.first_name).toBe('James');
    expect(result?.patient.last_name).toBe('Doe');
    expect(result?.patient.dob).toBe('1970-01-01');
    expect(result?.device.model).toBe('D321-200-0');
    expect(result?.interrogation_date).toBe('2026-06-29');
    expect(result?.parseStatus).not.toBe('failed');
  });

  it('repairs the "M?r" (March) encoding corruption seen on ~1/3 of real exports', () => {
    const content = [
      header('19 M?r 2026', 'D321-200-0'),
      'PatientLastName,Doe',
    ].join('\n');

    const result = parseBostonScientificBnk(content);
    expect(result?.interrogation_date).toBe('2026-03-19');
  });

  it('fails soft (empty date, not a throw) on a genuinely unrecognized month corruption', () => {
    const content = [
      header('19 X?y 2026', 'D321-200-0'),
      'PatientLastName,Doe',
    ].join('\n');

    expect(() => parseBostonScientificBnk(content)).not.toThrow();
    const result = parseBostonScientificBnk(content);
    expect(result?.interrogation_date).toBe('');
  });

  it('names a lead by its Position text, not by which slot (A vs V1) it was stored under', () => {
    // Real example: some records have PatientLeadAPosition = "Rechter
    // Ventrikel" and PatientLeadV1Position = "Rechter Vorhof" — the A/V1
    // slot tracks connector port, not anatomic chamber.
    const content = [
      header('15 Apr 2026', 'D233-000-0'),
      'PatientLastName,Smith',
      'PatientLeadAModelNum,0673',
      'PatientLeadAPosition,Rechter Ventrikel',
      'PatientLeadV1ModelNum,7741',
      'PatientLeadV1Position,Rechter Vorhof',
    ].join('\n');

    const result = parseBostonScientificBnk(content);
    const bySlotA = result?.leads?.find(l => l.model === '0673');
    const bySlotV1 = result?.leads?.find(l => l.model === '7741');
    expect(bySlotA?.name).toBe('RV');
    expect(bySlotV1?.name).toBe('Atrium');
  });

  it('infers CRT-P from an LV lead with no ICD-capability signal, and CRT-D when DFT/shock impedance is also present', () => {
    const crtPContent = [
      header('29 Jun 2026', 'G141-200-0'), // real internal model code, no "CRT" text anywhere
      'PatientLastName,Roe',
      'PatientLeadAModelNum,4470',
      'PatientLeadAPosition,Rechter Vorhof',
      'PatientLeadV1ModelNum,0185',
      'PatientLeadV1Position,Rechter Ventrikel',
      'PatientLeadV2ModelNum,1258-86',
      'PatientLeadV2Position,LV Mitte (poster.)',
    ].join('\n');
    expect(parseBostonScientificBnk(crtPContent)?.device.type).toBe('CRT-P');

    const crtDContent = crtPContent + '\nPatientDFT,21.0 J';
    expect(parseBostonScientificBnk(crtDContent)?.device.type).toBe('CRT-D');
  });

  it('extracts the LV-specific measurement block separately from the generic ventricular one', () => {
    const content = [
      header('29 Jun 2026', 'G247-200-0'),
      'PatientLastName,Doe',
      'PatientLeadV1ModelNum,0296',
      'PatientLeadV1Position,Rechter Ventrikel',
      'PatientVImped,550.0 Ω',
      'PatientVThreshAmpl,800.0 mV',
      'PatientVThreshPW,0.4 ms',
      'PatientLeadV2ModelNum,4671',
      'PatientLeadV2Position,LV Mitte (poster.)',
      'PatientData.LVMsmts.LeadImped,1400.0 Ω',
      'PatientData.LVMsmts.PaceThreshAmpl,1500.0 mV',
      'PatientData.LVMsmts.PaceThreshPW,0.4 ms',
    ].join('\n');

    const result = parseBostonScientificBnk(content);
    const rv = result?.leads?.find(l => l.name === 'RV');
    const lv = result?.leads?.find(l => l.name === 'LV');
    expect(rv?.impedance?.value).toBe(550.0);
    expect(rv?.pacing_threshold?.value).toBe('0.8 @ 0.4');
    expect(lv?.impedance?.value).toBe(1400.0);
    expect(lv?.pacing_threshold?.value).toBe('1.5 @ 0.4');
  });

  it('reports remaining longevity in months from BatteryLongevityParams.TimeToERI (no voltage field exists in real exports)', () => {
    const content = [
      header('29 Jun 2026', 'D321-200-0'),
      'PatientLastName,Doe',
      'BatteryLongevityParams.TimeToERI,>132 months',
      'BatteryStatus.BatteryPhase,Funktions-Beginn',
    ].join('\n');

    const result = parseBostonScientificBnk(content);
    expect(result?.battery?.remaining_longevity?.value).toBe(132);
    expect(result?.battery?.status).toBe('Funktions-Beginn');
    expect(result?.battery?.voltage).toBeUndefined();
  });
});

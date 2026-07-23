import { describe, it, expect } from 'vitest';
import { parseMicroportXML } from '../parsers/microport-parser';

// Microport/Paceart devices are dispatched to this parser purely by content
// (the '<Paceart>' tag), and the existing implementation already matched the
// real anonymized samples (test/microport xml/) reasonably well. These tests
// cover the fail-soft/diagnostics treatment added to bring it in line with
// the other manufacturer parsers, plus a couple of real-sample quirks.

const paceart = (opts: {
  nameLast?: string;
  nameFirst?: string;
  birthDate?: string;
  pacemakerGuid?: string;
  lookupGuid?: string;
  model?: string;
  manufacturer?: string;
  serial?: string;
}) => {
  const pacemakerGuid = opts.pacemakerGuid ?? 'guid-1';
  const lookupGuid = opts.lookupGuid ?? pacemakerGuid;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Paceart>
  <FileInformation InstitutionName="Test" SchemaVersion="4.0" GenerationDate="2023-10-27T10:00:00+02:00"/>
  <LookupTables>
    <Devices>
      <Pacemakers>
        <PacemakerDetail Manufacturer="${opts.manufacturer ?? 'ELA Medical'}" GUID="${lookupGuid}" Model="${opts.model ?? 'TEO DR'}"/>
      </Pacemakers>
      <Leads/>
    </Devices>
  </LookupTables>
  <PatientRecords>
    <PatientRecord>
      <Demographics ${opts.nameFirst ? `nameFirst="${opts.nameFirst}" ` : ''}${opts.nameLast !== undefined ? `nameLast="${opts.nameLast}" ` : ''}${opts.birthDate ? `BirthDate="${opts.birthDate}"` : ''}/>
      <Devices>
        <Pacemaker SerialNumber="${opts.serial ?? 'SN000001'}">
          <PacemakerLookup>
            <PacemakerReference GUID="${pacemakerGuid}"/>
          </PacemakerLookup>
          <ImplantInformation Date="2020-01-01"/>
        </Pacemaker>
      </Devices>
      <Tests>
        <PacemakerClinic Date="2023-10-27T10:00:00+02:00">
          <Evaluation/>
        </PacemakerClinic>
      </Tests>
    </PatientRecord>
  </PatientRecords>
</Paceart>`;
};

describe('Microport/Paceart parser diagnostics', () => {
  it('returns null for non-Paceart XML (catastrophic — not this format at all)', async () => {
    const report = await parseMicroportXML('<?xml version="1.0"?><SomeOtherFormat/>');
    expect(report).toBeNull();
  });

  it('never throws, even on garbage input', async () => {
    await expect(parseMicroportXML('not xml at all {{{')).resolves.not.toThrow();
    await expect(parseMicroportXML('')).resolves.not.toThrow();
  });

  it('tags name=first+last-fields when Demographics carries a separate nameFirst', async () => {
    const report = await parseMicroportXML(paceart({ nameFirst: 'Erika', nameLast: 'Mustermann', birthDate: '1952-09-25' }));
    expect(report?.patient.first_name).toBe('Erika');
    expect(report?.patient.last_name).toBe('Mustermann');
    expect(report?.formatVariant).toContain('name=first+last-fields');
  });

  it('tags name=lastname-comma-split for the real "Last, First" single-field format', async () => {
    const report = await parseMicroportXML(paceart({ nameLast: 'Mustermann, Erika', birthDate: '1952-09-25' }));
    expect(report?.patient.first_name).toBe('Erika');
    expect(report?.patient.last_name).toBe('Mustermann');
    expect(report?.formatVariant).toContain('name=lastname-comma-split');
  });

  it('tags name=lastname-only when nameLast has no comma and no nameFirst is present', async () => {
    const report = await parseMicroportXML(paceart({ nameLast: 'Mustermann', birthDate: '1952-09-25' }));
    expect(report?.patient.last_name).toBe('Mustermann');
    expect(report?.patient.first_name).toBe('');
    expect(report?.formatVariant).toContain('name=lastname-only');
  });

  it('fails soft (warning, not null) when a lookup GUID reference is dangling', async () => {
    const report = await parseMicroportXML(paceart({ nameLast: 'Mustermann, Erika', pacemakerGuid: 'guid-1', lookupGuid: 'guid-2' }));
    expect(report).not.toBeNull();
    expect(report?.device.model).toBe('Unknown');
    expect(report?.parseWarnings?.some(w => w.stage === 'device.lookup')).toBe(true);
    // Patient identity still recovered, so this is 'partial', not 'failed'.
    expect(report?.parseStatus).toBe('partial');
  });

  it('parseStatus is failed only when neither patient nor device identity is recoverable', async () => {
    const report = await parseMicroportXML(paceart({ nameLast: '', pacemakerGuid: 'guid-1', lookupGuid: 'guid-2', serial: '' }));
    expect(report?.parseStatus).toBe('failed');
  });

  it('combines capture amplitude + duration into the shared "V @ ms" pacing_threshold convention', async () => {
    const xml = paceart({ nameLast: 'Mustermann, Erika' }).replace(
      '<Evaluation/>',
      `<Evaluation>
        <Thresholds>
          <Capture Chamber="RA" Amplitude_volts="0.50" Duration_ms="0.35"/>
        </Thresholds>
      </Evaluation>`
    ).replace(
      '<Devices>\n        <Pacemaker',
      `<Devices>
        <Lead SerialNumber="LD1">
          <LeadLookup><LeadReference GUID="lead-guid"/></LeadLookup>
          <ImplantInformation Chamber="Atrium" Date="2020-01-01"/>
        </Lead>
        <Pacemaker`
    );
    const report = await parseMicroportXML(xml);
    const raLead = report?.leads?.find(l => l.name === 'RA');
    expect(raLead?.pacing_threshold).toEqual({ value: '0.5 @ 0.35', unit: 'V @ ms' });
  });
});

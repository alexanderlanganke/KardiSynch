import { describe, it, expect } from 'vitest';
import { suggestLeadConnector, getConnectorFlag } from '../lib/leadConnectorLookup';

describe('suggestLeadConnector', () => {
  it('returns null for missing manufacturer/model or an unrecognized model', () => {
    expect(suggestLeadConnector(undefined, '6935')).toBeNull();
    expect(suggestLeadConnector('Medtronic', undefined)).toBeNull();
    expect(suggestLeadConnector('Medtronic', 'SomeUnknownLead123')).toBeNull();
    expect(suggestLeadConnector('Unknown', '6935')).toBeNull();
  });

  describe('Medtronic', () => {
    it('identifies Sprint Quattro Secure 6935/6947 as DF-1 shock leads', () => {
      expect(suggestLeadConnector('Medtronic', '6935')).toEqual(expect.objectContaining({ connector: 'DF-1', role: 'shock' }));
      expect(suggestLeadConnector('Medtronic', '6947')).toEqual(expect.objectContaining({ connector: 'DF-1', role: 'shock' }));
    });

    it('identifies the M-suffixed (MRI SureScan) variant as DF-4, not DF-1', () => {
      expect(suggestLeadConnector('Medtronic', '6935M')).toEqual(expect.objectContaining({ connector: 'DF-4', role: 'shock' }));
      expect(suggestLeadConnector('Medtronic', '6947M55')).toEqual(expect.objectContaining({ connector: 'DF-4', role: 'shock' }));
    });

    it('identifies Attain 4193-4196 as IS-1 LV leads', () => {
      expect(suggestLeadConnector('Medtronic', '4194')).toEqual(expect.objectContaining({ connector: 'IS-1', role: 'LV' }));
      expect(suggestLeadConnector('Medtronic', 'Attain StarFix 4195')).toEqual(expect.objectContaining({ connector: 'IS-1', role: 'LV' }));
    });

    it('does not classify the quadripolar Attain Performa/Stability Quad as IS-1', () => {
      expect(suggestLeadConnector('Medtronic', 'Attain Performa 4298')).toBeNull();
      expect(suggestLeadConnector('Medtronic', 'Attain Stability Quad')).toBeNull();
    });
  });

  describe('Boston Scientific', () => {
    it('identifies Endotak Reliance DF-1 models', () => {
      expect(suggestLeadConnector('Boston Scientific', '0127')).toEqual(expect.objectContaining({ connector: 'DF-1', role: 'shock' }));
      expect(suggestLeadConnector('Boston Scientific', '0185')).toEqual(expect.objectContaining({ connector: 'DF-1', role: 'shock' }));
    });

    it('identifies Endotak Reliance 4-Site / Reliance 4-Front DF4 models', () => {
      expect(suggestLeadConnector('Boston Scientific', '0296')).toEqual(expect.objectContaining({ connector: 'DF-4', role: 'shock' }));
      expect(suggestLeadConnector('Boston Scientific', '0673')).toEqual(expect.objectContaining({ connector: 'DF-4', role: 'shock' }));
    });

    it('identifies Acuity 4554/4555 as IS-1 LV leads but excludes Acuity X4', () => {
      expect(suggestLeadConnector('Boston Scientific', '4554')).toEqual(expect.objectContaining({ connector: 'IS-1', role: 'LV' }));
      expect(suggestLeadConnector('Boston Scientific', '4554 X4')).toBeNull();
    });
  });

  describe('Abbott', () => {
    it('identifies Durata non-Q models as DF-1 and Q-suffixed as DF4', () => {
      expect(suggestLeadConnector('Abbott', '7120')).toEqual(expect.objectContaining({ connector: 'DF-1', role: 'shock' }));
      expect(suggestLeadConnector('Abbott', '7120Q')).toEqual(expect.objectContaining({ connector: 'DF-4', role: 'shock' }));
    });

    it('identifies QuickFlex models as IS-1 LV leads', () => {
      expect(suggestLeadConnector('Abbott', '1258T')).toEqual(expect.objectContaining({ connector: 'IS-1', role: 'LV' }));
      expect(suggestLeadConnector('Abbott', 'QuickFlex Micro')).toEqual(expect.objectContaining({ connector: 'IS-1', role: 'LV' }));
    });

    it('does not classify Quartet as IS-1 (it is IS4 quadripolar)', () => {
      expect(suggestLeadConnector('Abbott', 'Quartet 1458Q')).toBeNull();
    });
  });

  describe('Biotronik', () => {
    it('distinguishes Plexa DF-1 from the DF4 variant by the literal "DF-1" in the model name', () => {
      expect(suggestLeadConnector('Biotronik', 'Plexa ProMRI DF-1 S 65')).toEqual(expect.objectContaining({ connector: 'DF-1', role: 'shock' }));
      expect(suggestLeadConnector('Biotronik', 'Plexa S 60')).toEqual(expect.objectContaining({ connector: 'DF-4', role: 'shock' }));
    });

    it('identifies Corox/Sentus bipolar LV leads as IS-1 but excludes the quadripolar QP variant', () => {
      expect(suggestLeadConnector('Biotronik', 'Corox OTW BP 75')).toEqual(expect.objectContaining({ connector: 'IS-1', role: 'LV' }));
      expect(suggestLeadConnector('Biotronik', 'Sentus ProMRI QP L')).toBeNull();
    });
  });
});

describe('getConnectorFlag', () => {
  it('flags a DF-1 lead as unconfirmed when the connector is only a suggestion', () => {
    const flag = getConnectorFlag({ manufacturer: 'Medtronic', model: '6935' });
    expect(flag).toEqual({ connector: 'DF-1', confirmed: false });
  });

  it('flags a manually confirmed DF-1 lead as confirmed', () => {
    const flag = getConnectorFlag({ manufacturer: 'Medtronic', model: '6935', connector: 'DF-1' });
    expect(flag).toEqual({ connector: 'DF-1', confirmed: true });
  });

  it('flags an IS-1 lead only when the model is a known LV-lead family (role: LV)', () => {
    expect(getConnectorFlag({ manufacturer: 'Medtronic', model: '4194' })).toEqual({ connector: 'IS-1', confirmed: false });
  });

  it('does not flag a manually confirmed IS-1 connector on a model the lookup table does not recognize as LV', () => {
    // Most pace/sense leads (atrial, RV) also use IS-1 — the vast majority
    // of leads in the app would false-positive if role weren't required.
    const flag = getConnectorFlag({ manufacturer: 'Medtronic', model: 'CapSureSense 5076', connector: 'IS-1' });
    expect(flag).toBeNull();
  });

  it('does not flag DF-4 or IS-4 leads', () => {
    expect(getConnectorFlag({ manufacturer: 'Medtronic', model: '6935M' })).toBeNull();
    expect(getConnectorFlag({ manufacturer: 'Medtronic', model: 'Attain Performa 4298' })).toBeNull();
  });

  it('returns null when there is no connector data at all (neither confirmed nor a table match)', () => {
    expect(getConnectorFlag({ manufacturer: 'Medtronic', model: 'SomeUnknownLead' })).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { parseMedtronicXML } from '../parsers/medtronic-parser';

// A Micra (leadless pacemaker) export: no Lead1-4 params at all (there is no
// physical lead), DeviceType reported as the generic 'IPG' (like any other
// pacemaker), but the RV pacing/sensing channel parameters are present —
// same parameter IDs a transvenous RV lead would carry (#159).
const micraXML = (opts: { withElectricalData: boolean }) => `<Composite domain="PersistedContent">
<Field name="Value">
<Composite domain="DiscreteDataContent">
<Field name="ContextCollection">
<Array domain="ContextCollection">
<Composite domain="Context">
<Field name="Name">
<String charset="UCS-2">NoPendingSettings</String>
</Field>
<Field name="NormalizedParameterCollection">
<Array domain="NormalizedParameterCollection">
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">DeviceModelName</String></Field>
<Field name="Current">
<Composite domain="DeviceModelName">
<Field name="Name"><String charset="UCS-2">Micra MC1VR01</String></Field>
</Composite>
</Field>
</Composite>
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">DeviceSerialNumber</String></Field>
<Field name="Current"><String charset="UCS-2">MICRA123456</String></Field>
</Composite>
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">DeviceType</String></Field>
<Field name="Current"><String charset="UCS-2">IPG</String></Field>
</Composite>
${opts.withElectricalData ? `
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">VSEventDetectionRVSensingThreshold</String></Field>
<Field name="Current"><Real>8.5</Real></Field>
</Composite>
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">VPacingTherapyRVPacingAmplitude</String></Field>
<Field name="Current"><Real>1.5</Real></Field>
</Composite>
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">VPacingTherapyAdaptRVPacingAmplitudeStatus</String></Field>
<Field name="Current">
<Composite domain="Status">
<Field name="PacingThreshold"><Real>0.5</Real></Field>
</Composite>
</Field>
</Composite>` : ''}
</Array>
</Field>
</Composite>
</Array>
</Field>
</Composite>
</Field>
</Composite>`;

describe('Medtronic XML Parser — leadless pacemaker (#159)', () => {
    it('classifies a Micra as "Leadless Pacemaker" even though its raw DeviceType is the generic "IPG"', () => {
        const report = parseMedtronicXML(micraXML({ withElectricalData: true }));
        expect(report!.device.type).toBe('Leadless Pacemaker');
        expect(report!.device.serial_number).toBe('MICRA123456');
    });

    it('surfaces the leadless pacing/sensing channel as a synthetic RV "lead" so threshold/impedance/sensing are visible', () => {
        const report = parseMedtronicXML(micraXML({ withElectricalData: true }));
        expect(report!.leads?.length).toBe(1);
        const channel = report!.leads![0];
        expect(channel.anatomic_location).toBe('RV');
        expect(channel.sensing?.value).toBe(8.5);
        expect(channel.pacing_amplitude?.value).toBe(1.5);
        expect(channel.pacing_threshold?.value).toBe(0.5);
    });

    it('does not fabricate a lead entry when no electrical data was actually found', () => {
        const report = parseMedtronicXML(micraXML({ withElectricalData: false }));
        expect(report!.device.type).toBe('Leadless Pacemaker');
        expect(report!.leads ?? []).toHaveLength(0);
    });
});

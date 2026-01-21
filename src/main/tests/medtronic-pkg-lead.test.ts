
import { describe, it, expect } from 'vitest';
import { parseMedtronicXML } from '../parsers/medtronic-parser';

const sampleXML = `<Composite domain="PersistedContent">
<Field name="Version">
<String charset="UCS-2">1.0</String>
</Field>
<Field name="SavedDateTime">
<DateTime>2025-11-06T13:25:18.804+01:00</DateTime>
</Field>
<Field name="Value">
<Composite domain="DiscreteDataContent">
<Field name="Version">
<String charset="UCS-2">1.4</String>
</Field>
<Field name="ContextCollection">
<Array domain="ContextCollection">
<IndexDescriptor>
<Integer>1</Integer>
</IndexDescriptor>
<Composite domain="Context">
<Field name="Name">
<String charset="UCS-2">NoPendingSettings</String>
</Field>
<Field name="NormalizedParameterCollection">
<Array domain="NormalizedParameterCollection">
<IndexDescriptor>
<Integer>1</Integer>
</IndexDescriptor>
<!-- Lead 1 Data -->
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">Lead1Location</String></Field>
<Field name="Current"><String charset="UCS-2">RV</String></Field>
</Composite>
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">Lead1Manufacturer</String></Field>
<Field name="Current"><String charset="UCS-2">Medtronic</String></Field>
</Composite>
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">Lead1Model</String></Field>
<Field name="Current"><String charset="UCS-2">6935 SprintQuattroSecureS MRI</String></Field>
</Composite>
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">Lead1SerialNumber</String></Field>
<Field name="Current"><String charset="UCS-2">LEAD123456</String></Field>
</Composite>
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">ImplantLead1Date</String></Field>
<Field name="Current"><Date>2021-07-21</Date></Field>
</Composite>

<!-- Device Data -->
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">DeviceModelName</String></Field>
<Field name="Current">
<Composite domain="DeviceModelName">
<Field name="Name"><String charset="UCS-2">Evera MRI S VR DVMC3D4</String></Field>
</Composite>
</Field>
</Composite>
<Composite domain="NormalizedParameter">
<Field name="Name"><String charset="UCS-2">DeviceSerialNumber</String></Field>
<Field name="Current"><String charset="UCS-2">DEV123456</String></Field>
</Composite>
</Array>
</Field>
</Composite>
</Array>
</Field>
</Composite>
</Field>
</Composite>`;

describe('Medtronic XML Parser (Leads)', () => {
    it('should extract leads from PublicDiscreteData.xml', () => {
        const report = parseMedtronicXML(sampleXML);

        expect(report.leads).toBeDefined();
        expect(report.leads?.length).toBeGreaterThan(0);

        const rvLead = report.leads?.find(l => l.anatomic_location === 'RV');
        expect(rvLead).toBeDefined();
        expect(rvLead?.model).toBe('6935 SprintQuattroSecureS MRI');
        expect(rvLead?.serial).toBe('LEAD123456');
        expect(rvLead?.manufacturer).toBe('Medtronic');
        expect(rvLead?.implant_date).toBe('2021-07-21');
    });
});

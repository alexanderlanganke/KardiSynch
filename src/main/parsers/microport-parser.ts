import { UnifiedReport } from '../reports';
import { XMLParser } from 'fast-xml-parser';

export const parseMicroportXML = async (xmlContent: string): Promise<UnifiedReport | null> => {
    try {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            parseAttributeValue: true
        });
        const parsed = parser.parse(xmlContent);

        const paceart = parsed.Paceart;
        if (!paceart) return null;

        const patientRecord = paceart.PatientRecords?.PatientRecord;
        if (!patientRecord) return null;

        const demographics = patientRecord.Demographics;
        const devices = patientRecord.Devices;
        const tests = patientRecord.Tests;
        const lookupTables = paceart.LookupTables;

        // 1. Patient Info
        let firstName = '';
        let lastName = 'Unknown';
        if (demographics?.nameLast) {
            // Format seems to be "Last, First" or just "Last"
            const parts = demographics.nameLast.split(',');
            if (parts.length > 0) lastName = parts[0].trim();
            if (parts.length > 1) firstName = parts[1].trim();
        }
        const dob = demographics?.BirthDate || '';

        // 2. Device Info
        const pacemaker = devices?.Pacemaker;
        const serial = pacemaker?.SerialNumber || 'Unknown';

        // Resolve Model from LookupTables
        let model = 'Unknown';
        let manufacturer = 'Microport'; // Default

        if (pacemaker?.PacemakerLookup?.PacemakerReference?.GUID && lookupTables?.Devices?.Pacemakers?.PacemakerDetail) {
            const guid = pacemaker.PacemakerLookup.PacemakerReference.GUID;
            const details = Array.isArray(lookupTables.Devices.Pacemakers.PacemakerDetail)
                ? lookupTables.Devices.Pacemakers.PacemakerDetail
                : [lookupTables.Devices.Pacemakers.PacemakerDetail];

            const match = details.find((d: any) => d.GUID === guid);
            if (match) {
                model = match.Model || model;
                manufacturer = match.Manufacturer || manufacturer;
            }
        }

        // 3. Interrogation Date
        const clinic = tests?.PacemakerClinic;
        // Handle array if multiple clinics (though usually one per file)
        const latestClinic = Array.isArray(clinic) ? clinic[clinic.length - 1] : clinic;
        const interrogationDate = latestClinic?.Date || new Date().toISOString();

        // 4. Telemetry / Measurements
        const evaluation = latestClinic?.Evaluation;
        const telemetry = evaluation?.PacemakerTelemetry;
        const thresholds = evaluation?.Thresholds;

        // Battery
        const battery: any = {};
        if (telemetry?.BatteryImpedance_ohms) {
            // Impedance isn't voltage/status, but it's something. 
            // The unified report expects voltage/status/lastCharge.
            // We can store it in raw_text or custom fields if needed, but for now let's skip if no voltage.
            // Actually, let's map what we can.
        }

        // Leads
        const leads: any[] = [];

        // Helper to find lead measurements
        const findLeadMeasure = (chamber: string, type: 'Sensing' | 'Pacing' | 'Capture' | 'Lead') => {
            if (!evaluation) return null;

            // Check Thresholds
            if (type === 'Sensing' && thresholds?.Sensing) {
                const list = Array.isArray(thresholds.Sensing) ? thresholds.Sensing : [thresholds.Sensing];
                return list.find((i: any) => i.Chamber === chamber);
            }
            if (type === 'Capture' && thresholds?.Capture) {
                const list = Array.isArray(thresholds.Capture) ? thresholds.Capture : [thresholds.Capture];
                return list.find((i: any) => i.Chamber === chamber);
            }

            // Check Telemetry
            if (type === 'Lead' && telemetry?.Lead) {
                const list = Array.isArray(telemetry.Lead) ? telemetry.Lead : [telemetry.Lead];
                return list.find((i: any) => i.Chamber === chamber);
            }
            return null;
        };

        // Iterate physical leads
        if (devices?.Lead) {
            const leadList = Array.isArray(devices.Lead) ? devices.Lead : [devices.Lead];

            leadList.forEach((l: any) => {
                const implantInfo = l.ImplantInformation;
                const chamber = String(implantInfo?.Chamber || ''); // e.g. "Atrium", "Ventricle"
                // Map "Atrium" -> "RA", "Ventricle" -> "RV" for matching measurements
                const measureChamber = chamber === 'Atrium' ? 'RA' : (chamber === 'Ventricle' ? 'RV' : chamber);

                // Resolve Model
                let leadModel = 'Unknown';
                if (l.LeadLookup?.LeadReference?.GUID && lookupTables?.Devices?.Leads?.LeadDetail) {
                    const guid = l.LeadLookup.LeadReference.GUID;
                    const details = Array.isArray(lookupTables.Devices.Leads.LeadDetail)
                        ? lookupTables.Devices.Leads.LeadDetail
                        : [lookupTables.Devices.Leads.LeadDetail];
                    const match = details.find((d: any) => d.GUID === guid);
                    if (match) leadModel = match.Model || leadModel;
                }

                const leadData: any = {
                    name: measureChamber,
                    model: leadModel,
                    serial: l.SerialNumber,
                    anatomic_location: chamber
                };

                // Measurements
                if (measureChamber) {
                    const sensing = findLeadMeasure(measureChamber, 'Sensing');
                    if (sensing) {
                        leadData.sensing = { value: parseFloat(sensing.Amplitude_millivolts), unit: 'mV' };
                    }

                    const capture = findLeadMeasure(measureChamber, 'Capture');
                    if (capture) {
                        leadData.pacing_threshold = { value: parseFloat(capture.Amplitude_volts), unit: 'V' };
                    }

                    const impedance = findLeadMeasure(measureChamber, 'Lead');
                    if (impedance) {
                        leadData.impedance = { value: parseFloat(impedance.BipolarImpedance_ohms), unit: 'Ohm' };
                    }
                }

                leads.push(leadData);
            });
        }

        const report: UnifiedReport = {
            manufacturer: manufacturer,
            interrogation_date: interrogationDate,
            patient: {
                first_name: firstName,
                last_name: lastName,
                dob: dob
            },
            device: {
                type: 'Pacemaker', // Inferred from "Pacemaker" tag
                model: model,
                serial_number: serial
            },
            battery: battery,
            leads: leads,
            raw_text: JSON.stringify(parsed, null, 2) // Store full JSON as raw text for debugging
        };

        return report;

    } catch (error) {
        console.error('Error parsing Microport XML:', error);
        return null;
    }
};

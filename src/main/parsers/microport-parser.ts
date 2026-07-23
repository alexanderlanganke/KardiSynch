import { UnifiedReport, BatteryData, LeadData, hasLeadData } from '../reports';
import { XMLParser } from 'fast-xml-parser';
import { normalizeDate } from '../../lib/dates';
import { DiagnosticsCollector, safeExtract, detectVariant, deriveParseStatus } from './parseDiagnostics';

/** Finds the entry for `chamber` in a Sensing/Capture/Lead telemetry list that may be a single object or an array. */
function findByChamber(list: any, chamber: string): any {
    if (!list) return undefined;
    const arr = Array.isArray(list) ? list : [list];
    return arr.find((i: any) => i.Chamber === chamber);
}

export const parseMicroportXML = async (xmlContent: string): Promise<UnifiedReport | null> => {
    const collector = new DiagnosticsCollector();
    let parsed: any;
    try {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            // Keep tag and attribute values as strings: number coercion
            // stripped leading zeros from serials and mixed string/number
            // types broke strict-equality matching downstream.
            parseAttributeValue: false,
            parseTagValue: false
        });
        parsed = parser.parse(xmlContent);
    } catch (e) {
        console.error('Failed to parse Microport/Paceart XML:', e);
        return null;
    }

    const paceart = parsed.Paceart;
    if (!paceart) return null;

    // Real exports carry exactly one <PatientRecord>; defensively take the
    // first if a file ever bundles more than one.
    let patientRecord = paceart.PatientRecords?.PatientRecord;
    if (Array.isArray(patientRecord)) patientRecord = patientRecord[0];
    if (!patientRecord) return null;

    const demographics = patientRecord.Demographics;
    const devices = patientRecord.Devices;
    const tests = patientRecord.Tests;
    const lookupTables = paceart.LookupTables;

    // 1. Patient info. Real Paceart exports we've seen only ever populate
    // `nameLast` as "Last, First" (no separate nameFirst field), but the
    // schema does allow a first/last split — try that first, then the
    // comma-split, then treat nameLast as a bare surname.
    const nameResult = detectVariant(collector, 'patient.name', [
        {
            name: 'name=first+last-fields', test: () => {
                if (!demographics?.nameFirst) return null;
                return { firstName: String(demographics.nameFirst), lastName: demographics?.nameLast ? String(demographics.nameLast) : 'Unknown' };
            }
        },
        {
            name: 'name=lastname-comma-split', test: () => {
                const nameLast = demographics?.nameLast ? String(demographics.nameLast) : '';
                if (!nameLast.includes(',')) return null;
                const parts = nameLast.split(',');
                return { lastName: parts[0].trim(), firstName: (parts[1] || '').trim() };
            }
        },
        {
            name: 'name=lastname-only', test: () => {
                if (!demographics?.nameLast) return null;
                return { lastName: String(demographics.nameLast), firstName: '' };
            }
        },
    ]);
    const firstName = nameResult?.value.firstName || '';
    const lastName = nameResult?.value.lastName || 'Unknown';
    const dob = demographics?.BirthDate || '';

    // 2. Device info — resolved from LookupTables by GUID reference.
    const serial = safeExtract(collector, 'device.serial', () => {
        const s = devices?.Pacemaker?.SerialNumber;
        return s != null && String(s).trim() !== '' ? String(s).trim() : 'Unknown';
    }, 'Unknown');

    const deviceLookup = safeExtract(collector, 'device.lookup', () => {
        const guid = devices?.Pacemaker?.PacemakerLookup?.PacemakerReference?.GUID;
        const details = lookupTables?.Devices?.Pacemakers?.PacemakerDetail;
        if (!guid || !details) return null;
        const list = Array.isArray(details) ? details : [details];
        const match = list.find((d: any) => d.GUID === guid);
        if (!match) {
            collector.warn('device.lookup', `Pacemaker GUID ${guid} referenced but not found in LookupTables.Devices.Pacemakers.`);
            return null;
        }
        return { model: match.Model || 'Unknown', manufacturer: match.Manufacturer || 'Microport' };
    }, null);
    const model = deviceLookup?.model || 'Unknown';
    // Paceart is a multi-vendor remote-monitoring platform (Sorin/ELA
    // Medical/MicroPort CRM share history but the schema allows any vendor),
    // so the manufacturer is read per-record from the lookup table rather
    // than hardcoded — this is deliberate, unlike the single-vendor .pdd/
    // .bnk/.log formats where the dispatcher stamps a fixed manufacturer.
    const manufacturer = deviceLookup?.manufacturer || 'Microport';

    // 3. Interrogation date + evaluation data
    const clinic = tests?.PacemakerClinic;
    const latestClinic = Array.isArray(clinic) ? clinic[clinic.length - 1] : clinic;
    const interrogationDate = latestClinic?.Date || '';
    const evaluation = latestClinic?.Evaluation;
    const telemetry = evaluation?.PacemakerTelemetry;
    const thresholds = evaluation?.Thresholds;

    // 4. Battery. Real exports carry BatteryImpedance_ohms, not a voltage —
    // stashed in `status` since BatteryData has no dedicated impedance slot.
    const battery = safeExtract(collector, 'battery', () => {
        const b: BatteryData = {};
        if (telemetry?.BatteryVoltage != null) {
            const val = parseFloat(telemetry.BatteryVoltage);
            if (!isNaN(val)) b.voltage = { value: val, unit: 'V' };
        }
        if (telemetry?.BatteryImpedance_ohms != null) {
            const val = parseFloat(telemetry.BatteryImpedance_ohms);
            if (!isNaN(val)) b.status = `Impedance: ${val} Ohm`;
        }
        return b;
    }, {} as BatteryData);

    // 5. Leads
    const leads = safeExtract(collector, 'leads', () => {
        const result: LeadData[] = [];
        if (!devices?.Lead) return result;
        const leadList = Array.isArray(devices.Lead) ? devices.Lead : [devices.Lead];
        const leadDetails = lookupTables?.Devices?.Leads?.LeadDetail;
        const leadDetailList = leadDetails ? (Array.isArray(leadDetails) ? leadDetails : [leadDetails]) : [];

        for (const l of leadList) {
            const implantInfo = l.ImplantInformation;
            const chamber = String(implantInfo?.Chamber || ''); // e.g. "Atrium", "Ventricle"
            // Map "Atrium" -> "RA", "Ventricle" -> "RV"; anything else (e.g. a
            // future "LV" for CRT devices) passes through unchanged.
            const measureChamber = chamber === 'Atrium' ? 'RA' : (chamber === 'Ventricle' ? 'RV' : chamber);

            const guid = l.LeadLookup?.LeadReference?.GUID;
            const match = guid ? leadDetailList.find((d: any) => d.GUID === guid) : undefined;
            if (guid && !match) {
                collector.warn('leads', `Lead GUID ${guid} referenced but not found in LookupTables.Devices.Leads.`);
            }

            const leadData: LeadData = {
                name: measureChamber || 'Unknown',
                model: match?.Model || 'Unknown',
                manufacturer: match?.Manufacturer || undefined,
                serial: l.SerialNumber != null ? String(l.SerialNumber) : undefined,
                anatomic_location: chamber || undefined,
                implant_date: implantInfo?.Date ? (normalizeDate(implantInfo.Date) || undefined) : undefined,
            };

            if (measureChamber) {
                const sensing = findByChamber(thresholds?.Sensing, measureChamber);
                if (sensing?.Amplitude_millivolts != null) {
                    const val = parseFloat(sensing.Amplitude_millivolts);
                    if (!isNaN(val)) leadData.sensing = { value: val, unit: 'mV' };
                }

                const capture = findByChamber(thresholds?.Capture, measureChamber);
                const captureAmp = capture?.Amplitude_volts != null ? parseFloat(capture.Amplitude_volts) : NaN;
                const captureDur = capture?.Duration_ms != null ? parseFloat(capture.Duration_ms) : NaN;
                if (!isNaN(captureAmp)) {
                    leadData.pacing_threshold = {
                        value: !isNaN(captureDur) ? `${captureAmp} @ ${captureDur}` : captureAmp,
                        unit: !isNaN(captureDur) ? 'V @ ms' : 'V',
                    };
                }

                const impedanceEntry = findByChamber(telemetry?.Lead, measureChamber);
                if (impedanceEntry?.BipolarImpedance_ohms != null) {
                    const val = parseFloat(impedanceEntry.BipolarImpedance_ohms);
                    if (!isNaN(val)) leadData.impedance = { value: val, unit: 'Ohm' };
                }
            }

            if (hasLeadData(leadData)) result.push(leadData);
        }
        return result;
    }, [] as LeadData[]);

    // Infer device type from model name
    let deviceType: string = 'Pacemaker';
    const modelUpper = model.toUpperCase();
    if (modelUpper.includes('CRT-D')) {
        deviceType = 'CRT-D';
    } else if (modelUpper.includes('CRT-P') || modelUpper.includes('CRT')) {
        deviceType = 'CRT-P';
    } else if (modelUpper.includes('ICD')) {
        deviceType = 'ICD';
    }

    const hasPatientIdentity = lastName !== 'Unknown' || !!dob;
    const hasDeviceIdentity = model !== 'Unknown' || serial !== 'Unknown';

    const report: UnifiedReport = {
        manufacturer,
        interrogation_date: normalizeDate(interrogationDate),
        patient: {
            first_name: firstName,
            last_name: lastName,
            dob: normalizeDate(dob)
        },
        device: {
            type: deviceType,
            model: model,
            serial_number: serial
        },
        battery: battery,
        leads: leads,
        raw_text: JSON.stringify(parsed, null, 2), // Store full JSON as raw text for debugging
        formatVariant: `microport-paceart;${nameResult?.variant || 'name=unmatched'}`,
        parseWarnings: collector.list,
        parseStatus: deriveParseStatus(collector, hasPatientIdentity, hasDeviceIdentity),
    };

    return report;
};

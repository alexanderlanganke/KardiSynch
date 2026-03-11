// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdf = require('pdf-parse');
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { UnifiedReport } from './reports';
import { parseBiotronikXML } from './parsers/biotronik-parser';
import { parseBostonScientificBnk, parseBostonScientificPdf } from './parsers/boston-scientific-parser';
import { parseMedtronicPdd, parseMedtronicPkg } from './parsers/medtronic-parser';
import { extractTextFromPdf, extractStructuredData } from './utils/pdf-utils';
import { parseMicroportXML } from './parsers/microport-parser';
import { parseAbbottLog } from './parsers/abbott-parser';

/**
 * Acts as a dispatcher, routing files to the appropriate parser based on their
 * file type and naming conventions. It handles PDFs (with OCR fallback),
 * Biotronik XML files, Boston Scientific .bnk files, Medtronic .pdd/.pkg files,
 * and Microport XML files.
 * @param filePath The path to the file to be parsed.
 * @returns A promise that resolves with a UnifiedReport object, or null if the
 * file type is not supported.
 */
export const parseFile = async (filePath: string): Promise<UnifiedReport | null> => {
  console.log(`Parsing file: ${filePath}`);
  const fileExtension = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);
  console.log(`File extension: '${fileExtension}', Filename: '${filename}', Includes BIOSTD_: ${filename.includes('BIOSTD_')}`);

  if (fileExtension === '.pdf') {
    const rawText = await extractTextFromPdf(filePath);

    // Check for Boston Scientific markers
    if (rawText.includes('Boston Scientific') || rawText.includes('LATITUDE') || rawText.includes('S-ICD') || rawText.includes('EMBLEM')) {
      console.log('Identified Boston Scientific PDF content.');
      return parseBostonScientificPdf(rawText);
    }

    // Biotronik PDFs are usually accompanied by an XML file which is the source of truth.
    // We now allow them to parse so we can extract the Serial Number / Name for matching.
    // The watcher will ensure we don't overwrite the XML data.
    if (filename.includes('BIOSTD_')) {
      console.log('Identified Biotronik PDF. Proceeding to extract data for matching.');
    }

    return extractStructuredData(rawText, filename);
  } else if (fileExtension === '.xml') {
    const xmlData = await fs.readFile(filePath, 'utf-8');

    // Check for Microport/Paceart
    if (xmlData.includes('<Paceart>')) {
      return parseMicroportXML(xmlData);
    }

    if (filename.includes('BIOSTD_')) {
      return parseBiotronikXML(xmlData);
    } else if (filename === 'visit.xml') {
      const { XMLParser } = require('fast-xml-parser');
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
      const parsed = parser.parse(xmlData);
      const visit = parsed.visit;

      if (!visit) return null;

      const report: UnifiedReport = {
        manufacturer: visit.manufacturer,
        interrogation_date: visit.interrogation_date,
        patient: { first_name: '', last_name: '', dob: '' }, // Metadata only
        device: {
          type: visit.device_type,
          model: visit.device_model,
          serial_number: visit.device_serial
        },
        battery: {},
        leads: [],
        raw_text: ''
      };

      if (visit.battery) {
        report.battery = {
          voltage: visit.battery.voltage ? { value: parseFloat(visit.battery.voltage.value), unit: visit.battery.voltage.unit } : undefined,
          lastChargeTime: visit.battery.last_charge_time ? { value: parseFloat(visit.battery.last_charge_time.value), unit: visit.battery.last_charge_time.unit } : undefined,
          status: visit.battery.status
        };
      }

      if (visit.leads && visit.leads.lead) {
        const leads = Array.isArray(visit.leads.lead) ? visit.leads.lead : [visit.leads.lead];
        report.leads = leads.map((l: any) => ({
          name: l.name,
          model: l.model,
          serial: l.serial,
          anatomic_location: l.anatomic_location,
          impedance: l.impedance ? { value: parseFloat(l.impedance.value), unit: l.impedance.unit } : undefined,
          sensing: l.sensing ? { value: parseFloat(l.sensing.value), unit: l.sensing.unit } : undefined,
          pacing_threshold: l.pacing_threshold ? { value: parseFloat(l.pacing_threshold.value), unit: l.pacing_threshold.unit } : undefined,
          pacing_amplitude: l.pacing_amplitude ? { value: parseFloat(l.pacing_amplitude.value), unit: l.pacing_amplitude.unit } : undefined,
          shock_impedance: l.shock_impedance ? { value: parseFloat(l.shock_impedance.value), unit: l.shock_impedance.unit } : undefined
        }));
      }

      return report;
    }
    return null;
  } else if (fileExtension === '.bnk') {
    const bnkData = await fs.readFile(filePath, 'utf-8');
    return parseBostonScientificBnk(bnkData);
  } else if (fileExtension === '.pdd') {
    return parseMedtronicPdd(filePath);
  } else if (fileExtension === '.pkg') {
    return parseMedtronicPkg(filePath);
  } else if (fileExtension === '.log') {
    return parseAbbottLog(filePath);
  } else {
    console.warn(`Unsupported file type: ${fileExtension}`);
    return null;
  }
};

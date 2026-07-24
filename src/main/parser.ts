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
 * Decodes an XML file buffer honoring its BOM / encoding declaration.
 * Supports UTF-8 (default), UTF-16 LE/BE and ISO-8859-1 / Windows-1252 —
 * reading everything as UTF-8 mangled umlauts in e.g. Latin-1 exports.
 */
const decodeXmlBuffer = (buffer: Buffer): string => {
  // Byte Order Marks
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.toString('utf16le', 2);
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    // UTF-16 BE: swap byte pairs, then decode as LE
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.toString('utf-8', 3);
  }

  // Sniff the encoding= declaration from the XML prolog (ASCII-compatible)
  const prolog = buffer.toString('latin1', 0, Math.min(buffer.length, 200));
  const encMatch = prolog.match(/encoding=["']([^"']+)["']/i);
  if (encMatch) {
    const enc = encMatch[1].toLowerCase();
    if (enc === 'iso-8859-1' || enc === 'latin1' || enc === 'windows-1252' || enc === 'cp1252') {
      return buffer.toString('latin1');
    }
    if (enc === 'utf-16' || enc === 'utf-16le' || enc === 'ucs-2') {
      return buffer.toString('utf16le');
    }
  }

  return buffer.toString('utf-8');
};

/**
 * Stamps `manufacturer` onto a report whose manufacturer the dispatcher
 * already knows for certain from the file's extension/naming convention
 * (e.g. .bnk is always Boston Scientific) — overriding whatever the parser
 * itself produced. Keeps "manufacturer" reliable on autoimport even if a
 * parser's own extraction of that field is wrong, missing, or falls back to
 * 'Unknown' along some partial-parse path (#147). Not used for formats that
 * are genuinely multi-vendor, like Microport/Paceart.
 */
const withManufacturer = <T extends UnifiedReport | null>(report: T, manufacturer: string): T => {
  if (report) report.manufacturer = manufacturer;
  return report;
};

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
      const report = extractStructuredData(rawText, filename);
      // The filename already tells us this is Biotronik — don't leave
      // manufacturer to extractStructuredData's generic keyword scan, which
      // can miss it if the PDF text never spells out "Biotronik" (#147).
      report.manufacturer = 'Biotronik';
      return report;
    }

    return extractStructuredData(rawText, filename);
  } else if (fileExtension === '.xml') {
    const xmlData = decodeXmlBuffer(await fs.readFile(filePath));

    // Check for Microport/Paceart
    if (xmlData.includes('<Paceart>')) {
      return parseMicroportXML(xmlData);
    }

    if (filename.includes('BIOSTD_')) {
      return withManufacturer(parseBiotronikXML(xmlData), 'Biotronik');
    } else if (filename === 'visit.xml') {
      try {
        const { XMLParser } = require('fast-xml-parser');
        // parseTagValue: false — keep all values as strings so serial numbers
        // like "008763967" or "60E5" survive verbatim (no number coercion).
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false });
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
            serial_number: visit.device_serial != null ? String(visit.device_serial) : visit.device_serial
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

        if (visit.additional_fields && visit.additional_fields.field) {
          const fields = Array.isArray(visit.additional_fields.field) ? visit.additional_fields.field : [visit.additional_fields.field];
          const additionalFields: Record<string, string | number> = {};
          for (const f of fields) {
            const name = f?.name;
            const value = typeof f === 'object' ? f['#text'] : f;
            if (name && value !== undefined && value !== null) additionalFields[name] = value;
          }
          if (Object.keys(additionalFields).length > 0) report.additional_fields = additionalFields;
        }

        return report;
      } catch (error) {
        console.warn(`Failed to parse visit.xml file ${filePath}:`, error);
        return null;
      }
    }
    return null;
  } else if (fileExtension === '.bnk') {
    const bnkData = await fs.readFile(filePath, 'utf-8');
    return withManufacturer(parseBostonScientificBnk(bnkData), 'Boston Scientific');
  } else if (fileExtension === '.pdd') {
    return withManufacturer(await parseMedtronicPdd(filePath), 'Medtronic');
  } else if (fileExtension === '.pkg') {
    return withManufacturer(await parseMedtronicPkg(filePath), 'Medtronic');
  } else if (fileExtension === '.log') {
    return withManufacturer(await parseAbbottLog(filePath), 'Abbott');
  } else {
    console.warn(`Unsupported file type: ${fileExtension}`);
    return null;
  }
};

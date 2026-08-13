package io.github.alexanderlanganke.kardisynch.core.testing

/**
 * Synthetic device-export files, one generator per manufacturer format this
 * KMP port covers (plus a hand-rolled minimal PDF). Every field is
 * deliberately fake — no real patient/device identity ever appears here —
 * built purely from having reverse-engineered each format while porting its
 * parser (under core's `parsers` package).
 *
 * These exist so the import pipeline (dispatch → parse → visit match/merge
 * → local index) can be exercised end to end without the real, gitignored
 * `test/` fixture directories, which only exist in the original checkout —
 * not in a fresh clone or CI. [MockExportFixturesTest] round-trips every
 * generator through its real parser to keep them honest.
 */

data class MockPatient(val firstName: String, val lastName: String, val dob: String)
data class MockDevice(val model: String, val serial: String)

// -----------------------------------------------------------------------
// Boston Scientific .bnk — plain `Key,Value` lines plus `#`-prefixed header
// comments (src/main/parsers/boston-scientific-parser.ts / BostonScientificBnkParser.kt).
// -----------------------------------------------------------------------

/**
 * [interrogationDate]/[dobDay]/[dobMonth]/[dobYear] use PACEART's spelled-out
 * month convention (e.g. "Jul") since the header/`PatientBirth*` fields are
 * parsed as "day month year" text, not a combined date string.
 *
 * [device].model must be a single whitespace-free token — the header line
 * (`# DEVICE MODEL: {token} SERIAL: {token}`) is parsed with `\S+`, matching
 * real PACEART model codes like "D321-200-0" (internal part numbers, not
 * marketing names).
 */
fun mockBostonScientificBnk(
    patient: MockPatient,
    device: MockDevice,
    interrogationDay: Int = 21,
    interrogationMonth: String = "Jul",
    interrogationYear: Int = 2026,
    dobDay: Int = 15,
    dobMonth: String = "Mar",
    dobYear: Int = 1970,
    batteryPhase: String = "BOL",
): String {
    require(!device.model.contains(Regex("""\s"""))) {
        "Boston Scientific mock device.model must be a single whitespace-free token (e.g. 'D321-200-0'), got '${device.model}'"
    }
    val lines = mutableListOf<String>()
    lines += "# TYPE: PACEART           SAVE DATE: $interrogationDay $interrogationMonth $interrogationYear"
    lines += "# PROGRAMMER      MODEL: 3300 SERIAL: 000000 APP   MODEL: 3868 VERSION: 2.03"
    lines += "# DEVICE          MODEL: ${device.model} SERIAL: ${device.serial}"
    lines += "PatientFirstName,${patient.firstName}"
    lines += "PatientLastName,${patient.lastName}"
    lines += "PatientBirthDay,$dobDay"
    lines += "PatientBirthMonth,$dobMonth"
    lines += "PatientBirthYear,$dobYear"
    lines += "PatientLeadAManufacturer,Boston Scientific"
    lines += "PatientLeadAModelNum,MOCK-LEAD-A"
    lines += "PatientLeadASerialNum,MOCKLEADSER-A"
    lines += "PatientLeadAPosition,Rechter Vorhof"
    lines += "PatientAtrialImped,500.0 Ohm"
    lines += "PatientAtrialThreshAmpl,1.5 mV"
    lines += "PatientLeadV1ModelNum,MOCK-LEAD-V"
    lines += "PatientLeadV1SerialNum,MOCKLEADSER-V"
    lines += "PatientLeadV1Position,Rechter Ventrikel"
    lines += "PatientVImped,450.0 Ohm"
    lines += "BatteryLongevityParams.TimeToERI,>84 months"
    lines += "BatteryStatus.BatteryPhase,$batteryPhase"
    return lines.joinToString("\n")
}

// -----------------------------------------------------------------------
// Abbott .log — 0x1C-delimited coded log (src/main/parsers/abbott-parser.ts
// / AbbottLogParser.kt): `{code}<FS>{Label}<FS>{Value}<FS>{Unit}<FS>` per line.
// -----------------------------------------------------------------------

private const val ABBOTT_UNIT_SEPARATOR = ''

/** [interrogationDate]/[dob] are US-locale `MM/DD/YYYY` — this format has no other date convention. */
fun mockAbbottLog(
    patient: MockPatient,
    device: MockDevice,
    interrogationDate: String = "07/21/2026",
    dob: String = "03/15/1970",
): ByteArray {
    fun line(code: String, label: String, value: String, unit: String = "") =
        "$code$ABBOTT_UNIT_SEPARATOR$label$ABBOTT_UNIT_SEPARATOR$value$ABBOTT_UNIT_SEPARATOR$unit$ABBOTT_UNIT_SEPARATOR"

    val lines = listOf(
        line("2430", "Patient Name", "${patient.lastName}, ${patient.firstName}"),
        line("2431", "Patient Date of Birth", dob),
        line("204", "Patient ID", "MOCK-PID-001"),
        line("200", "Device Model Name", device.model),
        line("202", "Device Serial Number", device.serial),
        line("105", "Session Timestamp", "$interrogationDate 09:30:00"),
        line("519", "Unloaded Battery Voltage", "3.15", "V"),
        line("507", "RV Pacing Lead Impedance", "375.0", "Ohm"),
        line("2722", "Ventricular Signal Amplitude", "12.0", "mV"),
        line("1606", "RV. Capture Test Threshold Amplitude", "1.0", "V"),
        line("2470", "RV Lead Serial Number", "MOCKLEADSER-RV"),
        line("2461", "Model Number: SJM RV Pace/Sense Lead", "MOCK-LEAD-RV"),
        line("2460", "Manufacturer: RV Lead", "Abbott"),
        line("2442", "Implant Date: Device", "01/01/2020"),
        line("2440", "Ejection Fraction", "55%"),
    )
    return lines.joinToString("\n").encodeToByteArray()
}

// -----------------------------------------------------------------------
// Biotronik XML — `<InterfaceData><Patient>/<Examination>` with a
// Measurements/Table/TableEntry(AttributeName, CharValue|DecimalValue) grid
// (src/main/parsers/biotronik-parser.ts / BiotronikXmlParser.kt).
// -----------------------------------------------------------------------

/**
 * [deviceModel] should contain a family keyword the parser recognizes
 * (default "Amvia" -> Pacemaker) — see `parseBiotronikXML`'s device-type
 * inference. [interrogationDate]/[dob] are EU `DD.MM.YYYY`.
 */
fun mockBiotronikXml(
    patient: MockPatient,
    device: MockDevice,
    interrogationDate: String = "21.07.2026",
    dob: String = "15.03.1970",
    deviceModel: String = "Amvia Sky DR-T",
    batteryVoltage: Double = 3.20,
): String = """
    <?xml version="1.0" encoding="UTF-8"?>
    <InterfaceData>
      <Patient>
        <PersonalData>
          <Name>${patient.lastName}</Name>
          <FirstName>${patient.firstName}</FirstName>
          <DOB>$dob</DOB>
        </PersonalData>
      </Patient>
      <Examination>
        <ExaminationDate>$interrogationDate</ExaminationDate>
        <FunctionalDomain>HSM</FunctionalDomain>
        <Measurements>
          <Table>
            <TableName>SUMMARY</TableName>
            <TableEntry><AttributeName>MANUFACTURERDESCR</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
            <TableEntry><AttributeName>CATAGGREGATDESCR</AttributeName><CharValue>$deviceModel</CharValue></TableEntry>
            <TableEntry><AttributeName>SERHSM</AttributeName><CharValue>${device.serial}</CharValue></TableEntry>
            <TableEntry><AttributeName>ACTBATTERYVOLTAGE</AttributeName><DecimalValue>$batteryVoltage</DecimalValue></TableEntry>
            <TableEntry><AttributeName>FU1BATTERYSTATUS</AttributeName><CharValue>BOL</CharValue></TableEntry>
            <TableEntry><AttributeName>Kanäle</AttributeName><CharValue>RA</CharValue></TableEntry>
            <TableEntry><AttributeName>Hersteller</AttributeName><CharValue>Biotronik</CharValue></TableEntry>
            <TableEntry><AttributeName>Elektrodenmodell</AttributeName><CharValue>Setrox S 60</CharValue></TableEntry>
            <TableEntry><AttributeName>Seriennummer</AttributeName><CharValue>MOCKLEADSER-RA</CharValue></TableEntry>
            <TableEntry><AttributeName>FU_RA_IMPED</AttributeName><CharValue>480</CharValue></TableEntry>
            <TableEntry><AttributeName>A_AMPLITUDE</AttributeName><CharValue>2.5</CharValue></TableEntry>
            <TableEntry><AttributeName>A_IMPDAUER</AttributeName><CharValue>0.4</CharValue></TableEntry>
          </Table>
        </Measurements>
      </Examination>
    </InterfaceData>
""".trimIndent()

// -----------------------------------------------------------------------
// Microport/Paceart XML — `<Paceart>` root; almost every value lives in
// attributes, device/lead identity resolved via LookupTables by GUID
// (src/main/parsers/microport-parser.ts / MicroportXmlParser.kt).
// -----------------------------------------------------------------------

/** [interrogationDate]/[dob] are ISO `YYYY-MM-DD` — this format has no ambiguous-date convention to route around. */
fun mockMicroportXml(
    patient: MockPatient,
    device: MockDevice,
    interrogationDate: String = "2026-07-21",
    dob: String = "1970-03-15",
    deviceModel: String = "Microport Reply 200 DR-T",
): String = """
    <?xml version="1.0" encoding="UTF-8"?>
    <Paceart>
      <PatientRecords>
        <PatientRecord>
          <Demographics nameFirst="${patient.firstName}" nameLast="${patient.lastName}" BirthDate="$dob" />
          <Devices>
            <Pacemaker SerialNumber="${device.serial}">
              <PacemakerLookup>
                <PacemakerReference GUID="mock-device-guid" />
              </PacemakerLookup>
            </Pacemaker>
            <Lead SerialNumber="MOCKLEADSER-RV">
              <ImplantInformation Chamber="Ventricle" Date="2020-01-01" />
              <LeadLookup>
                <LeadReference GUID="mock-lead-guid" />
              </LeadLookup>
            </Lead>
          </Devices>
          <Tests>
            <PacemakerClinic Date="$interrogationDate">
              <Evaluation>
                <PacemakerTelemetry BatteryVoltage="2.85" BatteryImpedance_ohms="150">
                  <Lead Chamber="RV" BipolarImpedance_ohms="450" />
                </PacemakerTelemetry>
                <Thresholds>
                  <Sensing Chamber="RV" Amplitude_millivolts="10" />
                  <Capture Chamber="RV" Amplitude_volts="1.5" Duration_ms="0.4" />
                </Thresholds>
              </Evaluation>
            </PacemakerClinic>
          </Tests>
        </PatientRecord>
      </PatientRecords>
      <LookupTables>
        <Devices>
          <Pacemakers>
            <PacemakerDetail GUID="mock-device-guid" Model="$deviceModel" Manufacturer="Microport" />
          </Pacemakers>
          <Leads>
            <LeadDetail GUID="mock-lead-guid" Model="Mock RV Lead 60cm" Manufacturer="Microport" />
          </Leads>
        </Devices>
      </LookupTables>
    </Paceart>
""".trimIndent()

// -----------------------------------------------------------------------
// Medtronic .pdd — binary, marker-based (src/main/parsers/medtronic-parser.ts
// / MedtronicPddParser.kt): fixed-offset length-prefixed ASCII strings for
// name (0x03) and model (0x22), `0xFF<digits>0x0A0xFF<digits>0x0A`
// value/type marker pairs for measurements.
// -----------------------------------------------------------------------

private fun MutableList<Byte>.appendAscii(s: String) { for (c in s) add(c.code.toByte()) }
private fun MutableList<Byte>.appendByte(b: Int) { add(b.toByte()) }
private fun MutableList<Byte>.padTo(offset: Int) { while (size < offset) add(0) }
private fun MutableList<Byte>.appendLenPrefixedAscii(s: String) {
    appendByte(s.length)
    appendAscii(s)
}
private fun MutableList<Byte>.appendMarkerPair(value: Int, type: Int) {
    appendByte(0xFF); appendAscii(value.toString()); appendByte(0x0A)
    appendByte(0xFF); appendAscii(type.toString()); appendByte(0x0A)
}

/**
 * [device].serial MUST match the format's serial shape — 3 uppercase
 * letters, 6 digits, 1 uppercase letter (e.g. "PQR123456X") — the parser
 * locates it via `Regex("([A-Z]{3}\\d{6}[A-Z])(\\d{14})?")` scanned across
 * printable strings; anything else won't be recognized as a serial at all.
 *
 * This format never carries patient DOB — [MockPatient.dob] is ignored, and
 * a real parse always yields the parser's own "1900-01-01" placeholder;
 * callers/tests should assert against that fixed value, not [patient].dob.
 */
fun mockMedtronicPdd(
    patient: MockPatient,
    device: MockDevice,
    interrogationDate: String = "2026-07-21",
    batteryVoltage: Double? = 3.2,
): ByteArray {
    require(Regex("""^[A-Z]{3}\d{6}[A-Z]$""").matches(device.serial)) {
        "Medtronic mock serial must match [A-Z]{3}\\d{6}[A-Z] (e.g. PQR123456X), got '${device.serial}'"
    }
    val bytes = mutableListOf<Byte>()

    bytes.padTo(0x03)
    bytes.appendLenPrefixedAscii("${patient.lastName}, ${patient.firstName}")

    bytes.padTo(0x22)
    bytes.appendLenPrefixedAscii(device.model.take(15))

    bytes.appendByte(0) // run terminator so the serial+date string below isn't glued onto the model text
    val dateDigits = interrogationDate.replace("-", "").padEnd(8, '0').take(8)
    bytes.appendAscii("${device.serial}${dateDigits}000000")
    bytes.appendByte(0)

    if (batteryVoltage != null) {
        // Three agreeing type-4 entries — the parser only trusts a voltage
        // when every in-range type-4 marker agrees (see its doc comment).
        val milliVolts = (batteryVoltage * 1000).toInt()
        repeat(3) { bytes.appendMarkerPair(milliVolts, 4) }
    }

    // Atrial impedance (type 3, 737000..738000 range, last 3 digits = value).
    bytes.appendMarkerPair(737342, 3)
    // Atrial then RV pacing thresholds (type 2, 737400..737600, %100/100 = volts).
    bytes.appendMarkerPair(737450, 2) // 0.5V atrial
    bytes.appendMarkerPair(737480, 2) // 0.8V RV

    return bytes.toByteArray()
}

// -----------------------------------------------------------------------
// Dummy PDF — no manufacturer PDF parser is ported yet (Boston Scientific
// and Abbott both have a PDF report variant, neither ported — see those
// parsers' doc comments), but the pipeline needs to know how to handle a
// PDF that arrives alongside a structured export. This is a minimal,
// hand-rolled single-page PDF (no library — a valid PDF is just a small
// text format) carrying the same synthetic fields as the other mocks,
// drawn as plain text, so it's ready to exercise a real PDF parser's
// text-extraction step whenever one exists.
// -----------------------------------------------------------------------

/** Builds a minimal but structurally valid one-page PDF whose content stream shows [lines] as left-aligned text. */
fun mockDummyPdf(lines: List<String>): ByteArray {
    fun escapePdfText(s: String) = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    val contentBody = buildString {
        append("BT /F1 12 Tf 72 720 Td 14 TL\n")
        lines.forEachIndexed { i, line ->
            if (i > 0) append("T*\n")
            append("(${escapePdfText(line)}) Tj\n")
        }
        append("ET")
    }

    val objects = mutableListOf<String>()
    objects += "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
    objects += "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
    objects += "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n"
    objects += "4 0 obj\n<< /Length ${contentBody.encodeToByteArray().size} >>\nstream\n$contentBody\nendstream\nendobj\n"
    objects += "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"

    val header = "%PDF-1.4\n"
    val sb = StringBuilder(header)
    val offsets = mutableListOf<Int>()
    for (obj in objects) {
        offsets += sb.length
        sb.append(obj)
    }
    val xrefStart = sb.length
    sb.append("xref\n0 ${objects.size + 1}\n")
    sb.append("0000000000 65535 f \n")
    for (offset in offsets) {
        sb.append(offset.toString().padStart(10, '0')).append(" 00000 n \n")
    }
    sb.append("trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n$xrefStart\n%%EOF")

    return sb.toString().encodeToByteArray()
}

/** Convenience wrapper matching the other generators' (patient, device) shape. */
fun mockDummyPdf(patient: MockPatient, device: MockDevice, interrogationDate: String = "2026-07-21"): ByteArray = mockDummyPdf(
    listOf(
        "Patient: ${patient.lastName}, ${patient.firstName}",
        "DOB: ${patient.dob}",
        "Device: ${device.model}",
        "Serial: ${device.serial}",
        "Interrogation Date: $interrogationDate",
    ),
)

/**
 * Extracts the plain text `Tj`/`TJ` operators show from a PDF's (single,
 * uncompressed) content stream — enough to verify [mockDummyPdf]'s own
 * output round-trips, and forward-compatible scaffolding for whenever a
 * real PDF text-extraction step is ported (see this file's doc comment).
 * Not a general PDF reader: no compressed streams, no multi-page documents,
 * no font/encoding awareness beyond plain ASCII `(...)Tj` literals.
 */
fun extractPdfText(pdfBytes: ByteArray): String {
    val content = pdfBytes.decodeToString()
    val streamStart = content.indexOf("stream\n").let { if (it == -1) return "" else it + "stream\n".length }
    val streamEnd = content.indexOf("\nendstream", streamStart).let { if (it == -1) content.length else it }
    val stream = content.substring(streamStart, streamEnd)

    val sb = StringBuilder()
    val tjRegex = Regex("""\(((?:[^()\\]|\\.)*)\)\s*Tj""")
    for (m in tjRegex.findAll(stream)) {
        if (sb.isNotEmpty()) sb.append('\n')
        sb.append(m.groupValues[1].replace("\\(", "(").replace("\\)", ")").replace("\\\\", "\\"))
    }
    return sb.toString()
}

package io.github.alexanderlanganke.kardisynch.core.qrimport

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val SAMPLE_PAYLOAD = """{
  "v": 1,
  "t": "fu",
  "ts": 1770000000,
  "d": {
    "date": "2026-02-05",
    "fn": "Jane",
    "ln": "Doe",
    "dob": "1970-05-05",
    "dt": "PM",
    "dm": "ABT",
    "mn": "Endurity Core",
    "ds": "ANONDEV00001",
    "di": "2018-11-08",
    "rv": {"ta": 0.5, "tp": 0.4, "se": 12, "im": 537.5},
    "bv": 2.94784,
    "bs": "OK",
    "lo": 84
  }
}"""

class FollowUpQrPayloadTest {
    @Test
    fun `decodes a real-shape follow-up payload`() {
        val result = parseFollowUpQrPayload(SAMPLE_PAYLOAD)
        assertEquals("Jane", result?.patientFirstName)
        assertEquals("Doe", result?.patientLastName)
        assertEquals("1970-05-05", result?.patientDob)

        val report = result!!.report
        assertEquals("Abbott", report.manufacturer)
        assertEquals("2026-02-05", report.interrogationDate)
        assertEquals("Pacemaker", report.device.type)
        assertEquals("Endurity Core", report.device.model)
        assertEquals("ANONDEV00001", report.device.serialNumber)
        assertEquals(2.94784, report.battery.voltage?.value)
        assertEquals(84.0, report.battery.remainingLongevity?.value)
        assertEquals(1, report.leads.size)
        assertEquals("RV", report.leads[0].name)
        assertEquals(0.5, report.leads[0].pacingThreshold?.value)
        assertEquals(537.5, report.leads[0].impedance?.value)
    }

    @Test
    fun `returns null for non-JSON or wrong envelope`() {
        assertNull(parseFollowUpQrPayload("not json at all"))
        assertNull(parseFollowUpQrPayload("""{"v": 2, "t": "fu", "ts": 1, "d": {}}"""))
        assertNull(parseFollowUpQrPayload("""{"v": 1, "t": "other", "ts": 1, "d": {}}"""))
    }

    @Test
    fun `tolerates a minimal payload with only date and no other fields`() {
        val minimal = """{"v": 1, "t": "fu", "ts": 1, "d": {"date": "2026-01-01"}}"""
        val result = parseFollowUpQrPayload(minimal)
        assertEquals("", result?.patientFirstName)
        assertEquals("", result?.patientLastName)
        assertTrue(result!!.report.leads.isEmpty())
    }

    // Issue #179's cross-check against visitToFuPayload.ts's DEVICE_TYPE_MAP
    // found "LR" was mapping to "ICM" instead of "Leadless Pacemaker" — a
    // genuinely different device type (Reveal/LINQ-style monitor vs.
    // Micra-style leadless pacemaker).
    @Test
    fun `LR decodes to Leadless Pacemaker, not ICM`() {
        val payload = """{"v": 1, "t": "fu", "ts": 1, "d": {"date": "2026-01-01", "dt": "LR"}}"""
        assertEquals("Leadless Pacemaker", parseFollowUpQrPayload(payload)?.report?.device?.type)
    }

    // visitToFuPayload.ts's compactDeviceType/compactManufacturer fall back
    // to the ORIGINAL string for anything not in their maps (e.g. an ICM
    // device, which has no TS-side compact code at all) — the decode side
    // must do the same, not collapse an unrecognized-but-present code to
    // "Unknown" and lose the exported data.
    @Test
    fun `an unrecognized device type or manufacturer code passes through verbatim, not Unknown`() {
        val payload = """{"v": 1, "t": "fu", "ts": 1, "d": {"date": "2026-01-01", "dt": "ICM", "dm": "SomeNewVendor"}}"""
        val report = parseFollowUpQrPayload(payload)?.report
        assertEquals("ICM", report?.device?.type)
        assertEquals("SomeNewVendor", report?.manufacturer)
    }

    @Test
    fun `an absent device type or manufacturer field is still Unknown`() {
        val payload = """{"v": 1, "t": "fu", "ts": 1, "d": {"date": "2026-01-01"}}"""
        val report = parseFollowUpQrPayload(payload)?.report
        assertEquals("Unknown", report?.device?.type)
        assertEquals("Unknown", report?.manufacturer)
    }
}

package io.github.alexanderlanganke.kardisynch.core.parsers.abbott

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class AbbottLogMeasurementsTest {
    private val fs = "\u001C"

    private fun log(vararg rows: Triple<String, String, String>): ByteArray {
        val unit = { v: String -> v.filter { !it.isDigit() && it != '.' }.trim() }
        val lines = mutableListOf(
            "2430${fs}Patient Name${fs}Mustermann, Erika${fs}${fs}", "2431${fs}Patient Date of Birth${fs}09/15/1950${fs}${fs}",
            "200${fs}Device Model Name${fs}Test ICD${fs}${fs}", "202${fs}Device Serial Number${fs}ABT100003${fs}${fs}",
            "105${fs}Session Timestamp${fs}07/21/2026 10:00:00${fs}${fs}",
        )
        rows.forEach { (code, label, value) -> lines += "$code$fs$label$fs${value.filter { it.isDigit() || it == '.' }}$fs${unit(value)}$fs" }
        // pad so the coded-line ratio check sees a coded log
        repeat(6) { lines += "9${it}0${fs}Filler${fs}1${fs}${fs}" }
        return lines.joinToString("\n").encodeToByteArray()
    }

    @Test
    fun `reads HV impedance and the programmed pacing output`() {
        val report = assertNotNull(
            parseAbbottLog(
                log(
                    Triple("507", "RV Pacing Lead Impedance", "480Ohm"), Triple("2730", "HV Lead Impedance", "64Ohm"),
                    Triple("306", "RV Pulse Amplitude", "2.5V"), Triple("305", "RV Pulse Width", "0.4ms"),
                    Triple("312", "Atrial Pulse Amplitude", "3.5V"), Triple("311", "Atrial Pulse Width", "0.4ms"),
                    Triple("512", "Atrial Pacing Lead Impedance", "510Ohm"),
                ),
                "12345.log",
            ),
        )
        val rv = report.leads.single { it.name == "RV" }
        assertEquals(64.0, rv.shockImpedance?.value)
        assertEquals(2.5, rv.pacingAmplitude?.value)
        assertEquals("V @ 0.4ms", rv.pacingAmplitude?.unit)
        assertEquals(3.5, report.leads.single { it.name == "Atrium" }.pacingAmplitude?.value)
    }

    @Test
    fun `a threshold from the decrement test or AutoCapture is used when there is no capture test`() {
        val report = assertNotNull(
            parseAbbottLog(
                log(
                    Triple("507", "RV Pacing Lead Impedance", "480Ohm"),
                    Triple("2604", "V. Pulse Amp Decrement Capture Test: Capture Threshold (Pulse Amp)", "0.75V"),
                    Triple("2605", "V. Pulse Amp Decrement Capture Test: Test Pulse Width", "0.4ms"),
                    Triple("512", "Atrial Pacing Lead Impedance", "510Ohm"),
                    Triple("849", "A. AutoCapture Capture Test Pulse Amplitude (threshold)", "0.5V"),
                ),
                "12345.log",
            ),
        )
        assertEquals(0.75, report.leads.single { it.name == "RV" }.pacingThreshold?.value)
        assertEquals(0.5, report.leads.single { it.name == "Atrium" }.pacingThreshold?.value)
    }

    @Test
    fun `the plain capture test still wins over the other threshold sources`() {
        val report = assertNotNull(
            parseAbbottLog(
                log(
                    Triple("507", "RV Pacing Lead Impedance", "480Ohm"), Triple("1606", "RV. Capture Test Threshold Amplitude", "1.0V"),
                    Triple("2604", "V. Pulse Amp Decrement Capture Test: Capture Threshold (Pulse Amp)", "0.75V"),
                ),
                "12345.log",
            ),
        )
        assertEquals(1.0, report.leads.single { it.name == "RV" }.pacingThreshold?.value)
    }

    @Test
    fun `no HV impedance code means no shock impedance`() {
        val report = assertNotNull(parseAbbottLog(log(Triple("507", "RV Pacing Lead Impedance", "480Ohm")), "12345.log"))
        assertNull(report.leads.single { it.name == "RV" }.shockImpedance)
    }
}

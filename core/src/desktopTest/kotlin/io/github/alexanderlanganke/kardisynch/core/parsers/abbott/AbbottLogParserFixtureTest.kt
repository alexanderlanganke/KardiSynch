package io.github.alexanderlanganke.kardisynch.core.parsers.abbott

import io.github.alexanderlanganke.kardisynch.core.testutil.findRepoTestDir
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

@Serializable
private data class FixtureMeasurement(val value: JsonElement, val unit: String)

@Serializable
private data class FixturePatient(val first_name: String, val last_name: String, val dob: String, val hospitalPatientId: String? = null)

@Serializable
private data class FixtureDevice(val type: String, val model: String, val serial_number: String, val implant_date: String? = null)

@Serializable
private data class FixtureBattery(val voltage: FixtureMeasurement? = null)

@Serializable
private data class FixtureLead(
    val name: String,
    val manufacturer: String? = null,
    val model: String? = null,
    val serial: String? = null,
    val implant_date: String? = null,
    val impedance: FixtureMeasurement? = null,
    val sensing: FixtureMeasurement? = null,
    val pacing_threshold: FixtureMeasurement? = null,
)

@Serializable
private data class FixtureReport(
    val manufacturer: String,
    val interrogation_date: String,
    val session_id: String? = null,
    val patient: FixturePatient,
    val device: FixtureDevice,
    val battery: FixtureBattery = FixtureBattery(),
    val leads: List<FixtureLead> = emptyList(),
)

private const val EPSILON = 0.005

private fun JsonElement?.asLeadingDouble(): Double? {
    val prim = this as? JsonPrimitive ?: return null
    prim.doubleOrNull?.let { return it }
    return Regex("""-?\d+(\.\d+)?""").find(prim.content)?.value?.toDoubleOrNull()
}

private fun closeEnough(a: Double?, b: Double?): Boolean = when {
    a == null && b == null -> true
    a != null && b != null -> kotlin.math.abs(a - b) < EPSILON
    else -> false
}

/**
 * Cross-validates the ported [parseAbbottLog] against the ORIGINAL
 * TypeScript parser's real output for every real .log sample in
 * test/abbott_logfiles (17 files, all coded-delimited format) — see
 * [io.github.alexanderlanganke.kardisynch.core.parsers.medtronic.MedtronicPddParserFixtureTest]
 * for how the fixture JSON is generated/why it's gitignored.
 */
class AbbottLogParserFixtureTest {
    private val fixtures: Map<String, FixtureReport> by lazy {
        val json = Json { ignoreUnknownKeys = true }
        val text = requireNotNull(
            javaClass.classLoader.getResourceAsStream("abbott-fixtures.json"),
        ) { "abbott-fixtures.json not found on the test classpath" }.bufferedReader().readText()
        json.decodeFromString<Map<String, FixtureReport>>(text)
    }

    @Test
    fun `matches the reference TypeScript parser on every real abbott log sample`() {
        val logDir = File(findRepoTestDir(), "abbott_logfiles")
        assertTrue(logDir.isDirectory, "abbott_logfiles directory not found under ${findRepoTestDir()}")
        assertTrue(fixtures.isNotEmpty(), "No reference fixtures loaded")

        val failures = mutableListOf<String>()
        for ((filename, expected) in fixtures) {
            val file = File(logDir, filename)
            if (!file.isFile) {
                failures.add("$filename: sample file missing from test/abbott_logfiles/")
                continue
            }
            val actual = parseAbbottLog(file.readBytes(), filename)
            if (actual == null) {
                failures.add("$filename: parser returned null")
                continue
            }

            fun check(label: String, cond: Boolean, detail: String) {
                if (!cond) failures.add("$filename [$label]: $detail")
            }

            check("sessionId", actual.sessionId == expected.session_id, "expected '${expected.session_id}', got '${actual.sessionId}'")
            check("device.model", actual.device.model == expected.device.model, "expected '${expected.device.model}', got '${actual.device.model}'")
            check("device.serial", actual.device.serialNumber == expected.device.serial_number, "expected '${expected.device.serial_number}', got '${actual.device.serialNumber}'")
            check("device.type", actual.device.type == expected.device.type, "expected '${expected.device.type}', got '${actual.device.type}'")
            check("device.implantDate", actual.device.implantDate == expected.device.implant_date, "expected '${expected.device.implant_date}', got '${actual.device.implantDate}'")
            check("patient.lastName", actual.patient.lastName == expected.patient.last_name, "expected '${expected.patient.last_name}', got '${actual.patient.lastName}'")
            check("patient.firstName", actual.patient.firstName == expected.patient.first_name, "expected '${expected.patient.first_name}', got '${actual.patient.firstName}'")
            check("patient.dob", actual.patient.dob == expected.patient.dob, "expected '${expected.patient.dob}', got '${actual.patient.dob}'")
            check("patient.hospitalPatientId", actual.patient.hospitalPatientId == expected.patient.hospitalPatientId, "expected '${expected.patient.hospitalPatientId}', got '${actual.patient.hospitalPatientId}'")
            check("interrogationDate", actual.interrogationDate == expected.interrogation_date, "expected '${expected.interrogation_date}', got '${actual.interrogationDate}'")
            check(
                "battery.voltage",
                closeEnough(expected.battery.voltage?.value.asLeadingDouble(), actual.battery.voltage?.value),
                "expected ${expected.battery.voltage?.value}, got ${actual.battery.voltage?.value}",
            )

            check("leads.count", actual.leads.size == expected.leads.size, "expected ${expected.leads.size} leads, got ${actual.leads.size}")
            for ((i, expectedLead) in expected.leads.withIndex()) {
                val actualLead = actual.leads.getOrNull(i)
                if (actualLead == null) {
                    failures.add("$filename [leads[$i]]: missing (expected '${expectedLead.name}')")
                    continue
                }
                check("leads[$i].name", actualLead.name == expectedLead.name, "expected '${expectedLead.name}', got '${actualLead.name}'")
                check("leads[$i].manufacturer", actualLead.manufacturer == expectedLead.manufacturer, "expected '${expectedLead.manufacturer}', got '${actualLead.manufacturer}'")
                check("leads[$i].model", actualLead.model == expectedLead.model, "expected '${expectedLead.model}', got '${actualLead.model}'")
                check("leads[$i].serial", actualLead.serial == expectedLead.serial, "expected '${expectedLead.serial}', got '${actualLead.serial}'")
                check("leads[$i].implantDate", actualLead.implantDate == expectedLead.implant_date, "expected '${expectedLead.implant_date}', got '${actualLead.implantDate}'")
                check(
                    "leads[$i].impedance",
                    closeEnough(expectedLead.impedance?.value.asLeadingDouble(), actualLead.impedance?.value),
                    "expected ${expectedLead.impedance?.value}, got ${actualLead.impedance?.value}",
                )
                check(
                    "leads[$i].sensing",
                    closeEnough(expectedLead.sensing?.value.asLeadingDouble(), actualLead.sensing?.value),
                    "expected ${expectedLead.sensing?.value}, got ${actualLead.sensing?.value}",
                )
                check(
                    "leads[$i].pacingThreshold",
                    closeEnough(expectedLead.pacing_threshold?.value.asLeadingDouble(), actualLead.pacingThreshold?.value),
                    "expected ${expectedLead.pacing_threshold?.value}, got ${actualLead.pacingThreshold?.value}",
                )
            }
        }

        assertTrue(
            failures.isEmpty(),
            "${failures.size} mismatch(es) against the reference TypeScript parser (of ${fixtures.size} files):\n" + failures.joinToString("\n"),
        )
    }
}

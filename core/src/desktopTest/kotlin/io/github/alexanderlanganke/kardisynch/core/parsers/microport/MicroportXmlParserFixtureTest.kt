package io.github.alexanderlanganke.kardisynch.core.parsers.microport

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
private data class FixturePatient(val first_name: String, val last_name: String, val dob: String)

@Serializable
private data class FixtureDevice(val type: String, val model: String, val serial_number: String)

@Serializable
private data class FixtureBattery(val voltage: FixtureMeasurement? = null, val status: String? = null)

@Serializable
private data class FixtureLead(
    val name: String,
    val manufacturer: String? = null,
    val model: String? = null,
    val serial: String? = null,
    val anatomic_location: String? = null,
    val implant_date: String? = null,
    val sensing: FixtureMeasurement? = null,
    val pacing_threshold: FixtureMeasurement? = null,
    val impedance: FixtureMeasurement? = null,
)

@Serializable
private data class FixtureReport(
    val manufacturer: String,
    val interrogation_date: String,
    val patient: FixturePatient,
    val device: FixtureDevice,
    val battery: FixtureBattery = FixtureBattery(),
    val leads: List<FixtureLead> = emptyList(),
)

private const val EPSILON = 0.005

/** Extracts the leading numeric token from a value that may be a JSON number or a composite "amplitude @ pulseWidth" string. */
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
 * Cross-validates the ported [parseMicroportXML] against the ORIGINAL
 * TypeScript parser's real output for every real .xml sample in
 * test/microport xml (9 files) — see
 * [io.github.alexanderlanganke.kardisynch.core.parsers.medtronic.MedtronicPddParserFixtureTest]
 * for how the fixture JSON is generated/why it's gitignored.
 */
class MicroportXmlParserFixtureTest {
    private val fixtures: Map<String, FixtureReport> by lazy {
        val json = Json { ignoreUnknownKeys = true }
        val text = requireNotNull(
            javaClass.classLoader.getResourceAsStream("microport-fixtures.json"),
        ) { "microport-fixtures.json not found on the test classpath" }.bufferedReader().readText()
        json.decodeFromString<Map<String, FixtureReport>>(text)
    }

    @Test
    fun `matches the reference TypeScript parser on every real microport xml sample`() {
        val xmlDir = File(findRepoTestDir(), "microport xml")
        assertTrue(xmlDir.isDirectory, "microport xml directory not found under ${findRepoTestDir()}")
        assertTrue(fixtures.isNotEmpty(), "No reference fixtures loaded")

        val failures = mutableListOf<String>()
        for ((filename, expected) in fixtures) {
            val file = File(xmlDir, filename)
            if (!file.isFile) {
                failures.add("$filename: sample file missing from test/microport xml/")
                continue
            }
            val actual = parseMicroportXML(file.readText())
            if (actual == null) {
                failures.add("$filename: parser returned null")
                continue
            }

            fun check(label: String, cond: Boolean, detail: String) {
                if (!cond) failures.add("$filename [$label]: $detail")
            }

            check("manufacturer", actual.manufacturer == expected.manufacturer, "expected '${expected.manufacturer}', got '${actual.manufacturer}'")
            check("device.model", actual.device.model == expected.device.model, "expected '${expected.device.model}', got '${actual.device.model}'")
            check("device.serial", actual.device.serialNumber == expected.device.serial_number, "expected '${expected.device.serial_number}', got '${actual.device.serialNumber}'")
            check("device.type", actual.device.type == expected.device.type, "expected '${expected.device.type}', got '${actual.device.type}'")
            check("patient.lastName", actual.patient.lastName == expected.patient.last_name, "expected '${expected.patient.last_name}', got '${actual.patient.lastName}'")
            check("patient.firstName", actual.patient.firstName == expected.patient.first_name, "expected '${expected.patient.first_name}', got '${actual.patient.firstName}'")
            check("patient.dob", actual.patient.dob == expected.patient.dob, "expected '${expected.patient.dob}', got '${actual.patient.dob}'")
            check("interrogationDate", actual.interrogationDate == expected.interrogation_date, "expected '${expected.interrogation_date}', got '${actual.interrogationDate}'")
            check("battery.status", actual.battery.status == expected.battery.status, "expected '${expected.battery.status}', got '${actual.battery.status}'")
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
                check("leads[$i].anatomicLocation", actualLead.anatomicLocation == expectedLead.anatomic_location, "expected '${expectedLead.anatomic_location}', got '${actualLead.anatomicLocation}'")
                check("leads[$i].implantDate", actualLead.implantDate == expectedLead.implant_date, "expected '${expectedLead.implant_date}', got '${actualLead.implantDate}'")
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
                check(
                    "leads[$i].impedance",
                    closeEnough(expectedLead.impedance?.value.asLeadingDouble(), actualLead.impedance?.value),
                    "expected ${expectedLead.impedance?.value}, got ${actualLead.impedance?.value}",
                )
            }
        }

        assertTrue(
            failures.isEmpty(),
            "${failures.size} mismatch(es) against the reference TypeScript parser (of ${fixtures.size} files):\n" + failures.joinToString("\n"),
        )
    }
}

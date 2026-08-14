package io.github.alexanderlanganke.kardisynch.core.parsers.biotronik

import io.github.alexanderlanganke.kardisynch.core.testutil.findRepoTestDirOrSkip
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

@Serializable
private data class FixtureMeasurement(val value: String, val unit: String)

@Serializable
private data class FixturePatient(val first_name: String, val last_name: String, val dob: String)

@Serializable
private data class FixtureDevice(val type: String, val model: String, val serial_number: String)

@Serializable
private data class FixtureBattery(
    val voltage: FixtureMeasurement? = null,
    val remaining_longevity: FixtureMeasurement? = null,
    val status: String? = null,
)

@Serializable
private data class FixtureLead(
    val name: String,
    val manufacturer: String? = null,
    val model: String? = null,
    val serial: String? = null,
    val impedance: FixtureMeasurement? = null,
    val sensing: FixtureMeasurement? = null,
    val pacing_threshold: FixtureMeasurement? = null,
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

/** Extracts the leading numeric token from a value that may be a plain number or a composite "amplitude @ pulseWidth" string. */
private fun leadingDouble(s: String?): Double? {
    if (s.isNullOrEmpty()) return null
    return Regex("""-?\d+(\.\d+)?""").find(s)?.value?.toDoubleOrNull()
}

private fun closeEnough(a: Double?, b: Double?): Boolean = when {
    a == null && b == null -> true
    a != null && b != null -> kotlin.math.abs(a - b) < EPSILON
    else -> false
}

/**
 * Cross-validates the ported [parseBiotronikXML] against the ORIGINAL
 * TypeScript parser's real output for every real .xml sample in
 * test/Biotronik xml (220 files) — see
 * [io.github.alexanderlanganke.kardisynch.core.parsers.medtronic.MedtronicPddParserFixtureTest]
 * for how the fixture JSON is generated/why it's gitignored.
 *
 * The original TS parser always constructs battery.voltage/
 * remaining_longevity objects with an empty-string value when no data was
 * found (rather than omitting the field) — this port uses a nullable
 * Measurement instead, so "" in the fixture is treated as equivalent to
 * null throughout this comparison.
 */
class BiotronikXmlParserFixtureTest {
    private val fixtures: Map<String, FixtureReport> by lazy {
        val json = Json { ignoreUnknownKeys = true }
        val text = requireNotNull(
            javaClass.classLoader.getResourceAsStream("biotronik-fixtures.json"),
        ) { "biotronik-fixtures.json not found on the test classpath" }.bufferedReader().readText()
        json.decodeFromString<Map<String, FixtureReport>>(text)
    }

    @Test
    fun `matches the reference TypeScript parser on every real Biotronik xml sample`() {
        val xmlDir = File(findRepoTestDirOrSkip(), "Biotronik xml")
        assertTrue(xmlDir.isDirectory, "Biotronik xml directory not found under ${findRepoTestDirOrSkip()}")
        assertTrue(fixtures.isNotEmpty(), "No reference fixtures loaded")

        val failures = mutableListOf<String>()
        for ((filename, expected) in fixtures) {
            val file = File(xmlDir, filename)
            if (!file.isFile) {
                failures.add("$filename: sample file missing from test/Biotronik xml/")
                continue
            }
            val actual = parseBiotronikXML(file.readText())

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

            check(
                "battery.voltage",
                closeEnough(leadingDouble(expected.battery.voltage?.value), actual.battery.voltage?.value),
                "expected '${expected.battery.voltage?.value}', got ${actual.battery.voltage?.value}",
            )
            check(
                "battery.remainingLongevity",
                closeEnough(leadingDouble(expected.battery.remaining_longevity?.value), actual.battery.remainingLongevity?.value),
                "expected '${expected.battery.remaining_longevity?.value}', got ${actual.battery.remainingLongevity?.value}",
            )
            check("battery.status", actual.battery.status == expected.battery.status, "expected '${expected.battery.status}', got '${actual.battery.status}'")

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
                check(
                    "leads[$i].impedance",
                    closeEnough(leadingDouble(expectedLead.impedance?.value), actualLead.impedance?.value),
                    "expected '${expectedLead.impedance?.value}', got ${actualLead.impedance?.value}",
                )
                check(
                    "leads[$i].sensing",
                    closeEnough(leadingDouble(expectedLead.sensing?.value), actualLead.sensing?.value),
                    "expected '${expectedLead.sensing?.value}', got ${actualLead.sensing?.value}",
                )
                check(
                    "leads[$i].pacingThreshold",
                    closeEnough(leadingDouble(expectedLead.pacing_threshold?.value), actualLead.pacingThreshold?.value),
                    "expected '${expectedLead.pacing_threshold?.value}', got ${actualLead.pacingThreshold?.value}",
                )
            }
        }

        assertTrue(
            failures.isEmpty(),
            "${failures.size} mismatch(es) against the reference TypeScript parser (of ${fixtures.size} files):\n" +
                failures.take(60).joinToString("\n") + if (failures.size > 60) "\n... and ${failures.size - 60} more" else "",
        )
    }
}

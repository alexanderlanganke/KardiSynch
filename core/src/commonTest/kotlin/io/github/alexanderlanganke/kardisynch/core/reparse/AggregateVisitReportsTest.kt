package io.github.alexanderlanganke.kardisynch.core.reparse

import io.github.alexanderlanganke.kardisynch.core.model.BatteryData
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.Measurement
import io.github.alexanderlanganke.kardisynch.core.model.PatientInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AggregateVisitReportsTest {
    private fun report(
        manufacturer: String = "Medtronic",
        interrogationDate: String = "2026-07-21",
        lastName: String = "Doe",
        deviceModel: String = "Model1",
        deviceSerial: String = "S1",
        battery: BatteryData = BatteryData(),
        leads: List<LeadData> = emptyList(),
        additionalFields: Map<String, String> = emptyMap(),
    ) = UnifiedReport(
        manufacturer = manufacturer,
        interrogationDate = interrogationDate,
        patient = PatientInfo(firstName = "Max", lastName = lastName, dob = "1970-01-01"),
        device = DeviceInfo(type = "ICD", model = deviceModel, serialNumber = deviceSerial),
        battery = battery,
        leads = leads,
        additionalFields = additionalFields,
    )

    @Test
    fun `an empty file list aggregates to null`() {
        assertNull(aggregateReports(emptyList(), "2026_07_21_abc"))
    }

    @Test
    fun `a single report aggregates to itself`() {
        val r = report()
        assertEquals(r, aggregateReports(listOf(r), "2026_07_21_abc"))
    }

    @Test
    fun `prefers a device with a known model over one with Unknown`() {
        val weak = report(deviceModel = "Unknown", deviceSerial = "Unknown")
        val strong = report(deviceModel = "RealModel", deviceSerial = "RealSerial")
        val aggregated = aggregateReports(listOf(weak, strong), "dir")
        assertEquals("RealModel", aggregated!!.device.model)
    }

    @Test
    fun `falls back to a device with a known serial when no file has a known model`() {
        val weak = report(deviceModel = "Unknown", deviceSerial = "Unknown")
        val serialOnly = report(deviceModel = "Unknown", deviceSerial = "S-999")
        val aggregated = aggregateReports(listOf(weak, serialOnly), "dir")
        assertEquals("S-999", aggregated!!.device.serialNumber)
    }

    @Test
    fun `falls back to the first report's device when nothing has model or serial`() {
        val a = report(deviceModel = "Unknown", deviceSerial = "Unknown")
        val b = report(deviceModel = "Unknown", deviceSerial = "Unknown")
        assertEquals(a.device, aggregateReports(listOf(a, b), "dir")!!.device)
    }

    @Test
    fun `interrogation date falls back to the directory name when no file has one`() {
        val a = report(interrogationDate = "")
        val aggregated = aggregateReports(listOf(a), "2026_07_21_abc123")
        assertEquals("2026-07-21", aggregated!!.interrogationDate)
    }

    @Test
    fun `prefers a battery with real data over an empty one`() {
        val empty = report(battery = BatteryData())
        val real = report(battery = BatteryData(voltage = Measurement(3.1, "V")))
        val aggregated = aggregateReports(listOf(empty, real), "dir")
        assertEquals(Measurement(3.1, "V"), aggregated!!.battery.voltage)
    }

    @Test
    fun `leads are deduplicated by serial across files`() {
        val leadA = LeadData(name = "RA", serial = "L1", model = "ModelA")
        val leadADuplicate = LeadData(name = "RA", serial = "L1", model = "ModelA-Updated")
        val leadB = LeadData(name = "RV", serial = "L2")
        val aggregated = aggregateReports(
            listOf(report(leads = listOf(leadA)), report(leads = listOf(leadADuplicate, leadB))),
            "dir",
        )
        assertEquals(2, aggregated!!.leads.size)
        assertEquals("ModelA", aggregated.leads.first { it.serial == "L1" }.model, "first occurrence wins")
    }

    @Test
    fun `leads without a usable serial fall back to model, then name, as the dedup key`() {
        val noSerialModel = LeadData(name = "RV", serial = null, model = "SharedModel")
        val noSerialModelDup = LeadData(name = "RV", serial = ".", model = "SharedModel")
        val noSerialNoModel = LeadData(name = "LV", serial = "Unknown", model = null)
        val aggregated = aggregateReports(
            listOf(report(leads = listOf(noSerialModel)), report(leads = listOf(noSerialModelDup, noSerialNoModel))),
            "dir",
        )
        assertEquals(2, aggregated!!.leads.size)
    }

    @Test
    fun `additional fields are unioned across files, later files overriding shared keys`() {
        val a = report(additionalFields = mapOf("x" to "1", "shared" to "from-a"))
        val b = report(additionalFields = mapOf("y" to "2", "shared" to "from-b"))
        val aggregated = aggregateReports(listOf(a, b), "dir")
        assertEquals(mapOf("x" to "1", "y" to "2", "shared" to "from-b"), aggregated!!.additionalFields)
    }

    @Test
    fun `prefers a manufacturer that isn't Unknown`() {
        val unknown = report(manufacturer = "Unknown")
        val known = report(manufacturer = "Biotronik")
        assertEquals("Biotronik", aggregateReports(listOf(unknown, known), "dir")!!.manufacturer)
    }

    @Test
    fun `prefers a patient with a non-blank last name`() {
        val noName = report(lastName = "")
        val named = report(lastName = "Smith")
        assertEquals("Smith", aggregateReports(listOf(noName, named), "dir")!!.patient.lastName)
    }
}

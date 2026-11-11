package io.github.alexanderlanganke.kardisynch.core.parsers.bostonscientific

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** Real PACEART exports leave the `Patient*` summary keys at "K.A" and carry the results under other keys. */
class BostonScientificBnkMeasurementsTest {
    private fun bnk(vararg lines: String) = buildString {
        appendLine("# TYPE: PACEART           SAVE DATE: 21 Jul 2026")
        appendLine("# DEVICE          MODEL: D321-200-0  SERIAL: 123456")
        for ((key, value) in listOf(
            "PatientLastName" to "Mustermann", "PatientFirstName" to "Erika", "PatientBirthDay" to "15", "PatientBirthMonth" to "Sep",
            "PatientBirthYear" to "1950", "PatientLeadAPosition" to "Rechter Vorhof", "PatientLeadAModelNum" to "4478",
            "PatientLeadV1Position" to "Rechter Ventrikel", "PatientLeadV1ModelNum" to "0158",
        )) appendLine("$key,$value")
        lines.forEach { appendLine(it) }
    }

    @Test
    fun `reads impedance, threshold, sensing and programmed output from the result keys when the summary keys are K_A`() {
        val report = parseBostonScientificBnk(
            bnk(
                "PatientAtrialImped,K.A", "PatientAtrialThreshAmpl,K.A", "PatientAtrialThreshPW,K.A", "PatientIntrinsicAAmplitude,K.A",
                "PatientVImped,K.A", "PatientVThreshAmpl,K.A", "PatientVThreshPW,K.A", "PatientIntrinsicVAmplitude,K.A", "PatientShockImped,K.A",
                "ManualLeadImpedData.RAMsmt.Msmt,512.0 ohms", "ManualLeadImpedData.RVMsmt.Msmt,472.0 ohms",
                "InterPaceThreshResult.RAMsmt.Amplitude,600.0 mV", "InterPaceThreshResult.RAMsmt.PulseWidth,0.4 ms",
                "InterPaceThreshResult.RVMsmt.Amplitude,700.0 mV", "InterPaceThreshResult.RVMsmt.PulseWidth,0.5 ms",
                "ManualIntrinsicResult.RAMsmt.Msmt,3.9 mV", "ManualIntrinsicResult.RVMsmt.Msmt,12.0 mV",
                "BdyNormAAmplitude,2.5 V", "BdyNormAPulseWidth,0.4 ms", "BdyNormVAmplitude,3.5 V", "BdyNormVPulseWidth,0.5 ms",
                "ShockLastImpedance,64.0 ohms",
            ),
        )

        val atrium = report.leads.single { it.name == "Atrium" }
        assertEquals(512.0, atrium.impedance?.value)
        assertEquals(0.6, atrium.pacingThreshold?.value)
        assertEquals("V @ 0.4ms", atrium.pacingThreshold?.unit)
        assertEquals(3.9, atrium.sensing?.value)
        assertEquals("mV", atrium.sensing?.unit)
        assertEquals(2.5, atrium.pacingAmplitude?.value)

        val rv = report.leads.single { it.name == "RV" }
        assertEquals(472.0, rv.impedance?.value)
        assertEquals(0.7, rv.pacingThreshold?.value)
        assertEquals(12.0, rv.sensing?.value)
        assertEquals(3.5, rv.pacingAmplitude?.value)
        assertEquals(64.0, rv.shockImpedance?.value, "the last shock impedance, when the summary key has none")
    }

    @Test
    fun `a summary key that has a value still wins over the result key`() {
        val report = parseBostonScientificBnk(
            bnk("PatientVImped,500.0 ohms", "PatientVThreshAmpl,700.0 mV", "PatientVThreshPW,0.4 ms", "ManualLeadImpedData.RVMsmt.Msmt,999.0 ohms", "InterPaceThreshResult.RVMsmt.Amplitude,1000.0 mV"),
        )
        val rv = report.leads.single { it.name == "RV" }
        assertEquals(500.0, rv.impedance?.value)
        assertEquals(0.7, rv.pacingThreshold?.value)
    }

    @Test
    fun `a non-numeric intrinsic result is no sensing value, not a wrong one`() {
        val report = parseBostonScientificBnk(bnk("ManualIntrinsicResult.RVMsmt.Msmt,Stimuliert"))
        assertNull(report.leads.single { it.name == "RV" }.sensing)
        assertNotNull(report.leads.single { it.name == "RV" })
    }
}

package io.github.alexanderlanganke.kardisynch.core.matching

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NearMatchPatientsTest {
    private fun patient(id: String, lastName: String, dob: String) = PatientIdentity(id, "First", lastName, dob)

    @Test
    fun `a patient sharing only the DOB is a near match`() {
        val candidates = listOf(patient("p1", "Smith", "1970-01-01"))
        val result = findNearMatchPatients(candidates, lastName = "Doe", dob = "1970-01-01")
        assertEquals(listOf("p1"), result.map { it.id })
    }

    @Test
    fun `a patient sharing only the last name is a near match`() {
        val candidates = listOf(patient("p1", "Doe", "1980-05-05"))
        val result = findNearMatchPatients(candidates, lastName = "Doe", dob = "1970-01-01")
        assertEquals(listOf("p1"), result.map { it.id })
    }

    @Test
    fun `an exact match on both is excluded, not a near match`() {
        val candidates = listOf(patient("p1", "Doe", "1970-01-01"))
        assertTrue(findNearMatchPatients(candidates, lastName = "Doe", dob = "1970-01-01").isEmpty())
    }

    @Test
    fun `a patient sharing neither is excluded`() {
        val candidates = listOf(patient("p1", "Smith", "1980-05-05"))
        assertTrue(findNearMatchPatients(candidates, lastName = "Doe", dob = "1970-01-01").isEmpty())
    }

    @Test
    fun `last name comparison is normalized (case, whitespace)`() {
        val candidates = listOf(patient("p1", "  doe ", "1980-05-05"))
        val result = findNearMatchPatients(candidates, lastName = "DOE", dob = "1970-01-01")
        assertEquals(listOf("p1"), result.map { it.id })
    }
}

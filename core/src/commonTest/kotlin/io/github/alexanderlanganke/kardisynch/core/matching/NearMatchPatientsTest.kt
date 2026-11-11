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

    private fun named(id: String, first: String, last: String, dob: String) = PatientIdentity(id, first, last, dob)

    @Test
    fun `same last name but a clearly different first name and DOB is another person, not a near match`() {
        val candidates = listOf(named("p1", "Erika", "Mustermann", "1950-09-15"))
        assertTrue(findNearMatchPatients(candidates, lastName = "Mustermann", dob = "1962-03-02", firstName = "Max").isEmpty())
    }

    @Test
    fun `same DOB but a clearly different first and last name is another person`() {
        val candidates = listOf(named("p1", "Erika", "Mustermann", "1950-09-15"))
        assertTrue(findNearMatchPatients(candidates, lastName = "Beispiel", dob = "1950-09-15", firstName = "Max").isEmpty())
    }

    @Test
    fun `same last name and same first name with a different DOB still asks (possible DOB typo)`() {
        val candidates = listOf(named("p1", "Erika", "Mustermann", "1950-09-15"))
        assertEquals(listOf("p1"), findNearMatchPatients(candidates, lastName = "Mustermann", dob = "1950-09-51", firstName = "Erika").map { it.id })
    }

    @Test
    fun `first name variants still ask`() {
        val candidates = listOf(named("p1", "Hans-Peter", "Muster", "1950-09-15"), named("p2", "Katharina", "Muster", "1950-09-15"))
        assertEquals(listOf("p1"), findNearMatchPatients(candidates, "Muster", "1961-01-01", "Hans").map { it.id })
        assertEquals(listOf("p2"), findNearMatchPatients(candidates, "Muster", "1961-01-01", "Catharina").map { it.id })
        assertEquals(listOf("p1"), findNearMatchPatients(candidates, "Muster", "1961-01-01", "H.").map { it.id })
    }

    @Test
    fun `a missing first name on either side keeps the near match (cannot tell)`() {
        val candidates = listOf(named("p1", "", "Mustermann", "1950-09-15"))
        assertEquals(listOf("p1"), findNearMatchPatients(candidates, "Mustermann", "1962-03-02", "Max").map { it.id })
        assertEquals(listOf("p1"), findNearMatchPatients(listOf(named("p2", "Erika", "Mustermann", "1950-09-15")).map { it.copy(id = "p1") }, "Mustermann", "1962-03-02", null).map { it.id })
    }
}

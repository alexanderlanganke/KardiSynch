package io.github.alexanderlanganke.kardisynch.core.matching

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PatientDuplicateDetectionTest {
    private fun patient(id: String, first: String, last: String, dob: String?, serials: List<String> = emptyList(), reportCount: Int = 0) =
        PatientSummary(id, first, last, dob, hospitalPatientId = null, reportCount = reportCount, lastReportDate = null, serials = serials)

    @Test
    fun `nameDistance is 0 for identical names ignoring case and whitespace`() {
        assertEquals(0, nameDistance("Doe", "doe"))
        assertEquals(0, nameDistance("Van Der Berg", "van  der  berg"))
    }

    @Test
    fun `nameDistance counts single-character edits`() {
        assertEquals(1, nameDistance("Smith", "Smyth"))
        assertEquals(2, nameDistance("Smith", "Smithee")) // 2 insertions
    }

    @Test
    fun `exact tier links patients with the same last name and DOB`() {
        val groups = findDuplicatePatientGroups(
            listOf(patient("1", "Jane", "Doe", "1970-01-01"), patient("2", "Jane", "Doe", "1970-01-01")),
        )
        assertEquals(1, groups.size)
        assertEquals(DupTier.EXACT, groups[0].tier)
        assertEquals(setOf("1", "2"), groups[0].patients.map { it.id }.toSet())
    }

    @Test
    fun `serial tier links patients sharing a device serial regardless of name`() {
        val groups = findDuplicatePatientGroups(
            listOf(
                patient("1", "Jane", "Doe", "1970-01-01", serials = listOf("SER123")),
                patient("2", "Janet", "Smith", "1971-02-02", serials = listOf("SER123")),
            ),
        )
        assertEquals(1, groups.size)
        assertEquals(DupTier.SERIAL, groups[0].tier)
        assertTrue(groups[0].reason.contains("SER123"))
    }

    @Test
    fun `dob-fuzzy-name tier links a same-DOB pair whose last names are close but not identical`() {
        val groups = findDuplicatePatientGroups(
            listOf(patient("1", "Jane", "Doe", "1970-01-01"), patient("2", "Jane", "Doeh", "1970-01-01")),
        )
        assertEquals(1, groups.size)
        assertEquals(DupTier.DOB_FUZZY_NAME, groups[0].tier)
    }

    @Test
    fun `name-close-dob tier links a same-surname pair whose DOB differs by a few days`() {
        val groups = findDuplicatePatientGroups(
            listOf(patient("1", "Jane", "Doe", "1970-01-01"), patient("2", "Janet", "Doe", "1970-01-03")),
        )
        assertEquals(1, groups.size)
        assertEquals(DupTier.NAME_CLOSE_DOB, groups[0].tier)
    }

    @Test
    fun `name-only is the fallback for same-surname pairs with unrelated DOBs`() {
        val groups = findDuplicatePatientGroups(
            listOf(patient("1", "Jane", "Doe", "1970-01-01"), patient("2", "Janet", "Doe", "1990-06-15")),
        )
        assertEquals(1, groups.size)
        assertEquals(DupTier.NAME_ONLY, groups[0].tier)
    }

    @Test
    fun `unrelated patients produce no group`() {
        val groups = findDuplicatePatientGroups(
            listOf(patient("1", "Jane", "Doe", "1970-01-01"), patient("2", "Bob", "Smith", "1990-06-15")),
        )
        assertTrue(groups.isEmpty())
    }

    @Test
    fun `transitively linked patients (A-B, B-C) are unioned into one group`() {
        // A and B share a serial; B and C are an exact name+DOB match. A and C
        // aren't directly linked at all, but should end up in the same group.
        val groups = findDuplicatePatientGroups(
            listOf(
                patient("a", "X", "Unrelated", "1900-01-01", serials = listOf("SHARED")),
                patient("b", "Y", "SameSurname", "1955-05-05", serials = listOf("SHARED")),
                patient("c", "Z", "SameSurname", "1955-05-05"),
            ),
        )
        assertEquals(1, groups.size)
        assertEquals(setOf("a", "b", "c"), groups[0].patients.map { it.id }.toSet())
    }

    @Test
    fun `the strongest tier across all pairs in a group wins, and the keeper suggestion is the highest report count`() {
        val groups = findDuplicatePatientGroups(
            listOf(
                patient("1", "Jane", "Doe", "1970-01-01", serials = listOf("SER1"), reportCount = 5),
                patient("2", "Jane", "Doe", "1970-01-01", reportCount = 1), // exact-tier link to #1
                patient("3", "Jane", "Doe", "1970-01-01", serials = listOf("SER1"), reportCount = 2), // serial-tier link to #1, exact to #2
            ),
        )
        assertEquals(1, groups.size)
        assertEquals(DupTier.EXACT, groups[0].tier, "exact outranks serial, so the group's tier should be the strongest link present")
        assertEquals("1", groups[0].patients.first().id, "highest report count should sort first as the suggested keeper")
    }

    @Test
    fun `groups are sorted strongest tier first`() {
        val groups = findDuplicatePatientGroups(
            listOf(
                // name-only pair
                patient("1", "A", "Weak", "1900-01-01"),
                patient("2", "B", "Weak", "2000-01-01"),
                // exact pair
                patient("3", "C", "Strong", "1970-01-01"),
                patient("4", "D", "Strong", "1970-01-01"),
            ),
        )
        assertEquals(2, groups.size)
        assertEquals(DupTier.EXACT, groups[0].tier)
        assertEquals(DupTier.NAME_ONLY, groups[1].tier)
    }
}

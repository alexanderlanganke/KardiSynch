package io.github.alexanderlanganke.kardisynch.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DobInputTest {
    @Test
    fun `accepts iso and german dates and normalises to iso`() {
        assertEquals("1950-09-15", normalizeDobInput("1950-09-15"))
        assertEquals("1950-09-15", normalizeDobInput("15.09.1950"))
        assertEquals("1950-09-05", normalizeDobInput(" 5.9.1950 "))
        assertEquals("1950-09-15", normalizeDobInput("15/09/1950"))
        assertEquals("1952-02-29", normalizeDobInput("29.02.1952"))
    }

    @Test
    fun `rejects things that are not calendar dates`() {
        assertNull(normalizeDobInput(""))
        assertNull(normalizeDobInput("1950-13-01"))
        assertNull(normalizeDobInput("31.04.1950"))
        assertNull(normalizeDobInput("29.02.1951"))
        assertNull(normalizeDobInput("15.09.50"))
        assertNull(normalizeDobInput("abc"))
    }
}

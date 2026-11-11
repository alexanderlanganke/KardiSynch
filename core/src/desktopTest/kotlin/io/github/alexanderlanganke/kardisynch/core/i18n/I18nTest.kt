package io.github.alexanderlanganke.kardisynch.core.i18n

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class I18nTest {
    @AfterTest fun reset() { I18n.lang = Lang.EN }

    @Test fun `english is the source text`() {
        I18n.lang = Lang.EN
        assertEquals("Visits (3)", tr("Visits ({n})", "n" to 3))
    }

    @Test fun `german translates and fills placeholders`() {
        I18n.lang = Lang.DE
        assertEquals("Kontrollen (3)", tr("Visits ({n})", "n" to 3))
        assertEquals("1 Kontrolle", trn(1, "{n} visit", "{n} visits"))
        assertEquals("9 Kontrollen", trn(9, "{n} visit", "{n} visits"))
    }

    @Test fun `a missing translation falls back to the english text`() {
        I18n.lang = Lang.DE
        assertEquals("A sentence nobody translated", tr("A sentence nobody translated"))
    }

    @Test fun `every translation keeps exactly the placeholders of its english text`() {
        val ph = Regex("""\{[a-z]+\}""")
        for ((en, de) in DE_STRINGS) {
            assertEquals(ph.findAll(en).map { it.value }.sorted().toList(), ph.findAll(de).map { it.value }.sorted().toList(), "placeholders differ for: $en")
        }
    }

    @Test fun `dates and decimals follow the language`() {
        I18n.lang = Lang.DE
        assertTrue(decimalSeparator() == ',')
        assertEquals("Okt.", monthAbbreviations()[9])
        assertEquals(Lang.DE, defaultLangFor("de-DE"))
        assertEquals(Lang.EN, defaultLangFor("fr"))
    }

    @Test fun `wahrnehmung and wahrnehmungsschwelle are never used as synonyms`() {
        // "Wahrnehmung" = the measured sensing amplitude; "Wahrnehmungsschwelle" = the programmed sensitivity (a setting).
        for ((en, de) in DE_STRINGS) {
            val measured = en.contains("sensing", ignoreCase = true) && !en.contains("threshold", ignoreCase = true)
            val setting = en.contains("sensing threshold", ignoreCase = true)
            if (measured) assertTrue(!de.contains("schwelle", ignoreCase = true), "the measured sensing must not be called a threshold: '$en' -> '$de'")
            if (setting) assertTrue(de.contains("Wahrnehmungsschwelle"), "the sensing threshold setting must be called Wahrnehmungsschwelle: '$en' -> '$de'")
        }
        I18n.lang = Lang.DE
        assertEquals("Wahrnehmung", tr("Sensing"))
        assertEquals("Reizschwelle", tr("Threshold"))
    }
}

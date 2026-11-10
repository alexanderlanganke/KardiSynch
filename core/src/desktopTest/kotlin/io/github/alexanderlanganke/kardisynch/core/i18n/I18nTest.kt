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
}

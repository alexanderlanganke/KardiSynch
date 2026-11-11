package io.github.alexanderlanganke.kardisynch.ui.detail

import io.github.alexanderlanganke.kardisynch.core.i18n.I18n
import io.github.alexanderlanganke.kardisynch.core.i18n.Lang
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

class TrendTileDeltaTest {
    @BeforeTest fun english() { I18n.lang = Lang.EN }

    @AfterTest fun reset() { I18n.lang = Lang.EN }

    private fun tile(vararg values: Double) =
        TrendTile("Battery voltage", "V", values.mapIndexed { i, v -> TrendPoint("2026-0${i + 1}-01", v, "S1") })

    @Test
    fun `a change below the shown precision is stable, not rising from 3-17 to 3-17`() {
        assertEquals("Stable, 3.17 V", tile(3.1704, 3.1731).deltaText)
    }

    @Test
    fun `rounding noise across several readings is stable`() {
        assertEquals("Stable, 3.17 V", tile(3.1701, 3.1698, 3.1712, 3.1689, 3.1731).deltaText)
    }

    @Test
    fun `a real fall reads falling from the first to the latest value`() {
        assertEquals("Falling, 3.15 to 2.97 V", tile(3.15, 3.10, 3.02, 2.97).deltaText)
    }

    @Test
    fun `a real rise reads rising from the first to the latest value`() {
        assertEquals("Rising, 2.97 to 3.15 V", tile(2.97, 3.02, 3.10, 3.15).deltaText)
    }

    @Test
    fun `values that differ only after rounding up are judged as shown`() {
        // 3.1749 shows as 3.17 and 3.1751 shows as 3.18: a real one-step difference on the screen.
        assertEquals("Rising, 3.17 to 3.18 V", tile(3.1749, 3.1751).deltaText)
    }

    @Test
    fun `a single reading says so`() {
        assertEquals("One reading", tile(3.17).deltaText)
    }
}

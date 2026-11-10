package io.github.alexanderlanganke.kardisynch.core.i18n

/** UI languages. English is the source language: every user-visible string in the code is its own English key. */
enum class Lang(val tag: String, val label: String) {
    EN("en", "English"),
    DE("de", "Deutsch"),
    ;

    companion object {
        fun fromTag(tag: String?): Lang? = entries.firstOrNull { it.tag == tag }
    }
}

/**
 * The current language. A plain variable on purpose: the app root sets it before composing and re-creates the
 * UI tree when it changes (`key(lang)`), so every string is re-read, whether it is produced in a composable or
 * in a plain function that builds text.
 */
object I18n {
    var lang: Lang = Lang.EN
}

/** Looks [en] up in the current language; a missing translation falls back to the English text, never to a blank. */
fun tr(en: String): String = if (I18n.lang == Lang.DE) DE_STRINGS[en] ?: en else en

/** [tr] with `{name}` placeholders filled in: `tr("Born {date}", "date" to x)`. Placeholders are part of the key. */
fun tr(en: String, vararg args: Pair<String, Any?>): String {
    var s = tr(en)
    for ((k, v) in args) s = s.replace("{$k}", v.toString())
    return s
}

/** One/other plural: `trn(n, "{n} visit", "{n} visits")`. German and English both use the 1 / not-1 rule. */
fun trn(n: Int, one: String, other: String): String = tr(if (n == 1) one else other, "n" to n)

/** Month abbreviations for [displayDate], and the decimal separator for numbers. */
fun monthAbbreviations(): List<String> =
    if (I18n.lang == Lang.DE) listOf("Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez.")
    else listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

fun decimalSeparator(): Char = if (I18n.lang == Lang.DE) ',' else '.'

/** The language to start with when none was chosen: German on a German system, otherwise English. */
fun defaultLangFor(systemLanguage: String?): Lang = if (systemLanguage?.lowercase()?.startsWith("de") == true) Lang.DE else Lang.EN

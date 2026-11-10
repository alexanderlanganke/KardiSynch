package io.github.alexanderlanganke.kardisynch.core.mri

/**
 * Manufacturer -> their own public MRI-conditional lookup tool, ported
 * from `mriCheckUrls.ts` (issue #175). This app never determines
 * MR-conditionality itself for any given device/lead model — the "MRI
 * check" UI has always just been a link out to the manufacturer's own web
 * tool, for the clinician to check by hand.
 */
private val MRI_CHECK_URLS: Map<String, String> = mapOf(
    "medtronic" to "https://www.medtronic.com/en-us/healthcare-professionals/mri-resources/mr-conditional-search-tool.html",
    "biotronik" to "https://www.promricheck.com",
    "abbott" to "https://mri.merlin.net/",
    "st. jude" to "https://mri.merlin.net/",
    "sjm" to "https://mri.merlin.net/",
    "boston scientific" to "https://www.bostonscientific.com/imageready/en-US/model-lookup.html",
    "guidant" to "https://www.bostonscientific.com/en-US/medical-specialties/electrophysiology/mri-resources.html",
    "microport" to "https://www.crm.microport.com/automri/en/cardiologist/tool",
    "sorin" to "https://www.crm.microport.com/automri/en/cardiologist/tool",
)

/** Case-insensitive substring match against [MRI_CHECK_URLS] (e.g. "St. Jude Medical" -> the "st. jude" entry) — mirrors `getMriCheckUrl`'s `includes()` check. */
fun mriCheckUrl(manufacturer: String?): String? {
    val manu = manufacturer?.lowercase()?.trim().orEmpty()
    if (manu.isEmpty()) return null
    return MRI_CHECK_URLS.entries.firstOrNull { (key, _) -> manu.contains(key) }?.value
}

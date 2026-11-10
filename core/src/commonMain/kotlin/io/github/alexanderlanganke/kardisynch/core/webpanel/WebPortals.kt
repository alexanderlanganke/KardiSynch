package io.github.alexanderlanganke.kardisynch.core.webpanel

/**
 * The manufacturer web portals, ported from the Electron app's integrated Web Panel. The native app does not
 * embed a browser: portals open in the clinician's own browser (where its password manager and saved
 * sessions work), and a downloaded report is picked up from the downloads folder and offered for import.
 * No credentials are stored here, ever.
 */
data class Portal(val label: String, val url: String, val manufacturer: String? = null)

data class PortalCategory(val title: String, val items: List<Portal>)

private const val CARELINK_EU = "https://europe.medtroniccarelink.net"
private const val CARELINK_US = "https://carelink.medtronic.com"

/** Same defaults as the Electron app: remote monitoring, MRI compatibility, advisories and recalls. [europe] picks the CareLink region. */
fun defaultPortalCategories(europe: Boolean = true): List<PortalCategory> = listOf(
    PortalCategory(
        "Remote monitoring",
        listOf(
            Portal("CareLink", if (europe) CARELINK_EU else CARELINK_US, "Medtronic"),
            Portal("Home Monitoring", "https://biotronik-homemonitoring.com", "Biotronik"),
            Portal("Merlin.net", "https://www.merlin.net", "Abbott"),
            Portal("LATITUDE", "https://www.latitude.bostonscientific.com", "Boston Scientific"),
        ),
    ),
    PortalCategory(
        "MRI compatibility",
        listOf(
            Portal("SureScan", "https://www.medtronic.com/us-en/healthcare-professionals/mri-resources/implantable-cardiac-devices/product-listing.html", "Medtronic"),
            Portal("ProMRI Check", "https://www.promricheck.com", "Biotronik"),
            Portal("MRI Safety", "https://www.cardiovascular.abbott/us/en/hcp/mri-safety.html", "Abbott"),
            Portal("ImageReady", "https://www.bostonscientific.com/imageready/en-EU/home.html", "Boston Scientific"),
        ),
    ),
    PortalCategory(
        "Advisories and recalls",
        listOf(
            Portal("BfArM", "https://www.bfarm.de/DE/Medizinprodukte/Aufgaben/Risikobewertung-und-Forschung/Massnahmen-von-Herstellern/_artikel.html"),
            Portal("FDA MAUDE", "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfmaude/search.cfm"),
        ),
    ),
)

/** Hosts whose downloads belong to a manufacturer's remote-monitoring service. A host matches itself and its subdomains. */
private val PORTAL_HOSTS: List<Pair<String, String>> = listOf(
    "medtroniccarelink.net" to "Medtronic", "carelink.medtronic.com" to "Medtronic", "medtronic.com" to "Medtronic",
    "biotronik-homemonitoring.com" to "Biotronik", "biotronik.com" to "Biotronik",
    "merlin.net" to "Abbott", "abbott.com" to "Abbott",
    "latitude.bostonscientific.com" to "Boston Scientific", "bostonscientific.com" to "Boston Scientific",
)

/** File types the Electron app intercepted from its web panel. */
val PORTAL_DOWNLOAD_EXTENSIONS: Set<String> = setOf("pdf", "zip")

/** A browser's unfinished download carries a temporary suffix; importing it would take a half-written file. */
fun isPartialDownload(fileName: String): Boolean {
    val n = fileName.lowercase()
    return PARTIAL_SUFFIXES.any { n.endsWith(it) } || n.startsWith(".")
}

private val PARTIAL_SUFFIXES = listOf(".crdownload", ".part", ".partial", ".tmp", ".download", ".opdownload")

fun isPortalDownloadType(fileName: String): Boolean =
    !isPartialDownload(fileName) && fileName.substringAfterLast('.', "").lowercase() in PORTAL_DOWNLOAD_EXTENSIONS

/** The host part of a URL, lower-case, or null when there is none. */
fun hostOf(url: String): String? =
    Regex("""^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^/@]*@)?([^/:?#]+)""").find(url.trim())?.groupValues?.get(1)?.lowercase()

/** The manufacturer whose portal [host] belongs to, or null for any other site. */
fun manufacturerForHost(host: String): String? {
    val h = host.lowercase()
    return PORTAL_HOSTS.firstOrNull { (d, _) -> h == d || h.endsWith(".$d") }?.second
}

/**
 * Windows records where a browser download came from in the file's `Zone.Identifier` stream
 * (`ReferrerUrl=` and `HostUrl=`); Linux browsers sometimes set `user.xdg.origin.url`. Pulls the URLs out of such text.
 */
fun parseOriginUrls(text: String): List<String> =
    text.lineSequence().mapNotNull { line ->
        val l = line.trim()
        when {
            l.startsWith("ReferrerUrl=", true) -> l.substringAfter('=')
            l.startsWith("HostUrl=", true) -> l.substringAfter('=')
            l.startsWith("http://", true) || l.startsWith("https://", true) -> l
            else -> null
        }
    }.filter { it.startsWith("http", true) }.toList()

/** The manufacturer a download came from, judged by its origin URLs; null when none is a known portal (or no origin is known). */
fun manufacturerForOrigins(urls: List<String>): String? = urls.firstNotNullOfOrNull { u -> hostOf(u)?.let(::manufacturerForHost) }

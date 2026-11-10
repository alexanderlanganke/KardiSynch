package io.github.alexanderlanganke.kardisynch.core.intake

/**
 * Boston Scientific (LATITUDE programmer / PACEART) USB exports are a per-patient
 * folder tree:
 *
 *     bsc/patientData/<Last>_<First>_<DDMMMYYYY>_<model>_<serial>/
 *         <hash>.bnk            structured interrogation export
 *         report/<Type>Report-<date>.pdf   printed reports, no patient in the file name
 *
 * The folder is the only location-based link between a PDF and its device, so the
 * intake keeps it: every file below one patient folder shares a [root] (for the
 * "same burst, same folder" fallback) and, when the file does not name a serial
 * itself, the folder's serial.
 *
 * Only model and serial are taken from the name. A name cannot be split reliably
 * ("Von_Muster_Anna") and the birth-date month is mojibake-prone ("MÃR").
 */
data class BostonPatientFolder(
    /** Path of the patient folder itself, `/`-separated. */
    val root: String,
    /** Short device model code such as `L231`. */
    val model: String,
    val serial: String,
)

private val patientFolderName = Regex("""^.+_\d{2}\S{3}\d{4}_(?<model>[A-Z]\d{3})_(?<serial>\d{4,})$""")

/**
 * The patient folder [path] lies in, or null. A `patientData` ancestor is required
 * so an unrelated folder that happens to look similar is never taken for one.
 */
fun bostonPatientFolder(path: String): BostonPatientFolder? {
    val parts = path.split('/', '\\')
    // The last segment is the file itself; only ancestors count.
    for (i in 0 until parts.size - 2) {
        if (!parts[i].equals("patientData", ignoreCase = true)) continue
        val m = patientFolderName.matchEntire(parts[i + 1]) ?: continue
        return BostonPatientFolder(
            root = parts.subList(0, i + 2).joinToString("/"),
            model = m.groups["model"]!!.value,
            serial = m.groups["serial"]!!.value,
        )
    }
    return null
}

/** [this] with the folder's serial filled in when the file names none. A serial the file does name always wins. */
fun DocumentFacts.withBostonFolder(folder: BostonPatientFolder?): DocumentFacts =
    if (folder == null || !serial.isNullOrBlank()) this else copy(serial = folder.serial)

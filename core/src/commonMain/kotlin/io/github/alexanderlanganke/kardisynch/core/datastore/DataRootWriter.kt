package io.github.alexanderlanganke.kardisynch.core.datastore

/**
 * Write-side counterpart to [DataRootReader]. NOT yet covered by the
 * advisory lock-file convention (see [generatePatientXml]/[generateVisitXml]'s
 * doc comment) — currently used only for additive new-visit creation
 * (QR-scan import), which never rewrites an existing patient/visit
 * directory.
 */
interface DataRootWriter {
    /** Creates a subdirectory under [parentHandle], returning its handle, or null on failure. */
    fun createDirectory(parentHandle: String, name: String): String?

    /** Writes [content] to a new file named [name] under [parentHandle]. Returns false on failure. */
    fun writeTextFile(parentHandle: String, name: String, content: String): Boolean
}

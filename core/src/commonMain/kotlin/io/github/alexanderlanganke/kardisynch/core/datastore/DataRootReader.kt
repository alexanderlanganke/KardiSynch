package io.github.alexanderlanganke.kardisynch.core.datastore

/**
 * One entry returned by [DataRootReader.listChildren] — deliberately opaque
 * about what [handle] actually is (a real filesystem path on desktop, a SAF
 * `content://` document URI on Android) so [DataRootIndexer] never has to
 * know or care which platform it's running on.
 */
data class DataEntry(val name: String, val handle: String, val isDirectory: Boolean)

/**
 * Platform abstraction over the `_DATA` root: desktop implements this with
 * real filesystem paths (java.nio), Android with a SAF tree URI
 * (`DocumentFile`, mirroring essentials_suite's `DirectoryLister.android.kt`
 * pattern — see the KMP migration plan).
 */
interface DataRootReader {
    fun listChildren(directoryHandle: String): List<DataEntry>
    fun readText(fileHandle: String): String?
}

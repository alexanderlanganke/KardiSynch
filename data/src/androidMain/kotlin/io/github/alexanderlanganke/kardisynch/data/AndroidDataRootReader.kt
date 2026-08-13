package io.github.alexanderlanganke.kardisynch.data

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootReader

/**
 * [directoryHandle]/[fileHandle] are SAF URI strings — Android's scoped
 * storage has no equivalent of a raw filesystem path here. The very first
 * handle a caller passes in (from `ACTION_OPEN_DOCUMENT_TREE`, granting
 * access to a folder — either a locally-synced copy or, more likely for a
 * shared `_DATA` store, one exposed by a separate SAF DocumentsProvider app
 * like CIFS Documents Provider mounting the SMB share, per the KMP
 * migration plan) is a genuine *tree* URI; every entry this class returns
 * afterward is a plain *document* URI. The two need different `DocumentFile`
 * factory methods, so [documentFileFor] dispatches on
 * [DocumentsContract.isTreeUri] rather than assuming one or the other —
 * mirrors essentials_suite's `DirectoryLister.android.kt`, adapted for
 * string-handle persistence (that version keeps the `DocumentFile` object
 * graph in memory during one recursive walk instead).
 */
class AndroidDataRootReader(private val context: Context) : DataRootReader {
    override fun listChildren(directoryHandle: String): List<DataEntry> {
        val dir = documentFileFor(Uri.parse(directoryHandle)) ?: return emptyList()
        return dir.listFiles().mapNotNull { entry ->
            val name = entry.name ?: return@mapNotNull null
            DataEntry(name = name, handle = entry.uri.toString(), isDirectory = entry.isDirectory)
        }
    }

    override fun readText(fileHandle: String): String? = try {
        context.contentResolver.openInputStream(Uri.parse(fileHandle))
            ?.use { it.readBytes().decodeToString() }
    } catch (e: Exception) {
        null
    }

    private fun documentFileFor(uri: Uri): DocumentFile? = if (DocumentsContract.isTreeUri(uri)) {
        DocumentFile.fromTreeUri(context, uri)
    } else {
        DocumentFile.fromSingleUri(context, uri)
    }
}

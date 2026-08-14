package io.github.alexanderlanganke.kardisynch.data

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootReader
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootWriter

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
class AndroidDataRootReader(private val context: Context) : DataRootReader, DataRootWriter {
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

    override fun createDirectory(parentHandle: String, name: String): String? {
        val parent = documentFileFor(Uri.parse(parentHandle)) ?: return null
        return parent.createDirectory(name)?.uri?.toString()
    }

    override fun writeTextFile(parentHandle: String, name: String, content: String): Boolean {
        val parent = documentFileFor(Uri.parse(parentHandle)) ?: return false
        val file = parent.createFile("text/xml", name) ?: return false
        return try {
            context.contentResolver.openOutputStream(file.uri)?.use { it.write(content.encodeToByteArray()) }
            true
        } catch (e: Exception) {
            false
        }
    }

    /** `DocumentFile.delete()` on a directory is recursive per SAF semantics — no extra work needed. */
    override fun deleteDirectory(directoryHandle: String): Boolean {
        val dir = documentFileFor(Uri.parse(directoryHandle)) ?: return false
        return dir.delete()
    }

    /**
     * SAF has no generic cross-provider move primitive that's guaranteed to
     * work (`DocumentsContract.moveDocument` requires specific tree
     * relationships some providers — like the CIFS Documents Provider this
     * class's own doc comment mentions — don't support), so this recursively
     * copies the directory's contents to the new location, then deletes the
     * source. Less efficient than desktop's atomic rename, but correct.
     */
    override fun moveDirectory(sourceHandle: String, newParentHandle: String, newName: String?): String? {
        val source = documentFileFor(Uri.parse(sourceHandle)) ?: return null
        val newParent = documentFileFor(Uri.parse(newParentHandle)) ?: return null
        val destName = newName ?: source.name ?: return null
        val dest = newParent.createDirectory(destName) ?: return null
        if (!copyContentsRecursively(source, dest)) return null
        source.delete()
        return dest.uri.toString()
    }

    private fun copyContentsRecursively(source: DocumentFile, dest: DocumentFile): Boolean {
        for (child in source.listFiles()) {
            val name = child.name ?: continue
            if (child.isDirectory) {
                val destChildDir = dest.createDirectory(name) ?: return false
                if (!copyContentsRecursively(child, destChildDir)) return false
            } else {
                val destChild = dest.createFile(child.type ?: "application/octet-stream", name) ?: return false
                try {
                    context.contentResolver.openInputStream(child.uri)?.use { input ->
                        context.contentResolver.openOutputStream(destChild.uri)?.use { output -> input.copyTo(output) }
                    }
                } catch (e: Exception) {
                    return false
                }
            }
        }
        return true
    }

    private fun documentFileFor(uri: Uri): DocumentFile? = if (DocumentsContract.isTreeUri(uri)) {
        DocumentFile.fromTreeUri(context, uri)
    } else {
        DocumentFile.fromSingleUri(context, uri)
    }
}

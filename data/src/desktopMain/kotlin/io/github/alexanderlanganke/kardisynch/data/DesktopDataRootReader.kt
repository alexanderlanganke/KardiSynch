package io.github.alexanderlanganke.kardisynch.data

import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootReader
import java.io.File

/** [directoryHandle]/[fileHandle] are plain absolute filesystem paths. */
class DesktopDataRootReader : DataRootReader {
    override fun listChildren(directoryHandle: String): List<DataEntry> {
        val children = File(directoryHandle).listFiles() ?: return emptyList()
        return children.map { DataEntry(name = it.name, handle = it.absolutePath, isDirectory = it.isDirectory) }
    }

    override fun readText(fileHandle: String): String? {
        val file = File(fileHandle)
        return if (file.isFile) file.readText(Charsets.UTF_8) else null
    }
}

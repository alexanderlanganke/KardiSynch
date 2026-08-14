package io.github.alexanderlanganke.kardisynch.data

import io.github.alexanderlanganke.kardisynch.core.datastore.DataRootWriter
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/** [directoryHandle]/[fileHandle] are plain absolute filesystem paths, matching [DesktopDataRootReader]. */
class DesktopDataRootWriter : DataRootWriter {
    override fun createDirectory(parentHandle: String, name: String): String? {
        val dir = File(parentHandle, name)
        return if (dir.mkdirs() || dir.isDirectory) dir.absolutePath else null
    }

    override fun writeTextFile(parentHandle: String, name: String, content: String): Boolean {
        val file = File(parentHandle, name)
        return try {
            val tmp = File(parentHandle, "$name.tmp-${System.nanoTime()}")
            tmp.writeText(content, Charsets.UTF_8)
            Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
            true
        } catch (e: Exception) {
            false
        }
    }

    override fun deleteDirectory(directoryHandle: String): Boolean {
        val dir = File(directoryHandle)
        return dir.isDirectory && dir.deleteRecursively()
    }

    override fun moveDirectory(sourceHandle: String, newParentHandle: String, newName: String?): String? {
        val source = File(sourceHandle)
        if (!source.isDirectory) return null
        val dest = File(newParentHandle, newName ?: source.name)
        return try {
            Files.move(source.toPath(), dest.toPath())
            dest.absolutePath
        } catch (e: Exception) {
            null
        }
    }
}

/**
 * Moves [sourceFile] into [visitDir] under a collision-free name, stripping
 * the `INTRAOP__` staging prefix some intraoperative-watcher paths add so it
 * never leaks into a stored filename. Ported from `storeFile`'s move step
 * (src/main/storage.ts): two same-day reports can carry identical basenames
 * (issue #145) — a byte-identical file is deduped (source deleted, `null`
 * returned instead of a path); a genuinely different one gets a numbered
 * suffix. `Files.move` (without `ATOMIC_MOVE`) already falls back to
 * copy+delete across filesystems on its own, so no manual EXDEV handling is
 * needed here the way the Node original required.
 */
fun storeIncomingFile(sourceFile: File, visitDir: File): File? {
    val destBaseName = sourceFile.name.removePrefix("INTRAOP__")
    val destPath = collisionFreeDestPath(visitDir, destBaseName, sourceFile) ?: run {
        sourceFile.delete()
        return null
    }
    Files.move(sourceFile.toPath(), destPath.toPath(), StandardCopyOption.REPLACE_EXISTING)
    return destPath
}

/**
 * Copies every file directly under [visitDir] into [destinationDir]
 * (created if missing) — mirrors Electron's `exportVisitFiles`. A plain
 * `File`-to-`File` copy, not routed through the `DataRootReader`/[DataRootWriter]
 * abstraction: those only expose text reads, which would corrupt a binary source file
 * (e.g. `.pdd`), and the destination is typically outside `_DATA` entirely
 * (a USB drive, a local export folder) so the shared-root abstraction
 * doesn't fit here anyway. Returns the number of files copied.
 */
fun exportVisitFiles(visitDir: File, destinationDir: File): Int {
    destinationDir.mkdirs()
    val files = visitDir.listFiles { f -> f.isFile } ?: return 0
    var copied = 0
    for (file in files) {
        file.copyTo(File(destinationDir, file.name), overwrite = true)
        copied++
    }
    return copied
}

private fun collisionFreeDestPath(visitDir: File, baseName: String, sourceFile: File): File? {
    val ext = baseName.substringAfterLast('.', "")
    val stem = if (ext.isEmpty()) baseName else baseName.removeSuffix(".$ext")
    var i = 0
    while (true) {
        val candidateName = if (i == 0) baseName else if (ext.isEmpty()) "${stem}_${i + 1}" else "${stem}_${i + 1}.$ext"
        val candidate = File(visitDir, candidateName)
        if (!candidate.exists()) return candidate
        if (candidate.length() == sourceFile.length() && candidate.readBytes().contentEquals(sourceFile.readBytes())) {
            return null
        }
        i++
    }
}

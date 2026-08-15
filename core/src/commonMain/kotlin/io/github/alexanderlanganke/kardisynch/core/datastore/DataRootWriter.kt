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

    /** Recursively deletes the directory at [directoryHandle]. Returns false on failure, including if it doesn't exist. */
    fun deleteDirectory(directoryHandle: String): Boolean

    /**
     * Moves the directory at [sourceHandle] to become a child of [newParentHandle],
     * keeping its original name unless [newName] is given (for collision avoidance
     * at the destination). Returns the moved directory's new handle, or null on failure.
     */
    fun moveDirectory(sourceHandle: String, newParentHandle: String, newName: String? = null): String?

    /** Writes binary [content] to a new file named [name] under [parentHandle]. Returns false on failure — the binary counterpart to [writeTextFile] (report-level dedup, Phase 6). */
    fun writeBytes(parentHandle: String, name: String, content: ByteArray): Boolean

    /**
     * Moves the single file at [fileHandle] to become a child of [newParentHandle],
     * keeping its original name unless [newName] is given. Returns the moved
     * file's new handle, or null on failure — [moveDirectory]'s single-file
     * counterpart, needed to merge one visit directory's files into another's
     * without touching the rest of either directory (Phase 6).
     */
    fun moveFile(fileHandle: String, newParentHandle: String, newName: String? = null): String?

    /** Deletes the single file at [fileHandle]. Returns false on failure, including if it doesn't exist — [deleteDirectory]'s single-file counterpart (Phase 6). */
    fun deleteFile(fileHandle: String): Boolean
}

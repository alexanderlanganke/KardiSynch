package io.github.alexanderlanganke.kardisynch.data

import io.github.alexanderlanganke.kardisynch.core.lock.DirectoryLock
import io.github.alexanderlanganke.kardisynch.core.lock.LOCK_FILE_NAME
import io.github.alexanderlanganke.kardisynch.core.lock.LockAcquisitionException
import io.github.alexanderlanganke.kardisynch.core.lock.LockInfo
import io.github.alexanderlanganke.kardisynch.core.lock.decodeLockInfo
import io.github.alexanderlanganke.kardisynch.core.lock.encodeLockInfo
import io.github.alexanderlanganke.kardisynch.core.lock.isStale
import java.io.File
import java.net.InetAddress
import java.nio.charset.StandardCharsets
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.StandardOpenOption

/**
 * Real desktop-filesystem [DirectoryLock]: `Files.newByteChannel` with
 * `CREATE_NEW` is the JVM's exclusive-create primitive (fails with
 * [FileAlreadyExistsException] instead of silently overwriting), matching
 * Node's `fs.open(path, 'wx')` on the Electron side of this same convention
 * (see [io.github.alexanderlanganke.kardisynch.core.lock.DirectoryLock]'s
 * doc comment).
 */
class DesktopDirectoryLock(
    private val acquireTimeoutMs: Long = 10_000L,
    private val retryIntervalMs: Long = 150L,
) : DirectoryLock {
    private val host: String by lazy { runCatching { InetAddress.getLocalHost().hostName }.getOrDefault("unknown-host") }

    override fun <T> withLock(directoryHandle: String, operation: String, block: () -> T): T {
        val lockFile = File(directoryHandle, LOCK_FILE_NAME)
        acquire(lockFile, operation)
        try {
            return block()
        } finally {
            lockFile.delete()
        }
    }

    private fun acquire(lockFile: File, operation: String) {
        val deadline = System.currentTimeMillis() + acquireTimeoutMs
        while (true) {
            val info = LockInfo(owner = "kmp-desktop", host = host, pid = currentPid(), acquiredAtMs = System.currentTimeMillis(), operation = operation)
            try {
                Files.newByteChannel(lockFile.toPath(), setOf(StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)).use { channel ->
                    channel.write(java.nio.ByteBuffer.wrap(encodeLockInfo(info).toByteArray(StandardCharsets.UTF_8)))
                }
                return
            } catch (e: FileAlreadyExistsException) {
                // fall through to staleness check below
            }

            val existing = runCatching { lockFile.readText(StandardCharsets.UTF_8) }.getOrNull()?.let(::decodeLockInfo)
            if (existing == null || isStale(existing, System.currentTimeMillis())) {
                lockFile.delete()
                continue
            }

            if (System.currentTimeMillis() >= deadline) {
                throw LockAcquisitionException(
                    "Timed out waiting for _DATA lock on ${lockFile.parent} (held by ${existing.owner}@${existing.host}, operation: ${existing.operation})",
                )
            }
            Thread.sleep(retryIntervalMs)
        }
    }

    private fun currentPid(): Long? = runCatching { ProcessHandle.current().pid() }.getOrNull()
}

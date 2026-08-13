package io.github.alexanderlanganke.kardisynch.core.lock

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Advisory lock-file convention for `_DATA` writes (migration plan Decision
 * 4). `_DATA` can live on a shared SMB mount that both this KMP client and
 * the Electron app write to — a read-merge-write (e.g. reading the existing
 * `visit.xml`/`patient.xml`, merging, then writing it back — see
 * [io.github.alexanderlanganke.kardisynch.core.matching.mergeReports])
 * racing a concurrent write from the other client can silently lose data.
 * There's no reliable OS-level file lock across SMB/cross-platform, so this
 * is a *convention*: a sentinel file both clients create-exclusive before
 * touching a patient directory, and delete when done. It's advisory, not
 * enforced — a non-participating client can still corrupt data — but every
 * write path in this app goes through it.
 *
 * One lock per *patient directory* (not per-visit, not global): every write
 * this protects ultimately reads/writes that patient's `patient.xml` and/or
 * a `visit.xml` nested under it, so locking the patient directory covers the
 * whole read-merge-write regardless of which file(s) it touches, while still
 * letting unrelated patients' writes proceed concurrently.
 *
 * Electron's retrofit (`src/main/utils/dataLock.ts`) uses the exact same
 * file name, JSON shape, and staleness timeout so either client can tell
 * what's holding a lock it's waiting on.
 */

const val LOCK_FILE_NAME = ".kardisynch.lock"
const val LOCK_STALE_AFTER_MS = 30_000L

@Serializable
data class LockInfo(
    val v: Int = 1,
    val owner: String,
    val host: String,
    val pid: Long? = null,
    val acquiredAtMs: Long,
    val operation: String,
)

fun encodeLockInfo(info: LockInfo): String = Json.encodeToString(LockInfo.serializer(), info)

/** Null on any malformed/foreign content — treated by callers the same as a lock that's about to be stolen. */
fun decodeLockInfo(json: String): LockInfo? = try {
    Json.decodeFromString(LockInfo.serializer(), json)
} catch (e: Exception) {
    null
}

fun isStale(info: LockInfo, nowMs: Long, staleAfterMs: Long = LOCK_STALE_AFTER_MS): Boolean =
    nowMs - info.acquiredAtMs > staleAfterMs

/**
 * Serializes a read-merge-write against a shared `_DATA` directory another
 * client might be writing to concurrently. [NoOpDirectoryLock] is the
 * correct choice for callers that only ever create a brand-new directory
 * additively (never read-merge-write into an existing one — e.g. the
 * QR-scan-to-new-visit flow) and for platforms without a reliable
 * exclusive-create primitive (Android SAF has none — see
 * [io.github.alexanderlanganke.kardisynch.core.datastore.DataRootWriter]'s
 * doc comment on why that's still safe for its current additive-only use).
 */
interface DirectoryLock {
    fun <T> withLock(directoryHandle: String, operation: String, block: () -> T): T
}

object NoOpDirectoryLock : DirectoryLock {
    override fun <T> withLock(directoryHandle: String, operation: String, block: () -> T): T = block()
}

class LockAcquisitionException(message: String) : Exception(message)

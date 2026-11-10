package io.github.alexanderlanganke.kardisynch.core.lock

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DirectoryLockTest {
    @Test
    fun `round-trips through JSON`() {
        val info = LockInfo(owner = "kmp-desktop", host = "my-host", pid = 1234L, acquiredAtMs = 1_700_000_000_000L, operation = "importReport:patient=abc")
        val decoded = decodeLockInfo(encodeLockInfo(info))
        assertEquals(info, decoded)
    }

    @Test
    fun `decodeLockInfo returns null for malformed content`() {
        assertNull(decodeLockInfo("not json"))
        assertNull(decodeLockInfo("{}"))
    }

    @Test
    fun `a lock younger than the staleness window is not stale`() {
        val info = LockInfo(owner = "electron", host = "h", acquiredAtMs = 1000L, operation = "op")
        assertFalse(isStale(info, nowMs = 1000L + LOCK_STALE_AFTER_MS, staleAfterMs = LOCK_STALE_AFTER_MS))
    }

    @Test
    fun `a lock older than the staleness window is stale`() {
        val info = LockInfo(owner = "electron", host = "h", acquiredAtMs = 1000L, operation = "op")
        assertTrue(isStale(info, nowMs = 1000L + LOCK_STALE_AFTER_MS + 1, staleAfterMs = LOCK_STALE_AFTER_MS))
    }

    @Test
    fun `NoOpDirectoryLock just runs the block`() {
        var ran = false
        val result = NoOpDirectoryLock.withLock("any/handle", "op") {
            ran = true
            "value"
        }
        assertTrue(ran)
        assertEquals("value", result)
    }
}

package io.github.alexanderlanganke.kardisynch.data

import io.github.alexanderlanganke.kardisynch.core.lock.LOCK_FILE_NAME
import io.github.alexanderlanganke.kardisynch.core.lock.LockAcquisitionException
import io.github.alexanderlanganke.kardisynch.core.lock.LockInfo
import io.github.alexanderlanganke.kardisynch.core.lock.encodeLockInfo
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DesktopDirectoryLockTest {
    private lateinit var dir: File

    @BeforeTest
    fun setUp() {
        dir = Files.createTempDirectory("kardisynch-lock-test").toFile()
    }

    @AfterTest
    fun tearDown() {
        dir.deleteRecursively()
    }

    @Test
    fun `acquires and releases, leaving no lock file behind`() {
        val lock = DesktopDirectoryLock()
        val result = lock.withLock(dir.absolutePath, "test-op") { "done" }
        assertEquals("done", result)
        assertFalse(File(dir, LOCK_FILE_NAME).exists())
    }

    @Test
    fun `releases the lock even when the block throws`() {
        val lock = DesktopDirectoryLock()
        assertFailsWith<IllegalStateException> {
            lock.withLock(dir.absolutePath, "test-op") { throw IllegalStateException("boom") }
        }
        assertFalse(File(dir, LOCK_FILE_NAME).exists())
    }

    @Test
    fun `steals a stale lock instead of waiting out the full timeout`() {
        val staleInfo = LockInfo(owner = "electron", host = "other-host", acquiredAtMs = 0L, operation = "old-op")
        File(dir, LOCK_FILE_NAME).writeText(encodeLockInfo(staleInfo))

        val lock = DesktopDirectoryLock(acquireTimeoutMs = 2_000)
        val start = System.currentTimeMillis()
        val result = lock.withLock(dir.absolutePath, "new-op") { "acquired" }
        val elapsed = System.currentTimeMillis() - start

        assertEquals("acquired", result)
        assertTrue(elapsed < 2_000, "Stealing a stale lock should be near-instant, took ${elapsed}ms")
    }

    @Test
    fun `times out with a diagnostic error when a fresh lock is held by someone else`() {
        val freshInfo = LockInfo(owner = "electron", host = "other-host", acquiredAtMs = System.currentTimeMillis(), operation = "busy-op")
        File(dir, LOCK_FILE_NAME).writeText(encodeLockInfo(freshInfo))

        val lock = DesktopDirectoryLock(acquireTimeoutMs = 500, retryIntervalMs = 100)
        val error = assertFailsWith<LockAcquisitionException> {
            lock.withLock(dir.absolutePath, "new-op") { "unreachable" }
        }
        assertTrue(error.message!!.contains("electron"))
        assertTrue(error.message!!.contains("busy-op"))
    }

    @Test
    fun `a second acquirer waits for the first to release, then proceeds`() = runBlocking {
        val lock = DesktopDirectoryLock(acquireTimeoutMs = 5_000, retryIntervalMs = 50)
        val order = mutableListOf<String>()

        val holder = launch {
            lock.withLock(dir.absolutePath, "first") {
                order.add("first-start")
                Thread.sleep(300)
                order.add("first-end")
            }
        }
        delay(50) // let the first holder acquire before the second tries
        val waiter = launch {
            lock.withLock(dir.absolutePath, "second") {
                order.add("second-start")
            }
        }
        holder.join()
        waiter.join()

        assertEquals(listOf("first-start", "first-end", "second-start"), order)
    }
}

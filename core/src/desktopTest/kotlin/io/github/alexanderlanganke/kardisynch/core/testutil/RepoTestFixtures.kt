package io.github.alexanderlanganke.kardisynch.core.testutil

import org.junit.Assume.assumeTrue
import java.io.File

/**
 * Locates the KardiSynch repo's `test/` fixture directory (real, anonymized
 * manufacturer export samples — abbott_logfiles, "boston bnk", "microport
 * xml", "medtronic pdd files", "Biotronik xml", "medtronic pkg`) by walking
 * up from the current working directory. Not copied into this KMP project:
 * referencing the original directory avoids duplicating hundreds of sample
 * files into a second location.
 */
private fun locateRepoTestDir(): File? {
    var dir = File(System.getProperty("user.dir")).absoluteFile
    repeat(8) {
        val candidate = File(dir, "test")
        if (candidate.isDirectory && File(candidate, "Biotronik xml").isDirectory) return candidate
        dir = dir.parentFile ?: return@repeat
    }
    return null
}

/**
 * Returns the real fixture directory, or marks the calling test as skipped
 * (not failed) if it isn't available. The directory is gitignored — it only
 * exists in the original checkout, not a fresh clone or CI (issue #181) —
 * so a test built on it can't be a hard failure when it's absent.
 */
fun findRepoTestDirOrSkip(): File {
    val dir = locateRepoTestDir()
    assumeTrue(
        "Skipping: the real test/ fixture directory isn't available in this checkout " +
            "(gitignored real manufacturer samples, only present in the original clone).",
        dir != null,
    )
    return dir!!
}

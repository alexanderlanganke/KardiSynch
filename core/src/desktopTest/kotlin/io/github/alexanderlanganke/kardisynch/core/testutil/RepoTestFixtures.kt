package io.github.alexanderlanganke.kardisynch.core.testutil

import java.io.File

/**
 * Locates the KardiSynch repo's `test/` fixture directory (real, anonymized
 * manufacturer export samples — abbott_logfiles, "boston bnk", "microport
 * xml", "medtronic pdd files", "Biotronik xml", "medtronic pkg`) by walking
 * up from the current working directory. Not copied into this KMP project:
 * referencing the original directory avoids duplicating hundreds of sample
 * files into a second location.
 */
fun findRepoTestDir(): File {
    var dir = File(System.getProperty("user.dir")).absoluteFile
    repeat(8) {
        val candidate = File(dir, "test")
        if (candidate.isDirectory && File(candidate, "Biotronik xml").isDirectory) return candidate
        dir = dir.parentFile ?: return@repeat
    }
    error(
        "Could not locate the KardiSynch test/ fixture directory by walking up from " +
            System.getProperty("user.dir"),
    )
}

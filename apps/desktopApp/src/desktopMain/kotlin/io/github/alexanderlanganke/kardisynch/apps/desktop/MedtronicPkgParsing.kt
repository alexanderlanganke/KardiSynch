package io.github.alexanderlanganke.kardisynch.apps.desktop

import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.parsers.medtronic.parseMedtronicXml
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream

/**
 * Extracts and parses `Public/PublicDiscreteData.xml` from a Medtronic
 * `.pkg` zip archive (issue #170) — the desktop-only companion to
 * [io.github.alexanderlanganke.kardisynch.core.parsers.medtronic.parseMedtronicXml],
 * which can't do the unzipping itself (`java.util.zip` isn't reachable
 * from `core`'s commonMain — see that function's doc comment).
 *
 * Reads the zip fully into memory and streams entries looking for the one
 * path it needs, rather than extracting everything to a temp directory the
 * way the Electron original (`adm-zip`) did. That original needed a temp
 * dir because it also pulled a companion PDF out of the same archive as a
 * patient/device-identity fallback — not ported here (no PDF text
 * extraction anywhere in this port yet) — which sidesteps its own
 * "retrying the temp-dir cleanup because a PDF library still has a handle
 * open" workaround (that was itself a fix for a real bug, issue #132)
 * entirely: there's no temp directory to clean up.
 *
 * Returns null if the archive has no `Public/PublicDiscreteData.xml` entry,
 * or if that entry doesn't parse as Medtronic's Encore XML schema.
 */
fun parseMedtronicPkg(bytes: ByteArray): UnifiedReport? {
    ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
        var entry = zip.nextEntry
        while (entry != null) {
            if (!entry.isDirectory && entry.name.replace('\\', '/').equals("Public/PublicDiscreteData.xml", ignoreCase = true)) {
                val xml = zip.readBytes().toString(Charsets.UTF_8)
                return parseMedtronicXml(xml)
            }
            entry = zip.nextEntry
        }
    }
    return null
}

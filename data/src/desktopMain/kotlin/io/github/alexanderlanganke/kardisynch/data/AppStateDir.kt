package io.github.alexanderlanganke.kardisynch.data

import java.io.File

/**
 * Where the app keeps its own state (the local index `database.db`, settings, the default import folder, the USB
 * manifest). Resolved in this order:
 *
 *  1. `KARDISYNCH_STATE_DIR`, for tests and unusual setups;
 *  2. inside a Flatpak sandbox (`FLATPAK_ID` is set), the app's private `$XDG_DATA_HOME/kardisynch`. A Flatpak that
 *     is granted the home folder sees the REAL home, so without this it would silently read and rewrite the
 *     `~/.kardisynch` of any other copy of the app;
 *  3. otherwise `~/.kardisynch`, as before.
 */
fun appStateDir(): File {
    System.getenv("KARDISYNCH_STATE_DIR")?.takeIf { it.isNotBlank() }?.let { return File(it) }
    if (System.getenv("FLATPAK_ID") != null) {
        System.getenv("XDG_DATA_HOME")?.takeIf { it.isNotBlank() }?.let { return File(it, "kardisynch") }
    }
    return File(System.getProperty("user.home"), ".kardisynch")
}

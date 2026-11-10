# Releasing KardiSynch (native app, v3.x)

## Cutting a release
1. Set `kardisynch.version` in `gradle.properties` (e.g. `3.0.1`) and commit.
2. `git tag v3.0.1 && git push origin v3.0.1`.
3. `KMP Release` builds the Windows app, runs the same self-test and GUI start-up check as
   `KMP Windows Desktop Build`, makes the installer, and publishes the GitHub release with
   `KardiSynch-Setup-<v>.exe`, a portable zip, `SHA256SUMS.txt` and `latest.yml`.
   A tag with a suffix (`v3.1.0-beta.1`) becomes a pre-release; those are only offered to users who tick
   "Include beta versions" in Settings.
4. The workflow refuses to run if the tag and `kardisynch.version` differ.

## How installed copies find out
* **Native app (3.x):** checks `GET /repos/alexanderlanganke/KardiSynch/releases` at start-up (at most daily, can be turned
  off), ignores drafts, ignores the Electron line (`v2.*`), picks the newest version above its own that carries
  an installer, downloads it only after the user taps *Install and restart*, verifies SHA-256 against
  `SHA256SUMS.txt`, starts it silently (`/S --updated`) and exits. The installer replaces the files and starts the
  app again. This needs the repository to be public (an unauthenticated API call).
* **Electron app (2.x):** its own `electron-updater` reads `latest.yml` from the latest release, so the first `v3.*`
  release reaches every installed Electron app as an ordinary update. The installer it downloads removes the
  Electron version (`packaging/windows/installer.nsi`), installs the native app, and starts it.

## What the first start of the native app does for a former Electron user
* Reads `%APPDATA%\kardisynch\database.db` (a copy; read-only) and takes over: the `_DATA` folder, the import
  folder, USB folders, theme, "onboarding done". The `_DATA` folder itself is not modified by the import.
* Rebuilds its local index from `_DATA` (read-only on `_DATA`). Stored visits are **not** re-read automatically,
  neither here nor after any upgrade, because that rewrites `visit.xml` in the clinic's data. To apply a
  parser fix to existing data once, run a debug start with `KARDISYNCH_REPARSE_ALL=1` (or use Settings >
  "Re-read all visits").
* Not carried over: the Web Panel and its stored logins (the native app has no web panel yet).

## Important
* Rollback: the last Electron installer stays on its release page. `_DATA` was never converted, so going back
  is possible; the native app only adds data the Electron app ignores.

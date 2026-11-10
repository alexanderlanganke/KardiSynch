# Intake pipeline: from files on a drive or share to visits

Files arrive in the import folder (directly, from a USB drive via `UsbWatcher`, or from a network share) and
`ImportWatcher` turns them into visits. The unit of work is a **bundle**: the files that describe one interrogation.

1. **Scan** the import folder recursively (never the app's own `_unmatched`, `_pending_sort`, `_duplicates`).
2. **Settle**: size and modified time unchanged across two checks, older than `minFileAgeMs`, readable.
3. **Fingerprint** with SHA-256. Content that is already imported *and whose stored copy still exists* is a
   duplicate (moved to `_duplicates`, never deleted). If the visit was deleted, the file imports again.
4. **Identify and parse** (`parseForIntake`): `core/intake/FileIdentification.kt` decides kind, manufacturer and a
   0 to 99 confidence from the file's *content*, with the evidence behind it. The name is a weak hint only. PDFs
   are read with PDFBox and `extractPdfFacts` (a port of Electron's heuristics).
5. **Bundle** (`groupIntoBundles`): by facts, never by in-memory state. Same device serial within 30 minutes, a shared
   base name, or same patient and day. Files that contradict each other are never bundled.
6. **Resolve and commit** once per bundle through `resolvePatientIdentity`. Confident: import. Otherwise queue in
   `PendingSortTasks` with the bundle id and the evidence. A PDF with no data file attaches to an existing visit of the
   same device and day, or becomes a partial visit of a patient already on file, or is queued: a name regex over PDF
   text is never enough to create a patient.

Every file gets a row in `IntakeFiles` (states: `committed`, `attached`, `pending`, `unrecognised`, `duplicate`,
`error`, `ignored`), so nothing disappears into a folder. The Inbox screen shows it.

## Adding or fixing a manufacturer

1. Add a `FileKind` and a detector in `identifyFile` (a strong content signature, then weak hints).
2. Route it in `dispatchParse`.
3. Add a fixture generator to `core/testing/MockExportFixtures.kt` and cases to `IntakeTest`.
4. For PDFs, add keywords to `PDF_MANUFACTURER_KEYWORDS` and, if the file name encodes patient/serial/date, a pattern
   in `DocumentFacts.kt`.

Run it against real files first: every raw file already inside `_DATA/Reports/<patient>/<visit>/` is a labelled
example (the visit you assigned it to), so identification accuracy can be measured without any new labelling.

## Boston Scientific bulk exports

A LATITUDE programmer / PACEART USB export is a per-patient folder tree:

    bsc/patientData/<Last>_<First>_<DDMMMYYYY>_<model>_<serial>/
        <hash>.bnk
        report/<Type>Report-<date>.pdf      (no patient in the file name)

* `core/intake/BostonExport.kt` keeps that folder: every file below one patient folder shares it as its bundling
  scope (so the `.bnk` and the PDFs in `report/` are "the same folder"), and a PDF that names no serial gets the
  folder's. Only model and serial are taken from the folder name, never the patient name or birth date.
* `extractPdfFacts` reads the LATITUDE header: `Last, First` (compound surnames allowed), `Geburtsdatum 15 Sep 1950`,
  `Bericht erstel. <date>` (the print day, which is the session's own day; "Letzte Abfrage in der Praxis" is the
  *previous* visit and is ignored) and `Aggregat <model> <code>/ <serial>`.
* `.bn_` files (same PACEART text as `.bnk`) are not imported; see the open question in the release notes.


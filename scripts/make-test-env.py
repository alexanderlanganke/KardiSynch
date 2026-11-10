#!/usr/bin/env python3
"""Builds a ready-to-use KardiSynch test environment from the real sample corpus.

    scripts/make-test-env.py <corpus-dir> <target-dir> [--seed-settings <database.db>]

<corpus-dir> is the `test/` folder of the original checkout (real exports of every manufacturer).
Nothing from the corpus is ever written into the repository; this script only copies files into
<target-dir>:

  _DATA/Reports/     empty data root (the app fills it)
  _IMPORT/           first batch: imported when the app starts
  drop-later/        second batch to drag into _IMPORT to watch intake live: PDFs that arrive before
                     their data file, opaque file names, subfolders, duplicates of batch one, damaged files
  usb-source/        a simulated USB stick (set as a USB source) and usb-target/ (its target folder)

--seed-settings writes the folder settings into an existing KardiSynch database (created by starting
the app once), so the app opens straight onto this environment.
"""
import os, random, re, shutil, sqlite3, sys

def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("corpus")
    ap.add_argument("target")
    ap.add_argument("--seed-settings", metavar="DATABASE")
    ns = ap.parse_args()
    corpus, target, db = ns.corpus, ns.target, ns.seed_settings
    rnd = random.Random(20261109)

    def files(sub, exts):
        d = os.path.join(corpus, sub)
        return sorted(os.path.join(d, f) for f in os.listdir(d) if f.rsplit(".", 1)[-1].lower() in exts)

    pair_rx = re.compile(r"^(?:[A-Za-z]+_)?[0-9a-fA-F-]{36}_(.+?)-([A-Z0-9]+)-[A-Za-z]+-(\d{2}_[A-Za-z]{3}_\d{4}_\d{2}_\d{2}_\d{2}_\d{3})\.")
    pairs = {}
    for f in files("medtronic pkg", {"pkg", "pdf"}):
        m = pair_rx.match(os.path.basename(f))
        if m:
            pairs.setdefault(m.groups(), {})[f.rsplit(".", 1)[-1].lower()] = f
    pairs = [v for v in pairs.values() if "pkg" in v and "pdf" in v]
    rnd.shuffle(pairs)
    bio, pdd, bnk, log, mp = (files("Biotronik xml", {"xml"}), files("medtronic pdd files", {"pdd"}), files("boston bnk", {"bnk"}),
                              files("abbott_logfiles", {"log"}), files("microport xml", {"xml"}))
    for l in (bio, pdd, bnk, log, mp):
        rnd.shuffle(l)

    for d in ("_DATA/Reports", "_IMPORT", "drop-later", "usb-source", "usb-target"):
        os.makedirs(os.path.join(target, d), exist_ok=True)
    put = lambda src, sub, name=None: shutil.copy2(src, os.path.join(target, sub, name or os.path.basename(src)))

    # batch one: imported when the app starts
    batch_one = []
    for p in pairs[:25]:
        put(p["pkg"], "_IMPORT"); put(p["pdf"], "_IMPORT"); batch_one += [p["pkg"], p["pdf"]]
    for src in bio[:20] + pdd[:8] + bnk[:5] + log[:5] + mp[:4]:
        put(src, "_IMPORT"); batch_one.append(src)

    # batch two: to drop in later
    os.makedirs(os.path.join(target, "drop-later", "workstation-1"), exist_ok=True)
    os.makedirs(os.path.join(target, "drop-later", "share-2026-11-10"), exist_ok=True)
    n = 0
    for i, p in enumerate(pairs[25:37]):
        n += 1
        if i % 3 == 0:   # the PDF first, with an opaque name: it must wait for its data file
            put(p["pdf"], "drop-later/workstation-1", "scan_%04d.pdf" % n)
            put(p["pkg"], "drop-later/share-2026-11-10")
        elif i % 3 == 1:
            put(p["pkg"], "drop-later/workstation-1", "export (%d).pkg" % n)
            put(p["pdf"], "drop-later/workstation-1", "IMG_%04d.PDF" % n)
        else:
            put(p["pkg"], "drop-later/share-2026-11-10"); put(p["pdf"], "drop-later/share-2026-11-10")
    for src in bio[20:28]:
        put(src, "drop-later/workstation-1")
    for k, src in enumerate(rnd.sample(batch_one, 4)):       # the same content again: must be skipped as duplicates
        put(src, "drop-later", "copy_of_%d.%s" % (k + 1, src.rsplit(".", 1)[-1]))
    # damaged files: must never be imported
    junk = bytearray(rnd.randbytes(3000))
    open(os.path.join(target, "drop-later", "damaged_random.pdf"), "wb").write(junk)
    first_xml = open(bio[0], "rb").read()
    open(os.path.join(target, "drop-later", "damaged_truncated.xml"), "wb").write(first_xml[: len(first_xml) // 3])
    open(os.path.join(target, "drop-later", "note.txt"), "w").write("not a device report\n")

    # a simulated USB stick
    for p in pairs[37:42]:
        put(p["pkg"], "usb-source"); put(p["pdf"], "usb-source")
    for src in bio[28:33] + pdd[8:12] + log[5:8]:
        put(src, "usb-source")

    counts = {d: sum(len(fs) for _, _, fs in os.walk(os.path.join(target, d))) for d in ("_IMPORT", "drop-later", "usb-source")}
    print("test environment in", target, counts)

    if db:
        con = sqlite3.connect(db)
        rows = {"dataRootPath": os.path.join(target, "_DATA"), "importDirPath": os.path.join(target, "_IMPORT"),
                "usbSourceDirs": os.path.join(target, "usb-source"), "usbTargetDir": os.path.join(target, "usb-target"),
                "onboardingCompleted": "true"}
        for k, v in rows.items():
            con.execute("INSERT OR REPLACE INTO Settings(key, value) VALUES (?, ?)", (k, v))
        con.commit(); con.close()
        print("settings written to", db)

main()

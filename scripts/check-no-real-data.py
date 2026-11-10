#!/usr/bin/env python3
"""Fails when the repository contains something that looks like real patient data or a secret.

    scripts/check-no-real-data.py                       # allowlist mode (CI, pre-push): needs nothing but the repo
    scripts/check-no-real-data.py --corpus <dir> ...    # local only: also cross-reference the REAL sample exports

Allowlist mode flips the usual logic: every birth-date-like date, patient-name-like pair, device-serial-like value,
email, private IP and home path in a tracked text file must be listed in scripts/real-data-allowlist.txt (invented
values only). Anything unlisted fails, so a real value we never heard of is still caught.

Corpus mode reads the real exports (filenames, text, UTF-16 text, PDF text, .pkg members) and fails if any name,
birth date or identifier found there also appears in the repository. The corpus is only ever read; nothing from it is
stored, and every finding is printed masked (first character + length), never as a value.

Exit status 0 = clean, 1 = findings, 2 = usage error.
"""
import argparse
import collections
import os
import re
import subprocess
import sys
import unicodedata
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ALLOWLIST = os.path.join(HERE, "real-data-allowlist.txt")
SKIP_EXT = re.compile(r"\.(png|jpg|jpeg|gif|ico|webp|traineddata|jar|zip|woff2?|db|sqlite|pdf|lock)$", re.I)
SKIP_PATH = re.compile(r"(^|/)(scripts/real-data-allowlist\.txt|scripts/check-no-real-data\.py|gradlew(\.bat)?|LICENSE)$")

MONTHS = {"jan": 1, "feb": 2, "mar": 3, "mär": 3, "mrz": 3, "apr": 4, "mai": 5, "may": 5, "jun": 6, "jul": 7,
          "aug": 8, "sep": 9, "okt": 10, "oct": 10, "nov": 11, "dez": 12, "dec": 12}
LET = "A-Za-zÀ-ÖØ-öø-ÿ"


def mask(v):
    v = str(v)
    return v[:1] + "*" * (len(v) - 1) + f" (len {len(v)})"


def tracked_files(root):
    try:
        out = subprocess.check_output(["git", "-C", root, "ls-files", "-z"], stderr=subprocess.DEVNULL).decode()
        files = [f for f in out.split("\0") if f]
        if files:
            return files
    except Exception:
        pass
    files = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in (".git", "node_modules", "build", ".gradle", ".kotlin")]
        for f in fn:
            files.append(os.path.relpath(os.path.join(dp, f), root))
    return files


def read_text(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except Exception:
        return None


# ---------------------------------------------------------------- dates

def iso_variants(text):
    """Every date in [text] as ISO strings (both day/month orders when ambiguous) with the year, for years <= 2010."""
    out = []
    for m in re.finditer(r"(?<!\d)(19\d{2}|20[01]\d)-(\d{2})-(\d{2})(?!\d)", text):
        y, mo, d = m.groups()
        out.append((m.start(), f"{y}-{mo}-{d}"))
        out.append((m.start(), f"{y}-{d}-{mo}"))  # the invalid-by-design "1950-15-09" style used in date tests
    for m in re.finditer(r"(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](19\d{2}|20[01]\d)(?!\d)", text):
        a, b, y = m.groups()
        out.append((m.start(), f"{y}-{int(b):02d}-{int(a):02d}"))
        out.append((m.start(), f"{y}-{int(a):02d}-{int(b):02d}"))
    for m in re.finditer(rf"(?<!\d)(\d{{1,2}})\.?\s?([{LET}]{{3,9}})\.?\s?(19\d{{2}}|20[01]\d)(?!\d)", text):
        d, mon, y = m.groups()
        k = mon.lower()[:3]
        if k in MONTHS:
            out.append((m.start(), f"{y}-{MONTHS[k]:02d}-{int(d):02d}"))
    for m in re.finditer(rf"([{LET}]{{3,9}})\.?\s(\d{{1,2}}),?\s(19\d{{2}}|20[01]\d)(?!\d)", text):
        mon, d, y = m.groups()
        k = mon.lower()[:3]
        if k in MONTHS:
            out.append((m.start(), f"{y}-{MONTHS[k]:02d}-{int(d):02d}"))
    return out


# ---------------------------------------------------------------- patterns (allowlist mode)

NAME_PAIR = re.compile(
    rf"""['"(>:=]\s*([A-ZÄÖÜ][{LET}'-]+(?:[ _-][A-ZÄÖÜ][{LET}'-]+)?),[ _]?([A-ZÄÖÜ][{LET}'-]+)\s*['"<)\\\n]"""
)
NAME_FIELD = re.compile(
    rf"""(?:"(?:last_?name|first_?name|lastName|firstName|patient_?name)"\s*:\s*"([^"]{{2,40}})"|"""
    rf"""<(?:\w+:)?(?:Last|First|Family|Given)[A-Za-z]*Name[^>]*>([^<]{{2,40}})<|"""
    rf"""(?:PatientLastName|PatientFirstName),([{LET} '-]{{2,40}}))"""
)
MDT_SERIAL = re.compile(r"\b[A-Z]{3}\d{6}[A-Z]\b")
MDT_FILE = re.compile(rf"[{LET}_'-]+,_[{LET}_'-]+-[A-Z0-9]{{8,10}}-")
BSC_FOLDER = re.compile(r"\b[\w-]+_[\w-]+_\d{2}[A-Za-z?Ã]{3}\d{4}_[A-Z]\d{3}_\d{4,}\b")
SERIAL_KV = re.compile(
    r"""(?i)(?:serial(?:[_ ]?number)?|seriennummer|\bsn)["']?\s*[:=,>]\s*["']?([A-Z0-9][A-Z0-9-]{4,})"""
)
SYNTHETIC_SERIAL = re.compile(
    r"(?i)(123|321|456|654|789|987|000|999|111|222|abc|xyz|dev|anon|mock|test|fake|demo|sample|legacy|other|second|"
    r"manual|lead|dup|first|old|new|^pm|^ld|^rv|^lv|^ra|^bio)"
)
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[a-z]{2,}")
PRIVATE_IP = re.compile(r"\b(?:100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b")
HOME_PATH = re.compile(r"(?:/home|/Users)/[A-Za-z][\w.-]*|[A-Za-z]:\\Users\\\w+")
SECRETS = [
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("github token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("aws key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("google key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("password literal", re.compile(r"""(?i)\b(?:store|key)?password\s*[:=]\s*["'][^"'\s]{4,}["']""")),
]


def load_allowlist():
    allow = collections.defaultdict(set)
    if not os.path.exists(ALLOWLIST):
        return allow
    for line in open(ALLOWLIST, encoding="utf-8"):
        line = line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        kind, value = line.split(":", 1)
        allow[kind.strip().lower()].add(value.strip().lower())
    return allow


def check_allowlist(root, files, allow, findings):
    for rel in files:
        if SKIP_EXT.search(rel) or SKIP_PATH.search(rel):
            continue
        text = read_text(os.path.join(root, rel))
        if text is None:
            continue
        for ln, line in enumerate(text.splitlines(), 1):
            def add(kind, value):
                findings.append((rel, ln, kind, value))

            by_pos = collections.defaultdict(list)
            for pos, iso in iso_variants(line):
                by_pos[pos].append(iso)
            for pos, variants in by_pos.items():
                if not any(v in allow["date"] for v in variants):
                    add("date<=2010 not in allowlist", variants[0])
            for m in NAME_PAIR.finditer(line):
                last, first = m.group(1), m.group(2)
                toks = [t.lower() for t in re.split(r"[ _-]", last)] + [first.lower()]
                if f"{last}, {first}".lower() in allow["pair"]:
                    continue
                if not all(t in allow["name"] for t in toks):
                    add("name pair not in allowlist", f"{last}, {first}")
            for m in NAME_FIELD.finditer(line):
                v = next(g for g in m.groups() if g)
                if v.startswith("${") or v.startswith("$"):
                    continue  # a template placeholder, not a value
                toks = [t.lower() for t in re.split(r"[ ,_-]+", v.strip()) if len(t) > 1]
                if not all(t in allow["name"] for t in toks):
                    add("name field not in allowlist", v)
            for m in MDT_SERIAL.finditer(line):
                if m.group(0).lower() not in allow["serial"] and not SYNTHETIC_SERIAL.search(m.group(0)):
                    add("device serial not in allowlist", m.group(0))
            for m in SERIAL_KV.finditer(line):
                v = m.group(1)
                if (sum(c.isdigit() for c in v) >= 4 and v.lower() not in allow["serial"]
                        and not SYNTHETIC_SERIAL.search(v) and not re.fullmatch(r"[A-Z0-9-]{5,}", v) is None
                        and not v.isalpha()):
                    add("serial-like value not in allowlist", v)
            for m in MDT_FILE.finditer(line):
                if m.group(0).lower() not in allow["filename"]:
                    add("manufacturer file name with a name not in allowlist", m.group(0))
            for m in BSC_FOLDER.finditer(line):
                if m.group(0).lower() not in allow["filename"]:
                    add("Boston patient folder name not in allowlist", m.group(0))
            for m in EMAIL.finditer(line):
                if m.group(0).lower() not in allow["email"] and not m.group(0).lower().endswith("@users.noreply.github.com"):
                    add("email not in allowlist", m.group(0))
            for m in PRIVATE_IP.finditer(line):
                if m.group(0) not in allow["ip"]:
                    add("private IP not in allowlist", m.group(0))
            for m in HOME_PATH.finditer(line):
                if m.group(0).lower() not in allow["path"]:
                    add("home path not in allowlist", m.group(0))
            for label, rx in SECRETS:
                if rx.search(line):
                    add(f"secret: {label}", "(redacted)")


# ---------------------------------------------------------------- corpus mode

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


def decode_all(b):
    outs = []
    for enc in ("utf-8", "utf-16le", "latin-1"):
        try:
            outs.append(b.decode(enc, "replace"))
        except Exception:
            pass
    return outs


def corpus_texts(path):
    name = os.path.basename(path)
    yield name
    low = path.lower()
    try:
        if low.endswith(".pdf"):
            t = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, timeout=40).stdout
            yield t
            return
        data = open(path, "rb").read(12_000_000)
    except Exception:
        return
    for t in decode_all(data):
        yield t
    if low.endswith((".pkg", ".zip")) and zipfile.is_zipfile(path):
        try:
            with zipfile.ZipFile(path) as z:
                for n in z.namelist():
                    yield n
                    if n.lower().endswith((".xml", ".txt", ".pdd", ".log", ".json")):
                        for t in decode_all(z.read(n)[:6_000_000]):
                            yield t
        except Exception:
            pass


RARE_MAX_FILES = 10**9  # no rarity filter: a real patient's DOB or serial appears in dozens of that patient's own files


def collect_corpus(dirs):
    tokens, dates, pairs = collections.Counter(), collections.Counter(), collections.Counter()
    lasts = collections.Counter()
    files = 0
    name_rx = (
        (re.compile(r"PatientLastName,([^\r\n]+)[\s\S]{0,3000}?PatientFirstName,([^\r\n]+)"), (1, 2)),
        (re.compile(rf"([{LET}'][{LET}' -]{{1,30}}),\s?([{LET}'][{LET}' -]{{1,25}})"), (1, 2)),
        (re.compile(rf"([{LET}][{LET}-]{{1,30}}(?:_[{LET}-]{{2,25}})*),_([{LET}-]{{2,25}})-[A-Z0-9]{{8,10}}-"), (1, 2)),
        (re.compile(rf"BIOSTD_[\d_-]+_([{LET}-]+)_([{LET}-]+)_\d+"), (1, 2)),
        (re.compile(rf"([{LET}][{LET}'_-]+)_([{LET}][{LET}'_-]+)_\d{{2}}[A-Za-z?\u00c3]{{3}}\d{{4}}_[A-Z]\d{{3}}_\d+"), (1, 2)),
    )
    for d in dirs:
        for dp, _, fn in os.walk(d):
            for f in fn:
                if f.startswith(".") or f.endswith("^"):
                    continue
                files += 1
                ft, fd, fp, fl = set(), set(), set(), set()
                for text in corpus_texts(os.path.join(dp, f)):
                    ft |= {t for t in re.findall(r"[A-Za-z0-9]{6,}", text)
                           if sum(c.isdigit() for c in t) >= 4 and not re.fullmatch(r"(.)\1+|0+\d?", t)}
                    fd |= {iso for _, iso in iso_variants(text)}
                    for ri, (rx, (li, fi)) in enumerate(name_rx):
                        for m in rx.finditer(text[:2_000_000]):
                            a = (m.group(li) or "").strip()
                            b2 = (m.group(fi) or "").strip()
                            if a and b2 and 2 <= len(a) <= 32 and 2 <= len(b2) <= 26 and " " not in b2:
                                fp.add((norm(a), norm(b2)))
                                if ri != 1:  # the generic 'Cap, Cap' extractor is too noisy for surname-only matching
                                    for part in re.split(r"[ _-]+", a):
                                        if len(norm(part)) >= 5:
                                            fl.add(norm(part))
                tokens.update(ft)
                dates.update(fd)
                pairs.update(fp)
                lasts.update(fl)
    return files, tokens, dates, pairs, lasts


def check_corpus(root, files, dirs, findings, allow):
    nfiles, tokens, dates, pairs, lasts = collect_corpus(dirs)
    rare_t = {t for t, c in tokens.items() if c <= RARE_MAX_FILES}
    rare_d = {d for d, c in dates.items() if c <= RARE_MAX_FILES}
    codeword = re.compile(r"name|patient|lead|model|serial|mock|hospital|dob|equals|isblank")
    rare_p = {p for p, c in pairs.items() if c <= RARE_MAX_FILES and len(p[0]) >= 3 and len(p[1]) >= 2
              and not codeword.search(p[0] + p[1])}
    surnames = {n for n in lasts if n not in allow["name"]}
    print(f"corpus: {nfiles} files read; matching against {len(rare_t)} identifiers, {len(rare_d)} dates (<=2010), "
          f"{len(rare_p)} name pairs, {len(surnames)} surnames", file=sys.stderr)
    by_last = collections.defaultdict(set)
    for last, first in rare_p:
        by_last[last].add(first)
    for rel in files:
        if SKIP_EXT.search(rel) or SKIP_PATH.search(rel):
            continue
        text = read_text(os.path.join(root, rel))
        if text is None:
            continue
        for ln, line in enumerate(text.splitlines(), 1):
            for t in set(re.findall(r"[A-Za-z0-9]{6,}", line)):
                if t in rare_t and t.lower() not in allow["ident"] and t.lower() not in allow["serial"]:
                    findings.append((rel, ln, "CORPUS: identifier also found in real samples", t))
            for _, iso in iso_variants(line):
                if iso in rare_d and iso not in allow["date"]:
                    findings.append((rel, ln, "CORPUS: date also found in real samples (<=2010)", iso))
            words = {norm(w) for w in re.findall(rf"[{LET}'-]{{3,}}", line)}
            for last in words & by_last.keys():
                for first in by_last[last] & words:
                    if last in allow["name"] and first in allow["name"]:
                        continue  # placeholders the samples themselves are anonymised with (Doe, John, ...)
                    findings.append((rel, ln, "CORPUS: name pair also found in real samples", f"{last} {first}"))
            for w in words & surnames:
                findings.append((rel, ln, "CORPUS: surname also found in real samples", w))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=ROOT)
    ap.add_argument("--corpus", action="append", default=[])
    ap.add_argument("--show", action="store_true", help="print values unmasked (allowlist findings only)")
    args = ap.parse_args()
    root = os.path.abspath(args.root)
    files = tracked_files(root)
    findings = []
    allow = load_allowlist()
    check_allowlist(root, files, allow, findings)
    if args.corpus:
        check_corpus(root, files, args.corpus, findings, allow)
    by = collections.Counter(k for _, _, k, _ in findings)
    for rel, ln, kind, value in sorted(set(findings)):
        shown = value if (args.show and not kind.startswith("CORPUS")) else mask(value)
        print(f"{rel}:{ln}: {kind}: {shown}")
    print(f"\n{len(set(findings))} finding(s) in {len(files)} files" + ("" if not by else "  " + str(dict(by))))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())

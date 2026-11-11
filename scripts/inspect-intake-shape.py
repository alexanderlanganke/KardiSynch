#!/usr/bin/env python3
"""Prints the SHAPE of intake files (never their content), to see why KardiSynch does not recognise them.

    scripts/inspect-intake-shape.py <file-or-folder> [...]

Safe to run on real patient data and to paste the output into an issue: it emits counts, booleans and masked line
shapes only (digits -> 9, letters -> a/A, the 0x1C separator -> |). Mirrors the checks in
core/.../intake/FileIdentification.kt, so "detected: no" tells you which signature is missing.
"""
import os, re, subprocess, sys

def shape(line, n=40):
    out = []
    for ch in line[:n]:
        out.append("|" if ch == "\x1c" else "9" if ch.isdigit() else "a" if ch.islower() else "A" if ch.isupper() else ch if ch in " :,.-_/()" else "?")
    return "".join(out)

def inspect_log(b):
    bom = "utf-16le" if b[:2] == b"\xff\xfe" else "utf-16be" if b[:2] == b"\xfe\xff" else "utf-8-bom" if b[:3] == b"\xef\xbb\xbf" else "none"
    try: head = b[:16384].decode("utf-8"); valid = True
    except UnicodeDecodeError: head = b[:16384].decode("utf-8", "replace"); valid = False
    lines = [l for l in head.split("\n") if l.strip()]
    delimited = len(re.findall(r"(?m)^\d{2,5}\x1c", head)) >= 3
    concat = len(lines) >= 10 and sum(1 for l in lines if re.match(r"^\d{2,5}[A-Z]", l)) / len(lines) > 0.7
    print(f"  bom={bom} utf8_valid={valid} crlf={b'\r\n' in b[:4000]} bytes_0x1C={b.count(b'\x1c')} nul_bytes={b.count(0)}")
    print(f"  coded_lines_with_0x1C(first 16K)={len(re.findall(r'(?m)^\d{2,5}\x1c', head))} lines={len(lines)}")
    print(f"  detected_as_abbott_log={'yes' if delimited or concat else 'NO'}  (delimited={delimited}, concatenated={concat})")
    for l in lines[:4]: print("  line shape:", shape(l))

def inspect_pdf(path):
    try:
        text = subprocess.run(["pdftotext", "-q", path, "-"], capture_output=True, text=True, timeout=30).stdout
    except FileNotFoundError:
        print("  (pdftotext not installed: cannot check the text layer)"); return
    low = text.lower()
    print(f"  text_chars={len(text.strip())} has_text_layer={'yes' if text.strip() else 'NO (scanned image?)'}")
    for name, kws in {"Abbott": ["abbott", "st. jude", "merlin"], "Medtronic": ["medtronic", "carelink"], "Biotronik": ["biotronik"], "Boston": ["boston scientific", "latitude"]}.items():
        print(f"  mentions {name}: {any(k in low for k in kws)}")
    print(f"  has 'patient' label: {'patient' in low}   has 'serial' label: {'serial' in low}   has date-like value: {bool(re.search(r'\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}', text))}")

def main():
    paths = []
    for a in sys.argv[1:]:
        if os.path.isdir(a):
            paths += [os.path.join(d, f) for d, _, fs in os.walk(a) for f in sorted(fs)]
        else:
            paths.append(a)
    for i, p in enumerate(paths, 1):
        ext = p.rsplit(".", 1)[-1].lower() if "." in os.path.basename(p) else "-"
        print(f"[{i}] .{ext}  {os.path.getsize(p)} bytes  depth_below_arg={p.count(os.sep) - sys.argv[1].rstrip(os.sep).count(os.sep)}")
        if ext == "pdf": inspect_pdf(p)
        elif ext in ("log", "txt"): inspect_log(open(p, "rb").read())
        else: print("  (not a type this tool inspects)")

if __name__ == "__main__":
    main()

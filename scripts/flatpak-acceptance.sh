#!/usr/bin/env bash
# Acceptance run of the INSTALLED KardiSynch Flatpak against the real sample corpus.
#   scripts/flatpak-acceptance.sh <corpus-dir> [test-env-dir]
# Resets the app's own sandbox data and the test environment (never the host's ~/.kardisynch), starts the app,
# waits for the first import, drops the second batch in live, restarts the app, and reports counts, errors in
# the app log, and any file that ended up with the wrong patient. Exits non-zero on a failed check.
set -u
CORPUS=${1:?corpus dir}; ENV=${2:-$HOME/KardiSynch-Test}
APP=io.github.alexanderlanganke.kardisynch
DB=$HOME/.var/app/$APP/data/kardisynch/database.db
LOG=/tmp/kardisynch-flatpak.log
HERE=$(cd "$(dirname "$0")" && pwd)
fail=0
note() { echo "== $*"; }
check() { if [ "$2" = "ok" ]; then echo "  PASS  $1"; else echo "  FAIL  $1 ($2)"; fail=1; fi; }
q() { python3 - "$DB" "$1" <<'PY'
import sqlite3,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
r=c.execute(sys.argv[2]).fetchall()
print(r[0][0] if len(r)==1 and len(r[0])==1 else r)
PY
}
states() { python3 - "$DB" <<'PY'
import sqlite3,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
print(dict(c.execute("select state,count(*) from IntakeFiles group by state")))
PY
}
wait_quiet() { # wait until the ledger count is stable for 25 s and the import folder holds nothing to process
  local last=-1 same=0 n
  for _ in $(seq 1 90); do
    n=$(q "select count(*) from IntakeFiles"); left=$(find "$ENV/_IMPORT" -type f -not -path "*/_unmatched/*" -not -path "*/_pending_sort/*" -not -path "*/_duplicates/*" | wc -l)
    if [ "$n" = "$last" ] && [ "$left" = 0 ]; then same=$((same+1)); else same=0; fi
    last=$n; [ $same -ge 5 ] && return 0; sleep 5
  done; return 1; }

note "reset"
flatpak kill $APP 2>/dev/null; sleep 1
rm -rf "$HOME/.var/app/$APP/data/kardisynch"; rm -rf "$ENV"/{_DATA,_IMPORT,drop-later,usb-source,usb-target}
python3 "$HERE/make-test-env.py" "$CORPUS" "$ENV" | tail -1
HOSTSUM=$(sha256sum ~/.kardisynch/database.db 2>/dev/null | cut -c1-16)

note "first start (creates the app's own database), then seed the folder settings"
: > $LOG; (flatpak run $APP >>$LOG 2>&1 &)
for _ in $(seq 1 40); do [ -f "$DB" ] && break; sleep 1; done; sleep 5; flatpak kill $APP; sleep 2
python3 "$HERE/make-test-env.py" "$CORPUS" "$ENV" --seed-settings "$DB" | tail -1

note "start on the test environment: first batch (_IMPORT + USB stick)"
(flatpak run $APP >>$LOG 2>&1 &)
for _ in $(seq 1 20); do sleep 2; W=$(xdotool search --onlyvisible --name "KardiSynch" 2>/dev/null | head -1); [ -n "$W" ] && break; done
check "the window opens" "$([ -n "${W:-}" ] && echo ok || echo none)"
wait_quiet; check "first import settles" "$([ $? = 0 ] && echo ok || echo timeout)"
echo "  ledger: $(states)  patients=$(q 'select count(*) from Patients') visits=$(q 'select count(*) from Reports')"
FIRST=$(q "select count(*) from IntakeFiles")

note "second batch dropped in live (PDFs first, opaque names, subfolders, duplicates, damaged files)"
cp -r "$ENV"/drop-later/. "$ENV"/_IMPORT/
wait_quiet; check "second import settles" "$([ $? = 0 ] && echo ok || echo timeout)"
echo "  ledger: $(states)  patients=$(q 'select count(*) from Patients') visits=$(q 'select count(*) from Reports')"
check "the 4 exact duplicates were recognised" "$([ "$(q "select count(*) from IntakeFiles where state='duplicate'")" -ge 4 ] && echo ok || echo "$(q "select count(*) from IntakeFiles where state='duplicate'")")"
check "damaged files were not imported" "$([ "$(q "select count(*) from IntakeFiles where fileName like 'damaged_%' and state in ('committed','attached')")" = 0 ] && echo ok || echo imported)"
check "the damaged and non-report files are visible as unrecognised" "$([ "$(q "select count(*) from IntakeFiles where state='unrecognised'")" -ge 3 ] && echo ok || echo "$(q "select count(*) from IntakeFiles where state='unrecognised'")")"
check "nothing is left unprocessed" "$([ "$(find "$ENV/_IMPORT" -type f -not -path "*/_unmatched/*" -not -path "*/_pending_sort/*" -not -path "*/_duplicates/*" | wc -l)" = 0 ] && echo ok || echo left)"
check "no import errors" "$([ "$(q "select count(*) from IntakeFiles where state='error'")" = 0 ] && echo ok || echo "$(q "select message from IntakeFiles where state='error' limit 2" | cut -c1-120)")"

note "restart: state must persist and nothing may be imported twice"
VIS=$(q "select count(*) from Reports"); flatpak kill $APP; sleep 3; (flatpak run $APP >>$LOG 2>&1 &); sleep 25
check "visits unchanged after restart" "$([ "$(q 'select count(*) from Reports')" = "$VIS" ] && echo ok || echo changed)"
check "no content imported twice" "$([ "$(q "select count(*) from (select sha256 from IntakeFiles where state in ('committed','attached') group by sha256 having count(*)>1)")" = 0 ] && echo ok || echo twice)"

note "wrong-patient check: every attached/committed Medtronic file must sit with the patient named in its file name"
python3 - "$DB" <<'PY' || fail=1
import sqlite3,sys,re
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
rx=re.compile(r'(?:^|_)([A-Za-zÀ-ÿ\' -]+?),_([A-Za-zÀ-ÿ\' -]+?)-[A-Z0-9]+-[A-Za-z]+-\d{2}_[A-Za-z]{3}_\d{4}')
checked=wrong=0
for fn,last in c.execute("select i.fileName,p.lastName from IntakeFiles i join Patients p on p.id=i.patientId where i.state in ('committed','attached')"):
    m=rx.search(fn)
    if not m: continue
    checked+=1
    if m.group(1).replace('_',' ').strip().lower().split()[-1]!=last.lower().split()[-1]: wrong+=1
print(f"  checked {checked} files by the name in their file name; mismatches: {wrong}")
sys.exit(1 if wrong else 0)
PY

note "app log"
errs=$(grep -c -i -E "Uncaught exception|SQLITE_BUSY|OutOfMemory|FATAL" $LOG)
check "no uncaught exception, lock error or crash in the app log" "$([ "$errs" = 0 ] && echo ok || echo "$errs lines")"
check "host database untouched" "$([ "$(sha256sum ~/.kardisynch/database.db 2>/dev/null | cut -c1-16)" = "$HOSTSUM" ] && echo ok || echo changed)"
echo; [ $fail = 0 ] && echo "ACCEPTANCE PASSED" || echo "ACCEPTANCE FAILED"
exit $fail

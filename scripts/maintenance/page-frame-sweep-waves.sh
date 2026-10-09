#!/usr/bin/env bash
# Run the page-frame sweep (#5876) in waves, with a by-eye review of the frames
# each wave actually wrote before the next one starts.
#
# Each wave: page-frame-sweep.mjs --apply on the next N books (checkpointed), then
# page-frame-dry-run.mjs --written-since draws two contact sheets of what it wrote
# (30 random framed pages, and the 18 most-cropped), then a headless Claude job
# looks at them and writes OK or STOP. Anything other than OK — a STOP, no verdict
# within an hour, the sweep's error-rate guard (exit 3), a crash — stops the run,
# comments on the issue and pages Derek's phone. Re-running resumes from the
# checkpoint; delete <dir>/STOP first.
#
# Usage (from the checkout root, on a job host, under tmux or systemd-run):
#   scripts/maintenance/page-frame-sweep-waves.sh <state-dir> <wave sizes...>
#   e.g. ... /data/scratch/sl/page-frame-sweep 3000      (every wave 3000 books)
# The last size repeats until no candidate books are left.
#
# PRIOR ART: scripts/maintenance/page-frame-sweep.mjs — the per-book writer this
# drives (one pass, no review between batches); scripts/audit/page-frame-dry-run.mjs
# — the contact sheets, reused here in its --written-since review mode.
set -u
DIR=${1:?state dir}; shift
[ $# -gt 0 ] || { echo "need at least one wave size" >&2; exit 2; }
SIZES=("$@")
ENVF=${ENVF:-/root/sourcelibrary/.env.production.local}
ISSUE=${ISSUE:-5876}
NTFY=${NTFY:-https://ntfy.sh/sourcelibrary-uptime}
JOB=${JOB:-/root/bin/claude-job.sh}
mkdir -p "$DIR"
CK=$DIR/done.txt STOP=$DIR/STOP

note() {  # one line to the log and the issue
  echo "$(date -u +%FT%TZ) $1" | tee -a "$DIR/waves.log"
  gh issue comment "$ISSUE" --body "page-frame sweep: $1" >/dev/null 2>&1 || echo "  (issue comment failed)"
}
say() {  # ... and to Derek's phone: stops and completion only — both need him, so they buzz (#6181)
  note "$1"
  curl -s -m 20 -H "Title: page-frame sweep" -H "Priority: high" -d "$1" "$NTFY" >/dev/null || true
}

# Preflight: the checkout must parse and still frame the reference page (page 13
# of the Bodhicaryavatara, checked by eye) before any wave writes.
node --check scripts/maintenance/page-frame-sweep.mjs || { say "preflight: sweep script does not parse"; exit 2; }
node --env-file="$ENVF" scripts/maintenance/page-frame-sweep.mjs --book=6a308272675ed2bdbe36f649 --pages=13 2>&1 \
  | grep -q 'pages=1 framed=1' || { say "preflight: reference page 13 no longer frames; detector broken?"; exit 2; }

i=0
while :; do
  [ -e "$STOP" ] && { say "stopped before wave $((i + 1)): $(cat "$STOP")"; exit 0; }
  n=${SIZES[$i]:-${SIZES[${#SIZES[@]}-1]}}
  i=$((i + 1)); W=$DIR/wave-$i; mkdir -p "$W"
  start=$(date -u +%FT%TZ)
  node --env-file="$ENVF" scripts/maintenance/page-frame-sweep.mjs --apply --concurrency="${CONCURRENCY:-8}" \
    --limit-books="$n" --checkpoint="$CK" --stop-file="$STOP" >"$W/sweep.log" 2>&1
  rc=$?
  totals=$(grep '^totals' "$W/sweep.log" | tail -1 | cut -c8-)
  if [ $rc -eq 3 ]; then say "wave $i STOPPED on the error-rate guard: $totals. Log $W/sweep.log"; exit 3; fi
  if [ $rc -ne 0 ]; then say "wave $i crashed (exit $rc): $(tail -3 "$W/sweep.log" | tr '\n' ' ')"; exit $rc; fi
  if echo "$totals" | grep -q '"books":0'; then say "complete after $((i - 1)) waves; $(wc -l <"$CK") books checkpointed."; exit 0; fi

  node --env-file="$ENVF" scripts/audit/page-frame-dry-run.mjs --written-since="$start" --out="$W" >"$W/review.log" 2>&1
  summary=$(grep '^review:' "$W/review.log" | tail -1)
  if [ ! -s "$W/sheet-random.jpg" ]; then
    # Nothing framed this wave (all books probed clean): nothing to look at.
    note "wave $i: $totals; no frames written"; continue
  fi

  cat >"$W/brief.txt" <<EOF
You are checking crops before a sweep continues (issue #$ISSUE). Readers of a digitised library will
see each scanned page cropped to the RED BOX drawn on it; the dark scanner bed, book
board or neighbouring leaf outside the box is meant to be hidden.

Read these four files and nothing else: $W/sheet-random.jpg, $W/sheet-random.txt,
$W/sheet-tightest.jpg, $W/sheet-tightest.txt (the .txt keys map tile numbers to books).

STOP if ANY box cuts off part of the page's content: text, a page number or running
head, marginal notes, an illustration, a decorated border, or a torn page edge that
still carries writing; or if a box frames something that is not a book page (an
object, a stela, a board of several leaves) and hides part of it. Excluding a colour
chart, ruler, or library label is fine. Leaving a little bed visible is fine.

Write exactly one line to $W/VERDICT and then stop:
  OK <one short sentence>
  STOP <tile numbers and sheet> <what is cut off>
Do not edit, commit, push or comment on anything else.
EOF
  # The job name carries the state dir: claude-job.sh refuses a name whose branch
  # already exists, so a second run's "pf-review-1" never started and its wave
  # went unreviewed for an hour before the stop (run2, 2026-10-06).
  if ! "$JOB" start "pf-review-$(basename "$DIR")-$i" "$W/brief.txt" >"$W/job.log" 2>&1; then
    echo "wave $i: review job did not start" >"$STOP"
    say "wave $i STOPPED: the review job did not start ($(tail -1 "$W/job.log")). Sheets $W/sheet-*.jpg"; exit 4
  fi
  for _ in $(seq 1 120); do [ -s "$W/VERDICT" ] && break; sleep 30; done
  verdict=$(head -1 "$W/VERDICT" 2>/dev/null || echo "STOP no verdict within an hour")
  case "$verdict" in
    OK*) note "wave $i: $totals. $summary. Review: $verdict" ;;
    *) echo "wave $i: $verdict" >"$STOP"; say "wave $i STOPPED by review: $verdict. Sheets $W/sheet-*.jpg"; exit 4 ;;
  esac
done

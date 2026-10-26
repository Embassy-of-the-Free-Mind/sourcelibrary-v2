#!/bin/bash
# PRIOR ART: run-volume.sh (one volume: read, ya-btags check, apply; called here unchanged) and leafcheck.mjs (the audit
# instruments). Neither loops over volumes, audits per volume, paces agy, or keeps a done/pending state; this does.
# #6560 production pass (2026-10-26): Flash-low correction of the Yigdzin read, volume by volume, behind a per-volume
# audit with two judges. Wraps run-volume.sh; resumable from its state file.
#   run-pass.sh gate <book_id>         read + dry apply + 40-page audit, both judges, the gate's bar. Writes nothing.
#   run-pass.sh apply-gate <book_id>   apply the gate volume (only after `gate` passed)
#   run-pass.sh run [max_volumes]      the order file's volumes not yet in the state file: read, 10-page audit, apply
# Bars (pre-registered in experiments/2026-10-27-tibetan-flash-pass-production-6560.md): gate pooled worse <= 4/40 and
# better >= 3 x worse; per volume STOP when pooled worse > 2/10 or the ya-btags guard holds > 1% of its pages.
# Never --mark-stale: changed page ids go to $D.changed.json, and re-translation is a follow-up (#6948).
# Pacing: at most AGY_DAY_MAX (4000) agy calls a UTC day, counted from the read metas this pass made (a reused
#   candidate read is not a call). Exit 3 = a quota stop or a day cap; re-run the same command to resume.
# env: ORDER (default $JOB_SCRATCH/order.json, from volume-ids.mjs order), STATE (default $JOB_SCRATCH/pass-state.jsonl).
set -uo pipefail
CMD=$1; ARG=${2:-}
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
ENV=${ENV_FILE:-/root/sourcelibrary/.env.production.local}
P=$REPO/scripts/eval/tibetan-correct-6560/pass
ORDER=${ORDER:-$JOB_SCRATCH/order.json}; STATE=${STATE:-$JOB_SCRATCH/pass-state.jsonl}
AGY_DAY_MAX=${AGY_DAY_MAX:-4000}
SKIP=${SKIP:-69e7aaba80b52390feb199b8}   # rGyud 'bum Kha: the #6758 gate volume, judged and refused there
cd "$REPO"; touch "$STATE"

calls_today() {  # agy calls this pass made today (UTC): read metas with no reused_from, dated today
  python3 - "$JOB_SCRATCH/vol" <<'EOF'
import json, os, sys, glob, datetime
day = datetime.datetime.utcnow().strftime('%Y-%m-%d'); n = 0
for f in glob.glob(os.path.join(sys.argv[1], '*', '*.meta.json')):
    if datetime.datetime.utcfromtimestamp(os.path.getmtime(f)).strftime('%Y-%m-%d') != day: continue
    try: m = json.load(open(f))
    except Exception: continue
    if not m.get('reused_from'): n += 1
print(n)
EOF
}

audit() {  # audit <book> <n>: both judges on n changed pages; prints the gate json's head line
  local B=$1 N=$2 D=$JOB_SCRATCH/vol/$1 A=$JOB_SCRATCH/vol/$1.audit$2
  mkdir -p "$A"
  node --env-file="$ENV" $P/leafcheck.mjs audit-req --dir="$D" --verdicts="$D/yat-verdicts.jsonl" --n=$N --seed=6560 \
    --req="$A/req.jsonl" --key="$A/key.json" --changed="$D.changed.json" || return 1
  node $P/leafcheck.mjs tiles-req --req="$A/req.jsonl" --tiles-dir="$A/tiles" --out="$A/tiles-req.jsonl" || return 1
  node $P/leafcheck.mjs page-req --key="$A/key.json" --dir="$D" --req="$A/page-req.jsonl" || return 1
  for J in tiles page; do
    python3 scripts/eval/replicate-6547/run-claude-arm.py --requests "$A/$J-req.jsonl" --out "$A/$J-out.jsonl" \
      --arm "tib-pass-$J-$B" --model opus --parallel 2 --timeout 900 >> "$A/opus.log" 2>&1
    [ $? = 3 ] && { echo "QUOTA (claude) in the $J audit of $B"; return 3; }
  done
  node $P/leafcheck.mjs audit-score --key="$A/key.json" --replies="$A/tiles-out.jsonl" --out="$A/span-score.json" > "$A/span-score.log" || return 1
  node $P/leafcheck.mjs gate --key="$A/key.json" --span="$A/span-score.json" --page-replies="$A/page-out.jsonl" --n=$N \
    --out="$A/gate.json" | tee "$A/gate.log" | head -1
}

guard_rate() {  # held ya-btags pages / pages read, from the dry apply summary
  python3 -c "import json,sys; s=json.load(open('$JOB_SCRATCH/vol/$1/apply-summary-dry.json')); n=len(json.load(open('$JOB_SCRATCH/vol/$1.ids.json'))); print(f\"{s.get('held_yatags',0)} {n} {s.get('written',0)}\")"
}

passed() { python3 -c "import json; print('yes' if json.load(open('$JOB_SCRATCH/vol/$1.audit$2/gate.json'))['pass'] else 'no')"; }

record() { echo "$1" >> "$STATE"; }

case "$CMD" in
gate)
  B=$ARG
  bash $P/run-volume.sh "$B" --no-apply || exit $?
  audit "$B" 40 || exit $?
  echo "gate $B: pass=$(passed "$B" 40); guard $(guard_rate "$B")" ;;
apply-gate)
  B=$ARG
  [ "$(passed "$B" 40)" = yes ] || { echo "gate did not pass for $B: nothing applied"; exit 4; }
  MARK_STALE= bash $P/run-volume.sh "$B" || exit $?
  read HELD N W < <(guard_rate "$B")
  record "{\"book_id\":\"$B\",\"status\":\"done\",\"audit\":40,\"pages\":$N,\"held_yatags\":$HELD,\"changed\":$(python3 -c "import json;print(len(json.load(open('$JOB_SCRATCH/vol/$B.changed.json'))))"),\"at\":\"$(date -u +%FT%TZ)\"}" ;;
run)
  MAX=${ARG:-1000}; done_n=0
  for B in $(python3 -c "import json; [print(v['book_id']) for v in json.load(open('$ORDER'))]"); do
    [ "$B" = "$SKIP" ] && continue
    grep -q "\"book_id\":\"$B\"" "$STATE" && continue
    [ $done_n -ge $MAX ] && { echo "max volumes reached ($MAX)"; exit 0; }
    NP=$(python3 -c "import json; print(next(v['pages'] for v in json.load(open('$ORDER')) if v['book_id']=='$B'))")
    CT=$(calls_today)
    [ $((CT + NP)) -gt $AGY_DAY_MAX ] && { echo "DAYCAP: $CT agy calls today + $NP pages > $AGY_DAY_MAX; resume after 00:00 UTC"; exit 3; }
    echo "$(date -u +%FT%TZ) volume $B ($NP pages; $CT agy calls today)"
    bash $P/run-volume.sh "$B" --no-apply || exit $?
    read HELD N W < <(guard_rate "$B")
    if python3 -c "import sys; sys.exit(0 if $HELD > 0.01 * $N else 1)"; then
      record "{\"book_id\":\"$B\",\"status\":\"stopped\",\"why\":\"ya-btags guard held $HELD of $N pages (> 1%)\",\"at\":\"$(date -u +%FT%TZ)\"}"
      echo "STOP: ya-btags guard held $HELD of $N pages of $B"; exit 5
    fi
    audit "$B" 10 || exit $?
    if [ "$(passed "$B" 10)" != yes ]; then
      record "{\"book_id\":\"$B\",\"status\":\"stopped\",\"why\":\"audit: pooled worse > 2/10\",\"at\":\"$(date -u +%FT%TZ)\"}"
      echo "STOP: $B failed its 10-page audit"; exit 5
    fi
    MARK_STALE= bash $P/run-volume.sh "$B" || exit $?
    record "{\"book_id\":\"$B\",\"status\":\"done\",\"audit\":10,\"pages\":$N,\"held_yatags\":$HELD,\"changed\":$(python3 -c "import json;print(len(json.load(open('$JOB_SCRATCH/vol/$B.changed.json'))))"),\"at\":\"$(date -u +%FT%TZ)\"}"
    done_n=$((done_n + 1))
  done ;;
*) sed -n 2,12p "$0"; exit 2 ;;
esac

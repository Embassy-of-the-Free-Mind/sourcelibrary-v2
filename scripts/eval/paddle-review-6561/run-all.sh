#!/bin/bash
# NOT RUN (2026-10-14): the gate said NO-GO, so step 2 never started and this cron was never installed.
# PRIOR ART: scripts/eval/paddle-correct-6561/batch/cron.sh — the Opus run's detached runner + cron pair; this is the
# review side. #6561 step 2: review every page the gate did not, detached (setsid nohup), resumable.
# Pass 0 reviews all-req.jsonl; passes 1 and 2 re-ask only the pages whose reply did not parse (or was empty): the
# brief's "retried twice, then NOT REVIEWED". A quota stop (run-cli-arm exit 3) is not a verdict: sleep 60 min and
# resume the same pass. After every pass record.mjs --apply folds the verdicts into checkpoint.jsonl and the staging
# docs. Writes all-run.exit when it ends.
#   cd $JOB_SCRATCH && setsid nohup bash <repo>/scripts/eval/paddle-review-6561/run-all.sh > all-run.log 2>&1 < /dev/null &
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
SCR="${JOB_SCRATCH:-/mnt/HC_Volume_105839809/jobs/table-review-6561}"; cd "$SCR" || exit 1
ENVF=/root/sourcelibrary/.env.production.local
MODEL="${REVIEW_MODEL:-gemini-3.8-flash-high}"
echo $$ > all-run.pid; rm -f all-run.exit
for pass in 0 1 2; do
  if [ "$pass" = 0 ]; then REQ=all-req.jsonl; else
    node --env-file=$ENVF "$HERE/record.mjs" --apply >> record.log 2>&1
    REQ=all-req-pass$pass.jsonl
    python3 - "$pass" <<'EOF'
import json, sys
p = sys.argv[1]
done = {json.loads(l)['page_id'] for l in open('checkpoint.jsonl') if l.strip()}
uids = json.load(open('all-uids.json'))
rows = [json.loads(l) for l in open('all-req.jsonl') if l.strip()]
todo = [r for r in rows if uids[r['uid']] not in done]
with open(f'all-req-pass{p}.jsonl', 'w') as f:
    for r in todo: f.write(json.dumps(r, ensure_ascii=False) + '\n')
print(f'pass {p}: {len(todo)} pages without a parseable verdict', flush=True)
EOF
    [ -s "$REQ" ] || break
  fi
  quota=0
  while :; do
    python3 "$REPO/scripts/eval/run-cli-arm.py" --job table-review-6561 --model "$MODEL" --kind review --arm "review-6561-all-p$pass" \
      --requests "$REQ" --out "all-review-pass$pass.jsonl" --parallel 2 --print-timeout 240
    rc=$?
    echo "$(date -u +%FT%TZ) pass $pass exit $rc"
    if [ $rc -eq 3 ]; then quota=$((quota+1)); echo "quota stop $quota; sleeping 60 min"; sleep 3600; continue; fi
    break
  done
done
node --env-file=$ENVF "$HERE/record.mjs" --apply >> record.log 2>&1
tail -2 record.log
date -u +%FT%TZ > all-run.exit

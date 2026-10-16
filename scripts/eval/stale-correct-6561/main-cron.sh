#!/usr/bin/env bash
# PRIOR ART: /root/bin/stale-correct-trigger.sh (main: waits for a report, starts the next job, removes itself) and
# scripts/eval/paddle-correct-6561/batch/cron.sh (6-hourly progress comments). Neither watches the agy quota or the
# 50,387-page run's exit, which are the two things the rest of #6561 items 1, 2 and 5 wait on.
#
# Hourly on main (job stale-correct-6561, 2026-10-15). Every agy Gemini model has answered "Individual quota reached"
# since 2026-10-14 13:06 UTC, so everything that needs agy waits here:
#   1. agy back (a Gemini call logged ok in /var/log/sourcelibrary/agy-calls.jsonl in the last 2 h, or, with nothing
#      else calling agy, a one-line probe answers): start job stale-correct-6561-b on main with brief-b.md (item 2 run +
#      judge, the item-1 pilot's Gemini review and gate, then the serve path). Once.
#   2. item 5: when the 50,387-page run (`stale-retranslate-6567.mjs run`, out dir /root/stale-resume-out) has exited,
#      retry its failed pages once (rows not written and not no-body) into a fresh out dir, detached; when that exits,
#      report on #6567. Once.
#   3. a comment on #6561 every 6 h while it waits. Gives up on 2026-11-15 with a comment.
# Removes its own cron line when 1 and 2 are both done. DRY=1 changes nothing.
#   35 * * * * /mnt/HC_Volume_105839809/jobs/stale-correct-6561/state/bin/main-cron.sh >> /mnt/HC_Volume_105839809/jobs/stale-correct-6561/state/main-cron.log 2>&1  # stale-correct-6561-main-cron
set -u
export PATH=/root/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=${HOME:-/root}
HERE="$(cd "$(dirname "$0")" && pwd)"   # installed as a copy in $ST/bin, so a reaped worktree cannot break it
ST=${SC_STATE:-/mnt/HC_Volume_105839809/jobs/stale-correct-6561/state}
ENVF=/root/sourcelibrary/.env.production.local
STALE_OUT=/root/stale-resume-out; STALE_CODE=/root/stale-resume-6567; RETRY_OUT=/root/stale-retry-out
REPO=Embassy-of-the-Free-Mind/sourcelibrary-v2; TAG=stale-correct-6561-main-cron; JOB_B=stale-correct-6561-b
DRY=${DRY:-0}
mkdir -p "$ST"; cd "$ST" || exit 1
exec 9> "$ST/main-cron.lock"; flock -n 9 || exit 0
say() { echo "$(date -u +%FT%TZ) $*"; }
comment() { if [ "$DRY" = 1 ]; then say "DRY comment on #$1:"; echo "$2"; else gh issue comment "$1" -R "$REPO" --body "$2" >/dev/null && say "commented on #$1"; fi; }
unschedule() { if [ "$DRY" = 1 ]; then say "DRY would remove the cron line"; else crontab -l | grep -v "# $TAG\$" | crontab - && say "cron line removed"; fi; }
stale_alive() { pgrep -f '[s]tale-retranslate-6567\.mjs run --out=/root/stale-resume-out' >/dev/null; }

agy_back() {
  # a Gemini call that answered, in the last 2 h, from any job
  if python3 - <<'EOF'
import json, sys, datetime as dt
cut = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=2)).isoformat()[:19]
ok = False
with open('/var/log/sourcelibrary/agy-calls.jsonl', 'rb') as f:
    f.seek(0, 2); f.seek(max(0, f.tell() - 2_000_000))
    for l in f.read().decode('utf8', 'ignore').splitlines()[1:]:
        try: r = json.loads(l)
        except Exception: continue
        if (r.get('ts') or '')[:19] >= cut and r.get('ok') and str(r.get('model', '')).startswith('gemini'): ok = True
sys.exit(0 if ok else 1)
EOF
  then return 0; fi
  # nothing else is calling agy: ask it once
  stale_alive && return 1
  timeout 120 agy -p 'Reply with the single word OK.' --model gemini-3.8-flash-low 2>&1 | grep -q -E '^OK\b|"OK"'
}

# 1. job b
if [ ! -f b.started ]; then
  if agy_back; then
    say "agy answers: starting $JOB_B"
    if [ "$DRY" = 1 ]; then say "DRY would run: claude-job.sh start $JOB_B $HERE/brief-b.md"; else
      cp "$HERE/brief-b.md" /root/claude-jobs/$JOB_B.txt
      if /root/bin/claude-job.sh start $JOB_B /root/claude-jobs/$JOB_B.txt; then date -u +%FT%TZ > b.started
        comment 6561 "stale-correct-6561 cron: agy answers again, so job \`$JOB_B\` started on main (item 2's retranslation and judge, the item-1 pilot's Gemini review and gate). Brief: \`scripts/eval/stale-correct-6561/brief-b.md\`."
      else say "start failed"; fi
    fi
  else say "agy still quota-blocked"; fi
fi

# 2. item 5
if [ ! -f retry.reported ]; then
  if [ ! -f retry.started ]; then
    if ! stale_alive && [ "$(sort -u <(python3 -c "import json,sys;[print(json.loads(l)['page_id']) for l in open('$STALE_OUT/done.jsonl') if l.strip()]") | wc -l)" -lt "$(grep -c . $STALE_OUT/set.jsonl)" ]; then
      # exited before the end (killed, a reboot, or its 12-failures halt): not a finished run, so no retry yet
      if [ ! -f incomplete.reported ]; then
        comment 6567 "stale-correct-6561 cron: the 50,387-page run (\`$STALE_OUT\`) is not running but has not checkpointed every page. Last log line: \`$(tail -1 $STALE_OUT/run.log | cut -c1-200)\`. Item 5's retry waits until it has run to the end; resume it with the same command (it skips checkpointed pages)."
        [ "$DRY" = 1 ] || touch incomplete.reported
      fi
    elif ! stale_alive; then
      say "the 50,387-page run has exited: retrying its failed pages"
      python3 - "$STALE_OUT/done.jsonl" "$ST/retry-ids.txt" <<'EOF'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
ok = {r['page_id'] for r in rows if r['outcome'] == 'written' or 'no-body' in (r.get('why') or '')}
ids = sorted({r['page_id'] for r in rows if r['page_id'] not in ok})
open(sys.argv[2], 'w').write('\n'.join(ids) + ('\n' if ids else ''))
print(len(ids), 'pages to retry')
EOF
      if [ "$DRY" = 1 ]; then say "DRY would start the retry"; else
        mkdir -p $RETRY_OUT && cp $STALE_OUT/set.jsonl $STALE_OUT/census.json $RETRY_OUT/
        ( cd $STALE_CODE && CLI_JOB_NAME=stale-retry-6567 setsid nohup node --env-file=$ENVF scripts/batch/stale-retranslate-6567.mjs run --out=$RETRY_OUT --ids=$ST/retry-ids.txt --parallel=2 --apply > $RETRY_OUT/run.log 2>&1 < /dev/null & )
        date -u +%FT%TZ > retry.started
      fi
    else say "the 50,387-page run is still running"; fi
  elif ! pgrep -f '[s]tale-retranslate-6567\.mjs run --out=/root/stale-retry-out' >/dev/null; then
    body=$(python3 - "$STALE_OUT" "$RETRY_OUT" "$ST/retry-ids.txt" <<'EOF'
import json, sys, collections
first = [json.loads(l) for l in open(sys.argv[1] + '/done.jsonl') if l.strip()]
c1 = collections.Counter(r['outcome'] for r in first)
try: second = [json.loads(l) for l in open(sys.argv[2] + '/done.jsonl') if l.strip()]
except FileNotFoundError: second = []
c2 = collections.Counter((r['outcome'], r.get('why') or '') for r in second)
n = len([l for l in open(sys.argv[3]) if l.strip()])
print(f"**Retry of the stale run's failed pages finished (job stale-correct-6561, item 5).**")
print(f"- The 50,387-page run (out dir `{sys.argv[1]}`) checkpointed {len(first)} pages: " + ', '.join(f'{k} {v}' for k, v in c1.most_common()) + '.')
print(f"- Retried once: {n} pages (not written and not no-body). Outcomes: " + (', '.join(f'{k[0]}{" (" + k[1] + ")" if k[1] else ""} {v}' for k, v in c2.most_common()) or 'none recorded') + '.')
print(f"- Same call, prompt and guards (`stale-retranslate-6567.mjs run --ids`, agy 3.8 Flash low). Out dir `{sys.argv[2]}` on main; log `{sys.argv[2]}/run.log`.")
EOF
)
    comment 6567 "$body"; [ "$DRY" = 1 ] || touch retry.reported
  else say "retry running"; fi
fi

# 3. report / give up / finish
if [ -f b.started ] && [ -f retry.reported ]; then unschedule; exit 0; fi
if [ "$(date -u +%Y%m%d)" -gt 20261115 ]; then
  comment 6561 "stale-correct-6561 cron: giving up on 2026-11-15. Job b started: $(cat b.started 2>/dev/null || echo no). Item 5 retry: $( [ -f retry.reported ] && echo reported || echo 'not done'). Nothing further will start on its own."
  unschedule; exit 0
fi
last=$(stat -c %Y last-comment 2>/dev/null || echo 0)
if [ $(( $(date +%s) - last )) -ge 21300 ]; then
  w=$(tail -1 $STALE_OUT/run.log 2>/dev/null | cut -c1-160)
  comment 6561 "stale-correct-6561 cron (main, $(date -u +%FT%TZ)): waiting. agy Gemini: $( [ -f b.started ] && echo "back; job $JOB_B started $(cat b.started)" || echo 'still quota-blocked, job b not started'). The 50,387-page run: $(stale_alive && echo running || echo exited), last log line \`$w\`. Item 5 retry: $( [ -f retry.reported ] && echo reported || { [ -f retry.started ] && echo running || echo 'waits for that run to exit'; })."
  [ "$DRY" = 1 ] || touch last-comment
fi

#!/bin/bash
# NOT RUN (2026-10-14): the gate said NO-GO, so step 2 never started and this cron was never installed.
# PRIOR ART: scripts/eval/paddle-correct-6561/batch/cron.sh — the Opus run's hourly watcher (progress comment, then
# start the next job, then remove itself). #6561 step 2's watcher, installed as /root/bin/table-review-6561-cron.sh:
#   7 * * * * /root/bin/table-review-6561-cron.sh >> /root/claude-jobs/table-review-6561-cron.log 2>&1
# Hourly: while run-all.sh lives, a progress comment on #6561 every 6 h; if it died without all-run.exit, restart it
# once; when all-run.exit appears, start job table-serve-6561 (the serve step) and remove its own cron line.
# DRY=1 prints what it would do and changes nothing.
set -u
SCR=/mnt/HC_Volume_105839809/jobs/table-review-6561
HERE=/mnt/HC_Volume_105839809/worktrees/job-table-review-6561/scripts/eval/paddle-review-6561
ENVF=/root/sourcelibrary/.env.production.local
ISSUE=6561; DRY="${DRY:-}"
say() { if [ -n "$DRY" ]; then echo "DRY would comment: $1"; else gh issue comment $ISSUE --body "$1" >/dev/null; fi; }
gone() { if [ -n "$DRY" ]; then echo "DRY would remove cron line"; else crontab -l | grep -v table-review-6561-cron.sh | crontab -; fi; }
cd "$SCR" || exit 0
[ -e serve-started ] && { gone; exit 0; }
summary() {
  node --env-file=$ENVF "$HERE/record.mjs" 2>/dev/null | tail -1 | python3 -c '
import json, sys
d = json.loads(sys.stdin.read()); v = ", ".join("%s %d" % kv for kv in sorted(d["verdicts"].items()))
print("- Reviewed %d of %d pages; verdicts: %s; no parseable verdict yet %d. Model: %s." % (d["reviewed"], d["pages_known"], v, d["not_reviewed"], ", ".join(d["models"])))'
  echo "- Reviewer calls logged: $(grep -c '"table-review-6561"' /var/log/sourcelibrary/agy-calls.jsonl). Quota stops: $(grep -c 'quota stop' all-run.log 2>/dev/null)."
}
if [ -e all-run.exit ]; then
  S=$(summary)
  if [ -n "$DRY" ]; then echo "DRY would start job table-serve-6561 with $SCR/serve-brief.txt"; else
    /root/bin/claude-job.sh start table-serve-6561 "$SCR/serve-brief.txt" >> /root/claude-jobs/table-review-6561-cron.log 2>&1 && touch serve-started
  fi
  say "**Gemini review of the Opus-corrected table pages has finished (job table-review-6561); the serve step starts now as job table-serve-6561. Nothing is written to \`pages\` until it does.**
$S"
  gone; exit 0
fi
PID=$(cat all-run.pid 2>/dev/null)
if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null || [ "$(ps -o stat= -p "$PID" | cut -c1)" = Z ]; then
  if [ -e restarted ]; then say "**Review runner (job table-review-6561) died a second time without finishing; not restarting. Look at $SCR/all-run.log.**"; gone; exit 0; fi
  if [ -z "$DRY" ]; then touch restarted; JOB_SCRATCH=$SCR setsid nohup bash "$HERE/run-all.sh" >> all-run.log 2>&1 < /dev/null & fi
  say "**Review runner (job table-review-6561) had stopped without finishing; restarted it once (it resumes from its checkpoint).**"
  exit 0
fi
LAST=$(cat last-progress 2>/dev/null || echo 0); NOW=$(date +%s)
if [ $((NOW - LAST)) -ge 21600 ]; then
  say "**Gemini review progress (job table-review-6561, main; reviews only, nothing written to \`pages\`).**
$(summary)"
  [ -z "$DRY" ] && echo "$NOW" > last-progress
fi
exit 0

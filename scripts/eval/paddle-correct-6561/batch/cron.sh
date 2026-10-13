#!/usr/bin/env bash
# PRIOR ART: none — looked in scripts/workers/ and scripts/eval/ for an hourly "watch a detached run, report, then
# hand over" cron (`git grep -l "crontab -l" scripts/`); the installers there add permanent lines. This one is the
# tail of a headless job (#6561, job table-correct-6561 on cloudlayer), which cannot wait for its own run.
#
# Hourly, on the box that runs run.mjs:
#   - runner not finished: restart it if it died (at most 8 times); a progress comment on #6561 every 6 h.
#   - runner finished (runner.done): upload the candidates to the staging collection, start the review job on main
#     through the box mesh with review-brief.md, comment, and remove this cron line.
# DRY=1 prints what it would do and changes nothing. Install line (tagged so it can remove itself):
#   17 * * * * /data/scratch/sl/jobs/table-correct-6561/code/scripts/eval/paddle-correct-6561/batch/cron.sh >> /data/scratch/sl/jobs/table-correct-6561/w/cron.log 2>&1  # table-correct-6561-cron
set -u
export PATH=/root/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=${HOME:-/root}
S=${TC_SCRATCH:-/data/scratch/sl/jobs/table-correct-6561}
W=$S/w; B=$S/code/scripts/eval/paddle-correct-6561/batch
ENVF=${TC_ENV:-/data/scratch/sl/sourcelibrary/.env.production.local}
REPO=Embassy-of-the-Free-Mind/sourcelibrary-v2; ISSUE=6561; TAG=table-correct-6561-cron; REVIEW=table-review-6561
DRY=${DRY:-0}
cd "$W" || exit 1
exec 9> "$W/cron.lock"; flock -n 9 || exit 0
say() { echo "$(date -u +%FT%TZ) $*"; }
comment() { if [ "$DRY" = 1 ]; then say "DRY comment:"; echo "$1"; else gh issue comment "$ISSUE" -R "$REPO" --body "$1" >/dev/null && say "commented"; fi; }
unschedule() { if [ "$DRY" = 1 ]; then say "DRY would remove the cron line"; else crontab -l | grep -v "$TAG" | crontab - && say "cron line removed"; fi; }
alive() { pgrep -f '[b]atch/run\.mjs' >/dev/null; }

if [ ! -f runner.done ]; then
  if ! alive && [ ! -f runner.stop ]; then
    n=$(cat restarts 2>/dev/null || echo 0)
    if [ "$n" -ge 8 ]; then
      comment "**Opus-correct run stopped and did not finish (job table-correct-6561, cloudlayer).** The runner died $n times. Nothing was uploaded and no review was started.
$(node "$B/status.mjs" "$W")
Log: \`$W/run.log\` on cloudlayer. Restart by hand: \`cd $W && rm -f restarts && setsid nohup node $B/run.mjs >> run.log 2>&1 &\` and re-add the cron line from \`cron.sh\`'s header."
      unschedule; exit 0
    fi
    say "runner not alive, restart $((n + 1))"
    if [ "$DRY" != 1 ]; then echo $((n + 1)) > restarts; 
      # inside the box's capped slice, as the job that first started it was
      cap=""; command -v systemd-run >/dev/null && cap="systemd-run --quiet --scope --slice=sourcelibrary.slice --"
      setsid nohup $cap node "$B/run.mjs" >> run.log 2>&1 < /dev/null &
    fi
  fi
  last=$(stat -c %Y last-comment 2>/dev/null || echo 0)
  if [ $(( $(date +%s) - last )) -ge 21300 ]; then
    comment "**Opus-correct progress (job table-correct-6561, cloudlayer; files only, nothing written to production).**
$(node "$B/status.mjs" "$W")"
    [ "$DRY" = 1 ] || touch last-comment
  fi
  exit 0
fi

# The runner finished.
if [ ! -f upload.done ]; then
  if [ "$DRY" = 1 ]; then node --env-file="$ENVF" "$B/upload.mjs"; else
    node --env-file="$ENVF" "$B/upload.mjs" --apply || { say "upload failed"; n=$(cat upload-fails 2>/dev/null || echo 0); echo $((n + 1)) > upload-fails
      [ "$n" -eq 2 ] && comment "**Upload of the Opus corrections failed three times (job table-correct-6561).** The candidates are safe in \`$W/out.jsonl\` on cloudlayer; the review has not started. Log: \`$W/cron.log\`."
      exit 1; }
  fi
fi
if [ ! -f review.started ]; then
  if [ "$DRY" = 1 ]; then say "DRY would run: box.sh main start $REVIEW < $B/review-brief.md ($(wc -c < "$B/review-brief.md") bytes)"; else
    out=$(/root/bin/box.sh main start "$REVIEW" < "$B/review-brief.md" 2>&1); rc=$?; say "box.sh main start: rc=$rc $out"
    if [ $rc -eq 0 ] || echo "$out" | grep -q "already exists"; then echo "$out" > review.started; else
      n=$(cat start-fails 2>/dev/null || echo 0); echo $((n + 1)) > start-fails
      if [ "$n" -ge 11 ]; then
        comment "**Opus-correct finished and uploaded, but the review job did not start (job table-correct-6561).** \`box.sh main start $REVIEW\` failed 12 times, last: \`$(echo "$out" | tail -1)\`. Start it by hand on main with the brief at \`scripts/eval/paddle-correct-6561/batch/review-brief.md\`.
$(node "$B/status.mjs" "$W")"
        unschedule
      fi
      exit 1
    fi
  fi
fi
comment "**Opus-correct finished; the candidates are staged and the Gemini review is started on main as job \`$REVIEW\`. Nothing is served yet.** (job table-correct-6561, cloudlayer)
$(node "$B/status.mjs" "$W")
- Staged: Mongo \`paddle_table_corrections_6561\`, one doc per corrected page ($(cat upload.done 2>/dev/null)). No cron or worker reads that collection. \`pages\` was not written.
- Pages with no accepted correction stay withheld: \`$W/not-corrected.json\` on cloudlayer.
- Next: the review samples 100 pages + 5 planted controls. Gate: invented text on at most 10 of the 100. It serves only if that passes.
- This job's cron has removed itself."
unschedule

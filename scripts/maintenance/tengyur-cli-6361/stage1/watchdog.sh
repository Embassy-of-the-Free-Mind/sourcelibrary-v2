#!/bin/bash
# #6361 Tengyur CLI re-translation: keeps the stage-1 driver alive, starts stage 2 once, posts one progress
# comment a day, pages only on done or an 8 h stall. Cron every 20 min. Removes its own cron line at DONE-STAGE2.
D=/root/tengyur-cli-6361; R=Embassy-of-the-Free-Mind/sourcelibrary-v2; N=${NTFY_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
log() { echo "$(date -u +%FT%TZ) $*" >> $D/watchdog.log; }
page() { curl -s -m 10 -H "Title: $1" -H "Priority: $2" -d "$3" "$N" >/dev/null 2>&1; }
[ -d $D ] || exit 0
if [ -e $D/DONE-STAGE2 ]; then
  [ -e $D/.paged-done2 ] || { page "Tengyur CLI re-translation finished (#6361)" default "Stage 2 done. Closing comment is on the issue."; touch $D/.paged-done2; }
  crontab -l | grep -v 'tengyur-cli-6361/watchdog.sh' | crontab -; log "done; cron line removed"; exit 0
fi
[ -e $D/STOP ] && exit 0
P="$(cat $D/progress.txt 2>/dev/null)"
if [ -e $D/DONE-STAGE1 ]; then
  if [ ! -e $D/.stage2-started ]; then
    date -u > $D/.stage2-started
    /root/bin/claude-job.sh start tengyur-cli-6361-stage2 /root/claude-jobs/tengyur-cli-6361-stage2.txt >> $D/watchdog.log 2>&1
    page "Tengyur CLI: stage 1 done, stage 2 started (#6361)" low "$P"; log "stage 2 started"
  fi
else
  if [ -x $D/start-driver.sh ] && ! tmux has-session -t tengyur-cli-6361-driver 2>/dev/null; then
    log "driver not running, restarting"; bash $D/start-driver.sh >> $D/watchdog.log 2>&1; date +%s > $D/.last-restart
  fi
  # stall: progress.txt older than 8 h although a restart was tried
  if [ -e $D/progress.txt ] && [ $(( $(date +%s) - $(stat -c %Y $D/progress.txt) )) -gt 28800 ] && [ -e $D/.last-restart ]; then
    [ "$(cat $D/.paged-stall 2>/dev/null)" = "$(date -u +%F)" ] || { page "Tengyur CLI re-translation stalled 8 h (#6361)" high "$P"; gh issue comment 6361 -R $R --body "Watchdog: no page staged for 8 hours after a driver restart. \`$P\`" >/dev/null 2>&1; date -u +%F > $D/.paged-stall; }
  fi
fi
# one progress comment a day
if [ -n "$P" ] && [ "$(cat $D/.commented 2>/dev/null)" != "$(date -u +%F)" ]; then
  Y="$(cat $D/.progress-yesterday 2>/dev/null)"
  gh issue comment 6361 -R $R --body "Daily progress (watchdog, $(date -u +%F)): \`$P\`${Y:+ — a day ago: \`$Y\`}" >/dev/null 2>&1 && { date -u +%F > $D/.commented; echo "$P" > $D/.progress-yesterday; }
fi

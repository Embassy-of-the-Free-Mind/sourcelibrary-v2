#!/bin/bash
# PRIOR ART: the hand-installed /root/speedtest-a/gate-cron.sh (draw only, judged by a laptop gate session, which died
# when the laptop slept 2026-10-01 ~04:00Z). This is that script plus the lid-proof half: classify scope on Mongo
# (gate-scope.mjs), then PUBLISH the window to branch eval/speedtest-a-gate-windows, where the claude.ai routine
# "Speed test A — window gate judge" picks it up at :40. Runbook: GATE.md. $0 API: Mongo reads + git.
#
# Installed as /root/speedtest-a/gate-cron.sh, run by /etc/cron.d/speedtest-a-gate at :25 after each tick.
set -uo pipefail
END=2026-10-03T23:00:00Z
[ "$(date -u +%s)" -gt "$(date -u -d $END +%s)" ] && exit 0
UNTIL=$(date -u -d "$(date -u +%Y-%m-%dT%H:15:00Z)" +%Y-%m-%dT%H:%M:%SZ)
SINCE=$(date -u -d "$UNTIL - 6 hours" +%Y-%m-%dT%H:%M:%SZ)
NAME=w-$(date -u -d "$UNTIL" +%m%dT%H%M)
OUT=/root/speedtest-a/gate/$NAME
echo "== $(date -u +%FT%TZ) gate draw $NAME [$SINCE, $UNTIL)"
GATE_REF=eval/speedtest-a-gate GATE_NAME=$NAME GATE_SINCE=$SINCE GATE_UNTIL=$UNTIL GATE_SEED=$(date -u -d "$UNTIL" +%Y%m%d%H) \
  timeout 1800 bash /root/speedtest-a/gate-window-draw.sh
cd /root/sourcelibrary; set -a; . .env.production.local; set +a
node /root/speedtest-a/over-blocks.js "$SINCE" "$UNTIL" > "$OUT/over-blocks.json" 2>&1
echo "over-blocks: $(head -c 400 "$OUT/over-blocks.json")"
# gate-scope.mjs lives in the clone the draw just checked out (/root/tca-work at eval/speedtest-a-gate).
(cd /root/tca-work && node scripts/eval/translation-corpus-audit/gate-scope.mjs --dir "$OUT") || echo "WARN gate-scope failed — routine will see no scope.json and report the raw eligibility list"
echo "READY $NAME"
bash /root/speedtest-a/gate-publish.sh "$NAME"

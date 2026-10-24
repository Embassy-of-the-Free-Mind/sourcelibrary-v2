#!/usr/bin/env bash
# PRIOR ART: scripts/batch/claude-translate.mjs stops with exit 3 at a usage limit and resumes by skipping pages done;
# scripts/lib/model-limits.mjs waitWhileBlocked() sleeps on the meter. This only joins the two for one job's caps.
# read-loop.sh IDS_JSON OUT_DIR PER_CALL JOB [OCR_CHECKED]
#   Runs claude-translate.mjs read (Opus, subscription) until every page is read, under this job's caps: no call at or
#   over 80% of the 5-hour window or 85% of the week (#6948 brief). On a limit stop it waits on the METER FILE only
#   (never a probe call, #7118) and resumes. Writes nothing to the database.
set -u
IDS=$1 OUT=$2 PC=$3 JOB=$4 CHECKED=${5:-"Yigdzin (bdrc-yigdzin-v1) leaf reads, #4523 2026-10-14 run: 0 invented in 15 by eye; leaf-grounded audit in this job's stage 1"}
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
export PATH=/root/.local/bin:$PATH CLAUDE_SESSION_MAX_PCT=${CLAUDE_SESSION_MAX_PCT:-80} CLAUDE_WEEKLY_MAX_PCT=${CLAUDE_WEEKLY_MAX_PCT:-85}
mkdir -p "$OUT"
while :; do
  node --env-file="$ROOT/.env.production.local" "$ROOT/scripts/batch/claude-translate.mjs" read --page-ids-file="$IDS" --out="$OUT" --model=opus --per-call="$PC" --job="$JOB" --ocr-checked="$CHECKED"
  rc=$?
  [ $rc -eq 3 ] || exit $rc
  node --input-type=module -e "
    const { claudeBlocked, waitWhileBlocked } = await import('$ROOT/scripts/lib/model-limits.mjs');
    const ok = await waitWhileBlocked(() => claudeBlocked({ sessionMax: +process.env.CLAUDE_SESSION_MAX_PCT, weeklyMax: +process.env.CLAUDE_WEEKLY_MAX_PCT }), { maxWaitH: 200 });
    process.exit(ok ? 0 : 4);" || exit 4
done

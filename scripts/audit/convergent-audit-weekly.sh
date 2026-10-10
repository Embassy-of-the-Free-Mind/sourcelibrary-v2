#!/usr/bin/env bash
# PRIOR ART: scripts/eval/spot-check/fortnightly-draw.sh (a scheduled spot-check draw; it stops at the draw and leaves
# the reads to a routine). This runs the whole #6420 lane D sequence unattended on the Hetzner box: draw, Opus reads
# (claude CLI, subscription), Gemini 3.7 reads (agy CLI, subscription), score, post on #6420.
#
# Cron (installed by hand, crontab is not read from the repo):
#   0 6 * * 1 /root/sourcelibrary/scripts/audit/convergent-audit-weekly.sh >> /var/log/sourcelibrary/convergent-audit-weekly.log 2>&1
set -u
REPO="${REPO:-/root/sourcelibrary}"
BASE="${AUDIT_BASE:-/mnt/HC_Volume_105839809/jobs/convergent-audit-6420}"
RUN="$BASE/$(date -u +%F)"
ENV="$REPO/.env.production.local"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH" TMPDIR="$BASE/tmp"
mkdir -p "$BASE/tmp"
exec 9>/tmp/sl-convergent-audit.lock; flock -n 9 || { echo "$(date -u +%FT%TZ) another audit is running"; exit 0; }
cd "$REPO" || exit 1
echo "== $(date -u +%FT%TZ) convergent audit $RUN"
[ -d "$RUN/packets" ] || node --env-file="$ENV" scripts/audit/convergent-audit-weekly.mjs draw --run "$RUN" || exit 1
# Opus: sealed folder per page, Read/Write only (run-readers.sh), 4 at a time, on the box's Claude account.
scripts/eval/second-reader/run-readers.sh "$RUN" opus claude opus read 4
# Gemini 3.7 Flash through the CLI, one page per call, the #6338 tested path; logs to the shared agy call meter.
node scripts/eval/second-reader/second-reader.mjs cli-requests --run "$RUN" --reader gemini37
python3 scripts/eval/run-cli-arm.py --requests "$RUN/readers/gemini37/requests.jsonl" --out "$RUN/readers/gemini37/cli-out.jsonl" \
  --arm audit6420-gemini37 --model gemini-3.7-flash-low --job convergent-audit-6420 --kind review --parallel 2 --attempts 4 \
  --workdir "$BASE/tmp/cli-ws"
node scripts/eval/second-reader/second-reader.mjs cli-assemble --run "$RUN" --reader gemini37
node scripts/audit/convergent-audit-weekly.mjs score --run "$RUN" --post
echo "== $(date -u +%FT%TZ) done"

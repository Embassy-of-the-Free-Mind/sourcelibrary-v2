#!/usr/bin/env bash
# PRIOR ART: scripts/eval/spot-check/fortnightly-draw.sh (a scheduled spot-check draw; it stops at the draw and leaves
# the reads to a routine). This runs the whole #6420 lane D sequence unattended on the Hetzner box: draw, Opus reads
# (claude CLI, subscription), Gemini reads (agy CLI, subscription), score, post on #6420.
#
# Cron (installed by hand, crontab is not read from the repo):
#   0 6 * * 1 /root/sourcelibrary/scripts/audit/convergent-audit-weekly.sh >> /var/log/sourcelibrary/convergent-audit-weekly.log 2>&1
# Finish a run whose second reader did not read (every step skips what is done):
#   scripts/audit/convergent-audit-weekly.sh 2026-10-12
#
# THE GEMINI READER AND QUOTA (#6203). On 2026-10-12 the account's quota ran out at 03:30 UTC (lane B's main200 reads
# share it) and reset at 06:35; this ran at 06:00. run-cli-arm.py stops on the first quota error with exit 3, the
# next two steps ran anyway, and the report said "Gemini 0" with a row of dashes and no reason. Now: a quota stop is
# retried (the runner resumes where it stopped) every AUDIT_QUOTA_WAIT seconds, up to AUDIT_QUOTA_RETRIES times, trying
# each model of AUDIT_GEMINI_MODELS in turn; and the scorer names why a reader has no verdicts and leaves that
# reader's rates and the agreement line out rather than printing them empty.
set -u
REPO="${REPO:-/root/sourcelibrary}"
BASE="${AUDIT_BASE:-/mnt/HC_Volume_105839809/jobs/convergent-audit-6420}"
RUN="$BASE/${1:-$(date -u +%F)}"
ENV="${AUDIT_ENV:-$REPO/.env.production.local}"
GEM_MODELS="${AUDIT_GEMINI_MODELS:-gemini-3.7-flash-low gemini-3.8-flash-low}"
QUOTA_WAIT="${AUDIT_QUOTA_WAIT:-1800}"
QUOTA_RETRIES="${AUDIT_QUOTA_RETRIES:-8}"
# Appended, not prepended: cron's PATH is /usr/bin:/bin either way, and the test puts its stubs first.
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin" TMPDIR="$BASE/tmp"
mkdir -p "$BASE/tmp"
exec 9>"${AUDIT_LOCK:-/tmp/sl-convergent-audit.lock}"; flock -n 9 || { echo "$(date -u +%FT%TZ) another audit is running"; exit 0; }
cd "$REPO" || exit 1
echo "== $(date -u +%FT%TZ) convergent audit $RUN"
[ -d "$RUN/packets" ] || node --env-file="$ENV" scripts/audit/convergent-audit-weekly.mjs draw --run "$RUN" || exit 1
# Opus: sealed folder per page, Read/Write only (run-readers.sh), 4 at a time, on the box's Claude account.
scripts/eval/second-reader/run-readers.sh "$RUN" opus claude opus read 4
# Gemini through the CLI, one page per call, the #6338 tested path; logs to the shared agy call meter.
node scripts/eval/second-reader/second-reader.mjs cli-requests --run "$RUN" --reader gemini37

# --no-tool-gate: since #6571 (2026-10-12 afternoon) run-cli-arm.py installs the OCR tool gate on every image request,
# and its denial message tells the model to "write the transcription". A reviewer must not be told that. Without the
# gate this is the path #6338 tested: plan mode, and the runner's own nudge when the model asks for a tool.
# One pass over the models: 0 = every page has a reply, 3 = every model is out of quota, else the runner's error.
gemini_reads() {
  local m rc=3
  for m in $GEM_MODELS; do
    python3 scripts/eval/run-cli-arm.py --requests "$RUN/readers/gemini37/requests.jsonl" --out "$RUN/readers/gemini37/cli-out.jsonl" \
      --arm audit6420-gemini37 --model "$m" --job convergent-audit-6420 --kind review --parallel 2 --attempts 4 \
      --no-tool-gate --workdir "$BASE/tmp/cli-ws"
    rc=$?
    [ "$rc" -eq 3 ] || return "$rc"
    echo "$(date -u +%FT%TZ) quota on $m"
  done
  return 3
}
try=0
while :; do
  gemini_reads; rc=$?
  [ "$rc" -eq 3 ] || break
  try=$((try + 1))
  if [ "$try" -gt "$QUOTA_RETRIES" ]; then echo "$(date -u +%FT%TZ) quota still out after $QUOTA_RETRIES waits: scoring without the Gemini reader"; break; fi
  echo "$(date -u +%FT%TZ) every model is out of quota: wait ${QUOTA_WAIT}s (retry $try of $QUOTA_RETRIES)"
  sleep "$QUOTA_WAIT"
done
[ "$rc" -eq 0 ] || echo "$(date -u +%FT%TZ) Gemini reader ended with exit $rc"
node scripts/eval/second-reader/second-reader.mjs cli-assemble --run "$RUN" --reader gemini37
node scripts/audit/convergent-audit-weekly.mjs score --run "$RUN" --post
echo "== $(date -u +%FT%TZ) done"

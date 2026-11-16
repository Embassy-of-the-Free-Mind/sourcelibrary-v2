#!/usr/bin/env bash
# PRIOR ART: scripts/eval/spot-check/fortnightly-draw.sh (a scheduled spot-check draw; it stops at the draw and leaves
# the reads to a routine). This runs the whole #6420 lane D sequence unattended on the Hetzner box: draw, Opus reads
# (claude CLI, subscription), Gemini reads (agy CLI, subscription), score, post on #6420.
#
# Cron (installed by hand, crontab is not read from the repo):
#   0 6 * * 1 /root/sourcelibrary/scripts/audit/convergent-audit-weekly.sh >> /var/log/sourcelibrary/convergent-audit-weekly.log 2>&1
# Finish a run whose second reader did not read (every step skips what is done):
#   scripts/audit/convergent-audit-weekly.sh 2026-10-12
# A spare-lane round (#6781: an account's expiring week, no issue to spend it on): Opus only, a fresh seed, no post;
# scripts/audit/convergent-audit-pool.mjs posts the account-week's rounds as one comment.
#   AUDIT_OPUS_ONLY=1 AUDIT_POST=0 AUDIT_SEED=<n> AUDIT_BASE=<dir> AUDIT_LOCK=<file> scripts/audit/convergent-audit-weekly.sh <run>
#
# THE GEMINI READER AND QUOTA (#6203). On 2026-10-12 the account's quota ran out at 03:30 UTC (lane B's main200 reads
# share it) and reset at 06:35; this ran at 06:00. run-cli-arm.py stops on the first quota error with exit 3, the
# next two steps ran anyway, and the report said "Gemini 0" with a row of dashes and no reason. Now: a quota stop is
# retried (the runner resumes where it stopped) every AUDIT_QUOTA_WAIT seconds, up to AUDIT_QUOTA_RETRIES times, trying
# each model of AUDIT_GEMINI_MODELS in turn; and the scorer names why a reader has no verdicts and leaves that
# reader's rates and the agreement line out rather than printing them empty.
#
# SINGLE-PAGE READS ARE OFF BY DEFAULT (v3#381, #8405; Derek 2026-11-15: QA is the paired-fifths book check, which sees
# page breaks, and it runs every day on cloudlayer, scripts/audit/paired-fifths-daily.sh). The scheduled Monday run is
# now the weekly loop only: labels.mjs reads book_checks, where those verdicts land, then the queue, the second read,
# the digest (with --book-checks) and the risk pool. AUDIT_READ=1 brings back the draw, the Opus and Gemini single-page
# reads and the #6420 report; a spare round (AUDIT_OPUS_ONLY=1) implies it.
set -u
READ="${AUDIT_READ:-${AUDIT_OPUS_ONLY:-0}}"
REPO="${REPO:-/root/sourcelibrary}"
BASE="${AUDIT_BASE:-/mnt/HC_Volume_105839809/jobs/convergent-audit-6420}"
RUN="$BASE/${1:-$(date -u +%F)}"
ENV="${AUDIT_ENV:-$REPO/.env.production.local}"
# 3.7 was withdrawn from agy on 2026-10-12 and now fails with exit 1, not the quota exit 3, so listing it first
# would end the pass before 3.8 is tried.
GEM_MODELS="${AUDIT_GEMINI_MODELS:-gemini-3.8-flash-low}"
QUOTA_WAIT="${AUDIT_QUOTA_WAIT:-1800}"
QUOTA_RETRIES="${AUDIT_QUOTA_RETRIES:-8}"
# Appended, not prepended: cron's PATH is /usr/bin:/bin either way, and the test puts its stubs first.
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin:/root/.local/bin" TMPDIR="$BASE/tmp"
mkdir -p "$BASE/tmp"
exec 9>"${AUDIT_LOCK:-/tmp/sl-convergent-audit.lock}"; flock -n 9 || { echo "$(date -u +%FT%TZ) another audit is running"; exit 0; }
cd "$REPO" || exit 1
echo "== $(date -u +%FT%TZ) convergent audit $RUN"
# The scheduled weekly round (#6420 decision 5, Derek 2026-11-12): 40 random books + 40 pages from the risk score's top
# decile (scripts/audit/risk-pool/current.json), no lane-B stratum. Spare-lane rounds (AUDIT_OPUS_ONLY=1) keep the
# uniform 60 + 20 design, because they are the uniform frame the predictor is trained and checked on.
# The pool the loop step below rebuilds each week ($BASE/risk-pool/current.json) is used when it exists; else the
# committed one. The draw refuses a pool older than 21 days either way.
RISK_POOL="${AUDIT_RISK_POOL:-$BASE/risk-pool/current.json}"; [ -f "$RISK_POOL" ] || RISK_POOL=scripts/audit/risk-pool/current.json
# Spare-lane rounds also add AUDIT_FILL pages (default 20, #244) from the language × half-century cells read least, so
# the heat map on /quality fills in; counted from the runs under AUDIT_FILL_HISTORY (default: $BASE). They are their
# own stratum (cell-fill), so the uniform 60 + 20 above is unchanged. AUDIT_FILL=0 turns it off.
if [ "${AUDIT_OPUS_ONLY:-0}" = 1 ]; then DRAW_ARGS="--fill ${AUDIT_FILL:-20} --fill-history ${AUDIT_FILL_HISTORY:-$BASE}"; else DRAW_ARGS="--books ${AUDIT_BOOKS:-40} --written ${AUDIT_WRITTEN:-0} --risk ${AUDIT_RISK:-40} --risk-pool $RISK_POOL"; fi
if [ "$READ" = 1 ]; then
# shellcheck disable=SC2086
[ -d "$RUN/packets" ] || node --env-file="$ENV" scripts/audit/convergent-audit-weekly.mjs draw --run "$RUN" $DRAW_ARGS ${AUDIT_SEED:+--seed "$AUDIT_SEED"} || exit 1
# Opus: sealed folder per page, Read/Write only (run-readers.sh), 4 at a time, on the box's Claude account.
# A refusal (exit 2: no claude CLI, or one without --restricted) read no page. Say so and stop, so the
# round does not print the "done" line a finished run prints (#6420, spare-audit-20261021-1).
scripts/eval/second-reader/run-readers.sh "$RUN" opus claude opus read 4 || {
  rc=$?; echo "== $(date -u +%FT%TZ) STOPPED: the Opus reader did not run (exit $rc)"; exit "$rc"; }
if [ "${AUDIT_OPUS_ONLY:-0}" = 1 ]; then
  node scripts/audit/convergent-audit-weekly.mjs score --run "$RUN"
  echo "== $(date -u +%FT%TZ) done (Opus only, not posted)"
  exit 0
fi
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
node scripts/audit/convergent-audit-weekly.mjs score --run "$RUN" $([ "${AUDIT_POST:-1}" = 1 ] && echo --post)
else
  echo "== $(date -u +%FT%TZ) no single-page reads (AUDIT_READ=0, v3#381): the weekly loop over book_checks only"
fi
# The weekly loop (#8632), scheduled rounds only. A failure here never fails the audit.
#   1. rebuild the label ledger and the repair queue (read-only, Node), applying every earlier second read whose page
#      still holds the text it was given on ($BASE/loop/second-reads.jsonl);
#   2. the second read (#8632 decision 3, Derek 2026-11-12): up to AUDIT_SECOND_READ_MAX pages flagged by Claude alone
#      are read by Gemini on the AUDIT_SECOND_READ_HOME pool, frozen brief, no tool gate; confirmed pages are queued;
#   3. the digest: findings against the four weeks before, the risk stratum, where flagged pages stand; posted on #8632;
#   4. the risk pool for next week's draw (#8632 decision 5): candidates from the audit frame scored on this week's
#      labels, written to $BASE/risk-pool/current.json (niced: the box runs the paid pipeline).
if [ "${AUDIT_OPUS_ONLY:-0}" != 1 ] && [ "${AUDIT_LOOP:-1}" = 1 ]; then
  LOOP="$BASE/loop/$(basename "$RUN")"; SR="$LOOP/second-read"; mkdir -p "$LOOP"
  # The ledger the second read appends to; the committed seed holds the first second read (2026-11-12, run on gex45).
  SR_LEDGER="$BASE/loop/second-reads.jsonl"
  LABELS_OK=0; QUEUE_OK=0
  node --env-file="$ENV" scripts/eval/error-zoo/labels.mjs "$LOOP" --spare-audit "$BASE" && LABELS_OK=1 \
    || echo "$(date -u +%FT%TZ) weekly loop: the label ledger failed; no queue, second read, digest or risk pool this week"
  [ "$LABELS_OK" = 1 ] && { node --env-file="$ENV" scripts/eval/error-zoo/repair-queue.mjs --labels="$LOOP/labels.jsonl" --out="$LOOP/repair-queue.json" --second-reads="scripts/eval/error-zoo/second-reads-2026-11-12.jsonl,$SR_LEDGER" && QUEUE_OK=1 \
    || echo "$(date -u +%FT%TZ) weekly loop: the repair queue failed; no second read or digest this week (the risk pool still rebuilds)"; }
  if [ "$QUEUE_OK" = 1 ] && [ "${AUDIT_SECOND_READ_MAX:-80}" -gt 0 ]; then
    # key.jsonl is written last by build, so a build that stopped partway is redone, not reused.
    { [ -s "$SR/key.jsonl" ] || { rm -rf "$SR"; node --env-file="$ENV" scripts/eval/error-zoo/second-read.mjs build --queue="$LOOP/repair-queue.json" --run="$SR" --max="${AUDIT_SECOND_READ_MAX:-80}"; }; } \
      && node scripts/eval/second-reader/second-reader.mjs cli-requests --run "$SR" --reader gem-second \
      && { AGY_HOME="${AUDIT_SECOND_READ_HOME:-/root/.agy-james}" python3 scripts/eval/run-cli-arm.py --requests "$SR/readers/gem-second/requests.jsonl" \
             --out "$SR/readers/gem-second/cli-out.jsonl" --arm loop8632-second --model "${GEM_MODELS%% *}" --job loop-8632 --kind review \
             --parallel 2 --attempts 4 --no-tool-gate --workdir "$BASE/tmp/cli-ws"; rc=$?
           # A quota stop (3) keeps what was read; the rest stay at needs-second-read and are picked next week.
           [ "$rc" -eq 0 ] || echo "$(date -u +%FT%TZ) second read: the reader ended with exit $rc$([ "$rc" -eq 3 ] && echo ' (quota on the second pool)'): confirming what was read"; true; } \
      && node scripts/eval/second-reader/second-reader.mjs cli-assemble --run "$SR" --reader gem-second \
      && node --env-file="$ENV" scripts/eval/error-zoo/second-read.mjs confirm --queue="$LOOP/repair-queue.json" --run="$SR" --reader=gem-second --family=gemini --ledger="$SR_LEDGER" \
      || echo "$(date -u +%FT%TZ) second read incomplete: the queue keeps those pages at needs-second-read"
  fi
  [ "$QUEUE_OK" = 1 ] && { node --env-file="$ENV" scripts/eval/error-zoo/loop-week.mjs --base "$BASE" --book-checks --queue "$LOOP/repair-queue.json" --out "$LOOP/digest.md" $([ "${AUDIT_POST:-1}" = 1 ] && echo --post 8632) \
    || echo "$(date -u +%FT%TZ) weekly digest failed"; }
  if [ "$LABELS_OK" = 1 ] && [ "${AUDIT_RISK_REBUILD:-1}" = 1 ]; then
    RP="$LOOP/risk-pool"; mkdir -p "$RP/union" "$BASE/risk-pool"
    # score.py needs numpy and scikit-learn: say so by name rather than as a bare failed step.
    if ! python3 -c 'import numpy, sklearn' 2>/dev/null; then
      echo "$(date -u +%FT%TZ) risk pool NOT rebuilt: python3 here has no numpy/scikit-learn (pip install scikit-learn); the draw keeps the last pool and refuses it after 21 days"
    else
      nice -n 19 node --env-file="$ENV" scripts/eval/error-zoo/pool.mjs --out="$RP" --seed="$(date -u +%Y%m%d)" --exclude="$LOOP/labels.jsonl" \
        && cat "$LOOP/labels.jsonl" "$RP/candidates.jsonl" > "$RP/union/labels.jsonl" \
        && nice -n 19 node --env-file="$ENV" scripts/eval/error-zoo/fetch-pages.mjs "$RP/union" \
        && nice -n 19 python3 scripts/eval/error-zoo/features.py "$RP/union" \
        && nice -n 19 python3 scripts/eval/error-zoo/score.py "$RP/union" --out "$RP/pool-scored.json" \
        && cp "$RP/pool-scored.json" "$BASE/risk-pool/current.json.tmp" && mv "$BASE/risk-pool/current.json.tmp" "$BASE/risk-pool/current.json" \
        && echo "$(date -u +%FT%TZ) risk pool rebuilt: $BASE/risk-pool/current.json" \
        || echo "$(date -u +%FT%TZ) risk pool rebuild failed: next week's draw uses the last pool (refused after 21 days)"
    fi
  fi
fi
echo "== $(date -u +%FT%TZ) done"

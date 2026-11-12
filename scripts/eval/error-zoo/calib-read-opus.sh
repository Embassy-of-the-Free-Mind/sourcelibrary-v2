#!/usr/bin/env bash
# PRIOR ART: scripts/eval/second-reader/run-readers.sh (the sealed Opus reader this calls) and its `collect` step.
# The calibration set's three Opus arms in order (CALIBRATION-SET-DESIGN.md): the rubric on all packets, the rubric
# again on the 30-packet re-read subset, the current brief (no rubric addendum) on block A. Then collect each.
# Usage: scripts/eval/error-zoo/calib-read-opus.sh [/root/jobs/calibration-6420]
set -u
CAL="${1:-/root/jobs/calibration-6420}"
RUNS="$CAL/runs"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
cd "$REPO" || exit 1
RUBRIC="$HERE/RUBRIC-ADDENDUM.md"
EXTRA_BRIEFS="$RUBRIC" scripts/eval/second-reader/run-readers.sh "$RUNS/rubric" opus-rubric claude opus read 4
EXTRA_BRIEFS="$RUBRIC" scripts/eval/second-reader/run-readers.sh "$RUNS/rubric-retest" opus-rubric-r2 claude opus read 4
scripts/eval/second-reader/run-readers.sh "$RUNS/current" opus-current claude opus read 4
node scripts/eval/second-reader/second-reader.mjs collect --run "$RUNS/rubric" --reader opus-rubric
node scripts/eval/second-reader/second-reader.mjs collect --run "$RUNS/rubric-retest" --reader opus-rubric-r2
node scripts/eval/second-reader/second-reader.mjs collect --run "$RUNS/current" --reader opus-current
echo "opus calibration reads done"

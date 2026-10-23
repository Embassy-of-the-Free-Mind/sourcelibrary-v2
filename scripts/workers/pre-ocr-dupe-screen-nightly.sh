#!/bin/bash
# Nightly pre-OCR duplicate screen (#4285). Holds a queued book out of paid OCR when the page images
# say it is the same printing as a copy we already read or are further along with. Never merges,
# hides or writes duplicate_of; same-printing pairs it cannot settle land in the run's review.jsonl.
#
# PRIOR ART: scripts/audit/pre-ocr-duplicate-screen.ts (candidates + decide; this file only chains it)
# and scripts/audit/page-image-same-printing.py (the verdict). The first run was by hand on gex45
# (2026-10-22: 167 holds, 47,696 pages); Derek approved the nightly cron the same day.
#
# Why incremental: the whole queue is ~1,000 candidate pairs and ~75 min on 12+ processes. Every
# verdict is kept in $STATE/verdicts.jsonl and only pairs never seen are image-checked, at most
# $MAX_NEW a night (the rest are found again tomorrow).
# Why the volume: the image cache is ~100 KB a leaf and a 1,300-pair run once filled gex45 (111 GB);
# the cache lives on the volume and is deleted when the run ends.
#
# Install (Hetzner main box crontab):
#   40 2 * * * flock -n /tmp/sl-pre-ocr-dupe-screen.lock /root/sourcelibrary/scripts/workers/pre-ocr-dupe-screen-nightly.sh >> /var/log/sourcelibrary/pre-ocr-dupe-screen.log 2>&1
# Dry run (no holds): PRE_OCR_SCREEN_APPLY=0 scripts/workers/pre-ocr-dupe-screen-nightly.sh
set -u
export PATH=/usr/local/bin:/root/.local/bin:/usr/bin:/bin
cd "$(dirname "$0")/../.." || exit 1
STATE=${PRE_OCR_SCREEN_STATE:-/mnt/HC_Volume_105839809/pre-ocr-screen}
MAX_NEW=${PRE_OCR_SCREEN_MAX_NEW:-150}  # ~2 min a pair at 4 workers on the main box (image fetches dominate)
WORKERS=${PRE_OCR_SCREEN_WORKERS:-4}
APPLY=${PRE_OCR_SCREEN_APPLY:-1}
MAX_DISK_PCT=${PRE_OCR_SCREEN_MAX_DISK_PCT:-90}
TOPIC=${PRE_OCR_SCREEN_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
UV=${UV:-/root/.local/bin/uv}
RUN=$STATE/runs/$(date -u +%F)
CACHE=$STATE/cache
SCREEN="npx tsx --env-file=.env.production.local scripts/audit/pre-ocr-duplicate-screen.ts"

note() {
  echo "$(date -u +%FT%TZ) PAGED: $1"
  curl -s -m 20 -H "Title: pre-OCR duplicate screen" -H "Priority: high" \
    -d "$1. Log: /var/log/sourcelibrary/pre-ocr-dupe-screen.log (#4285)" "$TOPIC" > /dev/null
}
fail() { note "FAILED: $1"; exit 1; }
trap 'rm -rf "$CACHE"' EXIT

mkdir -p "$RUN" || fail "cannot create $RUN"
used=$(df --output=pcent "$STATE" | tail -1 | tr -dc '0-9')
[ "${used:-100}" -lt "$MAX_DISK_PCT" ] || fail "volume ${used}% full, not starting"
echo "$(date -u +%FT%TZ) start run=$RUN apply=$APPLY"

$SCREEN candidates --dir "$RUN" --known "$STATE/verdicts.jsonl" || fail "candidates step failed"
head -n "$MAX_NEW" "$RUN/pairs-new.tsv" > "$RUN/pairs-check.tsv"
echo "new pairs: $(wc -l < "$RUN/pairs-new.tsv"), checking $(wc -l < "$RUN/pairs-check.tsv")"

if [ -s "$RUN/pairs-check.tsv" ]; then
  timeout 4h "$UV" run -q --env-file .env.production.local scripts/audit/page-image-same-printing.py \
    --pairs "$RUN/pairs-check.tsv" --out "$RUN/new-verdicts.jsonl" --wide --cache "$CACHE" --workers "$WORKERS"
  rc=$?
  # The checker writes one line per finished pair, so a timeout still leaves usable verdicts: keep them
  # (the unfinished pairs come back tomorrow) and go on to decide.
  touch "$RUN/new-verdicts.jsonl"
  cat "$RUN/new-verdicts.jsonl" >> "$STATE/verdicts.jsonl"
  cat "$RUN/new-verdicts.jsonl" >> "$RUN/verdicts.jsonl"
  [ "$rc" = 0 ] || note "image check exited $rc after $(wc -l < "$RUN/new-verdicts.jsonl") of $(wc -l < "$RUN/pairs-check.tsv") pairs; kept those, deciding on them"
fi

if [ "$APPLY" = 1 ]; then
  $SCREEN decide --dir "$RUN" --apply || fail "decide step failed"
else
  $SCREEN decide --dir "$RUN" || fail "decide step failed"
fi
echo "$(date -u +%FT%TZ) done; review list: $RUN/review.jsonl"

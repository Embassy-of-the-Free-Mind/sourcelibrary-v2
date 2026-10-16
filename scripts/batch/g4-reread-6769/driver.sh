#!/usr/bin/env bash
# PRIOR ART: scripts/batch/ocr-convergence/driver.mjs (a per-book read → adjudicate → apply loop; it writes through
# cli-ocr.mjs apply --only, holds nothing and retranslates nothing); scripts/workers/claude-job.sh (detached jobs with a
# done marker). This is the #6769 phase-B loop: one book at a time, hold → read → gate → apply → $0 retranslate →
# verify → release, for days, without a session watching it.
#
# #6769 phase B: re-read Rashi/mixed and Greek manuscript books with Gemini 4 Argon low (G4L), $0 only.
#
#   tmux new -d -s g4-reread 'scripts/batch/g4-reread-6769/driver.sh QUEUE.tsv'
#
# QUEUE.tsv: one book per line, `kind<TAB>book_id<TAB>title`. kind rashi|mixed is REFUSED: G4L reads the left column
# of a two-column Hebrew page first on 6/23 pilot pages, and 15/23 with a right-column-first instruction (#6769,
# results/g4-reread-pilot-6769/score-rashi-colfix.json); the Rashi lane waits for an order check. Per book, each step leaves a marker in $STATE/<book_id>/ so a restart resumes:
#   1. skip a book held for ANY other reason (its pages may be about to move: ia-wrong-leaf, containment …)
#   2. hold it (hold-pipeline-books.mjs, reason g4-reread-6769): the 07:30 stale sweep + gap-fill cannot then dispatch
#      paid retranslation of what this writes
#   3. read every page but fitted open-edition text and human-edited pages (cli-ocr.mjs read, G4L, 2 calls in flight;
#      a quota error sleeps through the reset), then once more for the pages that failed
#   4. gate: 30 random pages G4L vs served, judged blind against the image by Opus through `claude -p` (draw.mjs +
#      judge.py), 5 planted controls; pass = 0 worse and 5/5 caught (reread-gate.mjs). FAIL → nothing written, hold
#      released, reported, never retried
#   5. apply (cli-ocr.mjs apply --lane-gate): page_revisions snapshots, every other guard kept
#   6. retranslate exactly the rewritten pages on the $0 CLI route (cli-translate.mjs, G4L), one call at a time
#   7. verify (book.mjs verify: recount, every rewritten translatable page has English newer than its OCR) and release
#      the hold only then; otherwise the book stays held and the comment says which pages
#   8. one comment on #6769
# Stops cleanly before the next book when $STATE/STOP exists. ntfy sourcelibrary-uptime on start, end and death.
set -uo pipefail
QUEUE=${1:?usage: driver.sh QUEUE.tsv}
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
ENV_FILE=${ENV_FILE:-/root/sourcelibrary/.env.production.local}
STATE=${STATE:-/mnt/HC_Volume_105839809/jobs/g4-reread-6769/driver}
LANE=g4-reread-6769; MODEL=gemini-4-argon-low; ISSUE=6769
NTFY=${NTFY:-https://ntfy.sh/sourcelibrary-uptime}
POST=${POST_COMMENTS:-1}   # SUMMARY=0: no final summary comment (a one-book run)
MIN_DISK_GB=${MIN_DISK_GB:-12}
PILOT="$REPO/scripts/eval/g4-reread-pilot-6769"
RELEASE_SENTENCE="every page the g4-reread-6769 lane rewrote carries English written after its new OCR (scripts/batch/g4-reread-6769/book.mjs verify), or the book's gate failed and nothing was written"
export JOB_SCRATCH=${JOB_SCRATCH:-/mnt/HC_Volume_105839809/jobs/g4-reread-6769}
mkdir -p "$STATE"; rm -f "$STATE/driver.done"
cd "$REPO" || exit 2

node_() { node --env-file="$ENV_FILE" "$@"; }
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$STATE/driver.log"; }
ntfy() { curl -s -m 20 -H "Title: g4-reread-6769" -d "$1" "$NTFY" >/dev/null || true; }
progress() { jq -nc --arg at "$(date -u +%FT%TZ)" --arg book "$1" --arg step "$2" --arg detail "${3:-}" '{at:$at,book:$book,step:$step,detail:$detail}' >> "$STATE/progress.jsonl"; }
comment() { if [ "$POST" = 1 ]; then gh issue comment "$ISSUE" --body-file "$1" >/dev/null 2>>"$STATE/driver.log" || log "comment failed: $1"; else log "comment (not posted): $1"; fi; }
# Retry a command on a transient failure (Mongo, network): 3 tries, 5 min apart. Exit 3 (quota / usage limit) is
# handled by the caller, never here.
retry() { local i rc; for i in 1 2 3; do "$@"; rc=$?; [ $rc -eq 0 ] && return 0; [ $rc -eq 3 ] && return 3; log "  exit $rc (try $i): $*"; sleep 300; done; return $rc; }

trap 'rc=$?; [ -f "$STATE/driver.done" ] || ntfy "g4-reread-6769 driver STOPPED (exit $rc) at book $(cat "$STATE/current" 2>/dev/null). Log: $STATE/driver.log"' EXIT

release() { # $1 book, $2 note — releases only OUR hold; restores the status the book held at
  node_ scripts/maintenance/hold-pipeline-books.mjs --release-held --reason "$LANE" --book "$1" --apply >> "$STATE/$1/release.log" 2>&1
}

run_book() {
  local kind=$1 id=$2 title=$3 D="$STATE/$2"
  mkdir -p "$D"; echo "$id" > "$STATE/current"
  [ -f "$D/done" ] && return 0
  local avail; avail=$(df --output=avail -BG / | tail -1 | tr -dc 0-9)
  if [ "${avail:-0}" -lt "$MIN_DISK_GB" ]; then log "root disk ${avail}G < ${MIN_DISK_GB}G: stopping"; ntfy "g4-reread-6769 driver paused: root disk ${avail}G free"; exit 4; fi
  log "== $kind $id $title"; progress "$id" start "$kind"
  case "$kind" in rashi|mixed) log "  Hebrew column order unsolved (#6769): refused"; progress "$id" refused "column order"; return 0;; esac

  # 1–2. page list, hold
  if [ ! -f "$D/step.hold" ]; then
    node_ scripts/batch/g4-reread-6769/book.mjs pages --book="$id" --out="$D/pages.json" > "$D/pages.count.json" 2>>"$D/err.log" || { log "  pages failed"; return 1; }
    local hr; hr=$(jq -r '.hold_reason // ""' "$D/pages.count.json")
    if [ -n "$hr" ] && [ "$hr" != "$LANE" ]; then
      log "  held for $hr: skipped"; progress "$id" skipped "held for $hr"
      printf '**%s** (`%s`, %s): **skipped** — already held for `%s`, so its pages are not this lane'"'"'s to rewrite. Nothing read or written.\n' "$title" "$id" "$kind" "$hr" > "$D/comment.md"
      comment "$D/comment.md"; echo skipped > "$D/done"; return 0
    fi
    if [ "$(jq .to_read "$D/pages.count.json")" -lt 10 ]; then
      log "  under 10 readable pages: skipped (a per-book gate needs 10)"; progress "$id" skipped "too few pages"
      printf '**%s** (`%s`, %s): **skipped** — %s readable pages, under the 10 a per-book gate needs. Nothing read or written.\n' "$title" "$id" "$kind" "$(jq .to_read "$D/pages.count.json")" > "$D/comment.md"
      comment "$D/comment.md"; echo skipped > "$D/done"; return 0
    fi
    echo "$id" > "$D/id.txt"
    retry node_ scripts/maintenance/hold-pipeline-books.mjs --ids "$D/id.txt" --reason "$LANE" --issue "$ISSUE" --release "$RELEASE_SENTENCE" --apply >> "$D/hold.log" 2>&1 || { log "  hold failed"; return 1; }
    touch "$D/step.hold"; progress "$id" held "$(jq -c . "$D/pages.count.json")"
  fi

  # 3. read (twice: the second pass re-reads only what failed)
  if [ ! -f "$D/step.read" ]; then
    for pass in 1 2; do
      retry node_ scripts/batch/cli-ocr.mjs read --page-ids-file="$D/pages.json" --out="$D/read" --model="$MODEL" --concurrency=2 --quota-sleep=1800 --job="$LANE" >> "$D/read.log" 2>&1 || { log "  read failed"; return 1; }
    done
    touch "$D/step.read"; progress "$id" read "$(grep -c ' ok ' "$D/read.log") ok lines"
  fi

  # 4. gate
  if [ ! -f "$D/step.gate" ]; then
    [ -f "$D/judge/key.json" ] || retry node_ "$PILOT/draw.mjs" --book="$id" --tag="$id" --reads="$D/read" --out="$D/judge" >> "$D/gate.log" 2>&1 || { log "  draw failed"; return 1; }
    local round rc
    for round in 1 2 3 4 5 6; do
      python3 "$PILOT/judge.py" --requests "$D/judge/requests.jsonl" --out "$D/judge/verdicts.jsonl" --parallel 2 >> "$D/gate.log" 2>&1; rc=$?
      if [ $rc -eq 3 ]; then log "  claude usage limit: sleeping 30 min"; sleep 1800; continue; fi
      node_ scripts/batch/reread-gate.mjs --lane="$LANE" --model="$MODEL" --reads="$D/read" --key="$D/judge/key.json" --verdicts="$D/judge/verdicts.jsonl" --out="$D/gate.json" >> "$D/gate.log" 2>&1
      jq -e '.reason // "" | test("unjudged") | not' "$D/gate.json" >/dev/null && break
    done
    touch "$D/step.gate"
  fi
  local summary_gate; summary_gate=$(jq -r '"\(.sample.better) better / \(.sample.same) same / \(.sample.worse) worse of \(.sample.n); controls \(.controls.pass)/\(.controls.n)"' "$D/gate.json")
  if [ "$(jq -r .pass "$D/gate.json")" != true ]; then
    release "$id" "gate failed"
    log "  GATE FAIL: $(jq -r .reason "$D/gate.json")"; progress "$id" gate_fail "$(jq -r .reason "$D/gate.json")"
    { printf '**%s** (`%s`, %s): **gate FAILED — nothing written.** %s. Reason: %s. Hold released (status restored). Not retried.\n' "$title" "$id" "$kind" "$summary_gate" "$(jq -r .reason "$D/gate.json")"
      printf '\nReads: %s pages to read (%s fitted open-edition pages and %s human-edited pages never read).\n' "$(jq .to_read "$D/pages.count.json")" "$(jq .fitted "$D/pages.count.json")" "$(jq .human_edited "$D/pages.count.json")"; } > "$D/comment.md"
    comment "$D/comment.md"; cleanup "$D"; echo gate_fail > "$D/done"; return 0
  fi
  progress "$id" gate_pass "$summary_gate"

  # 5. apply
  if [ ! -f "$D/step.apply" ]; then
    retry node_ scripts/batch/cli-ocr.mjs apply --out="$D/read" --lane="$LANE" --lane-gate="$D/gate.json" --reason="#6769 G4L re-read, per-book gate passed ($summary_gate)" --apply > "$D/apply.log" 2>&1 || { log "  apply failed: book stays held"; return 1; }
    ls -t "$D"/read/apply-summary-cli-ocr-*.json | head -1 > "$D/apply-summary.path"
    jq -c .written_page_ids "$(cat "$D/apply-summary.path")" > "$D/written.json"
    touch "$D/step.apply"; progress "$id" applied "$(jq length "$D/written.json") written"
  fi
  local summary; summary=$(cat "$D/apply-summary.path")
  local nw; nw=$(jq length "$D/written.json")

  # 6. retranslate the rewritten pages, $0 CLI
  if [ ! -f "$D/step.translate" ] && [ "$nw" -gt 0 ]; then
    local t rc
    for t in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
      CLI_JOB_NAME="$LANE" node_ scripts/batch/cli-translate.mjs read --page-ids-file="$D/written.json" --out="$D/tr" --model="$MODEL" >> "$D/translate.log" 2>&1; rc=$?
      if [ $rc -eq 3 ]; then log "  agy quota: sleeping 30 min"; sleep 1800; continue; fi
      [ $rc -eq 0 ] || { sleep 300; continue; }
      # one more pass re-reads what failed (an empty read is not 'already read')
      CLI_JOB_NAME="$LANE" node_ scripts/batch/cli-translate.mjs read --page-ids-file="$D/written.json" --out="$D/tr" --model="$MODEL" >> "$D/translate.log" 2>&1; rc=$?
      [ $rc -eq 3 ] && { sleep 1800; continue; }
      break
    done
    retry node_ scripts/batch/cli-translate.mjs apply --out="$D/tr" --reason="#6769: English for the pages the G4L re-read rewrote, \$0 CLI route" --apply > "$D/translate-apply.log" 2>&1 || { log "  translate apply failed: book stays held"; return 1; }
    touch "$D/step.translate"; progress "$id" translated "$(tail -1 "$D/translate-apply.log")"
  fi

  # 6b. a page whose English the door refused (stray script, health) or whose call failed is translated ONCE more,
  # fresh, in its own directory (Grec 1841: 4 of 354 pages carried a stray CJK token, #5734's shape)
  if [ ! -f "$D/step.retry" ] && [ "$nw" -gt 0 ]; then
    node_ scripts/batch/g4-reread-6769/book.mjs verify --book="$id" --written="$summary" --out="$D/verify-pre.json" >> "$D/verify.log" 2>&1
    if [ "$(jq '.stale_ids // [] | length' "$D/verify-pre.json")" -gt 0 ]; then
      jq -c '.stale_ids' "$D/verify-pre.json" > "$D/retry.json"
      local t2 rc2
      for t2 in 1 2 3 4 5 6 7 8 9 10; do
        CLI_JOB_NAME="$LANE" node_ scripts/batch/cli-translate.mjs read --page-ids-file="$D/retry.json" --out="$D/tr-retry" --model="$MODEL" >> "$D/translate.log" 2>&1; rc2=$?
        [ $rc2 -eq 3 ] && { log "  agy quota: sleeping 30 min"; sleep 1800; continue; }
        [ $rc2 -eq 0 ] && break; sleep 300
      done
      retry node_ scripts/batch/cli-translate.mjs apply --out="$D/tr-retry" --reason="#6769: English for rewritten pages, second attempt after a refusal, \$0 CLI route" --apply > "$D/translate-retry-apply.log" 2>&1 || log "  retry apply failed"
    fi
    touch "$D/step.retry"
  fi

  # 7. verify → release
  node_ scripts/batch/g4-reread-6769/book.mjs verify --book="$id" --written="$summary" --out="$D/verify.json" >> "$D/verify.log" 2>&1
  local released="no — kept held"
  if jq -e '.release_ok and (.restores_to != null) and (.hold_reason == "g4-reread-6769")' "$D/verify.json" >/dev/null; then
    release "$id" "verified" && released="yes → \`$(jq -r .restores_to "$D/verify.json")\`"
  fi
  progress "$id" done "released: $released"

  # 8. report
  {
    printf '**%s** (`%s`, %s)\n\n' "$title" "$id" "$kind"
    printf -- '- pages: %s to read; never read: %s fitted open-edition, %s human-edited, %s with no image\n' "$(jq .to_read "$D/pages.count.json")" "$(jq .fitted "$D/pages.count.json")" "$(jq .human_edited "$D/pages.count.json")" "$(jq .no_image "$D/pages.count.json")"
    printf -- '- gate: **PASS**, %s (Opus via `claude -p`, blind, image whole + halves)\n' "$summary_gate"
    printf -- '- OCR **written %s**; skipped %s\n' "$nw" "$(jq -c .skipped "$summary")"
    printf -- '- English (G4L via agy, $0): %s\n' "$(tail -1 "$D/translate-apply.log" 2>/dev/null | sed 's/   / /g')"
    [ -f "$D/translate-retry-apply.log" ] && printf -- '- English, second attempt on %s refused pages: %s\n' "$(jq length "$D/retry.json")" "$(tail -1 "$D/translate-retry-apply.log" | sed 's/   / /g')"
    printf -- '- verify: %s fresh, %s not translatable, stale %s; counts %s\n' "$(jq .fresh "$D/verify.json")" "$(jq .not_translatable "$D/verify.json")" "$(jq -c .stale "$D/verify.json")" "$(jq -c .counts "$D/verify.json")"
    printf -- '- hold released: %s%s\n' "$released" "$(jq -r 'if .gap_fill_after_release then " (under the 90% gap-fill bar: its never-translated pages are as eligible as before)" else "" end' "$D/verify.json")"
  } > "$D/comment.md"
  comment "$D/comment.md"
  cleanup "$D"
  echo ok > "$D/done"
}

cleanup() { rm -rf "$1"/read/ws-* "$1"/judge/img; }   # images only; reads, verdicts and logs stay

log "driver start: $(wc -l < "$QUEUE") books in $QUEUE"
ntfy "g4-reread-6769 driver started: $(wc -l < "$QUEUE") books (#6769). touch $STATE/STOP to stop after the current book."
while IFS=$'\t' read -r kind id title; do
  [ -z "$id" ] && continue
  if [ -f "$STATE/STOP" ]; then log "STOP file: stopping before $id"; break; fi
  run_book "$kind" "$id" "$title" || { log "  $id: error, see $STATE/$id; moving on"; progress "$id" error ""; }
done < "$QUEUE"

# final summary
{
  echo "## g4-reread-6769 driver: summary"
  echo
  echo "| outcome | books |"; echo "|---|---|"
  for d in "$STATE"/*/; do [ -f "$d/done" ] && cat "$d/done"; [ -f "$d/done" ] || echo "unfinished"; done | sort | uniq -c | awk '{print "| " $2 " | " $1 " |"}'
  echo
  echo "Pages written: $(cat "$STATE"/*/written.json 2>/dev/null | jq -s 'map(length) | add // 0'). Per-book comments above; state in \`$STATE\`."
} > "$STATE/summary.md"
[ -f "$STATE/STOP" ] || [ "${SUMMARY:-1}" != 1 ] || comment "$STATE/summary.md"
touch "$STATE/driver.done"
ntfy "g4-reread-6769 driver finished: $(head -c 300 "$STATE/summary.md" | tr '\n' ' ')"
log "driver done"

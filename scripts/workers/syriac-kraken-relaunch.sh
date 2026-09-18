#!/bin/bash
# PRIOR ART: /root/tibetan-reocr/relaunch.sh (#4523, not in the repo) — the same cron-driven
# self-heal: keep N worker shards alive over a todo file whose per-page outputs are idempotent,
# then run the apply step. This one is in the repo so the lane survives the box.
#
# Syriac Kraken lane keeper (#4883). Cron: */30. Idempotent; safe to run while shards work.
#   1. keep SHARDS `work` processes alive (each exits at end of plan; outputs are per page,
#      so a restart re-scans cheaply and never redoes a page)
#   2. apply what has been read (revisions first, loop-guarded, counters, re-enrolment)
#   3. release held imports whose pages are all done (to `queued`, for the Latin leaves)
# Nothing here hides a page or a book. No Gemini call is made.
#
# REPO is the checkout the lane runs from. Until PR #4883's branch merges it is a worktree of
# /root/sourcelibrary on that branch; after the merge, point it back at /root/sourcelibrary
# (`lesson_a_service_pointing_into_a_worktree`: a merged worktree is a time bomb).
REPO=${SYRIAC_KRAKEN_REPO:-/root/sourcelibrary}
DIR=${SYRIAC_KRAKEN_DIR:-/root/syriac-kraken}
SHARDS=${SYRIAC_KRAKEN_SHARDS:-2}
ENV=/root/sourcelibrary/.env.production.local
export OMP_NUM_THREADS=${OMP_NUM_THREADS:-2}
mkdir -p "$DIR"
LANE="$REPO/scripts/workers/syriac-kraken-lane.mjs"
[ -f "$LANE" ] || { echo "$(date -Is) no lane script at $LANE"; exit 0; }
[ -f "$DIR/plan.jsonl" ] || { echo "$(date -Is) no plan yet — run: node --env-file=$ENV $LANE plan"; exit 0; }
[ -f "$DIR/PAUSE" ] && { echo "$(date -Is) paused ($DIR/PAUSE present)"; exit 0; }

cd "$REPO" || exit 1
for ((s = 0; s < SHARDS; s++)); do
  if ! pgrep -f "syriac-kraken-lane.mjs work --shard $s --shards $SHARDS" > /dev/null; then
    # --retry-failed: a shard restarts only at end of plan or after a crash, so re-trying the
    # fetch/kraken failures then is cheap — measured 2026-09-18, 14 of 14 early failures were
    # transient HTTP 500s from the image host, all of which fetched fine minutes later.
    nohup node --env-file="$ENV" "$LANE" work --shard "$s" --shards "$SHARDS" --dir "$DIR" --retry-failed >> "$DIR/work-$s.log" 2>&1 &
    disown
    echo "$(date -Is) started shard $s/$SHARDS (pid $!)"
  fi
done

# Reading and writing are separable: SYRIAC_KRAKEN_NO_APPLY=1 (or a NO_APPLY file in DIR)
# keeps the shards reading while the apply pass waits — e.g. for the translation-staleness
# writer (#4927) to land, so re-read pages are flagged for re-translation the moment they land.
if [ -n "${SYRIAC_KRAKEN_NO_APPLY:-}" ] || [ -f "$DIR/NO_APPLY" ]; then echo "$(date -Is) apply held (NO_APPLY)"; exit 0; fi

# apply + release under their own lock so two cron ticks never apply the same book twice
flock -n "$DIR/apply.lock" bash -c "
  node --env-file=$ENV $LANE apply --apply --dir $DIR >> $DIR/apply.log 2>&1
  node --env-file=$ENV $LANE release --apply --dir $DIR >> $DIR/apply.log 2>&1
" || echo "$(date -Is) apply already running"

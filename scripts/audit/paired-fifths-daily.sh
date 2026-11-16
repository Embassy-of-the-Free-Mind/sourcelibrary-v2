#!/usr/bin/env bash
# PRIOR ART: scripts/audit/spare-paired-fifths.mjs (draw / run / pool: the round itself, unchanged here) and
# scripts/workers/spare-lane.py (starts that round only in an account's last 48 h, so it almost never ran). Neither
# runs it on a calendar; this is the cron driver that does (v3#381), nothing more.
#
# The daily paired-fifths lane (v3#381, Derek 2026-11-15): every day, 40 served books get the paired-fifths book
# check (24 uniform by language x print/manuscript cell, emptiest cell this month first; 16 from book-check-priority),
# Opus via `claude -p` on this box's subscription login. Verdicts are book_checks rows; the Monday loop
# (scripts/eval/error-zoo/labels.mjs → repair-queue.mjs) turns serious OCR findings on served pages into repair rows.
# Nothing here writes page text.
#
#   paired-fifths-daily.sh day    draw (kept if today's exists) and run today's round: one run dir per UTC day,
#                                 resumable; at most PF_DAILY_MAX_CALLS (200) calls a day across every resume;
#                                 the pace guard stops it at weekly ROUTE_JUDGE_WEEKLY_MAX (85%) or 5-hour 95%.
#   paired-fifths-daily.sh week   pool the seven days before today (Monday..Sunday) into ONE comment on v3#381,
#                                 once (a marker file per week).
#
# Cron: infrastructure/cloudlayer-crontab; registered in scripts/lib/lanes.mjs CRON_ROWS (cloudlayer-paired-fifths-*).
set -uo pipefail

SL=${PF_DAILY_SL:-/data/scratch/sl/sourcelibrary}
BASE=${PF_DAILY_BASE:-/data/scratch/sl/paired-fifths-daily}
CAP=${PF_DAILY_MAX_CALLS:-200}
UNIFORM=${PF_DAILY_UNIFORM:-24}
RISK=${PF_DAILY_RISK:-16}
ISSUE=${PF_DAILY_ISSUE:-381}
REPO=${PF_DAILY_REPO:-Embassy-of-the-Free-Mind/sourcelibrary-v3}
# The lane-judge pace guard's own default. Not the spare lane's 99% drain: this lane runs every day, not at week's end.
export ROUTE_JUDGE_WEEKLY_MAX=${ROUTE_JUDGE_WEEKLY_MAX:-85}
NODE=(node --no-warnings "--env-file=$SL/.env.production.local" scripts/audit/spare-paired-fifths.mjs)

mkdir -p "$BASE"
cd "$SL" || exit 1
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

case "${1:-}" in
  day)
    exec 9>"$BASE/.lock"
    flock -n 9 || { echo "$(stamp) day: a round is already running here; skipped"; exit 0; }
    [ -f "$BASE/STOP" ] && { echo "$(stamp) day: $BASE/STOP exists ($(head -c 200 "$BASE/STOP")); skipped"; exit 0; }
    RUN="$BASE/pf-daily-$(date -u +%Y%m%d)"
    echo "$(stamp) day: $RUN (cap $CAP calls, weekly max $ROUTE_JUDGE_WEEKLY_MAX%)"
    "${NODE[@]}" draw --run "$RUN" --uniform "$UNIFORM" --risk "$RISK" || { echo "$(stamp) day: draw failed"; exit 1; }
    "${NODE[@]}" run --run "$RUN" --concurrency 5 --max-calls "$CAP" >> "$RUN/run.log" 2>&1
    rc=$?
    tail -n 4 "$RUN/run.log" | sed 's/^/    /'
    echo "$(stamp) day: run exit $rc"
    ;;
  week)
    # The week that ended yesterday: Monday..Sunday when cron runs this on Monday.
    WEEK=$(date -u -d '7 days ago' +%Y%m%d)
    MARK="$BASE/posted-$WEEK"
    [ -f "$MARK" ] && { echo "$(stamp) week $WEEK: already posted ($(cat "$MARK"))"; exit 0; }
    runs=()
    for i in 7 6 5 4 3 2 1; do d="$BASE/pf-daily-$(date -u -d "$i days ago" +%Y%m%d)"; [ -f "$d/draw.json" ] && runs+=("$d"); done
    [ ${#runs[@]} -eq 0 ] && { echo "$(stamp) week $WEEK: no daily round ran; nothing to post"; exit 0; }
    out=$("${NODE[@]}" pool --title "Daily paired-fifths lane" --label "week from $WEEK, cloudlayer" --post --issue "$ISSUE" --repo "$REPO" "${runs[@]}") || { echo "$(stamp) week $WEEK: pool failed"; exit 1; }
    url=$(printf '%s\n' "$out" | grep -o 'https://github.com/[^ ]*' | tail -n 1)
    echo "${url:-posted} $(stamp)" > "$MARK"
    echo "$(stamp) week $WEEK: ${#runs[@]} round(s) pooled → ${url:-posted}"
    ;;
  *)
    echo "usage: paired-fifths-daily.sh day | week" >&2; exit 2 ;;
esac

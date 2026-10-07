#!/usr/bin/env bash
# PRIOR ART: scripts/catalog-coverage/archive-acquired-cron.sh (the hourly Hetzner runner — one host-blind
#   lane, flock'd, 50-minute ceiling; this is the same bounded cycle, one per HOST, looping);
#   scripts/catalog-coverage/archive-acquired-mac.sh (the laptop lane — same loop shape, but its own egress
#   address and a network guard this box does not need).
#
# One archiver lane per image host (#4397). Each lane is its own process, so each gets its own limiter
# state and its own circuit breaker: a host that throttles or blocks stalls its own lane and nobody else's.
# The hourly cron (archive-acquired-cron.sh) is untouched and keeps draining acquisition_queue.
#
#   LANE=heidelberg ARCHIVE_ARGS="--campaign acquisition-wave-2026-10 --hosts digi.ub.uni-heidelberg.de" \
#     scripts/catalog-coverage/archive-lane.sh >> /var/log/sourcelibrary/lane-heidelberg.log 2>&1
#
# Typically run in tmux: tmux new -d -s lane-heidelberg '... archive-lane.sh >> ...log 2>&1'
#
# MEMORY, NOT THROUGHPUT, IS THE BUDGET. archive-acquired-cron.sh records why: JP2 pages decode in
# `opj_decompress` at ~1 GB RSS each, and 8 of them on this 15 GB box took cron.service down for 25 hours
# (2026-08-31). Pages in flight per lane = ARCHIVE_CONCURRENCY × ARCHIVE_PAGE_CONCURRENCY, and the SUM over
# all lanes on top of the cron's 6 is what has to fit. Keep the defaults small (1 × 2); a lane on a 2/s host
# does not need more than two pages in flight to saturate its rate.
#
# RATE: the per-host limiter is per PROCESS. A lane on a host the hourly cron also reaches (e-rara,
# gallica) must take a share of that host's budget with --host-rate, which can only lower a rate.
set -u
cd "$(dirname "$0")/../.." || exit 1
# A worktree has no .env.production.local (gitignored, lives in the main checkout). Say which one is used:
# a silently wrong env is how a lane reports an empty queue (credential-injection.md).
ENV_FILE=".env.production.local"
if [ ! -f "$ENV_FILE" ] && [ -f "../../../$ENV_FILE" ]; then ENV_FILE="../../../$ENV_FILE"; fi
if [ ! -f "$ENV_FILE" ]; then echo "$(date -u +%FT%TZ) no .env.production.local here or in the main checkout — exiting"; exit 1; fi
set -a; source "$ENV_FILE"; set +a

LANE="${LANE:?set LANE=<name>}"
ARGS="${ARCHIVE_ARGS:?set ARCHIVE_ARGS (at least --hosts or --exclude-hosts)}"
case "$ARGS" in *--hosts*|*--exclude-hosts*) ;; *) echo "ARCHIVE_ARGS has no --hosts/--exclude-hosts: that is the host-blind cron lane, not a host lane — refusing"; exit 2 ;; esac
BATCH="${ARCHIVE_BATCH:-40}"
CONCURRENCY="${ARCHIVE_CONCURRENCY:-1}"
PAGE_CONCURRENCY="${ARCHIVE_PAGE_CONCURRENCY:-2}"
MAX_MINUTES="${ARCHIVE_MAX_MINUTES:-50}"
IDLE_SLEEP="${ARCHIVE_IDLE_SLEEP:-900}"
LOCK="/tmp/sl-arch-lane-${LANE}.lock"

stamp() { date -u +%FT%TZ; }

exec 9>"$LOCK"
if ! flock -n 9; then echo "$(stamp) lane $LANE: lock $LOCK held by another runner — exiting"; exit 0; fi

echo "$(stamp) lane $LANE: env $(cd "$(dirname "$ENV_FILE")" && pwd)/.env.production.local, batch $BATCH, ${CONCURRENCY}×${PAGE_CONCURRENCY} pages in flight, ceiling ${MAX_MINUTES}m, args: $ARGS"
while true; do
  out=$(mktemp)
  # shellcheck disable=SC2086 — ARGS is a flag list by design
  timeout --signal=TERM --kill-after=60s "${MAX_MINUTES}m" npx tsx scripts/catalog-coverage/archive-acquired.ts \
    --batch "$BATCH" --concurrency "$CONCURRENCY" --page-concurrency "$PAGE_CONCURRENCY" $ARGS 2>&1 | tee "$out"
  rc=${PIPESTATUS[0]}
  case "$rc" in
    0|124|137|143) ;;
    3) echo "$(stamp) lane $LANE: SOURCE BLOCKED (exit 3) — stopping this lane. Do not auto-retry a 403; ask the institution."; rm -f "$out"; exit 3 ;;
    *) echo "$(stamp) lane $LANE: run exited $rc — sleeping ${IDLE_SLEEP}s before retrying" ; sleep "$IDLE_SLEEP" ;;
  esac
  # A cycle that found nothing on this lane sleeps instead of re-scanning in a tight loop.
  if grep -qE "starting: 0 book" "$out"; then echo "$(stamp) lane $LANE: nothing to do — sleeping ${IDLE_SLEEP}s"; sleep "$IDLE_SLEEP"; fi
  rm -f "$out"
done

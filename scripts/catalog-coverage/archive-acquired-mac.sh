#!/usr/bin/env bash
# PRIOR ART: scripts/catalog-coverage/archive-acquired-cron.sh (the Hetzner hourly runner — this is the same
#   archiver on a second egress address, looping instead of cron'd, gated by the Mac's network guard);
#   scripts/workers/archive-iiif-daemon.sh (the Mac's IIIF/e-codices loop — different worker, different backlog).
#
# Laptop archive lane (#4404 step 3, the throughput half): drain acquisition_queue rows whose page images live
# on hosts that rate-limit the Hetzner address but serve a residential/WARP one, NEWEST FIRST so fresh
# acquisitions never wait behind the backlog and the two lanes meet in the middle. Measured 2026-09-11: MDZ
# answered 429 to Hetzner in 60 ms while ten concurrent full-res fetches from the Mac all returned 200 in 3–4 s.
#
# Runs as a launchd KeepAlive agent (scripts/catalog-coverage/org.sourcelibrary.archive-acquired-mac.plist).
# Each cycle is bounded like the Hetzner runner, so a wedged run dies before it can hold the lane for hours.
# Logs to /tmp/archive-acquired-mac.log.
set -u
cd "$(dirname "$0")/../.." || exit 1
# A worktree checkout (.claude/worktrees/<name>) has no .env.production.local — the file is gitignored and
# lives in the main checkout three levels up. Say which one was used: a silently wrong env is how a lane
# reports an empty queue (credential-injection.md).
ENV_FILE=".env.production.local"
if [ ! -f "$ENV_FILE" ] && [ -f "../../../$ENV_FILE" ]; then ENV_FILE="../../../$ENV_FILE"; fi
if [ ! -f "$ENV_FILE" ]; then echo "$(date -u +%FT%TZ) no .env.production.local here or in the main checkout — exiting"; exit 1; fi
echo "$(date -u +%FT%TZ) env: $(cd "$(dirname "$ENV_FILE")" && pwd)/.env.production.local"
set -a; source "$ENV_FILE"; set +a

HOSTS="${ARCHIVE_HOSTS:-api.digitale-sammlungen.de}"
BATCH="${ARCHIVE_BATCH:-120}"
CONCURRENCY="${ARCHIVE_CONCURRENCY:-4}"
PAGE_CONCURRENCY="${ARCHIVE_PAGE_CONCURRENCY:-4}"
MAX_MINUTES="${ARCHIVE_MAX_MINUTES:-50}"
# Per-machine network guard. Checked every cycle and every minute during one; FAILS OPEN when absent.
# BULK_NET_ALLOW_ONLY=1 makes the guard deny everything except networks pinned in ~/.config/bulk-net-allow
# (Derek 2026-09-11: "only do it on wifido"). Pinned by signature — gateway hardware address + DHCP
# server — because macOS 15+ hides the SSID from tools without Location permission. Pin the home network
# once with `~/bin/bulk-net-guard.sh --pin wifido` while on it; set ARCHIVE_ALLOW_ONLY=0 to go back to
# the deny-list behaviour.
GUARD="${BULK_NET_GUARD:-$HOME/bin/bulk-net-guard.sh}"
export BULK_NET_ALLOW_ONLY="${ARCHIVE_ALLOW_ONLY:-1}"
# GNU timeout is `gtimeout` from coreutils on macOS. Without it, perl's alarm() survives exec, so the
# archiver inherits a SIGALRM deadline it does not handle and is terminated at the ceiling.
TIMEOUT=$(command -v gtimeout || command -v timeout || true)

stamp() { date -u +%FT%TZ; }

while true; do
  if [ -x "$GUARD" ] && ! "$GUARD" --why; then
    echo "$(stamp) PARKED — metered link, re-checking in 10m"; sleep 600; continue
  fi
  echo "$(stamp) archive-acquired-mac: hosts $HOSTS, batch $BATCH, concurrency $CONCURRENCY×$PAGE_CONCURRENCY, newest first, ceiling ${MAX_MINUTES}m"
  # Run the archiver in the background and re-check the guard every minute while it runs: the guard at
  # cycle start is not enough when a cycle is 50 minutes long and a plane boards in the middle of it.
  # On DENY the archiver gets SIGTERM, which it handles (in-flight pages are abandoned, the next cycle
  # resumes from the pages still lacking archived_photo) — see its own shutdown note.
  if [ -n "$TIMEOUT" ]; then
    "$TIMEOUT" --signal=TERM --kill-after=60s "${MAX_MINUTES}m" npx tsx scripts/catalog-coverage/archive-acquired.ts \
      --batch "$BATCH" --concurrency "$CONCURRENCY" --page-concurrency "$PAGE_CONCURRENCY" --newest-first --hosts "$HOSTS" &
  else
    perl -e 'alarm shift; exec @ARGV' "$((MAX_MINUTES * 60))" npx tsx scripts/catalog-coverage/archive-acquired.ts \
      --batch "$BATCH" --concurrency "$CONCURRENCY" --page-concurrency "$PAGE_CONCURRENCY" --newest-first --hosts "$HOSTS" &
  fi
  child=$!
  parked=0
  while kill -0 "$child" 2>/dev/null; do
    sleep 60
    if [ -x "$GUARD" ] && ! "$GUARD" --why; then
      echo "$(stamp) link became metered mid-cycle — stopping the archiver"
      # $child is a wrapper (timeout/perl -> npx -> node); signal every process running the script
      # so the node worker itself gets TERM, not just the wrapper. Only this lane runs it on the Mac.
      pkill -TERM -f 'scripts/catalog-coverage/archive-acquired.ts' 2>/dev/null
      kill -TERM "$child" 2>/dev/null
      parked=1
      break
    fi
  done
  wait "$child"
  rc=$?
  if [ "$parked" -eq 1 ]; then echo "$(stamp) PARKED mid-cycle — re-checking in 10m"; sleep 600; continue; fi
  case "$rc" in
    0)   echo "$(stamp) cycle finished; next in 5m"; sleep 300 ;;
    3)   # HostBlocked (401/403): the source refused this address. Never auto-retry into a block.
         echo "$(stamp) SOURCE BLOCKED (exit 3) — parking this lane for 6h; check the ABORTED line above and the institution before resuming"; sleep 21600 ;;
    124|137|142) echo "$(stamp) cycle killed at the ${MAX_MINUTES}m ceiling; resuming"; sleep 30 ;;
    *)   echo "$(stamp) cycle exited $rc; retry in 15m"; sleep 900 ;;
  esac
done

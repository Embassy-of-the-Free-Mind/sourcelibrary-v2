#!/usr/bin/env bash
# Steady-state archiver runner (#4404). Committed rather than inlined in the
# crontab for the same reason acquire-catchup.sh is: ops logic that lives only
# on the box is invisible to every session and cannot be reviewed.
#
# Suggested crontab (Hetzner), replacing the inline invocation:
#   45 * * * * /root/sourcelibrary/scripts/catalog-coverage/archive-acquired-cron.sh >> /var/log/sourcelibrary/archive-acquired.log 2>&1
#
# ── Why this exists ──────────────────────────────────────────────────────────
#
# The inline cron ran `flock -n /tmp/sl-arch-acq.lock ... archive-acquired.ts`
# with no time bound. Two failure modes followed from that, and both were SILENT:
#
#   1. A run that hangs holds the lock indefinitely. Every subsequent hourly cron
#      then exits 1 from `flock -n` and writes NOTHING to the log. On 2026-08-30
#      one run held the lock for 1h24m; the archiver looked dead for three hours
#      and the only way to tell a stall from an empty queue was to query Mongo.
#
#   2. `flock -n` failing is indistinguishable from "nothing to do" in the log,
#      because both produce no output at all.
#
# Steadiness is the goal here, not speed. Acquisition legitimately runs far ahead
# of archiving — that is by design, the queue is the buffer. What matters is that
# the archiver keeps making progress every hour without a human noticing it stopped.
#
# So: bound the run, and make every outcome say something.

set -u
cd "$(dirname "$0")/../.." || exit 1
set -a; source .env.production.local; set +a

BATCH="${ARCHIVE_BATCH:-240}"
# Concurrency is a MEMORY budget here, not a throughput dial.
#
# JP2 pages are decoded by `opj_decompress`, an external binary the Node heap
# limits cannot touch. Measured on the box 2026-08-31: ~1.0 GB RSS each
# (total-vm 1.48 GB). At the previous default of 8 that is ~8 GB of decoders
# against 15 GB of RAM shared with the rest of the pipeline — and on
# 2026-08-31 06:41 it went global-OOM. The kernel killed `opj_decompress`
# repeatedly (687 OOM events in syslog) and took **cron.service itself** down
# with it, so EVERY scheduled job on the box stopped for 25 hours: archiving,
# the hourly auto-pull, health snapshots, the lot. Nothing alarmed, because a
# dead scheduler writes no logs to notice.
#
# It also explains the archiver's own numbers: the run before the outage logged
# 284 pages ok against 379 "failed" at 0.10 pages/s. Those failures were mostly
# our own decoders being OOM-killed, not sources refusing us — so a lower
# concurrency should RAISE net throughput, not lower it.
#
# 4 keeps peak decoder memory near 4 GB with headroom for node + the workers
# that share this machine. Raise it only against measured `free -g` headroom
# under a real run, never on assumption.
CONCURRENCY="${ARCHIVE_CONCURRENCY:-4}"

# Ceiling below the hourly interval, so a stuck run is always dead before the
# next one is due and can never chain into a multi-hour silent outage. The
# archiver is idempotent — archiveIiif only fetches pages lacking archived_photo
# — so a killed run resumes rather than losing work.
MAX_MINUTES="${ARCHIVE_MAX_MINUTES:-50}"

stamp() { date -u +%FT%TZ; }

exec 9>/tmp/sl-arch-acq.lock
if ! flock -n 9; then
  # Previously silent. A held lock is the single most useful thing to know here:
  # it means a prior run is still going (fine, if it is progressing — check the
  # heartbeat) or wedged (not fine).
  echo "$(stamp) SKIPPED — lock held by a running archiver; check the heartbeat in this log"
  exit 0
fi

echo "$(stamp) archive-acquired-cron: batch $BATCH, concurrency $CONCURRENCY, ceiling ${MAX_MINUTES}m"

# --signal=TERM then KILL after a grace period, so the run gets a chance to
# finish its in-flight page and close Mongo cleanly.
timeout --signal=TERM --kill-after=60s "${MAX_MINUTES}m" \
  npx tsx scripts/catalog-coverage/archive-acquired.ts --batch "$BATCH" --concurrency "$CONCURRENCY"
rc=$?

case "$rc" in
  0)   echo "$(stamp) run finished cleanly" ;;
  3)   # archive-acquired exits 3 on HostBlocked (401/403 — a rights refusal or a
       # real block). Never auto-retried; the script has already said which host.
       echo "$(stamp) run stopped: source blocked (exit 3) — see the ABORTED line above" ;;
  124) echo "$(stamp) run KILLED at the ${MAX_MINUTES}m ceiling — it was still working or wedged; the next hour resumes where it stopped" ;;
  137) echo "$(stamp) run KILLED (SIGKILL after grace) at the ${MAX_MINUTES}m ceiling" ;;
  *)   echo "$(stamp) run exited $rc" ;;
esac

exit 0

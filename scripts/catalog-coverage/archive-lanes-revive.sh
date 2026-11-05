#!/usr/bin/env bash
# PRIOR ART: scripts/catalog-coverage/archive-lane.sh (one host lane, looping; this only (re)starts it);
#   scripts/catalog-coverage/archive-acquired-cron.sh (the hourly host-blind lane — cron-driven, so it
#   survives what killed the lanes; this gives the host lanes the same property).
#
# Cron watchdog for archiver host lanes (#5457, #5448). Run from cron every 10 minutes on each box; for
# every lane of THIS box that has no tmux session `lane-<name>`, start one. The lanes of the 2026-10
# acquisition wave ran in tmux sessions started by hand. At 13:22 UTC on 2026-10-01 the OOM killer took
# root's `systemd --user` manager, every tmux pane went with it, and nothing restarted them for five days.
#
# THE TABLE (#5448 step 4): scripts/catalog-coverage/archive-lanes.json, committed, one row per lane with
# its box, hosts, providers, rate and page concurrency; archive-lanes.mjs --conf prints this box's rows.
# The box is ARCHIVE_LANES_BOX, else derived from the hostname (archive-lanes.mjs thisBox()).
#
# LEGACY: /etc/sourcelibrary/archive-lanes.conf (override with ARCHIVE_LANES_CONF) is still read, one lane
# per line `<name>|<page concurrency>|<archive-acquired args>`, so lanes hand-listed there before the table
# keep being revived. A name that is also in the table is taken from the table. Move the rest into the table.
#
# A BLOCKED LANE STAYS DOWN. archive-lane.sh exits 3 when its host answers 401/403 in a streak (a refusal,
# never auto-retried, archive-fetch-failures.md) and leaves $STATE/<name>.blocked. Without that marker this
# watchdog restarted it ten minutes later, into the same refusal, forever. Delete the marker to let it start.
#
# MEMORY: the pages in flight across all lanes of a box add to that box's other archivers (on main, the
# hourly cron's 6, see archive-lane.sh). The table's box_page_budget caps each box; its test enforces it.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
LANE_SH="$HERE/archive-lane.sh"
CONF="${ARCHIVE_LANES_CONF:-/etc/sourcelibrary/archive-lanes.conf}"
LOGD="${ARCHIVE_LANES_LOGDIR:-/var/log/sourcelibrary}"
STATE="${ARCHIVE_LANES_STATE:-/var/tmp/sl-archive-lanes}"
# Cgroup for the lane processes where the box has one (l7a: sourcelibrary.slice, 14 GB for all SL work).
SLICE="${ARCHIVE_LANES_SLICE:-}"
mkdir -p "$LOGD" "$STATE" 2>/dev/null

stamp() { date -u +%FT%TZ; }

table=$(node "$HERE/archive-lanes.mjs" --conf 2>&1) || { echo "$(stamp) archive-lanes.mjs failed: $table"; table=""; }
legacy=""
[ -f "$CONF" ] && legacy=$(grep -v '^[[:space:]]*#' "$CONF" | grep -v '^[[:space:]]*$')
table_names=" $(printf '%s\n' "$table" | cut -d'|' -f1 | tr '\n' ' ') "

start_lane() {
  local name="$1" pc="$2" args="$3"
  if [ -f "$STATE/$name.blocked" ]; then
    # Say it once a day, not every ten minutes.
    [ "$(date -u +%H%M)" \< "0010" ] && echo "$(stamp) lane-$name stays down: $(cat "$STATE/$name.blocked") — delete $STATE/$name.blocked to restart it"
    return
  fi
  tmux has-session -t "=lane-$name" 2>/dev/null && return
  echo "$(stamp) lane-$name has no tmux session — starting it ($pc pages in flight; $args)"
  local env="LANE='$name' ARCHIVE_PAGE_CONCURRENCY='$pc' ARCHIVE_ARGS='$args' ARCHIVE_LANES_STATE='$STATE'"
  if [ -n "$SLICE" ]; then
    tmux new -d -s "lane-$name" "$env systemd-run --quiet --scope --slice='$SLICE' '$LANE_SH' >> '$LOGD/lane-$name.log' 2>&1"
  else
    tmux new -d -s "lane-$name" "$env '$LANE_SH' >> '$LOGD/lane-$name.log' 2>&1"
  fi
}

while IFS='|' read -r name pc args; do
  [ -n "$name" ] && start_lane "$name" "$pc" "$args"
done <<< "$table"
while IFS='|' read -r name pc args; do
  case "$name" in ''|'#'*) continue ;; esac
  case "$table_names" in *" $name "*) continue ;; esac   # the table's row wins
  start_lane "$name" "$pc" "$args"
done <<< "$legacy"

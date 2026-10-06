#!/usr/bin/env bash
# PRIOR ART: scripts/catalog-coverage/archive-lane.sh (one host lane, looping; this only (re)starts it);
#   scripts/catalog-coverage/archive-acquired-cron.sh (the hourly host-blind lane — cron-driven, so it
#   survives what killed the lanes; this gives the host lanes the same property).
#
# Cron watchdog for archiver host lanes (#5457). Run from cron every 10 minutes; for every lane listed in
# the config file that has no tmux session `lane-<name>`, start one. The lanes of the 2026-10 acquisition
# wave ran in tmux sessions started by hand. At 13:22 UTC on 2026-10-01 the OOM killer took root's
# `systemd --user` manager, every tmux pane went with it, and nothing restarted them for five days.
#
# Config: /etc/sourcelibrary/archive-lanes.conf (override with ARCHIVE_LANES_CONF). One lane per line:
#   <name>|<page concurrency>|<archive-acquired args>
#   vatican|1|--campaign acquisition-wave-2026-10 --hosts digi.vatlib.it --host-rate digi.vatlib.it=0.1
# Lines starting with # are ignored. No file means no lanes: the script is a no-op until a lane is listed.
# To retire a lane, delete its line and `tmux kill-session -t lane-<name>`.
#
# MEMORY: the pages in flight across all lanes add to the hourly cron's 6 (see archive-lane.sh). Keep the
# sum of page concurrency in this file at 4 or less.
set -u
CONF="${ARCHIVE_LANES_CONF:-/etc/sourcelibrary/archive-lanes.conf}"
[ -f "$CONF" ] || exit 0
LANE_SH="$(cd "$(dirname "$0")" && pwd)/archive-lane.sh"
LOGD="${ARCHIVE_LANES_LOGDIR:-/var/log/sourcelibrary}"

while IFS='|' read -r name pc args; do
  case "$name" in ''|'#'*) continue ;; esac
  tmux has-session -t "=lane-$name" 2>/dev/null && continue
  echo "$(date -u +%FT%TZ) lane-$name has no tmux session — starting it"
  tmux new -d -s "lane-$name" \
    "LANE='$name' ARCHIVE_PAGE_CONCURRENCY='$pc' ARCHIVE_ARGS='$args' '$LANE_SH' >> '$LOGD/lane-$name.log' 2>&1"
done < "$CONF"

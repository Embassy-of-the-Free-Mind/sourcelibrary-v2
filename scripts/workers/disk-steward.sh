#!/bin/bash
# PRIOR ART: scripts/maintenance/reap-worktrees.mjs (called here, unchanged); /root/move-to-volume.sh on
#   the Hetzner box (2026-10-01 hand fix; its verified-move routine is reproduced below so it lives in git);
#   scripts/workers/disk-alarm.sh (pages, never acts). None of them runs on a schedule and acts.
#
# Disk steward for the job hosts (#6223). Nightly from cron; safe to run by hand at any time.
#   disk-steward.sh            # dry run: says what it would do
#   disk-steward.sh --apply    # does it
#
# Why: the Hetzner root disk (150 GB) filled to 100% on 2026-10-01 and again on 2026-10-07, both times
# from job worktrees and experiment output written into /root, while the attached 492 GB volume sat
# half empty. Both times a person cleaned up by hand after jobs had already died silently.
#
# What it does. It never deletes data:
#   1. Reaps job worktrees whose PR is merged or closed, that no live process is inside and that hold
#      no uncommitted work (reap-worktrees.mjs --merged-only; branches are kept).
#   2. Moves each idle top-level folder in /root to the volume and leaves a symlink at the old path,
#      so every path that named it still works. Idle means:
#        - a real directory (not a symlink) of at least MIN_GB;
#        - no file written in the last IDLE_DAYS days;
#        - no open files;
#        - not on the KEEP list.
#      The copy is verified by file count AND byte total before the original is removed.
# On a host without the volume (cloudlayer) only step 1 runs.
#
# Install (Hetzner crontab):
#   40 4 * * * f=/root/sourcelibrary/scripts/workers/disk-steward.sh; [ -x $f ] && $f --apply >> /var/log/sourcelibrary/disk-steward.log 2>&1
set -u
APPLY=""; [ "${1:-}" = "--apply" ] && APPLY=1
VOL=${DISK_STEWARD_VOL:-/mnt/HC_Volume_105839809}
DEST=$VOL/root-moved
SL=${DISK_STEWARD_SL:-/root/sourcelibrary}
MIN_GB=${DISK_STEWARD_MIN_GB:-1}
IDLE_DAYS=${DISK_STEWARD_IDLE_DAYS:-3}
# Never moved: the live checkout, the job wrapper's state, and tool/config homes.
KEEP=" sourcelibrary bin claude-jobs snap go .ssh .claude .config .local .npm .nvm .cache .cargo .rustup "
now() { date -u +%FT%TZ; }
echo "$(now) disk-steward ${APPLY:+--apply}${APPLY:---dry-run} root: $(df -h --output=used,avail,pcent / | tail -1)"

# 1. Reap merged worktrees.
if [ -f "$SL/scripts/maintenance/reap-worktrees.mjs" ]; then
  (cd "$SL" && node scripts/maintenance/reap-worktrees.mjs --merged-only ${APPLY:+--apply} 2>&1 | grep -E '^ *removed |would remove|^Reaped|^DRY-RUN' )
fi

# 2. Move idle /root folders to the volume.
if [ ! -d "$VOL" ]; then echo "$(now) no volume at $VOL: step 2 skipped"; exit 0; fi
mkdir -p "$DEST"
for S in /root/* /root/.[!.]*; do
  [ -d "$S" ] && [ ! -L "$S" ] || continue
  n=$(basename "$S")
  case "$KEEP" in *" $n "*) continue ;; esac
  kb=$(du -sk "$S" 2>/dev/null | cut -f1)
  [ "${kb:-0}" -ge $((MIN_GB * 1048576)) ] || continue
  if [ -n "$(find "$S" -xdev -type f -mmin -$((IDLE_DAYS * 1440)) -print -quit 2>/dev/null)" ]; then
    echo "  keep $n ($((kb / 1048576)) GB): written in the last ${IDLE_DAYS} days"; continue; fi
  if lsof +D "$S" >/dev/null 2>&1; then echo "  keep $n: has open files"; continue; fi
  T=$DEST/$n
  [ -e "$T" ] && { echo "  keep $n: $T already exists, look by hand"; continue; }
  if [ -z "$APPLY" ]; then echo "  would move $n ($((kb / 1048576)) GB) → $T"; continue; fi
  rsync -a "$S/" "$T/" || { echo "  $n rsync FAILED, original untouched"; continue; }
  a=$(find "$S" -type f | wc -l); b=$(find "$T" -type f | wc -l)
  sa=$(du -sb "$S" | cut -f1); sb=$(du -sb "$T" | cut -f1)
  if [ "$a" != "$b" ] || [ "$sa" != "$sb" ]; then
    echo "  $n VERIFY FAILED (files $a/$b, bytes $sa/$sb), original untouched; copy left at $T"; continue; fi
  rsync -a "$S/" "$T/"  # catch a late write
  mv "$S" "$S.moving" && ln -s "$T" "$S" && rm -rf "$S.moving" && echo "  moved $n ($a files, $sa bytes) → $T"
done
echo "$(now) done. root: $(df -h --output=used,avail,pcent / | tail -1)"

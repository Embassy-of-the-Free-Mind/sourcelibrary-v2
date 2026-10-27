#!/bin/bash
# PRIOR ART: scripts/maintenance/reap-worktrees.mjs (called here, unchanged); /root/move-to-volume.sh on
#   the Hetzner box (2026-10-01 hand fix; its verified-move routine is reproduced below so it lives in git);
#   scripts/workers/disk-alarm.sh (pages, never acts). None of them runs on a schedule and acts.
#
# Disk steward for the job hosts (#6223). Nightly from cron; safe to run by hand at any time.
#   disk-steward.sh            # dry run: says what it would do
#   disk-steward.sh --apply    # does it
#   disk-steward.sh --apply --agy-only   # only the Antigravity CLI steps (1b, 1c); hourly from cron
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
#   10 * * * * f=/root/sourcelibrary/scripts/workers/disk-steward.sh; [ -x $f ] && $f --apply --agy-only >> /var/log/sourcelibrary/disk-steward.log 2>&1
set -u
APPLY=""; AGY_ONLY=""
for a in "$@"; do case "$a" in --apply) APPLY=1 ;; --agy-only) AGY_ONLY=1 ;; esac; done
VOL=${DISK_STEWARD_VOL:-/mnt/HC_Volume_105839809}
DEST=$VOL/root-moved
SL=${DISK_STEWARD_SL:-/root/sourcelibrary}
ROOT=${DISK_STEWARD_ROOT:-/root}
MIN_GB=${DISK_STEWARD_MIN_GB:-1}
IDLE_DAYS=${DISK_STEWARD_IDLE_DAYS:-3}
# Never moved: the live checkout, the job wrapper's state, and tool/config homes.
KEEP=" sourcelibrary bin claude-jobs snap go .ssh .claude .config .local .npm .nvm .cache .cargo .rustup "
now() { date -u +%FT%TZ; }
echo "$(now) disk-steward $([ -n "$APPLY" ] && echo --apply || echo --dry-run) root: $(df -h --output=used,avail,pcent / | tail -1)"

# 1. Reap merged worktrees.
if [ -z "$AGY_ONLY" ] && [ -f "$SL/scripts/maintenance/reap-worktrees.mjs" ]; then
  (cd "$SL" && node scripts/maintenance/reap-worktrees.mjs --merged-only ${APPLY:+--apply} 2>&1 | grep -E '^ *removed |would remove|^Reaped|^DRY-RUN' )
fi

# 1b. Shrink the Antigravity CLI's SQLite write-ahead log. agy never checkpoints it while calls keep a reader
#     open, and on 2026-10-16 it had reached 15 GB of a 150 GB root disk (conversation_summaries.db-wal).
#     A checkpoint is SQLite's own operation: it copies committed pages into the database and drops nothing.
#     TRUNCATE only succeeds in a moment with no reader, so retry for a few minutes, then say so.
for W in "$ROOT"/.gemini/antigravity-cli/*.db-wal "$ROOT"/.agy-*/.gemini/antigravity-cli/*.db-wal; do
  [ -f "$W" ] || continue
  DB=${W%-wal}; mb=$(( $(stat -c %s "$W") / 1048576 ))
  [ "$mb" -ge 256 ] || continue
  if [ -z "$APPLY" ]; then echo "  would checkpoint $(basename "$DB") (WAL ${mb} MB)"; continue; fi
  python3 - "$DB" <<'PY'
import sqlite3, sys, time
db = sys.argv[1]
for i in range(int(180)):
    c = sqlite3.connect(db, timeout=5)
    r = c.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone(); c.close()
    if r[0] == 0: print(f'  checkpointed {db}: WAL truncated after {i} s'); break
    time.sleep(1)
else: print(f'  checkpointed {db}: WAL still held by a reader after 180 s (pages copied, file not shrunk)')
PY
done

# 1c. Remove the Antigravity CLI's orphaned temp files. agy rewrites jetbox_summaries_proto.pb (~100 MB) by writing
#     jetbox_summaries_proto.pb.<uuid>.tmp and renaming it into place; a call killed mid-write (a timeout, the tool
#     gate) leaves the .tmp behind, and nothing reads it again. On 2026-10-27 main held 909 of them, 27 GB, 349
#     written that day, and the root disk had reached 100% at 02:45Z. Only files over an hour old that no process
#     holds open are removed: a younger one may be a write in progress.
n=0; kb=0
for T in "$ROOT"/.gemini/antigravity-cli/*.tmp; do
  [ -f "$T" ] || continue
  [ -n "$(find "$T" -mmin +60 -print -quit 2>/dev/null)" ] || continue
  lsof "$T" >/dev/null 2>&1 && continue
  n=$((n + 1)); kb=$((kb + $(du -k "$T" | cut -f1)))
  [ -n "$APPLY" ] && rm -f "$T"
done
[ "$n" -gt 0 ] && echo "  $([ -n "$APPLY" ] && echo removed || echo would remove) $n orphaned agy .tmp files ($((kb / 1048576)) GB)"
[ -n "$AGY_ONLY" ] && { echo "$(now) done (agy only). root: $(df -h --output=used,avail,pcent / | tail -1)"; exit 0; }

# 2. Move idle /root folders to the volume.
# A mount point, not just a directory: a wrapper that mistakes its host for main mkdirs $VOL/worktrees on the root
# disk, and "moving" /root folders onto the same disk would only rename them (gex45, 2026-10-17, #5660).
if [ -n "${DISK_STEWARD_VOL:-}" ] && [ -d "$VOL" ]; then :
elif ! mountpoint -q "$VOL" 2>/dev/null; then echo "$(now) no volume mounted at $VOL: step 2 skipped"; exit 0; fi
mkdir -p "$DEST"
for S in "$ROOT"/* "$ROOT"/.[!.]*; do
  [ -d "$S" ] && [ ! -L "$S" ] || continue
  n=$(basename "$S")
  case "$KEEP" in *" $n "*) continue ;; esac
  kb=$(du -sk "$S" 2>/dev/null | cut -f1)
  [ "${kb:-0}" -ge $((MIN_GB * 1048576)) ] || continue
  if [ -n "$(find "$S" -xdev -type f -mmin -$((IDLE_DAYS * 1440)) -print -quit 2>/dev/null)" ]; then
    echo "  keep $n ($((kb / 1048576)) GB): written in the last ${IDLE_DAYS} days"; continue; fi
  if lsof +D "$S" >/dev/null 2>&1; then echo "  keep $n: has open files"; continue; fi
  T=$DEST/$n
  if [ -e "$T" ]; then
    # An earlier move left a copy here (a hand move, or the folder was re-created on root after a move).
    # If every root file is already in it with the same checksum, root is a stale duplicate: swap in the
    # symlink and lose nothing. Otherwise move to a fresh name beside it, so neither copy is overwritten.
    if [ -d "$T" ] && [ ! -L "$T" ] && [ -z "$(rsync -an --checksum --out-format='%n' "$S/" "$T/" | grep -v '/$' | head -1)" ]; then
      if [ -z "$APPLY" ]; then echo "  would link $n ($((kb / 1048576)) GB) → $T (every file already there)"; continue; fi
      mv "$S" "$S.moving" && ln -s "$T" "$S" && rm -rf "$S.moving" && echo "  linked $n → $T (every file already there, checksum-verified)"
      continue
    fi
    i=2; while [ -e "$DEST/$n.$i" ]; do i=$((i + 1)); done
    echo "  $n: $T already exists and differs; moving to $DEST/$n.$i (reconcile the two by hand)"
    T=$DEST/$n.$i
  fi
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

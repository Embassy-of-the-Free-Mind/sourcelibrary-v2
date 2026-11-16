#!/bin/bash
# PRIOR ART: scripts/maintenance/reap-worktrees.mjs (called here, unchanged); /root/move-to-volume.sh on
#   the Hetzner box (2026-10-01 hand fix; its verified-move routine was step 2 here until 2026-10-29);
#   scripts/workers/disk-alarm.sh (pages, never acts). None of them runs on a schedule and acts.
#
# Disk steward for the job hosts (#6223). Hourly from cron; safe to run by hand at any time.
#   disk-steward.sh                  # dry run: lists every candidate and what it would do
#   disk-steward.sh --apply          # does it
#   disk-steward.sh --apply --agy-only   # only the Antigravity CLI steps (1a, 1b, 1c, 1d)
#   disk-steward.sh restore <dir>.IN-R2.txt   # bring an archived folder back from R2
#
# Why: every box sat between 80% and 95% with alarms (Derek 2026-10-29: "There must be a better way to manage
# storage than always from 80-95% full with warnings"). The old step 2 moved idle /root folders to main's
# volume; it never deleted, gex45 has no volume, and main's volume filled in turn. Folders were then moved
# between boxes by hand (2026-10-27), which only shuffled them. So storage now has a LIFETIME instead:
#
#   1. Reaps job worktrees whose PR is merged or closed (reap-worktrees.mjs --merged-only; branches kept), and at
#      REAP_ALL_PCT (default 85) every unoccupied worktree with no uncommitted work, PR or not.
#   1a. Antigravity CLI: rotate its call history (database + .pb) past AGY_HISTORY_MAX_MB; trim old conversations.
#   1b/1c/1d. Antigravity CLI: checkpoint its SQLite WAL, remove orphaned .tmp files, trim debug logs to 2 days.
#   1e. Removes the test databases (/tmp/mongo-mem-*) that killed CI runs leave behind.
#   1f. Resets an idle CI runner's checkout once its .git passes RUNNER_GIT_CAP_GB (the next job re-clones).
#   1h. Removes the runner account's idle entries in /tmp (CI install leftovers; #393).
#   1g. Moves Claude Code transcript folders idle 12 h to the job disk, leaving a link (boxes with a second disk; #367).
#   2. CACHE: trims the Hugging Face hub cache to HF_CACHE_CAP_GB, least recently accessed revision first
#      (huggingface_hub's scan-cache / delete-revisions). Models are re-downloadable. A revision with a blob
#      open by any process, or read in the last HF_KEEP_RECENT_H hours, is never touched. Runs every time.
#      Nor is a repo in HF_PIN_REPOS: the engines a scheduled lane serves with HF_HUB_OFFLINE=1, which
#      cannot re-download what was trimmed. On 2026-11-08 the cap trimmed LightOnOCR-3-1B after the GPU queue
#      sat idle a day while image models filled the cache, and every euro/JCB/gpu-print chunk failed after it.
#   3. COLD ARCHIVE, only while a disk is above BAND% (default 70), oldest-idle first, stopping at <= BAND%
#      (idle = IDLE_DAYS, or PRESSURE_IDLE_DAYS while the folder's disk is at PRESSURE_PCT or more):
#      an idle folder is tarred with zstd and streamed to R2 (private bucket sl-corpus-snapshots,
#      key cold/<box>/<path-slug>-<date>.tar.zst), read back in full and checked (bytes, sha256, and the
#      archive's entry count against the folder's, sockets aside), and only then removed, leaving <dir>.IN-R2.txt with the
#      key, sha256, size and a one-line restore command. Any failure keeps the original (and removes the
#      partial object). Approved standing cost: R2 at $0.015/GB-month (Derek 2026-10-29, ~$3-5/month).
#      Candidates: each folder in /root/jobs, each FOLDER in /root/claude-jobs (its job files are files and
#      are never candidates; old jobs kept their scratch there, 8.1 GB on main on 2026-11-12, #90), /root/moved-from-*, the volume's jobs/ and root-moved/,
#      /data/scratch/sl/jobs and /data/scratch/moved-from-*, and, on main and gex45 only, each top-level /root
#      folder, and each day folder (YYYY-MM-DD) inside a jobs folder; all of at least MIN_MB. Not /root on cloudlayer or l7a: those boxes are guests of a live public
#      service whose own folders sit there (DISK_STEWARD_TOP=1 overrides). Idle means ALL of: nothing written for IDLE_DAYS days; no tmux session named for it; no open
#      file or working directory inside it; any git checkout inside has no uncommitted or unpushed work.
#      Never: the live checkout, bin, claude-jobs itself (only its idle folders), worktrees, dot folders (tool homes: .claude*, .agy*,
#      .cache: HF is step 2; transcripts in .claude*/projects are moved by step 1g), or a top-level folder holding a Python environment (a tool such as /root/pz,
#      not scratch).
#   The last --apply run's end state goes to $STATE; disk-alarm.sh reads it and pages only when the steward
#   could not bring a disk under 85% (and says what it could not archive, and why).
#
# Install (crontab, every box; cold-r2.mjs must sit beside this file). Until #6223's PR merged the boxes ran a
# hand-placed copy in /root/bin; the line prefers the checkout's copy as soon as it has cold-r2.mjs:
#   25 * * * * f=/root/sourcelibrary/scripts/workers/disk-steward.sh; [ -f /root/sourcelibrary/scripts/workers/cold-r2.mjs ] || f=/root/bin/disk-steward.sh; [ -x $f ] && $f --apply >> /var/log/sourcelibrary/disk-steward.log 2>&1
set -u
APPLY=""; AGY_ONLY=""; MODE=run; POINTER=""
while [ $# -gt 0 ]; do case "$1" in
  --apply) APPLY=1 ;; --agy-only) AGY_ONLY=1 ;;
  --band) shift; DISK_STEWARD_BAND=$1 ;;
  restore) MODE=restore; shift; POINTER=${1:-} ;;
  *) echo "unknown argument $1"; exit 2 ;;
esac; shift; done
here=$(cd "$(dirname "$0")" && pwd)
SL=${DISK_STEWARD_SL:-/root/sourcelibrary}; export DISK_STEWARD_SL=$SL
ROOT=${DISK_STEWARD_ROOT:-/root}
VOL=${DISK_STEWARD_VOL:-/mnt/HC_Volume_105839809}
# Smallest folder worth an archive, in MB. It was 1 GB until 2026-11-15, when 46 idle job folders under 1 GB held
# about 15 GB of gex45's root disk that no rule would ever reach (#393). A lane's day folder is often 100-600 MB.
MIN_MB=${DISK_STEWARD_MIN_MB:-$(( ${DISK_STEWARD_MIN_GB:-0} * 1024 ))}; [ "$MIN_MB" -gt 0 ] || MIN_MB=200
IDLE_DAYS=${DISK_STEWARD_IDLE_DAYS:-7}
# A finished job never says so, so idle is a guess, and at 7 days a heavy week fills the disk faster than it clears
# (gex45 75% to 91% in three days, 2026-11-07: about 97 GB of job scratch, 54 GB of it page images). Under pressure a
# folder counts as idle sooner. It is archived, never deleted: its pointer restores it if the job comes back.
PRESSURE_PCT=${DISK_STEWARD_PRESSURE_PCT:-80}
PRESSURE_IDLE_DAYS=${DISK_STEWARD_PRESSURE_IDLE_DAYS:-3}
BAND=${DISK_STEWARD_BAND:-70}   # 75 until 2026-11-15: a box that sits at the band has no room for one heavy job (#393)
REAP_ALL_PCT=${DISK_STEWARD_REAP_ALL_PCT:-85}   # step 1: full worktree reap at this root-disk use
HF_CAP_GB=${HF_CACHE_CAP_GB:-50}
HF_KEEP_RECENT_H=${HF_KEEP_RECENT_H:-24}
# Space-separated repo ids never trimmed: the GPU OCR filler's vLLM engine (scripts/gpu/gpu-print-gpu.sh,
# scripts/eval/euro-gpu-correct-7567/drive.sh LO). Add an engine here when a scheduled lane starts serving it.
HF_PIN_REPOS=${HF_PIN_REPOS:-lightonai/LightOnOCR-3-1B}
HF_HUB=${HF_HUB_CACHE:-${HF_HOME:-$ROOT/.cache/huggingface}/hub}
TMP_DIR=${DISK_STEWARD_TMP:-/tmp}
TMP_DB_IDLE_MIN=${DISK_STEWARD_TMP_DB_IDLE_MIN:-120}
RUNNER_HOME=${DISK_STEWARD_RUNNER_HOME:-/home/gha}      # self-hosted GitHub runners (step 1f); absent = skipped
RUNNER_GIT_CAP_GB=${DISK_STEWARD_RUNNER_GIT_CAP_GB:-2}   # a fresh clone's .git is about 1 GB; it grows ~0.7 GB a day (#393)
RUNNER_USER=${DISK_STEWARD_RUNNER_USER:-gha}             # step 1h: the CI runners' account; absent = skipped
RUNNER_TMP_IDLE_MIN=${DISK_STEWARD_RUNNER_TMP_IDLE_MIN:-120}
STATE=${DISK_STEWARD_STATE:-/var/lib/sourcelibrary/disk-steward.state}
ENVF=${DISK_STEWARD_ENV:-$SL/.env.production.local}
COLD="node --env-file=$ENVF $here/cold-r2.mjs"
# Top-level /root folders that are never archived. Containers (jobs, moved-from-*, root-moved) are handled
# folder by folder below; dot folders are skipped by rule.
KEEP=" sourcelibrary bin claude-jobs claude-pace snap go worktrees jobs root-moved gpu-queue lost+found "
case "$(hostname)" in clawdbot) BOX=main ;; earthai-live) BOX=cloudlayer ;; earthai-l7a) BOX=l7a ;; gex45-1) BOX=gex45 ;; *) BOX=$(hostname -s) ;; esac
case "$BOX" in main|gex45) TOP=${DISK_STEWARD_TOP:-1} ;; *) TOP=${DISK_STEWARD_TOP:-} ;; esac
now() { date -u +%FT%TZ; }
pct() { df --output=pcent "$1" 2>/dev/null | tail -1 | tr -dc '0-9'; }
mnt() { df --output=target "$1" 2>/dev/null | tail -1; }
gb() { awk -v k="$1" 'BEGIN{printf "%.1f", k / 1048576}'; }

# ---- restore ------------------------------------------------------------------------------------------
if [ "$MODE" = restore ]; then
  [ -f "$POINTER" ] || { echo "no pointer file $POINTER"; exit 2; }
  val() { sed -n "s/^$1=//p" "$POINTER" | head -1; }
  P=$(val path); KEY=$(val key); SHA=$(val sha256); BYTES=$(val bytes)
  [ -n "$P" ] && [ -n "$KEY" ] && [ -n "$SHA" ] || { echo "pointer $POINTER lacks path/key/sha256"; exit 2; }
  [ -e "$P" ] && { echo "REFUSED: $P exists; move it aside first"; exit 3; }
  parent=$(dirname "$P"); name=$(basename "$P"); tmp="$parent/.restoring-$name-$$"; sum=$(mktemp)
  need=$((BYTES / 1024 * 3)); avail=$(df -k --output=avail "$parent" | tail -1 | tr -dc '0-9')
  [ "$avail" -gt "$need" ] || echo "WARNING: $(gb "$avail") GB free at $parent; the archive is $(gb $((BYTES / 1024))) GB compressed"
  mkdir -p "$tmp"
  echo "$(now) restoring $KEY → $P"
  $COLD get "$KEY" --sum-to "$sum" | tar --use-compress-program='zstd -d -q' -C "$tmp" -xf -
  st=("${PIPESTATUS[@]}")
  got=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' "$sum" 2>/dev/null)
  if [ "${st[0]}" != 0 ] || [ "${st[1]}" != 0 ] || [ "$got" != "$SHA" ] || [ ! -d "$tmp/$name" ]; then
    echo "RESTORE FAILED (get=${st[0]} tar=${st[1]} sha=${got:-?} want $SHA); partial copy left in $tmp"; rm -f "$sum"; exit 1
  fi
  mv "$tmp/$name" "$P" && rmdir "$tmp" && rm -f "$sum"
  # tar restores the old mtimes, so mark the folder as written now: it is not idle again for IDLE_DAYS.
  date -u +%FT%TZ > "$P/.restored-from-r2"
  mv "$POINTER" "${POINTER%.IN-R2.txt}.RESTORED-$(date -u +%F).txt"
  echo "$(now) restored $P (sha256 verified). The R2 object stays: $KEY"
  exit 0
fi

# One run at a time: an archive pass can outlast the hour.
# (The 2>/dev/null stays inside the braces: on a bare `exec` it would silence stderr for the whole run.)
{ exec 9>/run/lock/disk-steward.lock; } 2>/dev/null || exec 9>/tmp/disk-steward.lock
flock -n 9 || { echo "$(now) disk-steward: another run holds the lock; skipping"; exit 0; }
echo "$(now) disk-steward $([ -n "$APPLY" ] && echo --apply || echo --dry-run) box=$BOX band=${BAND}% root: $(df -h --output=used,avail,pcent / | tail -1)"

# 1. Reap merged worktrees; at REAP_ALL_PCT or more, every worktree no process occupies and with no uncommitted
#    work, PR or not. Job worktrees with no PR (PR: no briefs, stopped jobs) are never "merged", so --merged-only
#    kept them: on 2026-11-13 main reached 88%, under the 15% free that claude-job.sh start needs, with 31 such
#    worktrees (12 GB) idle; the full reap took it to 80%. The reaper keeps branches, so commits survive.
if [ -z "$AGY_ONLY" ] && [ -f "$SL/scripts/maintenance/reap-worktrees.mjs" ]; then
  REAP_SCOPE=--merged-only; [ "$(pct /)" -ge "$REAP_ALL_PCT" ] && REAP_SCOPE=
  (cd "$SL" && node scripts/maintenance/reap-worktrees.mjs $REAP_SCOPE ${APPLY:+--apply} 2>&1 | grep -E '^ *removed |would remove|^Reaped|^DRY-RUN' )
fi

# 1a. Rotate the Antigravity CLI's call history. agy keeps a summary of every call it ever made: on 2026-11-13 each
#     gex45 login held ~150K rows (conversation_summaries.db, ~200 MB) and a ~100 MB jetbox_summaries_proto.pb, and
#     every call rewrites the .pb and churns the database, so the write-ahead log grew ~50 MB a SECOND under the
#     lanes and agy-guard's 4 GB drain fired every few minutes (a 4-13 GB swing on a disk run at 84%). Headless
#     calls never read that history. Tested on gex45 the same day: with the database and .pb moved aside, agy makes
#     fresh ones (20 KB), and `--conversation <id>` still resumes a call, because it reads conversations/, which
#     stays. So once the database passes AGY_HISTORY_MAX_MB, take agy-guard's drain lock (new calls wait, up to
#     135 s), wait for the calls holding the database to finish, and move the database and .pb to
#     $ROOT/agy-history-aside/<login>-<time>/ (removed after 2 days). If calls still hold it after 100 s, release
#     the lock and try next hour. conversations/ and brain/ entries older than 2 days are removed too.
AGY_HISTORY_MAX_MB=${AGY_HISTORY_MAX_MB:-50}
ASIDE="$ROOT/agy-history-aside"
for D in "$ROOT"/.gemini/antigravity-cli "$ROOT"/.agy-*/.gemini/antigravity-cli; do
  DB="$D/conversation_summaries.db"; [ -f "$DB" ] || continue
  acct=$(basename "$(dirname "$(dirname "$D")")"); acct=${acct#.}; [ "$D" = "$ROOT/.gemini/antigravity-cli" ] && acct=default
  mb=$(( $(stat -c %s "$DB") / 1048576 ))
  if [ "$mb" -ge "$AGY_HISTORY_MAX_MB" ]; then
    if [ -z "$APPLY" ]; then echo "  would rotate $acct agy history (database ${mb} MB)"
    elif mkdir "$D/.agy-guard-drain" 2>/dev/null; then
      # lsof exits 1 if ANY named file is missing, so ask only about the files that exist.
      held=1; for _ in $(seq 50); do lsof $(ls "$DB" "$DB-wal" 2>/dev/null) >/dev/null 2>&1 || { held=0; break; }; sleep 2; done
      if [ "$held" = 0 ]; then
        dst="$ASIDE/$acct-$(date -u +%Y%m%dT%H%M%S)"; mkdir -p "$dst"
        for f in conversation_summaries.db conversation_summaries.db-wal conversation_summaries.db-shm jetbox_summaries_proto.pb; do
          [ -e "$D/$f" ] && mv "$D/$f" "$dst/"
        done
        echo "  rotated $acct agy history (database ${mb} MB) to $dst"
      else
        echo "  $acct agy history (${mb} MB) still held by calls after 100 s; next run tries again"
      fi
      rmdir "$D/.agy-guard-drain"
    else
      echo "  $acct agy history: agy-guard is draining it; next run"
    fi
  fi
  for sub in conversations brain; do
    [ -d "$D/$sub" ] || continue
    n=$(find "$D/$sub" -mindepth 1 -maxdepth 1 -mtime +2 | wc -l)
    [ "$n" -gt 0 ] || continue
    echo "  $([ -n "$APPLY" ] && echo removed || echo would remove) $n $acct agy $sub entries older than 2 days"
    [ -n "$APPLY" ] && find "$D/$sub" -mindepth 1 -maxdepth 1 -mtime +2 -exec rm -rf {} +
  done
done
[ -n "$APPLY" ] && [ -d "$ASIDE" ] && find "$ASIDE" -mindepth 1 -maxdepth 1 -type d -mtime +2 -exec rm -rf {} +

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
for T in "$ROOT"/.gemini/antigravity-cli/*.tmp "$ROOT"/.agy-*/.gemini/antigravity-cli/*.tmp; do
  [ -f "$T" ] || continue
  [ -n "$(find "$T" -mmin +60 -print -quit 2>/dev/null)" ] || continue
  lsof "$T" >/dev/null 2>&1 && continue
  n=$((n + 1)); kb=$((kb + $(du -k "$T" | cut -f1)))
  [ -n "$APPLY" ] && rm -f "$T"
done
[ "$n" -gt 0 ] && echo "  $([ -n "$APPLY" ] && echo removed || echo would remove) $n orphaned agy .tmp files ($((kb / 1048576)) GB)"

# 1d. Trim the Antigravity CLI's debug logs. agy writes one log/cli-<timestamp>.log per call and never removes
#     them; on 2026-10-31 main's two agy homes held 128K of them, 4.2 GB, about 0.5 GB a day each, and that
#     growth alone kept the root disk over the 85% alarm. They are debug output nothing reads; keep two days.
n=0; kb=0
for L in "$ROOT"/.gemini/antigravity-cli/log "$ROOT"/.agy-*/.gemini/antigravity-cli/log; do
  [ -d "$L" ] || continue
  while IFS=' ' read -r k _; do n=$((n + 1)); kb=$((kb + k)); done < <(find "$L" -maxdepth 1 -type f -name 'cli-*.log' -mtime +1 -printf '%k %p\n')
  [ -n "$APPLY" ] && find "$L" -maxdepth 1 -type f -name 'cli-*.log' -mtime +1 -delete
done
[ "$n" -gt 0 ] && echo "  $([ -n "$APPLY" ] && echo removed || echo would remove) $n agy debug logs ($((kb / 1024)) MB)"
[ -n "$AGY_ONLY" ] && { echo "$(now) done (agy only). root: $(df -h --output=used,avail,pcent / | tail -1)"; exit 0; }

# Every open file and working directory on the box, once (steps 2 and 3 test against it).
CANDS=""; KEPT=""; OPEN=$(mktemp); trap 'rm -f "$OPEN" "$CANDS" "$KEPT"' EXIT
{ lsof -n -w -Fn 2>/dev/null | sed -n 's/^n//p'; for c in /proc/[0-9]*/cwd; do readlink "$c" 2>/dev/null; done; } | sort -u > "$OPEN"

# 1e. Remove the test databases the CI runners leave in /tmp. tests/setup.ts starts a mongodb-memory-server for
#     each integration test file, and its data folder (mongo-mem-XXXXXX, about 200 MB) is removed in the teardown.
#     A run that is killed, or that times out while mongod starts on a loaded box, never reaches the teardown.
#     On 2026-11-12 gex45 held 101 of them, 17 GB, all written in five hours, and the root disk reached 92%.
#     They hold fixtures only. A folder is removed when nothing in it was written for TMP_DB_IDLE_MIN minutes
#     and no process has a file open inside it: a live mongod keeps its lock file open.
n=0; kb=0
for T in "$TMP_DIR"/mongo-mem-*; do
  [ -d "$T" ] && [ ! -L "$T" ] || continue
  [ -z "$(find "$T" -mmin -"$TMP_DB_IDLE_MIN" -print -quit 2>/dev/null)" ] || continue
  awk -v p="$T" '$0 == p || index($0, p "/") == 1 { f = 1; exit } END { exit !f }' "$OPEN" && continue
  sz=$(du -sk "$T" 2>/dev/null | cut -f1)
  n=$((n + 1)); kb=$((kb + ${sz:-0}))
  [ -n "$APPLY" ] && rm -rf "$T"
done
[ "$n" -gt 0 ] && echo "  $([ -n "$APPLY" ] && echo removed || echo would remove) $n leftover test databases in $TMP_DIR ($(gb "$kb") GB)"

# 1f. Reset bloated CI runner checkouts. Each self-hosted runner (RUNNER_HOME/runner-N, from the runner's own
#     .service file) keeps one checkout under _work and fetches every PR's ref into it; nothing ever prunes it.
#     On 2026-11-13 gex45's six runners held 52 GB, each .git 5.2 GB with 2.39M objects against 142K (1.0 GB) in a
#     fresh clone, and the disk sat at 88%, refusing jobs. Removing an idle runner's checkout loses nothing: the
#     next job's actions/checkout clones again. A checkout is reset only when its .git is over RUNNER_GIT_CAP_GB
#     and the runner runs no job; the runner's service is stopped first and the job check repeated, so a job
#     cannot start inside a half-removed folder, and the service is started again whatever happens.
n=0; kb=0
for R in "$RUNNER_HOME"/runner-*; do
  [ -f "$R/.service" ] && [ -d "$R/_work" ] || continue
  svc=$(cat "$R/.service")
  for G in "$R"/_work/*/*/.git; do
    [ -d "$G" ] || continue
    sz=$(du -sk "$G" 2>/dev/null | cut -f1)
    [ "${sz:-0}" -gt $((RUNNER_GIT_CAP_GB * 1048576)) ] || continue
    pgrep -f "$R/bin/Runner.Worker" >/dev/null && { echo "  keep $(dirname "$G") ($(gb "$sz") GB .git): runner busy"; continue; }
    n=$((n + 1)); kb=$((kb + $(du -sk "$(dirname "$G")" 2>/dev/null | cut -f1)))
    [ -n "$APPLY" ] || continue
    systemctl stop "$svc"
    if pgrep -f "$R/bin/Runner.Worker" >/dev/null; then echo "  keep $(dirname "$G"): a job started"; n=$((n - 1))
    else rm -rf "$(dirname "$G")"; fi
    systemctl start "$svc"
  done
done
[ "$n" -gt 0 ] && echo "  $([ -n "$APPLY" ] && echo reset || echo would reset) $n CI runner checkouts over ${RUNNER_GIT_CAP_GB} GB of .git ($(gb "$kb") GB)"

# 1h. Remove what CI runs leave in /tmp. A job's steps inherit TMPDIR=/tmp, not the runner's _temp (which the runner
#     empties after every job), and some installs never clean up: every `npm ci` runs @posthog/cli's installer, which
#     downloads a 31 MB tarball into a fresh /tmp/XXXXXX and leaves it; onnxruntime-node leaves its packages, vite its
#     ssr caches. On 2026-11-15 gex45's /tmp held 22.9 GB owned by the runner account (about 150 tarballs a day,
#     4.6 GB a day), and systemd only ages /tmp out after 30 days (#393). Every top-level /tmp entry the runner
#     account owns is CI scratch: it is removed when nothing in it was written for RUNNER_TMP_IDLE_MIN minutes and no
#     process holds a file inside it, so a job still running on another runner keeps its files.
#     Only files and folders: the runners' own sockets and debug pipes (dotnet-diagnostic-*, clr-debug-pipe-*) stay.
n=0; kb=0
if id -u "$RUNNER_USER" >/dev/null 2>&1; then
  while IFS= read -r -d '' T; do
    [ -L "$T" ] && continue
    [ -z "$(find "$T" -mmin -"$RUNNER_TMP_IDLE_MIN" -print -quit 2>/dev/null)" ] || continue
    awk -v p="$T" '$0 == p || index($0, p "/") == 1 { f = 1; exit } END { exit !f }' "$OPEN" && continue
    sz=$(du -sk "$T" 2>/dev/null | cut -f1)
    n=$((n + 1)); kb=$((kb + ${sz:-0}))
    [ -n "$APPLY" ] && rm -rf "$T"
  done < <(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -user "$RUNNER_USER" \( -type d -o -type f \) ! -name 'mongo-mem-*' -print0 2>/dev/null)
fi
[ "$n" -gt 0 ] && echo "  $([ -n "$APPLY" ] && echo removed || echo would remove) $n CI leftovers in $TMP_DIR owned by $RUNNER_USER ($(gb "$kb") GB)"

# 1g. Move idle Claude Code transcript folders (<home>/projects/<folder>, every $ROOT/.claude*/projects) to the job
#     disk and leave a link, on a box that has one (#367). On 2026-11-15 main's root disk held 17 GB of them, 15.5 GB
#     written in two days (jobs that read page images keep the images in their transcript: one job 3.4 GB, the
#     pecha-split-304 workers 5.5 GB), and main refused job starts for two days at 12-13% free. Dot folders are
#     otherwise never touched here, so this is the one step that reaches into a tool home, and only into projects/.
#     A folder is moved only when nothing in it was written for TRANSCRIPT_IDLE_H hours and no process holds a file
#     in it; the copy is checked entry by entry before the original goes, and any failure keeps the original
#     (transcripts-to-volume.py). Moved, never archived or deleted: `claude --continue` reads them through the link.
#     New jobs never land on root at all: claude-job.sh start links the job's own folder to the same place.
TRANSCRIPT_IDLE_H=${DISK_STEWARD_TRANSCRIPT_IDLE_H:-12}
TDEST=${DISK_STEWARD_TRANSCRIPT_DEST:-}
if [ -z "$TDEST" ]; then
  for c in "$VOL" /data/scratch/sl; do
    [ -d "$c" ] && [ "$(mnt "$c")" != "$(mnt "$ROOT")" ] && { TDEST="$c/claude-projects"; break; }
  done
fi
TPROJ=$(ls -d "$ROOT"/.claude*/projects 2>/dev/null)
if [ -n "$TPROJ" ] && [ -n "$TDEST" ]; then
  [ -n "$APPLY" ] && mkdir -p "$TDEST"
  # shellcheck disable=SC2086
  python3 "$here/transcripts-to-volume.py" --dest "$TDEST" --idle-hours "$TRANSCRIPT_IDLE_H" --open-list "$OPEN" ${APPLY:+--apply} $TPROJ
elif [ -n "$TPROJ" ]; then
  echo "  transcripts: $(du -scxh $TPROJ 2>/dev/null | tail -1 | cut -f1) in $(echo $TPROJ | wc -w) projects folder(s), no second disk on this box: not moved"
fi

# 2. Trim the Hugging Face hub cache.
HF_PY=""
for p in ${HF_PYTHON:-} python3 "$ROOT"/pz/venv/bin/python "$ROOT"/*/venv/bin/python "$ROOT"/*/.venv/bin/python; do
  [ -x "$(command -v "$p" 2>/dev/null)" ] && "$p" -c 'import huggingface_hub' 2>/dev/null && { HF_PY=$p; break; }
done
if [ ! -d "$HF_HUB" ]; then :
elif [ -z "$HF_PY" ]; then echo "  HF cache $(du -sh "$HF_HUB" 2>/dev/null | cut -f1): no python with huggingface_hub here, not trimmed (set HF_PYTHON)"
else
  "$HF_PY" - "$HF_HUB" "$HF_CAP_GB" "$HF_KEEP_RECENT_H" "${APPLY:-0}" "$OPEN" "$HF_PIN_REPOS" <<'PY'
import sys, time
from huggingface_hub import scan_cache_dir
hub, cap, keep_h, apply, open_list = sys.argv[1], float(sys.argv[2]) * 1e9, float(sys.argv[3]), sys.argv[4] == '1', sys.argv[5]
pinned = set(sys.argv[6].split())
opened = set(l.rstrip('\n') for l in open(open_list))
info = scan_cache_dir(hub)
total = info.size_on_disk
print(f'  HF cache {total / 1e9:.1f} GB in {len(info.repos)} repos (cap {cap / 1e9:.0f} GB)')
if total <= cap: sys.exit(0)
revs = []
for repo in info.repos:
    for rev in repo.revisions:
        last = max([f.blob_last_accessed for f in rev.files] or [0])
        busy = any(str(f.blob_path) in opened or str(f.file_path) in opened for f in rev.files)
        revs.append((last, repo.repo_id, rev, busy))
revs.sort(key=lambda r: r[0])
chosen, freed, held = [], 0, []
for last, rid, rev, busy in revs:
    if total - freed <= cap: break
    age_h = (time.time() - last) / 3600
    if rid in pinned: held.append(f'{rid} (pinned)'); continue
    if busy: held.append(f'{rid} (open by a process)'); continue
    if age_h < keep_h: held.append(f'{rid} (read {age_h:.0f} h ago)'); continue
    chosen.append((rid, rev, age_h))
    freed = info.delete_revisions(*[r.commit_hash for _, r, _ in chosen]).expected_freed_size
for rid, rev, age_h in chosen:
    print(f'  {"trim" if apply else "would trim"} {rid}@{rev.commit_hash[:8]} ({rev.size_on_disk / 1e9:.1f} GB, last read {age_h / 24:.0f} d ago)')
if chosen and apply:
    info.delete_revisions(*[r.commit_hash for _, r, _ in chosen]).execute()
print(f'  HF cache: {"trimmed" if apply else "would trim"} {freed / 1e9:.1f} GB → {(total - freed) / 1e9:.1f} GB'
      + (f'; still over cap, kept: {", ".join(held[:5])}' if total - freed > cap else ''))
PY
fi

# 3. Cold archive to R2, oldest-idle first, only on a disk above the band.
CANDS=$(mktemp); KEPT=$(mktemp)
sessions=$(tmux ls -F '#{session_name}' 2>/dev/null)
named_by_session() {  # $1 folder name: a live tmux session names it (job-<name>, lane-<name>, or the name itself)
  local s t
  for s in $sessions; do
    t=${s#job-}; t=${t#lane-}; [ ${#t} -ge 4 ] || continue
    case "$1" in *"$t"*) return 0 ;; esac
    case "$t" in *"$1"*) return 0 ;; esac
  done; return 1
}
# GIT_OPTIONAL_LOCKS=0: a plain `git status` takes index.lock to refresh the index, which rewrites .git's mtime. Before
# 2026-11-15 that write was this step's own: it made a folder look written today, so it was never idle (#393).
export GIT_OPTIONAL_LOCKS=0
git_busy() {  # $1 folder: prints why a git checkout inside it may not be archived
  local g d url
  while IFS= read -r g; do
    d=$(dirname "$g")
    if ! git -C "$d" status --porcelain >/dev/null 2>&1; then echo "git checkout $d unreadable"; return; fi
    # A clone of someone else's repository (a data source such as OpenPecha's P000001) holds no work of ours, and
    # the archive keeps its working tree as it is; only our own checkouts are held for uncommitted or unpushed work.
    url=$(git -C "$d" remote get-url origin 2>/dev/null)
    case "$url" in ""|*Embassy-of-the-Free-Mind*|*sourcelibrary*|/*) ;; *) continue ;; esac
    [ -n "$(git -C "$d" status --porcelain 2>/dev/null | head -1)" ] && { echo "uncommitted work in $d"; return; }
    [ -n "$(git -C "$d" log --branches --not --remotes -1 --format=%h 2>/dev/null)" ] && { echo "unpushed commits in $d"; return; }
  done < <(find "$1" -maxdepth 4 -name .git 2>/dev/null)
}
consider() {  # $1 folder, $2 top|child. Appends "newest kb path" to CANDS, or "kb path reason" to KEPT.
  local S=$1 n kb newest age reason idle=$IDLE_DAYS
  [ -d "$S" ] && [ ! -L "$S" ] || return
  n=$(basename "$S")
  case "$n" in .restoring-*) return ;; esac
  kb=$(du -sk "$S" 2>/dev/null | cut -f1)
  [ "${kb:-0}" -ge $((MIN_MB * 1024)) ] || return
  # The newest FILE: a directory's mtime moves when anything inside it is removed or locked, which is not work (#393).
  newest=$(find "$S" -xdev ! -type d -printf '%T@\n' 2>/dev/null | sort -n | tail -1); newest=${newest%.*}
  age=$(( ($(date +%s) - ${newest:-0}) / 86400 ))
  [ "$(pct "$S")" -ge "$PRESSURE_PCT" ] && [ "$PRESSURE_IDLE_DAYS" -lt "$idle" ] && idle=$PRESSURE_IDLE_DAYS
  reason=""
  if [ "$age" -lt "$idle" ]; then reason="written ${age} d ago"
  elif named_by_session "$n"; then reason="a tmux session is named for it"
  elif awk -v p="$S" '$0 == p || index($0, p "/") == 1 { f = 1; exit } END { exit !f }' "$OPEN"; then reason="open files or a process working inside it"
  elif [ "$2" = top ] && [ -n "$(find "$S" -maxdepth 3 -name pyvenv.cfg -print -quit 2>/dev/null)" ]; then reason="holds a Python environment (a tool, not scratch)"
  else reason=$(git_busy "$S"); fi
  if [ -n "$reason" ]; then echo "$kb $S $reason" >> "$KEPT"; else echo "${newest:-0} $kb $S" >> "$CANDS"; fi
}
PARENTS=""
for P in "$ROOT"/jobs "$ROOT"/claude-jobs "$ROOT"/moved-from-* "$VOL"/jobs "$VOL"/root-moved "$VOL"/moved-from-* /data/scratch/sl/jobs /data/scratch/moved-from-*; do
  [ -d "$P" ] || continue
  r=$(readlink -f "$P"); case " $PARENTS " in *" $r "*) continue ;; esac; PARENTS="$PARENTS $r"
done
for P in $PARENTS; do for S in "$P"/*; do consider "$S" child; done; done
# A lane's folder (/root/jobs/cli-ocr-first) is written every day, so it is never idle, but each run writes into its
# own day folder (<lane>/YYYY-MM-DD) and no run reads an earlier day's: the ledgers sit beside them, not inside.
# So each day folder is a candidate on its own. On 2026-11-15 gex45's six cli-* lanes held 33 GB, 21 GB of it in day
# folders untouched for 3 days or more (#393).
for P in $PARENTS; do
  for S in "$P"/*/20[0-9][0-9]-[01][0-9]-[0-3][0-9]; do [ -d "$S" ] && consider "$S" day; done
done
for S in "$ROOT"/*; do
  [ -n "$TOP" ] || break
  n=$(basename "$S")
  case "$KEEP" in *" $n "*) continue ;; esac
  case "$n" in moved-from-*) continue ;; esac
  case " $PARENTS " in *" $(readlink -f "$S") "*) continue ;; esac
  consider "$S" top
done

slug() { echo "${1#/}" | sed 's#/#__#g; s#[^A-Za-z0-9._~-]#_#g'; }
archive_one() {  # $1 folder, $2 kb, $3 newest-write epoch. Returns 0 only when the folder is in R2 and gone.
  local S=$1 parent name key out sumf stamp entries back st put_sha put_bytes get_sha get_bytes
  parent=$(dirname "$S"); name=$(basename "$S")
  key="cold/$BOX/$(slug "$S")-$(date -u +%F).tar.zst"
  out=$(mktemp); sumf=$(mktemp); stamp=$(mktemp)
  # tar never archives a unix socket ("socket ignored", exit 0), so a socket must not be counted either. A job's
  # tmp/ keeps the sockets of processes long gone, and with them counted the check failed on every run: the
  # folder stayed, and was uploaded again each hour (yig-vllm-6871, 7.5 GB, 42 sockets, 68648 against 68690).
  entries=$(find "$S" ! -type s 2>/dev/null | wc -l)
  tar --use-compress-program='zstd -T4 -3 -q' -C "$parent" -cf - "$name" 2>"$out.err" | $COLD put "$key" > "$out" 2>"$out.uerr"
  st=("${PIPESTATUS[@]}")
  if [ "${st[0]}" != 0 ] || [ "${st[1]}" != 0 ]; then
    echo "  FAILED $S: tar=${st[0]} upload=${st[1]} $(cat "$out.err" "$out.uerr" | grep -v '^ *at ' | head -c 400); original kept"
    $COLD rm "$key" 2>/dev/null; rm -f "$out" "$out.err" "$out.uerr" "$sumf" "$stamp"; return 1
  fi
  read -r put_sha put_bytes < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["sha256"], d["bytes"])' "$out")
  back=$($COLD get "$key" --sum-to "$sumf" | tar --use-compress-program='zstd -d -q' -tf - | wc -l)
  read -r get_sha get_bytes < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["sha256"], d["bytes"])' "$sumf" 2>/dev/null)
  local why=""
  [ "$get_sha" = "$put_sha" ] && [ "$get_bytes" = "$put_bytes" ] || why="read-back ${get_sha:-?}/${get_bytes:-?} != ${put_sha}/${put_bytes}"
  [ -z "$why" ] && [ "$back" != "$entries" ] && why="archive lists $back entries, folder has $entries"
  [ -z "$why" ] && [ -n "$(find "$S" -newer "$stamp" -print -quit 2>/dev/null)" ] && why="written during the archive"
  [ -z "$why" ] && lsof +D "$S" >/dev/null 2>&1 && why="a file was opened during the archive"
  if [ -n "$why" ]; then
    echo "  FAILED $S: $why; original kept, R2 object removed"
    $COLD rm "$key" 2>/dev/null; rm -f "$out" "$out.err" "$out.uerr" "$sumf" "$stamp"; return 1
  fi
  local ptr="$S.IN-R2.txt" restore_cmd="$here/disk-steward.sh restore $S.IN-R2.txt"
  cat > "$ptr" <<P
# $S was archived to Cloudflare R2 by disk-steward.sh (#6223) after it went idle, and removed here.
# Restore: $restore_cmd
path=$S
host=$BOX
bucket=sl-corpus-snapshots
key=$key
sha256=$put_sha
bytes=$put_bytes
source_kb=$2
entries=$entries
newest_write=$(date -u -d "@$3" +%FT%TZ)
archived=$(now)
P
  $COLD put-json "$key.json" "$(python3 -c 'import json,sys; print(json.dumps(dict(l.split("=",1) for l in open(sys.argv[1]).read().splitlines() if "=" in l and not l.startswith("#"))))' "$ptr")" 2>/dev/null \
    || echo "  (manifest $key.json not written; the pointer file has everything)"
  rm -rf "$S"
  rm -f "$out" "$out.err" "$out.uerr" "$sumf" "$stamp"
  [ -e "$S" ] && { echo "  $S: removal incomplete (pointer written; archive verified)"; return 1; }
  echo "  archived $S ($(gb "$2") GB → $(gb $((put_bytes / 1024))) GB in R2, sha256 ${put_sha:0:12}) → $key"
  ARCHIVED_KB=$((ARCHIVED_KB + $2)); R2_BYTES=$((R2_BYTES + put_bytes))
}

ARCHIVED_KB=0; R2_BYTES=0
declare -A SIM  # dry run: projected used kb per mount
sort -n "$CANDS" -o "$CANDS"
while read -r -u 3 newest kb S; do  # fd 3: nothing the archive runs can eat the list from stdin
  [ -d "$S" ] || continue  # a day folder whose lane folder was archived before it
  m=$(mnt "$S")
  if [ -n "$APPLY" ]; then
    p=$(pct "$m")
    if [ "$p" -le "$BAND" ]; then echo "$kb $S eligible; $m at ${p}% is within the band" >> "$KEPT"; continue; fi
    archive_one "$S" "$kb" "$newest" || echo "$kb $S archive failed (see log)" >> "$KEPT"
  else
    read -r used avail < <(df -k --output=used,avail "$m" | tail -1)
    u=${SIM[$m]:-$used}; p=$(( (u * 100 + used + avail - 1) / (used + avail) ))
    if [ "$p" -le "$BAND" ]; then echo "  eligible, not needed ($m at ~${p}%): $S ($(gb "$kb") GB, idle since $(date -u -d "@$newest" +%F))"; continue; fi
    echo "  would archive $S ($(gb "$kb") GB, idle since $(date -u -d "@$newest" +%F)) [$m ~${p}%]"
    SIM[$m]=$((u - kb))
  fi
done 3< "$CANDS"
sort -rn "$KEPT" | while read -r kb S why; do echo "  keep $S ($(gb "$kb") GB): $why"; done
[ -n "$APPLY" ] && [ "$ARCHIVED_KB" -gt 0 ] && echo "  archived $(gb $ARCHIVED_KB) GB this run, $(awk -v b=$R2_BYTES 'BEGIN{printf "%.1f", b/1e9}') GB in R2 (\$$(awk -v b=$R2_BYTES 'BEGIN{printf "%.2f", b/1e9*0.015}')/month)"

# State for disk-alarm.sh: each mount's percent after this run, and what could not be archived on it.
if [ -n "$APPLY" ]; then
  mkdir -p "$(dirname "$STATE")"
  {
    echo "ts $(date +%s)"
    for m in $( { echo /; for P in $PARENTS; do mnt "$P"; done; } | sort -u); do
      echo "mount $m $(pct "$m")"
      echo "stuck $m $(sort -rn "$KEPT" | while read -r kb S why; do [ "$(mnt "$S")" = "$m" ] && echo "$S $(gb "$kb") GB: $why"; done | head -4 | paste -sd';' -)"
    done
  } > "$STATE.new" && mv "$STATE.new" "$STATE"
fi
echo "$(now) done. root: $(df -h --output=used,avail,pcent / | tail -1)"

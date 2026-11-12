#!/usr/bin/env bash
# The ONLY thing another job box may run here (#6360). Installed at /root/bin/box-rpc.sh and named as the
# forced command of every mesh key in /root/.ssh/authorized_keys:
#   restrict,from="<that box's IP>",command="/root/bin/box-rpc.sh" ssh-ed25519 AAAA… mesh@<box>
# `restrict` turns off shell, pty, port/agent/X11 forwarding; `from=` pins the caller's address; the
# command= makes sshd run this script whatever the caller asked for, with the request in
# $SSH_ORIGINAL_COMMAND. This script reads it as words and dispatches on a fixed verb list. Nothing in
# it is ever evaluated. Every call is logged to /var/log/box-rpc.log.
#
# Why a mesh at all (Derek 2026-10-10, "make them connect"): until now only the laptop could reach all
# three boxes, so a job that hit its weekly cap waited for a human with the lid open, the guest boxes
# had no usage meter, and earthai-live's decisions were unreadable from main (#6360). Two of the four
# Claude accounts sat at 0% for the week on idle boxes.
#
# Verbs (client: scripts/workers/box.sh):
#   ping                      "pong <host> <installed wrapper commit>"
#   where | status            the job wrapper's own one-line placement record / job list
#   decisions | taken | landings   the last 300 lines of that job ledger
#   usage                     "USAGE <email> <json>" per Claude login here, read with its own token, never refreshed
#   put-limits  (stdin)       the climits meter's latest.json, ≤ 64 KB, must parse with an accounts list
#   brief <name>              that job's brief here (≤ 200 lines): what it was told, its Route/Lands/Dispatched-by lines
#   health                    host, uptime, load, memory, disks
#   gpu                       the card's use, its processes, gpu-queue.sh list, the queue log's tail (GPU boxes)
#   gpu-probe                 one line for gex45-idle-alert.sh (newest output, util, uptime, queue counts, processes)
#   tail <path> [lines]       a file under the job and log trees (/root/jobs, /root/gpu-queue, /var/log/sourcelibrary, …)
#   ls <path>                 a directory listing, same trees
#   put <path> (stdin)        write a file (<= 20 MB) under a job dir; logged with its size and hash
#   gpu-add <name> (stdin)    queue a GPU task (<= 200 KB, needs a '# issue: NNNN' line) through gpu-queue.sh add
#   ledger                    the last 300 job-ledger records here (job-ledger.sh, #8606): start/done/stopped, who launched it
#   start <name> (stdin)      start a job from the brief on stdin (≤ 200 KB, with Lands:/PR: header lines).
#                             Refuses a name already used here, and more than $MESH_MAX_STARTS_PER_HOUR remote starts an hour.
# Exit codes: 0 ok, 2 bad request, 3 refused, 4 failed.
set -u
LOG=${BOX_RPC_LOG:-/var/log/box-rpc.log}
CJ=/root/bin/claude-job.sh
MESH_MAX_STARTS_PER_HOUR=${MESH_MAX_STARTS_PER_HOUR:-6}
if [ -d /data/scratch/sl/claude-jobs ]; then JD=/data/scratch/sl/claude-jobs; else JD=/root/claude-jobs; fi
caller=${SSH_CLIENT%% *}; caller=${caller:-local}
log() { echo "$(date -u +%FT%TZ) $caller $*" >> "$LOG" 2>/dev/null || true; }
die() { log "$verb -> $2: $3"; echo "box-rpc: $3" >&2; exit "$1"; }

read -r -a req <<< "${SSH_ORIGINAL_COMMAND:-}"
verb=${req[0]:-}; arg=${req[1]:-}
[ ${#req[@]} -le 2 ] || { [ "$verb" = tail ] && [ ${#req[@]} -le 3 ]; } || die 2 bad "too many words"

# Job work through the mesh (#8614, 2026-11-12): what jobs on one box did on another over a raw ssh (reading logs,
# queueing GPU tasks, copying code into /root/jobs/<job>), as verbs that are logged here and stay inside the job and log trees. Paths are resolved (realpath) before the check, so `..` and
# symlinks cannot leave the roots.
JOB_ROOTS="${BOX_RPC_TEST_ROOT:-} /root/jobs /root/gpu-queue /var/log/sourcelibrary /data/scratch/sl/jobs /data/scratch/sl/logs $(ls -d /mnt/HC_Volume_*/jobs 2>/dev/null | tr '\n' ' ')"
PUT_ROOTS="${BOX_RPC_TEST_ROOT:-} /root/jobs /data/scratch/sl/jobs $(ls -d /mnt/HC_Volume_*/jobs 2>/dev/null | tr '\n' ' ')"
under() {  # $1 resolved path, rest = roots: is it inside one of them?
  local p=$1 r; shift
  for r in "$@"; do r=$(realpath -m "$r"); case "$p" in "$r"|"$r"/*) return 0 ;; esac; done
  return 1
}

case "$verb" in
  ping)
    log ping; echo "pong $(hostname) $(cat /root/bin/claude-job.sh.commit 2>/dev/null || echo unknown)" ;;
  where|status)
    log "$verb"; exec "$CJ" "$verb" ;;
  decisions|taken|landings)
    log "$verb"; f="$JD/$verb.txt"; [ -f "$f" ] && tail -n 300 "$f"; exit 0 ;;
  brief)
    [[ "$arg" =~ ^[a-z0-9][a-z0-9-]{2,62}$ ]] || die 2 bad "job name must be lowercase letters, digits and dashes"
    [ -f "$JD/$arg.brief.txt" ] || die 3 refused "no job named $arg here"
    log "brief $arg"; head -n 200 "$JD/$arg.brief.txt"; exit 0 ;;
  ledger)
    log ledger; [ -f "$JD/ledger.jsonl" ] && tail -n 300 "$JD/ledger.jsonl"; exit 0 ;;
  health)
    log health; echo "host $(hostname) up $(uptime -p 2>/dev/null) load $(cut -d' ' -f1-3 /proc/loadavg) cpus $(nproc)"
    free -g | sed -n 2p; df -h / /mnt/HC_Volume_* /data 2>/dev/null | sed 1d | sort -u; exit 0 ;;
  gpu)
    command -v nvidia-smi >/dev/null || die 3 refused "no GPU on this box"
    log gpu; nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader
    nvidia-smi --query-compute-apps=pid,used_memory,process_name --format=csv,noheader 2>/dev/null | head -10
    [ -x /root/bin/gpu-queue.sh ] && /root/bin/gpu-queue.sh list
    tail -n 5 /var/log/sourcelibrary/gpu-queue.log 2>/dev/null; exit 0 ;;
  gpu-probe)
    # One line for scripts/maintenance/gex45-idle-alert.sh (it ran this over a raw ssh until #8614): newest output
    # mtime, GPU util %, uptime s, queue pending, running, newest finished mtime, compute processes.
    command -v nvidia-smi >/dev/null || die 3 refused "no GPU on this box"
    newest=0
    for d in /root/pz/out /root/jobs; do [ -d "$d" ] || continue
      t=$(find "$d" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)
      [ -n "$t" ] && [ "$t" -gt "$newest" ] && newest=$t
    done
    util=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
    procs=$(nvidia-smi --query-compute-apps=process_name --format=csv,noheader 2>/dev/null | xargs -r -n1 basename | sort | uniq -c | tr -s ' ' | tr '\n' ';')
    Q=/root/gpu-queue; qp=NA; [ -d $Q/pending ] && qp=$(ls -1 $Q/pending | grep -c '\.sh$'); qr=$(ls -1 $Q/running 2>/dev/null | grep -c '\.sh$')
    qf=$(find $Q/done $Q/failed -maxdepth 1 -name '*.sh' -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)
    echo "$newest ${util:-NA} $(cut -d. -f1 /proc/uptime) $qp $qr ${qf:-0} ${procs:-none}"; exit 0 ;;
  tail|ls)
    [ -n "$arg" ] || die 2 bad "usage: $verb <path>${verb:+ [lines]}"
    p=$(realpath -m -- "$arg"); under "$p" $JOB_ROOTS || die 3 refused "$arg is outside the job and log trees"
    log "$verb $p"
    if [ "$verb" = ls ]; then ls -la -- "$p" 2>&1 | head -n 500
    else n=${req[2]:-100}; [[ "$n" =~ ^[0-9]{1,4}$ ]] || die 2 bad "lines must be 1-9999"; [ -f "$p" ] || die 3 refused "no file $p"; tail -n "$n" -- "$p"; fi
    exit 0 ;;
  put)
    [ -n "$arg" ] || die 2 bad "usage: put <path under a job dir> (file on stdin, <= 20 MB)"
    p=$(realpath -m -- "$arg"); under "$p" $PUT_ROOTS || die 3 refused "put only writes under a job dir ($PUT_ROOTS)"
    under "$p" $PUT_ROOTS && for r in $PUT_ROOTS; do [ "$p" = "$(realpath -m "$r")" ] && die 3 refused "name a file inside a job dir"; done
    mkdir -p -- "$(dirname "$p")"; tmp=$(mktemp "$(dirname "$p")/.put.XXXXXX")
    head -c 20971521 > "$tmp"; [ "$(stat -c %s "$tmp")" -le 20971520 ] || { rm -f "$tmp"; die 2 bad "file over 20 MB"; }
    mv -f "$tmp" "$p"; log "put $p $(stat -c %s "$p")B sha $(sha256sum "$p" | cut -c1-12)"; echo "ok $p"; exit 0 ;;
  gpu-add)
    [ -x /root/bin/gpu-queue.sh ] || die 3 refused "no GPU queue on this box"
    [[ "$arg" =~ ^[a-z0-9][a-z0-9._-]{2,80}$ ]] || die 2 bad "task name: lowercase letters, digits, . _ -"
    tmp=$(mktemp /tmp/box-rpc-task.XXXXXX); head -c 204801 > "$tmp"
    [ "$(stat -c %s "$tmp")" -le 204800 ] || { rm -f "$tmp"; die 2 bad "task over 200 KB"; }
    # A queued task says which issue it serves, so the page and the log can name it (the queue's own `# issue:` header).
    grep -qE '^# issue: *[0-9]{3,5}' "$tmp" || { rm -f "$tmp"; die 2 bad "task needs a '# issue: NNNN' header line"; }
    out=$(/root/bin/gpu-queue.sh add "$tmp" "$arg" 2>&1); rc=$?; sha=$(sha256sum "$tmp" | cut -c1-12); rm -f "$tmp"
    echo "$out"; if [ $rc -eq 0 ]; then log "gpu-add $arg ok sha $sha"; else log "gpu-add $arg failed"; exit 4; fi; exit 0 ;;
  usage)
    # Each Claude login on this box (/root, and every JOB_CLAUDE_HOME dir /root/.claude-*), read with that login's
    # own access token as it stands. Prints "USAGE <email> <usage json>" per login, never a token. Never refreshes:
    # a refresh rotates the token under the running claude. Lets main's climits fill in an account whose own
    # climits grant expired, without a browser login (2026-11-09).
    log usage
    python3 - <<'PY'
import glob, json, os, time, urllib.request
homes = [("/root/.claude.json", "/root/.claude/.credentials.json")]
homes += [(os.path.join(d, ".claude.json"), os.path.join(d, ".credentials.json")) for d in sorted(glob.glob("/root/.claude-*"))]
seen = set()
for j, c in homes:
    try:
        email = ((json.load(open(j)).get("oauthAccount") or {}).get("emailAddress") or "").lower()
        o = json.load(open(c))["claudeAiOauth"]
    except Exception:
        continue
    if not email or email in seen or o.get("expiresAt", 0) / 1000 - time.time() < 60:
        continue
    try:
        r = urllib.request.Request("https://api.anthropic.com/api/oauth/usage", headers={
            "Authorization": "Bearer " + o["accessToken"], "anthropic-beta": "oauth-2025-04-20", "User-Agent": "climits/1.0 (mesh read)"})
        print("USAGE", email, json.dumps(json.load(urllib.request.urlopen(r, timeout=15))))
        seen.add(email)
    except Exception:
        pass
PY
    exit 0 ;;
  put-limits)
    dst=/root/.claude-limits/latest.json; mkdir -p -m 700 /root/.claude-limits
    tmp=$(mktemp /root/.claude-limits/.in.XXXXXX)
    head -c 65537 > "$tmp"
    [ "$(stat -c %s "$tmp")" -le 65536 ] || { rm -f "$tmp"; die 2 bad "limits file over 64 KB"; }
    python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert isinstance(d.get("accounts"), list)' "$tmp" 2>/dev/null \
      || { rm -f "$tmp"; die 2 bad "limits file does not parse as a climits latest.json"; }
    chmod 644 "$tmp"; mv -f "$tmp" "$dst"; log "put-limits ok"; echo ok ;;
  start)
    [[ "$arg" =~ ^[a-z0-9][a-z0-9-]{2,62}$ ]] || die 2 bad "job name must be lowercase letters, digits and dashes"
    [ -e "$JD/$arg.brief.txt" ] && die 3 refused "a job named $arg already exists here"
    n=$(awk -v since="$(date -u -d '1 hour ago' +%FT%TZ)" '$1 >= since && $3 == "start" && $5 == "ok"' "$LOG" 2>/dev/null | wc -l)
    [ "$n" -lt "$MESH_MAX_STARTS_PER_HOUR" ] || die 3 refused "$n remote starts in the last hour (cap $MESH_MAX_STARTS_PER_HOUR)"
    tmp=$(mktemp /tmp/box-rpc-brief.XXXXXX)
    head -c 204801 > "$tmp"
    sz=$(stat -c %s "$tmp")
    [ "$sz" -gt 0 ] && [ "$sz" -le 204800 ] || { rm -f "$tmp"; die 2 bad "brief must be 1 byte to 200 KB"; }
    # A remote start must say where it lands. On 2026-10-10 a mesh test sent the one-word brief "hi" under a
    # name that existed only on another box; it started, and a job ran on nothing. The header lines are
    # what a real brief always has (JOB-HOSTS.md), so their absence means the caller sent the wrong thing.
    head -15 "$tmp" | grep -qiE '^[[:space:]]*Lands:[[:space:]]*(#?[0-9]{3,5}|none)' && head -15 "$tmp" | grep -qiE '^[[:space:]]*PR:[[:space:]]*(yes|no)' \
      || { rm -f "$tmp"; die 2 bad "brief needs 'Lands: #NNNN|none' and 'PR: yes|no' in its first 15 lines"; }
    out=$("$CJ" start "$arg" "$tmp" 2>&1); rc=$?; rm -f "$tmp"
    echo "$out"
    if [ $rc -eq 0 ]; then log "start $arg ok"; else log "start $arg failed rc=$rc"; exit 4; fi ;;
  *)
    die 2 bad "unknown verb '${verb}' (ping where status decisions taken landings brief ledger health gpu gpu-probe tail ls put gpu-add usage put-limits start)" ;;
esac

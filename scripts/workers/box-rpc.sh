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
#   put-limits  (stdin)       the climits meter's latest.json, ≤ 64 KB, must parse with an accounts list
#   start <name> (stdin)      start a job from the brief on stdin (≤ 200 KB, with Lands:/PR: header lines).
#                             Refuses a name already used here, and more than $MESH_MAX_STARTS_PER_HOUR remote starts an hour.
# Exit codes: 0 ok, 2 bad request, 3 refused, 4 failed.
set -u
LOG=/var/log/box-rpc.log
CJ=/root/bin/claude-job.sh
MESH_MAX_STARTS_PER_HOUR=${MESH_MAX_STARTS_PER_HOUR:-6}
if [ -d /data/scratch/sl/claude-jobs ]; then JD=/data/scratch/sl/claude-jobs; else JD=/root/claude-jobs; fi
caller=${SSH_CLIENT%% *}; caller=${caller:-local}
log() { echo "$(date -u +%FT%TZ) $caller $*" >> "$LOG" 2>/dev/null || true; }
die() { log "$verb -> $2: $3"; echo "box-rpc: $3" >&2; exit "$1"; }

read -r -a req <<< "${SSH_ORIGINAL_COMMAND:-}"
verb=${req[0]:-}; arg=${req[1]:-}
[ ${#req[@]} -le 2 ] || die 2 bad "too many words"

case "$verb" in
  ping)
    log ping; echo "pong $(hostname) $(cat /root/bin/claude-job.sh.commit 2>/dev/null || echo unknown)" ;;
  where|status)
    log "$verb"; exec "$CJ" "$verb" ;;
  decisions|taken|landings)
    log "$verb"; f="$JD/$verb.txt"; [ -f "$f" ] && tail -n 300 "$f"; exit 0 ;;
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
    die 2 bad "unknown verb '${verb}' (ping where status decisions taken landings put-limits start)" ;;
esac

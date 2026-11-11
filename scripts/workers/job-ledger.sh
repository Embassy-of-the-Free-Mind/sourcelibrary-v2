#!/usr/bin/env bash
# PRIOR ART: claude-job.sh's landings.txt (one line per finished job, this box only) and ops RUNNING.md (by hand,
# rebuilt 2026-11-11 after it listed ~120 jobs as running when one was). This adds the start, with who launched it.
#
# job-ledger.sh — one record per job event (start / done / stopped), on every box, in one place (#8606).
#   job-ledger.sh record <event> <name> <brief>   called by claude-job.sh; never fails the caller
#   job-ledger.sh flush                           push spooled records to the ops repo (claude-job.sh sweep, cron)
#   job-ledger.sh show [days]                     every box's records from the ops repo, newest first (default 3)
#   job-ledger.sh why <name>                      that job's records: who launched it, from where, why, on what route
#
# Why: on 2026-11-11 Derek asked of kangyur-finish-8482 on main "where did this job come from?", and nothing on
# main could say. It had been started over a root ssh from gex45, not through box-rpc, so box-rpc.log had no line,
# and the dispatching session's transcript was on gex45, which main cannot read. Its Route line also named an
# engine the live router had moved off that day. A record written AT START, holding the launcher and the brief's
# own why/route lines, answers that from any box or the phone, with the laptop off.
#
# Where: Embassy-of-the-Free-Mind/sourcelibrary-ops, jobs/ledger/YYYY-MM/<ts>_<box>_<job>_<event>.json. One file
# per record, so two boxes writing at once never conflict in git. GitHub is the one store every box and the phone
# can reach. Each record is also appended to $JD/ledger.jsonl here (box-rpc `ledger`), and spooled in
# $JD/ledger-spool until a push lands, so a GitHub outage loses nothing and never delays a start.
#
# Launcher fields: `via` is box-rpc (a mesh start), ssh (a shell login: who, from which box) or local; `session` is
# the dispatching Claude session (CLAUDE_CODE_SESSION_ID locally; across the mesh, box.sh appends a
# `Dispatched-by:` line to the brief, since ssh does not carry the caller's environment).
set -u
if [ -d /data/scratch/sl/claude-jobs ]; then JD=/data/scratch/sl/claude-jobs; else JD=/root/claude-jobs; fi
JD=${JOB_LEDGER_JD:-$JD}
OPS_REPO=${JOB_LEDGER_REPO:-Embassy-of-the-Free-Mind/sourcelibrary-ops}
OPS_DIR=${JOB_LEDGER_CLONE:-/root/.cache/sl-ops-ledger}
SPOOL=$JD/ledger-spool
BOXES_FILE=${JOB_LEDGER_BOXES:-/root/bin/box.sh}

box_name() {  # this box, as box.sh names it (main/cloudlayer/l7a/gex45), else the hostname
  { [ -x "$BOXES_FILE" ] && "$BOXES_FILE" self 2>/dev/null; } || hostname
}
box_of_ip() {  # an address from the BOXES table in box.sh, as its box name; else the address itself
  local t b; t=$(grep -m1 -oE '^BOXES="[^"]*"' "$BOXES_FILE" 2>/dev/null | cut -d'"' -f2)
  for b in $t; do [ "${b#*=}" = "$1" ] && { echo "${b%%=*}"; return; }; done
  echo "$1"
}
hdr() {  # $1 header name, $2 brief: its value from the first 15 lines
  head -15 "$2" 2>/dev/null | grep -m1 -iE "^[[:space:]]*$1:[[:space:]]" | sed -E 's/^[^:]*:[[:space:]]*//; s/[[:space:]]+$//'
}

record() {
  local event=$1 name=$2 brief=$3 ts via from_ip from_box session disp why title acct
  ts=$(date -u +%FT%TZ)
  from_ip=${SSH_CLIENT%% *}
  if [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then via=box-rpc; elif [ -n "$from_ip" ]; then via=ssh; else via=local; fi
  from_box=""; [ -n "$from_ip" ] && from_box=$(box_of_ip "$from_ip")
  disp=$(grep -m1 -iE '^Dispatched-by:' "$brief" 2>/dev/null | sed -E 's/^[^:]*:[[:space:]]*//')
  session=${CLAUDE_CODE_SESSION_ID:-}
  # The brief's own reason: a `Why:` header, else its first WHY paragraph, else its first prose line.
  why=$(hdr Why "$brief")
  [ -n "$why" ] || why=$(grep -m1 -E '^WHY:' "$brief" 2>/dev/null | sed -E 's/^WHY:[[:space:]]*//')
  why=$(printf '%s' "$why" | cut -c1-400)
  title=$(grep -m1 -E '^# ' "$brief" 2>/dev/null | sed 's/^# //' | cut -c1-160)
  acct=$(python3 -c 'import json,os,sys; d=os.environ.get("CLAUDE_CONFIG_DIR"); p=os.path.join(d,".claude.json") if d else os.path.expanduser("~/.claude.json"); print(((json.load(open(p)).get("oauthAccount") or {}).get("emailAddress") or ""))' 2>/dev/null)
  local json
  json=$(EV="$event" NM="$name" TS="$ts" BX="$(box_name)" VIA="$via" FIP="$from_ip" FBX="$from_box" \
    SES="$session" DISP="$disp" WHY="$why" TTL="$title" ACCT="$acct" USR="${SUDO_USER:-${USER:-}}" \
    LANDS="$(hdr Lands "$brief")" ROUTE="$(hdr Route "$brief")" \
    SHA="$(sha256sum "$brief" 2>/dev/null | cut -c1-12)" BRIEF="$brief" python3 -c '
import json, os
e = os.environ
r = {"ts": e["TS"], "event": e["EV"], "job": e["NM"], "box": e["BX"], "title": e["TTL"], "lands": e["LANDS"],
     "route": e["ROUTE"], "why": e["WHY"], "account": e["ACCT"],
     "launcher": {"via": e["VIA"], "from_box": e["FBX"], "from_ip": e["FIP"], "user": e["USR"],
                  "session": e["SES"], "dispatched_by": e["DISP"]},
     "brief": {"path": e["BRIEF"], "sha256_12": e["SHA"]}}
print(json.dumps(r, ensure_ascii=False))') || return 0
  mkdir -p "$SPOOL" 2>/dev/null || return 0
  echo "$json" >> "$JD/ledger.jsonl"
  local f; f="$SPOOL/$(echo "$ts" | tr -d ':-')_$(box_name)_${name}_${event}.json"
  echo "$json" > "$f"
  # Push in the background: a start must never wait on GitHub. A failed push stays spooled for the next flush.
  [ -n "${JOB_LEDGER_NO_BG:-}" ] || ( flush >/dev/null 2>&1 & ) 2>/dev/null
  return 0
}

ops_sync() {  # a clone of the ops repo at origin's tip; sparse, so only jobs/ledger is on disk
  if [ ! -d "$OPS_DIR/.git" ]; then
    rm -rf "$OPS_DIR"
    git clone -q --depth 1 --filter=blob:none --sparse "${JOB_LEDGER_URL:-https://github.com/$OPS_REPO.git}" "$OPS_DIR" || return 1
    git -C "$OPS_DIR" sparse-checkout set jobs/ledger || return 1
  fi
  git -C "$OPS_DIR" fetch -q --depth 1 origin main && git -C "$OPS_DIR" reset -q --hard origin/main
}

flush() {
  ls "$SPOOL"/*.json >/dev/null 2>&1 || return 0
  exec 9> "$JD/.ledger-flush.lock"; flock -n 9 || return 0   # one flush at a time on a box
  local try f n
  for try in 1 2 3 4; do
    ops_sync || { sleep $((try * ${JOB_LEDGER_BACKOFF:-4})); continue; }
    n=0
    for f in "$SPOOL"/*.json; do
      [ -f "$f" ] || continue
      local m; m=$(basename "$f" | cut -c1-4)-$(basename "$f" | cut -c5-6)
      mkdir -p "$OPS_DIR/jobs/ledger/$m"; cp "$f" "$OPS_DIR/jobs/ledger/$m/"; n=$((n + 1))
    done
    [ $n -gt 0 ] || return 0
    git -C "$OPS_DIR" add jobs/ledger
    git -C "$OPS_DIR" -c user.name="job-ledger ($(box_name))" -c user.email=noreply@sourcelibrary.org \
      commit -q -m "ledger: $n record(s) from $(box_name)" || return 0
    if git -C "$OPS_DIR" push -q origin HEAD:main 2>/dev/null; then
      for f in "$SPOOL"/*.json; do [ -f "$OPS_DIR/jobs/ledger/$(basename "$f" | cut -c1-4)-$(basename "$f" | cut -c5-6)/$(basename "$f")" ] && rm -f "$f"; done
      return 0
    fi
    sleep $((try * ${JOB_LEDGER_BACKOFF:-4}))   # someone pushed first: fetch their tip and add ours on top
  done
  return 1
}

SHOW_PY='
import json, sys
for l in sys.stdin:
    try:
        r = json.loads(l)
    except Exception:
        continue
    L = r.get("launcher") or {}
    who = L.get("dispatched_by") or ("session " + L["session"] if L.get("session") else "")
    src = L.get("via", "?") + (" from " + L["from_box"] if L.get("from_box") else "")
    if who:
        src += "; " + who
    print("%s  %-7s %s on %s (%s) -> %s" % (r["ts"], r["event"], r["job"], r["box"], src, r.get("lands") or "-"))
    if r["event"] == "start":
        if r.get("route"):
            print("      route: " + r["route"])
        if r.get("why"):
            print("      why: " + r["why"][:200])
'
show() {  # $1 days
  ops_sync >/dev/null 2>&1 || echo "(could not reach $OPS_REPO; showing the last copy)" >&2
  local since; since=$(date -u -d "${1:-3} days ago" +%Y%m%dT%H%M%SZ)
  find "$OPS_DIR/jobs/ledger" -name '*.json' 2>/dev/null | awk -F/ -v s="$since" '$NF >= s' | sort -r |
    xargs -r cat | python3 -c "$SHOW_PY"
}

case "${1:-}" in
  record) [ $# -ge 4 ] || { echo "usage: job-ledger.sh record <event> <name> <brief>" >&2; exit 2; }; record "$2" "$3" "$4" ;;
  flush) flush ;;
  show) show "${2:-3}" ;;
  why) [ -n "${2:-}" ] || { echo "usage: job-ledger.sh why <name>" >&2; exit 2; }; show 90 | grep -A2 -F " $2 on " ;;
  *) sed -n '4,8p' "$0"; exit 2 ;;
esac

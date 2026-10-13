#!/usr/bin/env bash
# Ask another job box to do one of the things its box-rpc.sh allows (#6360). Installed at /root/bin/box.sh.
#   box.sh <main|cloudlayer|l7a|all|others> <verb> [arg] [< stdin]   verbs: see box-rpc.sh
#   box.sh pick [--exclude <box>]   the emptiest ready box (what job-where.sh decides on the laptop)
#   box.sh push-limits              copy this box's climits meter to the other boxes (main, cron */5)
#   box.sh self                     this box's name in the table below
#
# Safe: a dedicated key (/root/.ssh/id_mesh) that the other boxes accept only from this box's address and
# only as box-rpc.sh (forced command, `restrict`). Host keys are pinned in /root/.ssh/known_hosts_mesh,
# so a re-imaged or impersonated box is refused, not trusted on first use.
# Smooth: one table of boxes, here. Resilient: 8 s connect timeout, keepalives, three tries with backoff
# on a connection failure (ssh exit 255) and none on a refusal, so a dead box costs seconds, never a hang.
# Setup and key rotation: scripts/workers/mesh-setup.sh, run from the laptop. Doc: scripts/workers/JOB-HOSTS.md.
set -u
BOXES="main=46.224.122.120 cloudlayer=46.224.208.175 l7a=167.233.32.250"
KEY=/root/.ssh/id_mesh; KH=/root/.ssh/known_hosts_mesh
ip_of() { local b; for b in $BOXES; do [ "${b%%=*}" = "$1" ] && { echo "${b#*=}"; return 0; }; done; return 1; }
self() {
  local mine b; mine=$(hostname -I 2>/dev/null)
  for b in $BOXES; do case " $mine " in *" ${b#*=} "*) echo "${b%%=*}"; return 0 ;; esac; done
  case "$(hostname)" in clawdbot) echo main ;; earthai-live) echo cloudlayer ;; earthai-l7a) echo l7a ;; *) return 1 ;; esac
}
call() {  # $1 box, rest = verb [arg]; stdin passes through
  local ip try rc=255 in=""; ip=$(ip_of "$1") || { echo "box.sh: no box named $1" >&2; return 2; }; shift
  if [ ! -t 0 ]; then in=$(mktemp); cat > "$in"; fi
  for try in 1 2 3; do
    ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=15 \
        -o ServerAliveCountMax=2 -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KH" \
        "root@$ip" "$*" < "${in:-/dev/null}"
    rc=$?; [ $rc -ne 255 ] && break
    [ $try -lt 3 ] && sleep $((try * 5))
  done
  [ -n "$in" ] && rm -f "$in"
  return $rc
}
others() { local me b; me=$(self); for b in $BOXES; do [ "${b%%=*}" != "$me" ] && echo "${b%%=*}"; done; }

case "${1:-}" in
  self) self ;;
  pick)  # prints "<box>" of the emptiest ready box, or nothing. Score: load per core + jobs/100, using the 5-minute
         # load when the box reports it: l7a's archive tick fires every 10 min and swings load1 from ~1 to ~60.
    ex=""; [ "${2:-}" = --exclude ] && ex="${3:-}"; me=$(self)
    for b in $BOXES; do b=${b%%=*}; [ "$b" = "$ex" ] && continue
      if [ "$b" = "$me" ]; then line=$(/root/bin/claude-job.sh where 2>/dev/null); else line=$(call "$b" where </dev/null 2>/dev/null); fi
      echo "$line" | grep -q 'ready=yes' || continue
      echo "$b $line"
    done | awk '{ for (i = 2; i <= NF; i++) { split($i, kv, "="); v[kv[1]] = kv[2] }
                 l = (v["load5"] != "" ? v["load5"] : v["load1"])
                 s = l / (v["cores"] ? v["cores"] : 1) + v["live_jobs"] / 100; delete v
                 if (best == "" || s < bs) { best = $1; bs = s } } END { if (best != "") print best }' ;;
  push-limits)  # main box, after climits: other boxes read their own account's weekly % from this file
    src=/root/.claude-limits/latest.json; [ -s "$src" ] || exit 0
    st=/root/.claude-limits/push-state; mkdir -p "$st"
    for b in $(others); do
      if call "$b" put-limits < "$src" >/dev/null 2>&1; then
        [ -f "$st/$b.fails" ] && [ "$(cat "$st/$b.fails")" -ge 6 ] && \
          curl -s -m 10 -H "Title: Box mesh back: main -> $b" -H "Priority: low" -d "Usage meter copies to $b again." https://ntfy.sh/sourcelibrary-uptime >/dev/null 2>&1
        echo 0 > "$st/$b.fails"
      else
        n=$(( $(cat "$st/$b.fails" 2>/dev/null || echo 0) + 1 )); echo $n > "$st/$b.fails"
        # Page once, after 30 minutes of failures; the wrapper on $b treats a stale meter as "no check".
        [ $n -eq 6 ] && curl -s -m 10 -H "Title: Box mesh down: main -> $b (30 min)" -H "Priority: high" \
          -d "box.sh cannot reach $b. Jobs there start without the weekly-limit check, and capped jobs cannot move. From the laptop: ssh root@$(ip_of "$b") tail /var/log/box-rpc.log; scripts/workers/mesh-setup.sh check" https://ntfy.sh/sourcelibrary-uptime >/dev/null 2>&1
      fi
    done ;;
  all|others)
    sel=$1; shift; rc=0  # stdin is never sent to more than one box
    for b in $BOXES; do b=${b%%=*}
      [ "$sel" = others ] && [ "$b" = "$(self)" ] && continue
      echo "== $b"
      # This box has no mesh key for itself (and no pinned host key), so run its own box-rpc.sh directly.
      if [ "$b" = "$(self)" ]; then SSH_ORIGINAL_COMMAND="$*" SSH_CLIENT="local" /root/bin/box-rpc.sh </dev/null || rc=$?
      else call "$b" "$@" </dev/null || rc=$?; fi
    done; exit $rc ;;
  ""|-h|--help) sed -n '2,6p' "$0"; exit 2 ;;
  *) call "$@" ;;
esac

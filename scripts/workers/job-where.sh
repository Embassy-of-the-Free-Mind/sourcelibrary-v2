#!/usr/bin/env bash
# Which job box should take the next job? Run from the LAPTOP: it is the only machine that reaches all three
# (#6358, #6076). On a job box it asks the others through the box mesh instead (box.sh, #6360).
# Asks each box for `claude-job.sh where`, reads every account's Claude limits, and names the box to use.
#
#   scripts/workers/job-where.sh
#   SL_JOB_BOXES="main=root@46.224.122.120 cloudlayer=root@46.224.208.175" scripts/workers/job-where.sh
#
# Why: on 2026-10-09 the main box sat at load 17 on 16 cores with its root disk 86% full while cloudlayer
# ran no jobs at all. Nothing told a dispatching session where there was room.
# A box is skipped when it is not ready (no Claude login, no gh login, no env file), has under 4 GB of
# memory or 15 GB of job disk free, has a 5-minute load above 1.5 per core, or does not answer. The load
# ceiling came on 2026-10-15: main ran 42 model processes at load 50 on 16 cores (3.1 per core) and this
# script still called it "ok".
#
# Headroom (#6751): Claude jobs are bound by the box account's 5-hour and weekly windows, not its CPU. On
# 2026-10-15 main and l7a sat at their 5-hour ceilings while cloudlayer idled with ~43% of its week about to
# lapse. So a box is also skipped when its account's 5-hour window is >= 80% or its week >= 90%, and the
# rest are ranked by the week's allowance left per hour to its reset (hours floored at 12): the account
# with the most to spend, soonest, goes first. Load per core breaks ties. "unused" is the week the account
# would leave on the table at its current pace. Limits come from Mongo ops_reports `claude-limits:latest`
# (published by spare-lane.py on main), else this machine's /root/.claude-limits/latest.json; the box ->
# account map comes from each box's `where` (account=), else the logins in JOB-HOSTS.md.
set -u
BOXES=${SL_JOB_BOXES:-"main=root@46.224.122.120 cloudlayer=root@46.224.208.175 l7a=root@167.233.32.250 gex45=root@65.108.136.89"}
MIN_MEM_MB=${MIN_MEM_MB:-4096}; MIN_DISK_GB=${MIN_DISK_GB:-15}; MAX_LOAD_PER_CORE=${MAX_LOAD_PER_CORE:-1.5}
MAX_SESSION_PCT=${MAX_SESSION_PCT:-80}; MAX_WEEK_PCT=${MAX_WEEK_PCT:-90}
# Used only while a box's installed wrapper predates `account=` in `where` (logins change: check JOB-HOSTS.md).
DEFAULT_ACCOUNTS="main=team@sourcelibrary.org cloudlayer=derek@playpowerlabs.com l7a=derek@sourcelibrary.org"

# The shared limits doc. The env file lives in the main checkout, not in a worktree.
here=$(cd "$(dirname "$0")" && pwd); limits=""
for root in "$(git -C "$here" rev-parse --show-toplevel 2>/dev/null)" "$(cd "$(git -C "$here" rev-parse --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd)"; do
  [ -n "$root" ] && [ -s "$root/.env.production.local" ] || continue
  limits=$(cd "$root" && timeout 60 node --env-file=.env.production.local "$here/claude-limits-share.mjs" pull 2>/dev/null) && break
done
# One line per account: email session% week% hours-to-week-reset unused% score age-min. On a job box the
# meter copied every 5 min (box.sh push-limits) is usually fresher than Mongo's (every 30): take the newer.
acct_table=$(printf '%s' "$limits" | python3 -c '
import json, sys, datetime as dt
def t(s):
    try: return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception: return None
docs = []
for src in (sys.stdin, "/root/.claude-limits/latest.json"):
    try: docs.append(json.load(src if src is sys.stdin else open(src)))
    except Exception: pass
docs = [d for d in docs if t(d.get("checked_at") or "")]
if not docs: sys.exit(0)
d = max(docs, key=lambda d: t(d["checked_at"]))
now = dt.datetime.now(dt.timezone.utc)
age = (now - t(d["checked_at"])).total_seconds() / 60
for a in d.get("accounts", []):
    if not a.get("ok"): continue
    l = {x["key"]: x for x in a.get("limits", [])}
    s, w = l.get("session:all") or {}, l.get("weekly_all:all")
    if not w: continue
    wp, sp, r = w.get("percent") or 0, s.get("percent") or 0, t(w.get("resets_at") or "")
    h = max((r - now).total_seconds() / 3600, 0) if r else 168
    elapsed = 1 - h / 168
    unused = f"{max(0, 100 - wp / elapsed):.0f}%" if elapsed >= 0.15 else "early"  # a day in, a pace is noise
    score = (100 - wp) / max(h, 12)
    print(a["email"].lower(), sp, wp, f"{h:.0f}", unused, f"{score:.2f}", f"{age:.0f}")
')

# How to ask a box: ssh as root from the laptop; through the box mesh from a job box.
mesh=""; [ -x /root/bin/box.sh ] && [ -s /root/.ssh/id_mesh ] && mesh=$(/root/bin/box.sh self 2>/dev/null)
ask() {  # $1 label, $2 ssh target
  if [ -n "$mesh" ] && [ "$1" = "$mesh" ]; then /root/bin/claude-job.sh where 2>/dev/null
  elif [ -n "$mesh" ]; then /root/bin/box.sh "$1" where </dev/null 2>/dev/null
  else ssh -o BatchMode=yes -o ConnectTimeout=8 "$2" /root/bin/claude-job.sh where 2>/dev/null; fi
}

best=""; bestkey=""; bestssh=""; assumed=""
[ -n "$acct_table" ] || echo "(no Claude limits readable: Mongo and /root/.claude-limits both failed; ranking by load only)"
age=$(echo "$acct_table" | awk 'NR==1{print $7}'); [ -n "$age" ] && echo "limits polled ${age} min ago"
printf '%-11s %-6s %-9s %-9s %-9s %-5s %-25s %-7s %-12s %-7s %-6s %s\n' \
  box load/core mem-free job-disk root-disk jobs account 5-hour week/reset unused score verdict
for b in $BOXES; do
  label=${b%%=*}; target=${b#*=}
  line=$(ask "$label" "$target" | grep -m1 '^host=')
  if [ -z "$line" ]; then printf '%-11s %s\n' "$label" "no answer (ssh failed, or the wrapper there has no \`where\` yet)"; continue; fi
  cores=1 load1=0 load5= mem_free_mb=0 job_disk_free_gb=0 root_free_gb=0 live_jobs=0 ready=no account=
  for kv in $line; do case "$kv" in cores=*|load1=*|load5=*|mem_free_mb=*|job_disk_free_gb=*|root_free_gb=*|live_jobs=*|ready=*|account=*) eval "${kv%%=*}='${kv#*=}'" ;; esac; done
  acct=$account
  if [ -z "$acct" ] || [ "$acct" = "?" ]; then
    acct="?"; for m in $DEFAULT_ACCOUNTS; do [ "${m%%=*}" = "$label" ] && acct="${m#*=}*" assumed=1; done
  fi
  sp="?" wp="?" hr="?" unused="?" score=0
  row=$(echo "$acct_table" | awk -v e="$(echo "${acct%\*}" | tr 'A-Z' 'a-z')" '$1==e{print; exit}')
  [ -n "$row" ] && read -r _ sp wp hr unused score _ <<<"$row"
  # 5-minute load when reported: l7a's archive tick swings the 1-minute load from ~1 to ~60 every 10 min.
  per=$(awk -v l="${load5:-$load1}" -v c="$cores" 'BEGIN{printf "%.2f", l/c}')
  verdict=ok
  [ "$ready" = yes ] || verdict="skip: $ready"
  [ "$verdict" = ok ] && [ "$mem_free_mb" -lt "$MIN_MEM_MB" ] && verdict="skip: memory"
  [ "$verdict" = ok ] && [ "$job_disk_free_gb" -lt "$MIN_DISK_GB" ] && verdict="skip: disk"
  [ "$verdict" = ok ] && awk -v p="$per" -v m="$MAX_LOAD_PER_CORE" 'BEGIN{exit !(p>m)}' && verdict="skip: load"
  ge() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a+0>=b+0)}'; }  # a percent may come back as 80.5
  [ "$verdict" = ok ] && [ "$sp" != "?" ] && ge "$sp" "$MAX_SESSION_PCT" && verdict="skip: 5-hour ${sp}%"
  [ "$verdict" = ok ] && [ "$wp" != "?" ] && ge "$wp" "$MAX_WEEK_PCT" && verdict="skip: week ${wp}%"
  wk="?"; [ "$wp" != "?" ] && wk="${wp}%/${hr}h"
  printf '%-11s %-6s %-9s %-9s %-9s %-5s %-25s %-7s %-12s %-7s %-6s %s\n' "$label" "$per" "$((mem_free_mb/1024))G" \
    "${job_disk_free_gb}G" "${root_free_gb}G" "$live_jobs" "$acct" "${sp}%" "$wk" "$unused" "$score" "$verdict"
  [ "$verdict" = ok ] || continue
  # Higher headroom first; then lower load per core, then fewer live jobs.
  key=$(awk -v s="$score" -v p="$per" -v j="$live_jobs" 'BEGIN{printf "%.4f", s * 1000 - (p + j/100)}')
  if [ -z "$best" ] || awk -v a="$key" -v b="$bestkey" 'BEGIN{exit !(a>b)}'; then best=$label; bestkey=$key; bestssh=$target; fi
done
[ -n "$assumed" ] && echo "(account*: assumed from JOB-HOSTS.md; that box's wrapper does not report account= yet)"
if [ -n "$best" ]; then
  echo; echo "use: $best"
  echo "  scp <brief.txt> $bestssh:/tmp/ && ssh $bestssh /root/bin/claude-job.sh start <name> /tmp/<brief.txt>"
else echo; echo "no box has room; do not start a job"; exit 1; fi

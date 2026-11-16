#!/bin/bash
# Disk alarm for every job box, every mounted disk (#5534, #6223). Every 15 min from cron. Pages ntfy when the
# level changes (ok → high → critical and back), and REPEATS every 2 h while the level is critical.
#
# Why: on 2026-10-01 the 150 GB root disk hit 100% and headless jobs died at worktree checkout
# with "No space left on device" and no log line. The disk check in pipeline-health-alert.mjs
# (#5539) runs once a day at 07:00 and emails; the disk filled within hours. This is the fast path.
# Why the repeat (#6223): on 2026-10-07 the disk sat at 100% for hours after ONE page at the 85%
# crossing; every later run logged level=high prev=high and stayed silent while ~10 jobs ran.
#
# Every mount, not just / (2026-10-26): cloudlayer's 492 GB /data/scratch volume reached 98% (9.8 GB free)
# with no page, because this script watched only / and was not installed on cloudlayer or l7a at all.
# Each real mount (no tmpfs, overlay, efivars, /boot) gets its own level and state file. A non-root page
# names the mount's largest folders, since the steward's runbook only covers /root.
# DISK_ALARM_MOUNT=/ restricts it to one mount (the old behaviour).
#
# After the steward (2026-10-29, #6223): disk-steward.sh runs hourly and archives idle folders to R2 until a disk
# is back at 70% (75% until #393). So the 85% page means "the steward tried and could not", never "a disk is filling": a mount the
# steward manages pages at `high` only when its last run (within STEWARD_FRESH_MIN) ended at or above the limit,
# and the page names what it could not archive and why; or when the steward has not completed a run for that
# long (it is broken, which is worth a page by itself). `critical` (95%) still pages at once: jobs die there.
# Mounts the steward does not manage page as before.
#
# Channel: ntfy topic sourcelibrary-uptime, the same one scripts/uptime-monitor.mjs pages on.
# Install (Hetzner crontab, beside the uptime monitor):
#   */15 * * * * /root/sourcelibrary/scripts/workers/disk-alarm.sh >> /var/log/sourcelibrary/disk-alarm.log 2>&1
# Test that it fires: DISK_ALARM_PCT=1 DISK_ALARM_STATE=/tmp/disk-alarm-test scripts/workers/disk-alarm.sh
set -u
PCT_LIMIT=${DISK_ALARM_PCT:-85}
PCT_CRIT=${DISK_ALARM_CRIT_PCT:-95}
REPEAT_SEC=${DISK_ALARM_REPEAT_SEC:-7200}
STATE=${DISK_ALARM_STATE:-/var/lib/sourcelibrary/disk-alarm.state}
STEWARD_STATE=${DISK_STEWARD_STATE:-/var/lib/sourcelibrary/disk-steward.state}
STEWARD_FRESH_MIN=${STEWARD_FRESH_MIN:-180}
TOPIC=${DISK_ALARM_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
MOUNTS=${DISK_ALARM_MOUNT:-$(df -P -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs 2>/dev/null | awk 'NR>1 && $6 !~ "^/(boot|sys|run|snap)" {print $6}')}
mkdir -p "$(dirname "$STATE")"
now=$(date -u +%FT%TZ); epoch=$(date +%s)
case "$(hostname)" in clawdbot) DEF_BOX=Hetzner ;; earthai-live) DEF_BOX=cloudlayer ;; earthai-l7a) DEF_BOX=l7a ;; *) DEF_BOX=$(hostname) ;; esac
BOX=${DISK_ALARM_BOX:-$DEF_BOX}  # gex45-1 runs this too (#5660)

# What grew (#367). The "written in the last 6 h" line below counts only files over 20 MB, and a Claude Code transcript
# folder grows as thousands of small appends: on 2026-11-15 main's root held 17 GB of them, 15.5 GB written in two days,
# and four pages in two days named nothing. So from SNAP_PCT up, a run keeps `du` of the mount to depth GROW_DEPTH (8 s
# warm on main's root at depth 4; at most one snapshot an hour, gzipped, GROW_WINDOW_H hours kept), and the page names
# the three folders that grew most since the oldest snapshot in the window: 15 minutes is too short to see a
# 7-GB-a-day folder. A byte counts in the deepest folder listed (a folder's own growth is its total less its listed
# children's), so /root and /root/.claude do not crowd out /root/.claude/projects/<job folder>.
# Prints "over N h: path +X GB; ..." or nothing (no snapshot old enough yet, du timed out, nothing grew 100 MB).
GROW_DEPTH=${DISK_ALARM_GROW_DEPTH:-4}
SNAP_PCT=${DISK_ALARM_SNAP_PCT:-75}
GROW_WINDOW_H=${DISK_ALARM_GROW_WINDOW_H:-6}
SNAP_EVERY_MIN=${DISK_ALARM_SNAP_EVERY_MIN:-55}
grew_since_last() {  # $1 mount, $2 snapshot prefix ($2.<epoch>.gz)
  local cur rc base newest f t
  cur=$(mktemp)
  timeout 150 nice ionice -c3 du -xk --max-depth="$GROW_DEPTH" "$1" 2>/dev/null > "$cur"; rc=$?
  # du exits 1 when a file vanishes under it, which a busy disk always has; only a timeout means no reading.
  [ $rc -ne 124 ] && [ -s "$cur" ] || { rm -f "$cur"; return 0; }
  for f in "$2".*.gz; do  # drop snapshots older than the window
    [ -f "$f" ] || continue; t=${f%.gz}; t=${t##*.}
    [ $((epoch - t)) -gt $((GROW_WINDOW_H * 3600 + 900)) ] && rm -f "$f"
  done
  base=$(ls "$2".*.gz 2>/dev/null | sort | head -1); newest=$(ls "$2".*.gz 2>/dev/null | sort | tail -1)
  if [ -n "$base" ]; then
    t=${base%.gz}; t=${t##*.}
    zcat "$base" | python3 -c '
import os, sys
def load(lines):
    d = {}
    for l in lines:
        k, _, path = l.rstrip("\n").partition("\t")
        if k.isdigit(): d[path] = int(k)
    return d
old, new = load(sys.stdin), load(open(sys.argv[1], errors="replace"))
root, hours = sys.argv[2].rstrip("/") or "/", float(sys.argv[3])
grow = {p: new[p] - old.get(p, 0) for p in new}
own = dict(grow)
for p, g in grow.items():
    if p != root and os.path.dirname(p) in own: own[os.path.dirname(p)] -= g
top = sorted(((g, p) for p, g in own.items() if g >= 102400), reverse=True)[:3]  # 100 MB or more
if top: print(f"over {hours:.1f} h: " + "; ".join(f"{p} +{g / 1048576:.1f} GB" for g, p in top))
' "$cur" "$1" "$(awk -v s=$((epoch - t)) 'BEGIN{printf "%.1f", s/3600}')"
  fi
  t=${newest%.gz}; t=${t##*.}
  if [ -z "$newest" ] || [ $((epoch - t)) -ge $((SNAP_EVERY_MIN * 60)) ]; then gzip -c "$cur" > "$2.$epoch.gz"; fi
  rm -f "$cur"
}

# Who owns a path (#393). A page that names /root/jobs/zh-shi-ji-8053 still leaves the reader to find out whose it is,
# and whether the steward can act on it. So every path a page names carries its owner: the job (its brief's Lands:
# issue; still running or done), the lane whose crontab line names the folder, the CI runner, or the steward step that
# keeps the folder in check. JOBS_DIR / CLAUDE_JOBS_DIR are overridable for the tests.
JOBS_DIR=${DISK_ALARM_JOBS_DIR:-/root/jobs}
CLAUDE_JOBS_DIR=${DISK_ALARM_CLAUDE_JOBS_DIR:-/root/claude-jobs}
CRONTAB_TEXT=${DISK_ALARM_CRONTAB_TEXT-$(crontab -l 2>/dev/null)}
job_owner() {  # $1 job name: "job X (#N, running|done)" when a brief exists, else nothing
  local b="$CLAUDE_JOBS_DIR/$1.brief.txt" lands st=running
  [ -f "$b" ] || return 0
  lands=$(sed -n 's/^Lands: *//p' "$b" | head -1 | awk '{print $1}')
  [ -f "$CLAUDE_JOBS_DIR/$1.done" ] && st=done
  echo "job $1${lands:+ ($lands, $st)}"
}
owner_of() {  # $1 path: one short phrase, or nothing when no rule knows the path
  local p=$1 n o
  case "$p" in
    "$JOBS_DIR"/*)
      n=${p#"$JOBS_DIR"/}; n=${n%%/*}
      o=$(job_owner "$n")
      if [ -z "$o" ] && printf '%s\n' "$CRONTAB_TEXT" | grep -v '^ *#' | grep -q -- "$JOBS_DIR/$n\b"; then o="lane $n (crontab); its day folders are archived by the steward"; fi
      # Neither: a running process that names it (the GPU queue runs chunks as /root/gpu-queue/running/<name>-cNNN.sh).
      [ -z "$o" ] && o=$(pgrep -af -- "$n" 2>/dev/null | grep -v -e disk-alarm -e pgrep | awk 'NR == 1 { w = $NF; sub(".*/", "", w); print "process " w " (pid " $1 ")" }')
      echo "${o:-job folder $n, no brief, lane or process names it}" ;;
    /root/worktrees/*|/root/sourcelibrary/.claude/worktrees/*)
      n=${p#*/worktrees/}; n=${n%%/*}; o=$(job_owner "${n#job-}"); echo "${o:-worktree $n}" ;;
    /root/.claude*/projects/*)
      n=${p#*/projects/}; n=${n%%/*}; o=""
      case "$n" in -root-worktrees-job-*) o=$(job_owner "${n#-root-worktrees-job-}") ;; -root-jobs-*) o=$(job_owner "${n#-root-jobs-}") ;; esac
      echo "Claude transcripts${o:+ of $o} (steward step 1g)" ;;
    /home/gha/runner-*) n=${p#/home/gha/}; echo "CI ${n%%/*} (steward step 1f resets its checkout)" ;;
    /home/gha*) echo "CI runner account" ;;
    /tmp|/tmp/*) echo "/tmp (steward steps 1e, 1h)" ;;
    /root/.agy-*|/root/.gemini*|/root/agy-history-aside*) echo "agy CLI (steward steps 1a-1d)" ;;
    /root/.cache/huggingface*) echo "HF cache (steward step 2)" ;;
  esac
}
with_owners() {  # stdin: text; every absolute path in it gets " [owner]" after it
  local line out w o
  while IFS= read -r line; do
    out=""
    for w in $line; do
      out="$out${out:+ }$w"
      case "$w" in /*) o=$(owner_of "${w%%[;:,]}"); [ -n "$o" ] && out="$out [$o]" ;; esac
    done
    printf '%s\n' "$out"
  done
}

check() {
  local MOUNT=$1 st=$STATE
  # / keeps the original state file so an upgrade does not re-page; other mounts get their own.
  [ "$MOUNT" != / ] && st="$STATE.$(printf '%s' "$MOUNT" | tr -c 'A-Za-z0-9' '_')"
  local used level prev="" last_paged="" free page="" title prio msg runbook what
  used=$(df --output=pcent "$MOUNT" 2>/dev/null | tail -1 | tr -dc '0-9')
  if [ -z "$used" ]; then
    # An unreadable check is UNKNOWN, never clear: page once for it too.
    level=unknown
  else
    level=ok
    [ "$used" -ge "$PCT_LIMIT" ] && level=high
    [ "$used" -ge "$PCT_CRIT" ] && level=critical
  fi
  # State is "<level> <epoch of last page>"; a pre-#6223 state file holds the level alone.
  [ -f "$st" ] && read -r prev last_paged < "$st"
  prev=${prev:-ok}; last_paged=${last_paged:-0}
  free=$(df -h --output=avail "$MOUNT" 2>/dev/null | tail -1 | tr -d ' ')
  echo "$now $MOUNT used=${used:-?}% free=${free:-?} level=$level prev=$prev limit=$PCT_LIMIT%/$PCT_CRIT%"
  # Folder sizes for "what grew since the last run" (#367), from SNAP_PCT up so the snapshot exists when a page needs it.
  local grown=""
  [ -n "$used" ] && [ "$used" -ge "$SNAP_PCT" ] && grown=$(grew_since_last "$MOUNT" "$st.sizes")

  [ "$level" != "$prev" ] && page=change
  [ "$level" = critical ] && [ "$prev" = critical ] && [ $((epoch - last_paged)) -ge "$REPEAT_SEC" ] && page=repeat
  [ -z "$page" ] && return 0

  # What the steward made of this mount on its last run: "<end percent>|<what it could not archive>", or nothing.
  local sw="" sw_ts=0 sw_pct="" sw_stuck="" sw_age=""
  if [ -f "$STEWARD_STATE" ]; then
    sw_ts=$(awk '$1 == "ts" {print $2}' "$STEWARD_STATE")
    sw_pct=$(awk -v m="$MOUNT" '$1 == "mount" && $2 == m {print $3}' "$STEWARD_STATE")
    sw_stuck=$(awk -v m="$MOUNT" '$1 == "stuck" && $2 == m {$1 = ""; $2 = ""; sub(/^  /, ""); print}' "$STEWARD_STATE" | sed "s|;/|; /|g" | with_owners)
    sw_age=$(( (epoch - ${sw_ts:-0}) / 60 ))
  fi
  if [ -n "$sw_pct" ]; then
    if [ "$sw_age" -gt "$STEWARD_FRESH_MIN" ]; then
      sw=" disk-steward has not completed a run for ${sw_age} min: check /var/log/sourcelibrary/disk-steward.log."
    elif [ "$level" = high ] && [ "$sw_pct" -lt "$PCT_LIMIT" ]; then
      echo "$now $MOUNT held: the steward's run ${sw_age} min ago ended at ${sw_pct}%; it acts again within the hour"
      return 0
    else
      sw=" The steward's run ${sw_age} min ago ended at ${sw_pct}% and could not archive: ${sw_stuck:-nothing listed}."
    fi
  fi

  if [ "$MOUNT" = / ]; then
    what="Root disk"
    runbook="Runbook #6223: /root/bin/disk-steward.sh (hourly) archives idle folders to R2 above 70% and trims the HF cache; what it keeps, and why, is in its log."
  else
    what="Disk $MOUNT"
    runbook="Largest: $(timeout 120 du -xsh "$MOUNT"/* 2>/dev/null | sort -rh | head -3 | awk '{printf "%s %s; ", $2, $1}')"
    [ -z "$sw_pct" ] && runbook="${runbook}No steward manages this mount: free space by hand (#6223)."
  fi
  runbook="${sw# }${sw:+ }$runbook"
  # What grew. On 2026-10-27 the root pages said "run disk-steward", which could not help: the 27 GB were agy's
  # orphaned .tmp files, not idle folders. Name the three directories (three levels deep) with the most bytes in
  # files over 20 MB written in the last 6 h, so the page points at the cause. Bounded; only at high or critical.
  grew=""
  if [ "$level" = high ] || [ "$level" = critical ]; then
    grew=$(timeout 90 find "$MOUNT" -xdev -type f -mmin -360 -size +20M -printf '%s %h\n' 2>/dev/null \
      | awk '{ n = split($2, p, "/"); d = ""; for (i = 2; i <= n && i <= 4; i++) d = d "/" p[i]; s[d] += $1; c[d]++ }
             END { for (d in s) printf "%d %s %d\n", s[d], d, c[d] }' \
      | sort -rn | head -3 | awk '{ printf "%s%s %.1f GB (%d files)", (NR > 1 ? "; " : ""), $2, $1 / 1073741824, $3 }')
    grew=$(printf '%s' "$grew" | with_owners)
    grown=$(printf '%s' "$grown" | with_owners)
    [ -n "$grew" ] && grew=" Written in the last 6 h: ${grew}."
    [ -n "$grown" ] && grew=" Grew ${grown}.${grew}"
  fi
  case "$level" in
    critical) title="$BOX $MOUNT ${used}% full — jobs about to die"; prio=urgent; msg="$what at ${used}% (${free} free). Jobs die silently when it fills.${grew} ${runbook}" ;;
    high)     title="$BOX $MOUNT ${used}% full"; prio=high; msg="$what at ${used}% (${free} free, alarm at ${PCT_LIMIT}%).${grew} ${runbook}" ;;
    unknown)  title="$BOX disk check UNKNOWN ($MOUNT)"; prio=high; msg="df could not read ${MOUNT}. Treat as not-clear until checked (#5534)." ;;
    ok)       title="$BOX $MOUNT disk recovered: ${used}%"; prio=low; msg="$what back under ${PCT_LIMIT}% (${free} free)." ;;
  esac
  [ "$page" = repeat ] && title="STILL: $title"
  if NTFY_SRC=disk-alarm.sh "$(dirname "$0")/ntfy-send.sh" "$TOPIC" "$title" "$prio" floppy_disk "$msg"; then
    echo "$level $epoch" > "$st"; echo "$now paged ($page): $title"
  else
    echo "$now ntfy send FAILED; state left at $prev so the next run retries"
  fi
}

[ -n "${DISK_ALARM_LIB:-}" ] && return 0 2>/dev/null  # tests source the functions
for m in $MOUNTS; do check "$m"; done

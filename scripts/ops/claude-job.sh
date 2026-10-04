#!/usr/bin/env bash
# Run a Claude Code brief HEADLESSLY on this box, in its own git worktree, as its own systemd unit,
# so it survives Derek closing his laptop.
#   claude-job.sh start <name> <brief-file> | resume <name> | status [days] | log <name> [n] | stop <name> | sweep
# PRIOR ART: none in this repo — this is /root/bin/claude-job.sh (md5 dd854ae…, 2026-10-04) moved here
# so it is reviewed by PR and deployed by the hourly pull; /root/bin/claude-job.sh is a symlink to it.
# Each job: worktree /root/sourcelibrary/.claude/worktrees/job-<name> on branch job-<name>
# from origin/main (never the live checkout, which the hourly pull rewrites); the brief
# must use node --env-file=/root/sourcelibrary/.env.production.local for secrets.
# Log: /var/log/sourcelibrary/claude-jobs/<name>.log. Model: opus (Fable is scarce).
# ONE script for both job hosts (unified 2026-10-04; the twins had drifted and the cloudlayer copy
# had no `_run_resume` handler, so `resume` there silently did nothing). Source of truth: THIS file.
# Host differences live in the HOST block below. On cloudlayer (earthai-live, ARM, shared with the
# live Cloud Layer globe) everything runs inside sourcelibrary.slice (MemoryMax 14G, CPUWeight 30)
# so a guest job can never starve the public tick, and /root/sourcelibrary is a symlink to
# /data/scratch/sl/sourcelibrary so briefs written for the main box run unchanged.
#
# Why the resume loop (2026-10-01): `claude -p` ends the moment the model ends its turn;
# jobs that ended on "a watcher will tell me" never finished. Every brief gets HEADLESS
# RULES prepended, and a job that exits without its done file is resumed.
#
# Why shared node_modules + sl-tsc + reap (2026-10-01): 36 job worktrees held ~17 GB, and
# per-job `npm ci` plus full type checks (~3 GB each, several at once) were what the OOM
# killer took 12 times that day. Worktrees now symlink the checkout's node_modules,
# `sl-tsc` (flock) is the only sanctioned type check, and a DONE job with a clean, pushed
# worktree has it removed (reap_if_clean, #5534/#5536). Anything else is kept, reason logged.
#
# Why systemd units, not tmux (2026-10-04, #5709): nobody ever attaches to these sessions, one OOM
# kill could take every tmux session with it, and the supervisor hand-built in bash (heartbeat file,
# sweep cron) is what systemd already does. Each job is the transient service sl-job-<name> in the
# host's slice with its own MemoryMax: going over kills that job, not the box and not its neighbours.
# systemd restarts a job that ended ABNORMALLY (kill signal, OOM) once (StartLimitBurst=2 per day);
# the loop in run() still owns "claude exited without a done file" and the session-limit wait.
# `start` admits a job only under the host's caps (running unit jobs, MemAvailable); otherwise it QUEUES
# it in $JD/queue/<name> and the queue drains FIFO as capacity frees (on every unit exit, and from
# the */10 `sweep` cron). Jobs already running in tmux when this landed are LEGACY: never touched,
# still listed by `status`, still stoppable; nothing new is started in tmux.
#
# Deploy: the hourly pull replaces this file with a NEW inode (git unlinks and rewrites), so a bash
# already running the old copy keeps it; new starts, restarts and ExecStopPost get the new one.
set -u
export HOME="${HOME:-/root}" PATH="$PATH:/root/.local/bin:/usr/local/bin:/usr/sbin:/sbin"  # cron's PATH is /usr/bin:/bin, and units inherit ours
# The tmux era got its PATH from the login shell that started the tmux server. A cron start has none of it,
# so when claude is not found, take the login shell's PATH: the unit must see what the tmux job saw.
command -v claude >/dev/null 2>&1 || PATH="$PATH:$(bash -lc 'printf %s "$PATH"' 2>/dev/null)"
case "$0" in /*) SELF="$0" ;; *) SELF="$PWD/$0" ;; esac  # absolute and NOT resolved: units must follow the /root/bin symlink, so a rollback reaches restarts too
# ---- HOST block ----
if [ -d /data/scratch/sl/sourcelibrary ] && systemctl cat sourcelibrary.slice >/dev/null 2>&1; then
  HOST=cloudlayer; SL=/data/scratch/sl/sourcelibrary; LOGD=/data/scratch/sl/logs/claude-jobs; JD=/data/scratch/sl/claude-jobs
  HOST_RULES="- This host is SHARED with a live public service and capped at 14 GB for all Source Library work.
  node_modules is shared with the main checkout: NEVER run npm ci / npm install. To type-check run
  \`sl-tsc\` (one at a time, box-wide), never a bare \`npx tsc\`.
- The box is ARM64: Python ML tools (kraken, CLIP, onnx venvs) are NOT installed here; if the brief needs
  them, say so on the issue and stop."
  SLICE=sourcelibrary.slice; JOB_MEM=4G; MAX_JOBS=6
else
  HOST=hetzner; SL=/root/sourcelibrary; LOGD=/var/log/sourcelibrary/claude-jobs; JD=/root/claude-jobs
  HOST_RULES="- This box has 16 GB shared by every worker. node_modules is shared with the main checkout: NEVER run
  npm ci / npm install. To type-check run \`sl-tsc\` (one at a time, box-wide), never a bare \`npx tsc\`."
  SLICE=sourcelibrary-jobs.slice; JOB_MEM=3G; MAX_JOBS=4  # slice unit file: scripts/ops/sourcelibrary-jobs.slice (MemoryMax 9G)
fi
WT=$SL/.claude/worktrees
# ---- end HOST block ----
# Knobs. CJ_JD / CJ_LOGD exist so a test never touches the live jobs dir; the rest override a cap for one call.
JD=${CJ_JD:-$JD}; LOGD=${CJ_LOGD:-$LOGD}; QD=$JD/queue
MAX_JOBS=${CJ_MAX_JOBS:-$MAX_JOBS}            # running unit jobs on this box before `start` queues
MIN_MEM_MB=${CJ_MIN_MEM_MB:-3072}             # MemAvailable floor before `start` queues
JOB_MEM=${CJ_JOB_MEM:-$JOB_MEM}               # per-job MemoryMax (swap is off for the unit)
START_BURST=${CJ_START_BURST:-2}              # unit starts per day: 2 = systemd restarts an abnormal end once
MAX_RESUMES=${MAX_RESUMES:-8}
PASS_ENV="HOME PATH LANG USER LOGNAME SHELL CJ_JD CJ_LOGD CJ_MAX_JOBS CJ_MIN_MEM_MB CJ_JOB_MEM CJ_START_BURST MAX_RESUMES NTFY_TOPIC JOB_KEEP_WORKTREE"
mkdir -p "$LOGD" "$JD" "$WT" "$QD"
# The unit IS the cap. (The old cloudlayer wrapper put claude in its own scope, which would move it OUT of the job's unit.)
claude_capped() { claude "$@"; }

rules() { cat <<R
HEADLESS RULES (prepended by claude-job.sh; they override anything below):
- You run as \`claude -p\` with no human and no notifications. Your session ENDS the moment you end a turn.
  Never use run_in_background, Monitor, or "I'll be notified when X finishes" — nothing will ever notify you.
- Long work: run it in the foreground (Bash timeout up to 600000 ms), or detach it with nohup writing to a
  file and then wait in the FOREGROUND with an until-loop on that file (each call <= 10 min, repeat the call).
$HOST_RULES
- Everything this job runs shares ONE memory cap of $JOB_MEM (its systemd unit). Going over kills this job,
  not the box: work in pieces that fit, and never start several heavy processes at once.
- If anything needs Derek's decision (spend above the floor, public copy, a hold-list item), end your FINAL
  message with one line per decision: \`DECISION: <question> — default: <recommended answer> (#issue)\`.
  The wrapper collects these into $JD/decisions.txt and pages Derek; nothing else surfaces them.
- When the brief's definition of done is met (or you hit a STOP condition it names), run:
  touch $JD/$1.done   — and only then end. Exiting without it makes the wrapper resume you.
R
}


# Remove a finished job's worktree so checkouts stop filling the root disk (#5534, #5536 point 2).
# Only when ALL hold, else it is kept and the reason logged: the job wrote its done file; nothing
# uncommitted AND nothing gitignored is left (scratch data such as scratch/ or scripts/output is
# ignored by git, so `status --ignored` is what sees it); HEAD is on a branch whose commits are on
# origin (or it has none beyond origin/main); no live process has a file open inside it.
# `git worktree remove` without --force keeps the branch. Disable: JOB_KEEP_WORKTREE=1.
reap_if_clean() {
  local name="$1" d="$WT/job-$1" log="$LOGD/$1.log" why=""
  [ -n "${JOB_KEEP_WORKTREE:-}" ] && return
  [ -f "$JD/$name.done" ] || return
  cd /root
  local left; left=$(git -C "$d" status --porcelain --ignored 2>/dev/null | grep -vE '(node_modules|src/lib/vendor(/lamejs-bundle\.js|/)?|\.vercel/?)$' | head -3 | tr '
' ' ')
  [ -n "$left" ] && why="uncommitted or ignored files: $left"
  local br; br=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ -z "$why" ] && [ -n "$(git -C "$d" log --oneline origin/main..HEAD 2>/dev/null)" ]; then
    if [ "$br" = "HEAD" ]; then why="detached HEAD with commits"
    elif git -C "$d" fetch -q origin "$br" 2>/dev/null && git -C "$d" merge-base --is-ancestor HEAD FETCH_HEAD; then :
    elif [ "$(gh pr list --repo Embassy-of-the-Free-Mind/sourcelibrary-v2 --head "$br" --state merged --json number --jq length 2>/dev/null)" = "1" ]; then :  # squash-merged, branch deleted
    else why="branch $br not pushed"; fi
  fi
  [ -z "$why" ] && lsof +D "$d" >/dev/null 2>&1 && why="a live process has files open inside"
  if [ -n "$why" ]; then echo "[claude-job] worktree KEPT: $why" >> "$log"; return; fi
  [ -L "$d/node_modules" ] && rm -f "$d/node_modules"  # shared symlink: never let a removal reach through it
  git -C "$SL" worktree remove "$d" >> "$log" 2>&1 && echo "[claude-job] worktree removed (branch $br kept) $(date -u +%FT%TZ)" >> "$log"
}

# Did a DONE job LAND its result? (Derek 2026-10-04: "how do we know we collect them?") The done
# file is the job's own word; the 2026-09-11 per-language study "finished" in a worktree whose
# session died before committing, and its result sat unseen for two weeks. Checks, from outside:
#   1. the brief's first #NNNN issue has a comment created after the job started;
#   2. if the brief mentions a PR, branch job-<name> has one (any state);
#   3. the worktree holds nothing uncommitted (gitignored scratch excluded) and nothing unpushed.
# Prints "ok <pr-url>" or "MISSING: <what>". Never fails the job. Test one: `claude-job.sh _land <name>`.
REPO=Embassy-of-the-Free-Mind/sourcelibrary-v2
landing_check() {
  local name="$1" d="$WT/job-$1" brief="$JD/$1.brief.txt" miss="" pr="" since issue
  since=$(date -u -d "@$(stat -c %Y "$brief")" +%FT%TZ)
  issue=$(grep -oE '#[0-9]{4,5}' "$brief" | head -1 | tr -d '#')
  if [ -n "$issue" ]; then
    local nc; nc=$(gh issue view "$issue" --repo "$REPO" --json comments --jq "[.comments[] | select(.createdAt >= \"$since\")] | length" 2>/dev/null)
    [ "${nc:-0}" -gt 0 ] || miss="$miss no comment on #$issue since start;"
  else miss="$miss brief names no issue;"; fi
  if grep -qE '\bPR\b' "$brief"; then
    pr=$(gh pr list --repo "$REPO" --head "job-$name" --state all --json url --jq '.[0].url' 2>/dev/null)
    [ -n "$pr" ] || miss="$miss no PR from branch job-$name;"
  fi
  if [ -d "$d" ]; then
    [ -n "$(git -C "$d" status --porcelain 2>/dev/null | grep -vE '(node_modules|src/lib/vendor/lamejs-bundle\.js|\.vercel/?)$')" ] && miss="$miss uncommitted files in $d;"
    local br; br=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ -n "$(git -C "$d" log --oneline origin/main..HEAD 2>/dev/null)" ] && ! { git -C "$d" fetch -q origin "$br" 2>/dev/null && git -C "$d" merge-base --is-ancestor HEAD FETCH_HEAD; } && [ -z "$pr" ]; then
      miss="$miss unpushed commits on $br;"; fi
  fi
  if [ -n "$miss" ]; then echo "MISSING:$miss"; else echo "ok ${pr:-no PR expected}"; fi
}

# ntfy page for job outcomes (Derek 2026-10-04: "not getting notifications any more").
# Same topic as the box alerts. Never fails the job: a dead ntfy is not a dead job.
NTFY_TOPIC="${NTFY_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}"
ntfy_job() {  # $1 priority (min|low|default|high|urgent)  $2 tags  $3 title  $4 message
  curl -s -m 10 -H "Title: $3" -H "Priority: $1" -H "Tags: $2" -d "$4" "$NTFY_TOPIC" >/dev/null 2>&1 || true
}

# One claude call. Its exit is logged; a death BY SIGNAL (kill -9, the box's OOM killer) is passed on by
# dying the same way, so systemd records Result=signal and restarts the unit instead of this loop
# quietly spending a resume on it.
cj_claude() {
  claude_capped "$@" --model opus --permission-mode acceptEdits --verbose >> "$log" 2>&1; rc=$?
  echo "[claude-job] exit $rc $(date -u +%FT%TZ)" >> "$log"
  if [ $rc -gt 128 ] && [ ! -f "$JD/$name.done" ]; then
    echo "[claude-job] claude was killed by signal $((rc-128)); ending the unit the same way so systemd records and restarts it $(date -u +%FT%TZ)" >> "$log"
    kill -s KILL $$
  fi
}

run() {  # ExecStart of the unit sl-job-<name>
  name="$1"; mode="${2:-fresh}"; d="$WT/job-$name"; log="$LOGD/$name.log"; cd "$d" || exit 3
  # $name.ran = "this job's unit is in flight". It replaces the heartbeat file: liveness is systemd's
  # to report, and a .ran file with no unit behind it is a job lost to a reboot (sweep re-queues it).
  # Legacy tmux jobs keep writing their own .hb from the copy of the old script they are running;
  # `status` and `sweep` still read it, and that reader goes when the last tmux job has ended.
  [ -f "$JD/$name.ran" ] && mode=restart  # systemd restarted us after an abnormal end
  date -u +%FT%TZ >> "$JD/$name.ran"
  rm -f "${JD:?}/${name:?}.stopped" "${JD:?}/${name:?}.died"
  case "$mode" in
    manual)  # `resume`: re-enter the session, then the same loop
      echo "[claude-job] manual resume $(date -u +%FT%TZ)" >> "$log"
      cj_claude -p --continue "$(rules $name)

Resumed by hand. Re-read your brief ($JD/$name.brief.txt) and the issue thread, establish the current state from data, and continue to done." ;;
    restart)
      echo "[claude-job] unit restart $(date -u +%FT%TZ)" >> "$log"
      cj_claude -p --continue "$(rules $name)

Your job was KILLED (a kill signal, or it went over its $JOB_MEM memory cap; the [claude-job] lines at the end of $LOGD/$name.log say which) and systemd restarted it. Whatever you had running is gone. If it was memory, do NOT repeat the same command: do the work in smaller pieces. Re-read your brief ($JD/$name.brief.txt) and the issue thread, establish the current state from data, and continue to done." ;;
    *) false ;;
  esac
  # fresh start, or a --continue with no session to continue (killed before the first turn was saved)
  if [ "$mode" = fresh ] || { [ ! -f "$JD/$name.done" ] && tail -n 3 "$log" | grep -qi 'no conversation found'; }; then
    cj_claude -p "$(rules $name; echo; cat $JD/$name.brief.txt)"
  fi
  i=0
  while [ ! -f "$JD/$name.done" ] && [ $i -lt $MAX_RESUMES ]; do
    # A usage/session limit is a wait, not a failure (2026-10-03: all 8 resumes burned in 3 min on
    # "You've hit your session limit", then GAVE UP for 7 h). When the last claude output is a
    # limit message, sleep 20 min and retry WITHOUT spending a resume, for up to 18 waits (6 h).
    if grep -v '^\[claude-job\]' "$log" | tail -n 2 | grep -qiE "hit your (session|usage|weekly) limit|usage limit reached|rate limit"; then
      w=$((${w:-0}+1))
      if [ $w -gt 18 ]; then echo "[claude-job] limit wait exhausted (6 h) $(date -u +%FT%TZ)" >> "$log"; break; fi
      [ $w -eq 1 ] && ntfy_job low hourglass "Job waiting on usage limit: $name ($HOST)" "Retries every 20 min for up to 6 h without spending a resume."
      echo "[claude-job] limit wait $w/18 (20 min, resume not counted) $(date -u +%FT%TZ)" >> "$log"; sleep 1200
    else
      i=$((i+1)); sleep 30
    fi
    echo "[claude-job] resume $i/$MAX_RESUMES $(date -u +%FT%TZ) (no $name.done)" >> "$log"
    cj_claude -p --continue "$(rules $name)

You exited before writing $JD/$name.done. Any background task or watcher you started is GONE (detached nohup processes may still run — check with ps and their output files). Re-read your brief ($JD/$name.brief.txt) and the issue thread, establish the current state from data, and continue to done."
  done
  if [ -f "$JD/$name.done" ]; then
    echo "[claude-job] DONE $(date -u +%FT%TZ)" >> "$log"
    land=$(landing_check "$name"); echo "[claude-job] landing: $land" >> "$log"
    if [ "${land%% *}" = ok ]; then
      ntfy_job default white_check_mark "Job done + landed: $name ($HOST)" "$(grep -oE '#[0-9]{4,5}' "$JD/$name.brief.txt" | head -1) — ${land#ok }"
    else
      ntfy_job high warning "Job finished but did NOT land: $name ($HOST)" "${land#MISSING:} — results may be stranded on the box; \`claude-job.sh resume $name\` or look in $WT/job-$name"
    fi
  else
    echo "[claude-job] GAVE UP after $MAX_RESUMES resumes $(date -u +%FT%TZ)" >> "$log"
    ntfy_job high warning "Job GAVE UP: $name ($HOST)" "$(grep -vE '^\[claude-job\]|^\s*$' "$log" | tail -n 1 | cut -c1-200)"
  fi
  collect_decisions "$name"
  rm -f "$JD/$name.hb" "$JD/$name.ran"
  reap_if_clean "$name"
}

# DECISION: lines from the job's output -> one shared file + a page (#5709 follow-up, 2026-10-04).
collect_decisions() {
  local name="$1" log="$LOGD/$1.log" n
  grep -oE 'DECISION: .*' "$log" 2>/dev/null | sed 's/\\n.*//; s/[`"]*$//' | sort -u | while read -r l; do
    grep -qF "$name | $l" "$JD/decisions.txt" 2>/dev/null || echo "$(date -u +%F) | $name | $l" >> "$JD/decisions.txt"
  done
  n=$(grep -c " | $name | DECISION" "$JD/decisions.txt" 2>/dev/null || true)
  [ "${n:-0}" -gt 0 ] && ntfy_job default question "Job $name: $n decision(s) for Derek" "$(grep " | $name | " "$JD/decisions.txt" | cut -d'|' -f3- | head -3 | cut -c1-300)"
  return 0
}

# ---- systemd runner (#5709) ----
unit_get() {  # $1 name → sets U_ActiveState U_SubState U_Result U_ExecMainStatus U_NRestarts U_MainPID
  local k v
  U_ActiveState=inactive; U_SubState=dead; U_Result=success; U_ExecMainStatus=0; U_NRestarts=0; U_MainPID=0
  while IFS='=' read -r k v; do case "$k" in ActiveState|SubState|Result|ExecMainStatus|NRestarts|MainPID) printf -v "U_$k" %s "$v" ;; esac
  done < <(systemctl show "sl-job-$1.service" -p ActiveState,SubState,Result,ExecMainStatus,NRestarts,MainPID 2>/dev/null)
}
unit_live() { unit_get "$1"; case "$U_ActiveState" in active|activating|deactivating|reloading) return 0 ;; esac; return 1; }
job_live() { unit_live "$1" || tmux has-session -t "=job-$1" 2>/dev/null; }
pass_env() { local v; ENVARGS=(); for v in $PASS_ENV; do [ -n "${!v:-}" ] && ENVARGS+=(-E "$v=${!v}"); done; }

# Start job <name> as the unit sl-job-<name>. $2 = fresh | manual. Admission is the CALLER's job (dispatch).
launch() {
  local name="$1" mode="${2:-fresh}" d="$WT/job-$1" log="$LOGD/$1.log" f
  command -v claude >/dev/null 2>&1 || { echo "claude is not on PATH ($PATH)"; return 6; }
  if [ ! -d "$d" ]; then
    git -C "$SL" fetch -q origin main && git -C "$SL" worktree add -q "$d" -b "job-$name" origin/main || return 3
    ln -s "$SL/node_modules" "$d/node_modules"
  fi
  mkdir -p "$d/src/lib/vendor"; cp "$SL/src/lib/vendor/lamejs-bundle.js" "$d/src/lib/vendor/" 2>/dev/null || true
  [ "$mode" = fresh ] && touch "$JD/$name.brief.txt"  # landing_check dates "since the job started" from this file, and a queued job starts NOW
  for f in done ran died hb; do rm -f "${JD:?}/${name:?}.$f"; done
  systemctl cat "$SLICE" >/dev/null 2>&1 || echo "[claude-job] WARNING: $SLICE has no unit file on this box, so the jobs have no TOTAL cap (the per-job $JOB_MEM still holds). Install scripts/ops/sourcelibrary-jobs.slice." >> "$log"
  systemctl reset-failed "sl-job-$name.service" 2>/dev/null
  pass_env
  # The "-" on WorkingDirectory and ExecStopPost: a DONE job's worktree is reaped before ExecStopPost
  # runs, and without them a finished job's unit ends "failed" (status=200/CHDIR). run() checks the cd itself.
  systemd-run --quiet --unit="sl-job-$name" --slice="$SLICE" --description="claude-job $name" \
    -p MemoryMax="$JOB_MEM" -p MemorySwapMax=0 -p WorkingDirectory="-$d" \
    --property=StandardOutput="append:$log" --property=StandardError="append:$log" \
    -p Restart=on-abnormal -p RestartSec=30 -p StartLimitIntervalSec=86400 -p StartLimitBurst="$START_BURST" \
    -p TimeoutStopSec=30 -p ExecStopPost="-$SELF _post $name" \
    "${ENVARGS[@]}" "$SELF" _run "$name" "$mode"
}

# ExecStopPost of a job unit; systemd sets SERVICE_RESULT / EXIT_CODE / EXIT_STATUS. Writes WHY the unit
# ended into the job's log, and when systemd will not restart it, into $name.died (the failed unit
# itself is gone after a reboot) and to Derek's phone. Then lets the queue move.
post() {
  local name="$1" log="$LOGD/$1.log" r="${SERVICE_RESULT:-unknown}" final=1
  if [ "$r" != success ]; then
    unit_get "$name"
    case "$r" in signal|core-dump|oom-kill|timeout|watchdog) [ $((U_NRestarts + 1)) -lt "$START_BURST" ] && final=0 ;; esac
    echo "[claude-job] unit sl-job-$name ended: result=$r (${EXIT_CODE:-?}/${EXIT_STATUS:-?}) restarts=$U_NRestarts — $([ $final = 1 ] && echo 'systemd will NOT restart it' || echo 'systemd restarts it in 30 s') $(date -u +%FT%TZ)" >> "$log"
    [ "$r" = oom-kill ] && dmesg -T 2>/dev/null | grep -i 'killed process' | tail -1 >> "$log"
    [ $final = 0 ] && return 0  # still this job's slot: nothing for the queue
    if [ ! -f "$JD/$name.done" ] && [ ! -f "$JD/$name.stopped" ]; then
      echo "$r" > "$JD/$name.died"
      ntfy_job high skull "Job DIED$([ "$r" = oom-kill ] && echo ' (OOM)'): $name ($HOST)" "result=$r after $U_NRestarts restart(s)$([ "$r" = oom-kill ] && echo "; it went over its $JOB_MEM cap"). \`claude-job.sh resume $name\` by hand."
      collect_decisions "$name"
    fi
  elif [ -f "$JD/$name.ran" ] && [ ! -f "$JD/$name.done" ]; then
    # A clean end with the run loop unfinished: someone ran `systemctl stop` on the unit. That is a
    # STOP, and without this marker the sweep would read the leftover .ran as a lost job and re-queue it.
    echo "[claude-job] unit sl-job-$name was stopped from outside the run loop $(date -u +%FT%TZ)" >> "$log"
    touch "$JD/$name.stopped"; rm -f "${JD:?}/${name:?}.ran"
  fi
  kick 5
}

# ---- admission + queue (#5709) ----
# $QD/<name> holds the start mode (fresh | manual); its mtime is its place in the line.
queued() { find "$QD" -maxdepth 1 -type f ! -name '.*' -printf '%T@ %f\n' 2>/dev/null | sort -n | cut -d' ' -f2-; }
# Unit jobs only. Legacy tmux jobs are not counted (they have no cap to count against, and they are
# gone within days); while they run, the MemAvailable floor is what keeps a new job off a full box.
running_jobs() {
  systemctl list-units 'sl-job-*.service' --no-legend --plain --state=active,activating,deactivating,reloading 2>/dev/null | awk '{print $1}' | sed 's/^sl-job-//; s/\.service$//'
}
caps_reason() {  # why the box cannot take another job right now; empty = it can
  local n mem r=""
  n=$(running_jobs | grep -c . || true)
  [ "$n" -ge "$MAX_JOBS" ] && r="$n unit jobs running (cap $MAX_JOBS)"
  mem=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
  [ "$mem" -lt "$MIN_MEM_MB" ] && r="${r:+$r; }MemAvailable $mem MB (floor $MIN_MEM_MB MB)"
  echo "$r"
}
# Run `_dispatch` in $1 seconds, outside the caller's unit (an ExecStopPost has 30 s and a dying cgroup).
kick() { pass_env; systemd-run --quiet --collect --on-active="$1" --unit="sl-jobq-kick-$(date +%s%N)" --slice="$SLICE" "${ENVARGS[@]}" "$SELF" _dispatch >/dev/null 2>&1 || true; }
# Start the OLDEST queued job if the box is under its caps. One job per pass, so what it does to
# memory is visible before the next is admitted; a pass that started one schedules the next.
dispatch() { ( flock -w "${1:-0}" 9 || exit 0; _dispatch ) 9>"$QD/.lock"; }
_dispatch() {
  local name mode out rc
  name=$(queued | head -1); [ -n "$name" ] || return 0
  [ -z "$(caps_reason)" ] || return 0
  mode=$(cat "$QD/$name"); rm -f "${QD:?}/${name:?}"
  if job_live "$name"; then echo "[claude-job] queue entry dropped: job is already running $(date -u +%FT%TZ)" >> "$LOGD/$name.log"; return 0; fi
  out=$(launch "$name" "${mode:-fresh}" 2>&1 9>&-); rc=$?
  if [ $rc -eq 0 ]; then echo "[claude-job] started: unit sl-job-$name in $SLICE, MemoryMax $JOB_MEM, mode ${mode:-fresh} $(date -u +%FT%TZ)" >> "$LOGD/$name.log"
  else
    echo "[claude-job] could NOT start (rc=$rc): $out $(date -u +%FT%TZ)" >> "$LOGD/$name.log"
    ntfy_job high warning "Job could not start: $name ($HOST)" "rc=$rc: $(echo "$out" | tail -1 | cut -c1-200)"
  fi
  [ -n "$(queued)" ] && kick 60
  return 0
}
enqueue() {  # $1 name  $2 mode. A job already in line keeps its place.
  [ -f "$QD/$1" ] || echo "$2" > "$QD/$1"
}
# Before a start or resume: the job's old outcome markers go, so `status` reads the new run.
clear_outcome() { local f; for f in done stopped died; do rm -f "${JD:?}/${1:?}.$f"; done; }
# After enqueue + dispatch: say whether the job is running or waiting. Exit 0 either way unless it died at launch.
report_start() {
  local name="$1" verb="$2" pos reason
  if [ -f "$QD/$name" ]; then
    pos=$(queued | grep -nxF "$name" | cut -d: -f1); reason=$(caps_reason)
    [ "${pos:-1}" -gt 1 ] && reason="$((pos-1)) job(s) ahead${reason:+; $reason}"
    echo "[claude-job] QUEUED at position ${pos:-1}: ${reason:-the queue starts one job per pass} $(date -u +%FT%TZ)" >> "$LOGD/$name.log"
    echo "QUEUED job-$name (position ${pos:-1}): ${reason:-the queue starts one job per pass}. It starts by itself when capacity frees; \`$0 status\` shows it."
    return 0
  fi
  sleep 20  # a job that dies at launch must say so here, not look blank in `status` (#5709)
  if unit_live "$name" || [ -f "$JD/$name.done" ]; then echo "$verb job-$name (unit sl-job-$name, MemoryMax $JOB_MEM in $SLICE) → $LOGD/$name.log"
  else echo "job-$name DIED within 20 s:"; tail -5 "$LOGD/$name.log"; return 4; fi
}

# One line per job: LIVE / QUEUED / STOPPED / DONE / GAVE-UP / DIED / NOSTART / ENDED?. For a unit
# job the state is systemd's (ActiveState, Result, NRestarts); for a legacy tmux job it is the tmux
# session plus the heartbeat file. For LIVE, the deepest child process says what it is waiting on.
leaf_of() {
  ps -eo pid=,ppid=,args= | awk -v root="$1" '{p[$1]=$2; a[$1]=substr($0, index($0,$3))} END{best=""; bd=-1; for(k in p){d=0;x=k; while(x in p && x!=root && d<40){x=p[x];d++} if(x==root && d>bd && a[k] !~ /^(sleep|tail|tmux)/){bd=d;best=a[k]}} print best}' | cut -c1-110
}
job_state() {
  local name="$1" log="$LOGD/$1.log" hbage="-" now res; now=$(date +%s)
  [ -f "$JD/$name.hb" ] && hbage=$(( (now - $(cat "$JD/$name.hb" 2>/dev/null || echo $now)) / 60 ))m
  # (a unit whose LAST allowed start has failed sits in auto-restart for 30 s before systemd refuses it: that is DIED, and post() has already written .died)
  if unit_live "$name" && ! { [ "$U_SubState" = auto-restart ] && [ -f "$JD/$name.died" ]; }; then
    if [ "$U_SubState" = auto-restart ]; then echo "LIVE    $name  unit restarts=$U_NRestarts  :: ended with result=$U_Result, systemd is restarting it"
    else echo "LIVE    $name  unit restarts=$U_NRestarts  :: $(leaf_of "$U_MainPID")"; fi
  elif tmux has-session -t "=job-$name" 2>/dev/null; then
    local pid; pid=$(tmux list-panes -t "=job-$name" -F '#{pane_pid}' 2>/dev/null | head -1)
    echo "LIVE    $name  tmux hb=$hbage  :: $(leaf_of "$pid")"
  elif [ -f "$QD/$name" ]; then echo "QUEUED  $name  #$(queued | grep -nxF "$name" | cut -d: -f1) since $(date -u -r "$QD/$name" +%FT%TZ)  :: $(caps_reason)"
  elif [ -f "$JD/$name.stopped" ]; then echo "STOPPED $name"
  elif [ -f "$JD/$name.done" ]; then echo "DONE    $name  $(grep -oE '\[claude-job\] DONE [0-9T:-]+' "$log" 2>/dev/null | tail -1 | cut -c19-)"
  elif [ "$U_ActiveState" = failed ] || [ -f "$JD/$name.died" ]; then
    res=$(cat "$JD/$name.died" 2>/dev/null); res=${res:-$U_Result}
    if [ "$res" = oom-kill ]; then echo "DIED (OOM) $name  restarts=$U_NRestarts  :: went over its memory cap (MemoryMax); \`$0 resume $name\` by hand, with smaller pieces"
    else echo "DIED    $name  result=$res status=$U_ExecMainStatus restarts=$U_NRestarts  :: systemd gave up restarting it; \`$0 log $name\`, then \`$0 resume $name\`"; fi
  elif grep -q 'GAVE UP\|limit wait exhausted' "$log" 2>/dev/null; then echo "GAVE-UP $name  :: $(grep -vE '^\[claude-job\]|^\s*$' "$log" | tail -1 | cut -c1-110)"
  elif [ -f "$JD/$name.ran" ]; then echo "DIED    $name  :: its unit is gone with no result (reboot?); \`$0 sweep\` re-queues it (max 2)"
  elif [ -f "$JD/$name.hb" ]; then echo "DIED    $name  hb=$hbage  :: no tmux, no done file — check dmesg/df; \`$0 sweep\` re-queues it (max 2)"
  elif [ ! -s "$log" ]; then echo "NOSTART $name  :: brief only, empty log (never started, or died before the heartbeat existed)"
  else echo "ENDED?  $name  :: no done file, no terminal line (pre-heartbeat job) :: $(grep -vE '^\[claude-job\]|^\s*$' "$log" | tail -1 | cut -c1-90)"
  fi
}
valid_name() { case "$1" in ""|*[!A-Za-z0-9_.-]*) echo "bad job name '$1' (letters, digits, . _ - only)"; exit 2 ;; esac; }
# sweep: put a lost job back in line, at most twice (counted in its log). $1 name  $2 what was found
requeue_lost() {
  local n="$1" k
  k=$(grep -c '\[claude-job\] sweep-resume' "$LOGD/$n.log" 2>/dev/null || true)
  if [ "${k:-0}" -ge 2 ]; then
    echo "[claude-job] sweep gave up after 2 resumes $(date -u +%FT%TZ)" >> "$LOGD/$n.log"; rm -f "${JD:?}/${n:?}.hb" "${JD:?}/${n:?}.ran"; echo lost > "$JD/$n.died"
    ntfy_job high warning "Job DIED twice, not resumed: $n" "Check dmesg/df on the box; \`claude-job.sh resume $n\` by hand."; return; fi
  echo "[claude-job] sweep-resume $((k+1))/2: $2 $(date -u +%FT%TZ)" >> "$LOGD/$n.log"
  dmesg -T 2>/dev/null | grep -i 'killed process' | tail -1 >> "$LOGD/$n.log"
  enqueue "$n" manual
}

case "${1:-status}" in
  start)
    name="${2:-}"; brief="${3:-}"; valid_name "$name"; [ -f "$brief" ] || { echo "no brief file $brief"; exit 2; }
    job_live "$name" && { echo "job-$name is already running (\`$0 stop $name\` first)"; exit 5; }
    [ "$(realpath "$brief")" = "$JD/$name.brief.txt" ] || cp "$brief" "$JD/$name.brief.txt"
    clear_outcome "$name"; enqueue "$name" fresh; dispatch 60
    report_start "$name" started ;;
  resume)
    name="${2:-}"; valid_name "$name"
    job_live "$name" && { echo "job-$name is already running"; exit 5; }
    clear_outcome "$name"; enqueue "$name" manual; dispatch 60
    report_start "$name" resuming ;;
  _run) run "$2" "${3:-fresh}"; exit 0 ;;
  _run_resume|_resume) run "$2" manual; exit 0 ;;  # names the tmux era used; kept so an old command line still works
  _post) post "$2"; exit 0 ;;
  _dispatch) dispatch 30 ;;
  status)  # jobs started in the last ${2:-3} days, plus anything live or queued; `status 30` looks further back
    [ "$HOST" = cloudlayer ] && systemctl show sourcelibrary.slice -p MemoryCurrent | sed 's/MemoryCurrent=/slice memory bytes: /'
    { tmux ls -F '#{session_name}' 2>/dev/null | sed -n 's/^job-//p'
      systemctl list-units 'sl-job-*.service' --all --no-legend --plain 2>/dev/null | awk '{print $1}' | sed 's/^sl-job-//; s/\.service$//'
      queued
      find "$JD" -maxdepth 1 -name '*.brief.txt' -mtime -"${2:-3}" -printf '%f\n' | sed 's/\.brief\.txt$//'; } | sort -u |
      while read -r n; do job_state "$n"; done | sort > "/tmp/cj-status.$$"
    # DONE jobs older than a day are counted, not listed: the list is for what needs eyes.
    since=$(date -u -d '1 day ago' +%FT%T)
    awk -v since="$since" '$1!="DONE" || $3>=since' "/tmp/cj-status.$$"
    echo "-- $(awk -v since="$since" '$1=="DONE" && $3<since' "/tmp/cj-status.$$" | wc -l) older DONE jobs not listed (see \`ls -t $JD/*.done\`)"
    rm -f "/tmp/cj-status.$$"
    reason=$(caps_reason)
    echo "-- capacity ($HOST): $(running_jobs | grep -c . || true)/$MAX_JOBS unit jobs running, MemAvailable $(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo) MB (floor $MIN_MEM_MB), $(queued | grep -c . || true) queued, per-job MemoryMax $JOB_MEM in $SLICE — ${reason:-a new start runs at once}"
    [ -s "$JD/decisions.txt" ] && { echo "-- decisions for Derek (last 5; all in $JD/decisions.txt):"; tail -5 "$JD/decisions.txt" | cut -c1-200; }; true ;;
  sweep)  # cron */10: move the queue, and put LOST jobs back in line (at most twice each)
    exec 8>"$JD/.sweep.lock"; flock -n 8 || exit 0
    # Legacy tmux jobs: a heartbeat file with no tmux session behind it. Goes when the last tmux job has ended.
    for hb in "$JD"/*.hb; do [ -f "$hb" ] || continue; n=$(basename "$hb" .hb)
      job_live "$n" && continue; [ -f "$QD/$n" ] && continue
      [ -f "$JD/$n.done" ] || [ -f "$JD/$n.stopped" ] && { rm -f "$hb"; continue; }
      requeue_lost "$n" "no tmux, no done file, heartbeat $(( ($(date +%s)-$(cat "$hb"))/60 ))m old"
    done
    # Unit jobs: systemd restarts and reports their deaths itself. What it cannot report is a unit that
    # no longer exists (reboot): a .ran file with no unit, no done file and no recorded death.
    for ran in "$JD"/*.ran; do [ -f "$ran" ] || continue; n=$(basename "$ran" .ran)
      job_live "$n" && continue; [ "$U_ActiveState" = failed ] && continue; [ -f "$QD/$n" ] && continue
      [ -f "$JD/$n.done" ] || [ -f "$JD/$n.stopped" ] && { rm -f "$ran"; continue; }
      [ -f "$JD/$n.died" ] && continue
      requeue_lost "$n" "unit sl-job-$n is gone with no result and no done file (reboot?)"
    done
    dispatch 0 8>&- ;;
  log)  # the log file; the journal has systemd's own lines about the unit (start, OOM, restart)
    if [ -s "$LOGD/$2.log" ]; then tail -n "${3:-40}" "$LOGD/$2.log"; else journalctl -u "sl-job-$2" -n "${3:-40}" --no-pager; fi ;;
  stop)
    name="${2:-}"; valid_name "$name"; touch "$JD/$name.stopped"
    [ -f "$QD/$name" ] && { rm -f "${QD:?}/${name:?}"; echo "dequeued job-$name"; }
    if unit_live "$name"; then systemctl stop "sl-job-$name.service" && echo "stopped job-$name (unit)"; fi
    systemctl reset-failed "sl-job-$name.service" 2>/dev/null; rm -f "${JD:?}/${name:?}.ran"
    tmux kill-session -t "=job-$name" 2>/dev/null && echo "stopped job-$name (tmux)"  # legacy job
    exit 0 ;;
  _reap) reap_if_clean "$2"; tail -1 "$LOGD/$2.log" ;;  # test/one-off: apply the reap rule to one job
  _land) landing_check "$2" ;;  # test/one-off: would this job count as landed?
  *) echo "usage: $0 start <name> <brief-file> | resume <name> | status [days] | log <name> [n] | stop <name> | sweep"; exit 2 ;;
esac

#!/usr/bin/env bash
# Run a Claude Code brief HEADLESSLY on this box, in its own git worktree, inside tmux,
# so it survives Derek closing his laptop.
#   claude-job.sh start <name> <brief-file> | resume <name> | status [days] | log <name> | stop <name> | sweep
#                 where (this box's load, memory, disk, live jobs: one line) | backtest (old vs new landing verdicts)
# Each job: worktree $WT/job-<name> on branch job-<name> (main box: on the volume since #6223; older
# jobs keep /root/sourcelibrary/.claude/worktrees/job-<name>), output dir $JOB_SCRATCH = $DATA/<name>,
# from origin/main (never the live checkout, which the hourly pull rewrites); the brief
# must use node --env-file=/root/sourcelibrary/.env.production.local for secrets.
# Log: /var/log/sourcelibrary/claude-jobs/<name>.log. Model: opus (Fable is scarce).
# ONE script for every job host. Source of truth: scripts/workers/claude-job.sh in the repo (#6358).
# Never edit /root/bin/claude-job.sh on a box: scripts/workers/install-claude-job.sh copies this file
# there after each pull (new file, then mv; live jobs are executing the old one). Twice the hand-copied
# twins drifted: on 2026-10-04 the cloudlayer copy had no `_run_resume`, so `resume` silently did nothing;
# on 2026-10-09 main had a pushed-commit fix cloudlayer lacked. How to place a job: scripts/workers/JOB-HOSTS.md.
# Host differences live in the HOST block below. On the guest hosts (cloudlayer = earthai-live, shared with
# the live Cloud Layer globe; l7a = earthai-l7a, shared with the 0.6 km archive tick; both ARM) everything
# runs inside sourcelibrary.slice (MemoryMax 14G, CPUWeight 30) so a guest job can never starve the public
# tick, and /root/sourcelibrary is a symlink to /data/scratch/sl/sourcelibrary so briefs written for the
# main box run unchanged.
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
set -u
# Jobs started from cron (the spare lane) get cron's bare PATH, so `sl-tsc` in /root/bin was
# "not installed" to them and two l7a jobs on 2026-10-11 skipped the type check (#6360).
case ":$PATH:" in *:/root/bin:*) ;; *) export PATH="/root/bin:$PATH" ;; esac
# ---- HOST block ----
if [ -d /data/scratch/sl/sourcelibrary ] && systemctl cat sourcelibrary.slice >/dev/null 2>&1; then
  HOST=cloudlayer; SL=/data/scratch/sl/sourcelibrary; LOGD=/data/scratch/sl/logs/claude-jobs; JD=/data/scratch/sl/claude-jobs
  [ "$(hostname)" = earthai-l7a ] && HOST=l7a
  HOST_RULES="- This host is SHARED with a live public service and capped at 14 GB for all Source Library work.
  node_modules is shared with the main checkout: NEVER run npm ci / npm install. To type-check run
  \`sl-tsc\` (one at a time, box-wide), never a bare \`npx tsc\`.
- The box is ARM64: Python ML tools (kraken, CLIP, onnx venvs) are NOT installed here; if the brief needs
  them, say so on the issue and stop."
  claude_capped() { systemd-run --quiet --scope --slice=sourcelibrary.slice -- /root/.local/bin/claude "$@"; }
  WT=$SL/.claude/worktrees; DATA=/data/scratch/sl/jobs
else
  HOST=hetzner; SL=/root/sourcelibrary; LOGD=/var/log/sourcelibrary/claude-jobs; JD=/root/claude-jobs
  HOST_RULES="- This box has 16 GB shared by every worker. node_modules is shared with the main checkout: NEVER run
  npm ci / npm install. To type-check run \`sl-tsc\` (one at a time, box-wide), never a bare \`npx tsc\`."
  claude_capped() { claude "$@"; }
  # Disk (#6223): the 150 GB root filled to 100% on 10-01 and again on 10-07 (job worktrees + experiment
  # output in /root) while the 492 GB volume sat half empty. New worktrees and all job output go to the volume.
  VOL=/mnt/HC_Volume_105839809; WT=$VOL/worktrees; DATA=$VOL/jobs
fi
WT_OLD=$SL/.claude/worktrees  # worktrees made before #6223 stay where they are
MIN_ROOT_FREE_GB=${MIN_ROOT_FREE_GB:-10}
# ---- end HOST block ----
MAX_RESUMES=${MAX_RESUMES:-8}
mkdir -p "$LOGD" "$JD" "$WT" "$DATA"
wt_dir() { if [ -d "$WT_OLD/job-$1" ]; then echo "$WT_OLD/job-$1"; else echo "$WT/job-$1"; fi; }
root_free_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }

rules() { cat <<R
HEADLESS RULES (prepended by claude-job.sh; they override anything below):
- You run as \`claude -p\` with no human and no notifications. Your session ENDS the moment you end a turn.
  Never use run_in_background, Monitor, or "I'll be notified when X finishes" — nothing will ever notify you.
- Long work: run it in the foreground (Bash timeout up to 600000 ms), or detach it with nohup writing to a
  file and then wait in the FOREGROUND with an until-loop on that file (each call <= 10 min, repeat the call).
$HOST_RULES
- DISK: write every large or bulky output (reports, jsonl, images, model files, downloads) under
  \$JOB_SCRATCH ($DATA/$1), never in /root or the repo checkout. \$TMPDIR points there too. Gzip big reports.
  The root disk is small and shared; when it fills, every job on the box dies without a word (#6223).
- Vercel previews are opt-in (#5976, #6000): only main and preview/** branches deploy. If a human must look at
  a page, push ONCE at the end: git push origin HEAD:preview/<job-name>, and post that preview URL. Otherwise check
  locally (route harness, next dev --webpack). Never push preview/ on every commit; it holds the one build slot.
- Before you write the done file, \`git status --porcelain\` in your worktree must be empty: commit and push what
  is worth keeping, move scratch to \$JOB_SCRATCH, delete the rest. Anything left uncommitted or unpushed pages
  Derek at high priority as work at risk (#6358).
- DECIDE, don't ask, unless it is a one-way door. Raise a DECISION only for: paid spend above the \$10
  floor, public copy Derek has not seen, deleting or migrating data, auth/security, money, or anything
  irreversible. Everything else (a \$0.15 arm, copying a fix to another box, resuming after a reset,
  rejecting a model, which of two equivalent methods) you decide: take the default, do it, and log it in
  your FINAL message as \`TAKEN: <what you decided> — why: <one line> (#issue)\`. (#6360: 176 DECISION
  lines in six days, half of them this kind.)
- A real decision: end your FINAL message with one line each:
  \`DECISION: <question> — default: <recommended answer> (#issue)\`. The wrapper collects them into
  $JD/decisions.txt for the morning digest; they do not page.
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
  local name="$1" d="$(wt_dir "$1")" log="$LOGD/$1.log" why=""
  [ -n "${JOB_KEEP_WORKTREE:-}" ] && return
  [ -f "$JD/$name.done" ] || return
  cd /root
  local left; left=$(git -C "$d" status --porcelain --ignored 2>/dev/null | grep -vE '(node_modules/?|src/lib/vendor(/lamejs-bundle\.js|/)?|\.vercel/?|tsconfig\.tsbuildinfo|next-env\.d\.ts|\.next/)$' | head -3 | tr '
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
# session died before committing, and its result sat unseen for two weeks.
#
# The landing contract (#6358). A brief declares it in two header lines (first 15 lines of the brief):
#   Lands: #NNNN      the issue the job reports on (`Lands: none` = no comment is expected)
#   PR: yes|no        whether a pull request is expected
# Without them the wrapper guesses: the issue is the number the job NAME ends in, else the first #NNNN
# in the brief; a PR is expected only if the worktree holds commits beyond main. Why headers: by
# 2026-10-09, 58 of 113 finished jobs on the main box had paged "did NOT land" at high priority. The
# first #NNNN in a brief is often a cross-reference (second-reader-pilot-6338 was checked against #6345),
# and a PR was demanded of any brief containing the word "PR", including "no PR is expected".
#
# Two severities, because they are two different questions:
#   AT-RISK  work exists only on this box: uncommitted files, or commits on no remote. Pages high.
#   REPORT   the comment or the PR was not found. Usually a wrong guess. Low, plus the morning digest.
# Prints "ok <pr-url> [contract]", "AT-RISK: <what> [contract]" or "REPORT: <what> [contract]".
# Never fails the job. Test one: `claude-job.sh _land <name>`; all of them: `claude-job.sh backtest`.
REPO=Embassy-of-the-Free-Mind/sourcelibrary-v2
brief_header() {  # $1 key, $2 brief file -> the value of the first "Key: value" header line
  head -15 "$2" 2>/dev/null | grep -m1 -iE "^[[:space:]]*$1:[[:space:]]" | sed -E 's/^[^:]*:[[:space:]]*//; s/[[:space:]]+$//'
}
landing_contract() {  # $1 name, $2 brief file -> sets LC_ISSUE (number | none | ""), LC_ISSUE_SRC, LC_PR (yes | no | auto)
  local v; LC_ISSUE=""; LC_ISSUE_SRC=""; LC_PR=auto
  v=$(brief_header Lands "$2")
  if echo "$v" | grep -qiE '^(none|no|n/a|-)([^a-z]|$)'; then LC_ISSUE=none; LC_ISSUE_SRC="Lands header"
  elif echo "$v" | grep -qE '[0-9]{3,5}'; then LC_ISSUE=$(echo "$v" | grep -oE '[0-9]{3,5}' | head -1); LC_ISSUE_SRC="Lands header"
  else
    LC_ISSUE=$(echo "$1" | grep -oE '(^|-)[0-9]{4,5}[a-z]?(-|$)' | tail -1 | tr -dc '0-9')
    if [ -n "$LC_ISSUE" ]; then LC_ISSUE_SRC="job name"
    else LC_ISSUE=$(grep -oE '#[0-9]{4,5}' "$2" 2>/dev/null | head -1 | tr -d '#'); [ -n "$LC_ISSUE" ] && LC_ISSUE_SRC="first number in brief"; fi
  fi
  v=$(brief_header PR "$2" | tr 'A-Z' 'a-z')
  case "$v" in yes*) LC_PR=yes ;; no*) LC_PR=no ;; esac
}
pr_of() {  # $1 head branch -> "<url> <head sha>" of its newest PR in any state, or nothing
  gh pr list --repo "$REPO" --head "$1" --state all --json url,headRefOid --jq '.[0] // empty | "\(.url) \(.headRefOid)"' 2>/dev/null
}
# Uncommitted files whose content is on no remote. A job sometimes builds in its worktree and lands the
# same files from another branch or clone: embed-integrity-6175b paged for seven uncommitted files, each
# byte-identical to what PR #6273 had merged. A file is landed when its blob equals origin/main's at that
# path, or appears in any commit pushed to origin since the job started. Anything else (and a deletion)
# is listed. Reads at most 500 paths.
dirty_not_landed() {  # $1 worktree, $2 job start (ISO) -> one path per line
  local d="$1" seen l f h; seen=$(mktemp)
  git -C "$d" log --remotes=origin --since="$2" --raw --no-abbrev --no-renames --format= 2>/dev/null | awk '$4 ~ /^[0-9a-f]+$/ {print $4}' | sort -u > "$seen"
  git -C "$d" status --porcelain -uall 2>/dev/null | grep -vE '(node_modules|src/lib/vendor/lamejs-bundle\.js|\.vercel/.*)$' | head -500 | while IFS= read -r l; do
    f=${l:3}; f=${f##* -> }
    if [ -f "$d/$f" ]; then
      h=$(cd "$d" && git hash-object -- "$f" 2>/dev/null)
      [ -n "$h" ] && [ "$h" = "$(git -C "$d" rev-parse -q --verify "origin/main:$f" 2>/dev/null)" ] && continue
      [ -n "$h" ] && grep -qx "$h" "$seen" && continue
    fi
    echo "$f"
  done
  rm -f "$seen"
}
landing_check() {
  local name="$1" d="$(wt_dir "$1")" brief="$JD/$1.brief.txt" risk="" rep="" since br="" ahead=0 nc p1="" p2="" pr="" dirty unp h
  [ -f "$brief" ] || { echo "REPORT: no brief file $brief"; return; }
  since=$(date -u -d "@$(stat -c %Y "$brief")" +%FT%TZ)
  landing_contract "$name" "$brief"
  if [ -d "$d" ]; then
    git -C "$d" fetch -q origin 2>/dev/null
    br=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)
    ahead=$(git -C "$d" rev-list --count origin/main..HEAD 2>/dev/null)
  fi
  # 1. The report: a comment on the contract's issue, made after the job started.
  if [ "$LC_ISSUE" = none ]; then :
  elif [ -n "$LC_ISSUE" ]; then
    if nc=$(gh issue view "$LC_ISSUE" --repo "$REPO" --json comments --jq "[.comments[] | select(.createdAt >= \"$since\")] | length" 2>/dev/null); then
      [ "${nc:-0}" -gt 0 ] || rep="$rep no comment on #$LC_ISSUE since start;"
    else rep="$rep could not read #$LC_ISSUE (gh failed);"; fi
  else rep="$rep brief names no issue (add a 'Lands: #NNNN' line);"; fi
  # 2. The PR. Jobs often open it from another branch (fix/…-5517, eval/…-6141), so look under the
  # job branch, the branch the worktree is on, and any PR naming the issue opened since the brief
  # (without that, 21 of 78 pages on 2026-10-07 were false, #6181).
  p1=$(pr_of "job-$name")
  [ -n "$br" ] && [ "$br" != HEAD ] && [ "$br" != main ] && [ "$br" != "job-$name" ] && p2=$(pr_of "$br")
  pr=${p2%% *}; [ -n "$pr" ] || pr=${p1%% *}
  [ -z "$pr" ] && [ -n "$LC_ISSUE" ] && [ "$LC_ISSUE" != none ] && pr=$(gh pr list --repo "$REPO" --state all --search "$LC_ISSUE created:>=${since%T*}" --json url,headRefName,title,body,createdAt \
      --jq "[.[] | select(.createdAt >= \"$since\") | select((.headRefName + \" \" + .title + \" \" + .body) | test(\"(^|[^0-9])$LC_ISSUE([^0-9]|\$)\"))][0].url // empty" 2>/dev/null)
  if [ -z "$pr" ]; then
    if [ "$LC_PR" = yes ]; then rep="$rep no PR (brief says PR: yes);"
    elif [ "$LC_PR" = auto ] && [ "${ahead:-0}" -gt 0 ]; then rep="$rep $ahead commit(s) beyond main but no PR;"; fi
  fi
  # 3. Work at risk: it exists only in this worktree. A commit counts as pushed when some remote branch
  # holds it (jobs push under other names: eleven false "unpushed" on 2026-10-07), or when it is the head
  # of a PR (a squash-merged PR's branch is deleted, and its commits are then on no branch at all).
  if [ -d "$d" ]; then
    dirty=$(dirty_not_landed "$d" "$since")
    [ -n "$dirty" ] && risk="$risk $(echo "$dirty" | wc -l) uncommitted file(s) in $d ($(echo "$dirty" | head -3 | tr '\n' ' ' | sed 's/ $//'));"
    unp=$(git -C "$d" rev-list --count HEAD --not --remotes=origin 2>/dev/null); h=$(git -C "$d" rev-parse HEAD 2>/dev/null)
    if [ "${unp:-0}" -gt 0 ]; then
      case " $p1 $p2 " in *" $h "*) ;; *) risk="$risk $unp unpushed commit(s) on $br;" ;; esac
    fi
  fi
  local c="[#${LC_ISSUE:-?} from ${LC_ISSUE_SRC:-nothing}; PR: $LC_PR]"
  if [ -n "$risk" ]; then echo "AT-RISK:$risk${rep:+ also:$rep} $c"
  elif [ -n "$rep" ]; then echo "REPORT:$rep $c"
  else echo "ok ${pr:-no PR expected} $c"; fi
}

# Checkpoint on every exit that is not DONE (#6360 fix 1): GAVE UP, a weekly cap, stopped, died twice.
# On 2026-10-09 cli38-xl-6331 and judge-fable-6182b ended on a limit with scores and scripts uncommitted;
# they were saved by hand. Commits whatever the worktree holds (git's ignore rules apply; the shared
# node_modules link, the vendored bundle, .vercel and files over 5 MB are left out) and pushes it to the
# job's branch, or to <branch>-checkpoint-<time> when that push is refused. --no-verify: a failing hook
# must not cost the results. Prints the branch it pushed to, or nothing. Never fails the caller.
checkpoint() {  # $1 name, $2 why
  local name="$1" d="$(wt_dir "$1")" log="$LOGD/$1.log" br big to
  [ -d "$d" ] || return 0
  ( cd "$d" || exit 0
    git add -A -- . ':!node_modules' ':!src/lib/vendor/lamejs-bundle.js' ':!.vercel' 2>/dev/null
    big=$(git diff --cached --name-only -z 2>/dev/null | xargs -0 -I{} find {} -maxdepth 0 -type f -size +5M 2>/dev/null)
    [ -n "$big" ] && echo "$big" | while IFS= read -r f; do git reset -q -- "$f"; done
    git diff --cached --quiet || git commit -q -s --no-verify -m "checkpoint: job $name ended without DONE ($2)

Committed by claude-job.sh so the work survives the job (#6360).${big:+ Left out (over 5 MB): $(echo "$big" | tr '\n' ' ')}" >/dev/null 2>&1
    [ -n "$(git rev-list HEAD --not --remotes=origin 2>/dev/null | head -1)" ] || exit 0
    br=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); [ "$br" = HEAD ] && br="job-$name"
    to="$br"
    git push -q origin "HEAD:refs/heads/$to" >/dev/null 2>&1 || { to="$br-checkpoint-$(date -u +%Y%m%d%H%M)"; git push -q origin "HEAD:refs/heads/$to" >/dev/null 2>&1 || to=""; }
    if [ -n "$to" ]; then echo "[claude-job] checkpoint pushed to $to ($2) $(date -u +%FT%TZ)" >> "$log"; echo "$to"
    else echo "[claude-job] checkpoint push FAILED ($2) $(date -u +%FT%TZ)" >> "$log"; fi
  )
  return 0
}

# Fix 2 (placement half): the box's own account, from the climits meter (#6359). The meter runs on the
# main box and box.sh push-limits copies it to the others every 5 min, so the account is looked up by this
# box's own Claude login, not by the meter's. Prints the weekly all-models percent, or nothing when the
# meter is absent, stale (> 30 min) or unreadable.
weekly_pct() {
  local f=/root/.claude-limits/latest.json
  [ -f "$f" ] && [ -n "$(find "$f" -mmin -30 2>/dev/null)" ] || return 0
  python3 -c '
import json, sys
d = json.load(open(sys.argv[1])); me = d.get("claude_code_account")
try: me = json.load(open("/root/.claude.json"))["oauthAccount"]["emailAddress"] or me
except Exception: pass
for a in d.get("accounts", []):
    if a.get("email") == me and a.get("ok"):
        for l in a.get("limits", []):
            if l.get("key") == "weekly_all:all": print(int(l.get("percent") or 0))
' "$f" 2>/dev/null | head -1
}
MAX_WEEKLY_PCT=${MAX_WEEKLY_PCT:-90}

# A job capped on this box's account continues on the emptiest other box (#6360 fix 2), through the box
# mesh (box.sh / box-rpc.sh). The new job is <name>-mv, starts from origin/main like any job, and its brief
# tells it to pick up the checkpoint branch. One move per job: a -mv job that is capped again pages.
# Prints the box it moved to, or nothing.
move_job() {  # $1 name, $2 checkpoint branch
  local name="$1" br="${2:-job-$1}" to new b
  case "$name" in *-mv) return 0 ;; esac
  [ -x /root/bin/box.sh ] || return 0
  to=$(/root/bin/box.sh pick --exclude "$(/root/bin/box.sh self)" 2>/dev/null); [ -n "$to" ] || return 0
  new="$name-mv"; b=$(mktemp)
  { cat "$JD/$name.brief.txt"; printf '\n\n## Moved from %s on its weekly usage cap (claude-job.sh, %s)\n' "$HOST" "$(date -u +%FT%TZ)"
    printf 'An earlier run of this brief stopped on the weekly cap. Its work is on branch %s: start with\n' "$br"
    printf '`git fetch origin %s && git merge --no-edit FETCH_HEAD`, read what it already did (the issue thread too), and continue to done. Do not redo finished steps.\n' "$br"
  } > "$b"
  if /root/bin/box.sh "$to" start "$new" < "$b" >> "$LOGD/$name.log" 2>&1; then
    echo "[claude-job] moved to $to as $new $(date -u +%FT%TZ)" >> "$LOGD/$name.log"; echo "$to"
  else echo "[claude-job] move to $to FAILED $(date -u +%FT%TZ)" >> "$LOGD/$name.log"; fi
  rm -f "$b"; return 0
}

# ntfy page for job outcomes (Derek 2026-10-04: "not getting notifications any more").
# Same topic as the box alerts. Never fails the job: a dead ntfy is not a dead job.
NTFY_TOPIC="${NTFY_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}"
ntfy_job() {  # $1 priority (min|low|default|high|urgent)  $2 tags  $3 title  $4 message
  curl -s -m 10 -H "Title: $3" -H "Priority: $1" -H "Tags: $2" -d "$4" "$NTFY_TOPIC" >/dev/null 2>&1 || true
}

# A job owns its PR until the checks are green (Derek 2026-10-08). PR #5832 sat red for four days and
# 304 commits behind because the job that opened it had exited DONE. After DONE, from outside: find the
# job's OPEN PR, wait for its checks in bash (never in the model), and if one failed, resume the job
# ONCE with the failing check names. A marker file keeps it to one fix resume. Never fails the job.
pr_fix_once() {
  local name="$1" d="$(wt_dir "$1")" log="$LOGD/$1.log" br url bad
  [ -f "$JD/$name.prfix" ] && return 0
  br=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)
  url=$(gh pr list --repo "$REPO" --head "job-$name" --state open --json url --jq '.[0].url // empty' 2>/dev/null)
  [ -z "$url" ] && [ -n "$br" ] && [ "$br" != main ] && [ "$br" != HEAD ] && url=$(gh pr list --repo "$REPO" --head "$br" --state open --json url --jq '.[0].url // empty' 2>/dev/null)
  [ -n "$url" ] || return 0
  timeout 1200 gh pr checks "$url" --watch --interval 30 >/dev/null 2>&1
  # `gh pr checks --json` needs gh >= 2.50 and the main box has 2.45, where it printed nothing and this never fired.
  # Latest run per check name: the rollup keeps a failed first attempt beside the rerun that passed.
  bad=$(gh pr view "$url" --json statusCheckRollup --jq '[.statusCheckRollup | group_by(.name // .context)[] | sort_by(.completedAt // .startedAt // "") | last | select((.conclusion // .state // "") | test("^(FAILURE|ERROR|TIMED_OUT)$")) | (.name // .context)] | join(", ")' 2>/dev/null)
  if [ -z "$bad" ]; then echo "[claude-job] PR checks not failing: $url" >> "$log"; return 0; fi
  touch "$JD/$name.prfix"; rm -f "$JD/$name.done"
  echo "[claude-job] PR $url has failing checks ($bad): one fix resume $(date -u +%FT%TZ)" >> "$log"
  claude_capped -p --continue "$(rules $name)

Your PR $url has failing checks: $bad. A job owns its PR until it is green. Read the failing logs (gh run view --log-failed), fix the cause, push, then wait for the checks in ONE bash call (timeout 1200 gh pr checks $url --watch). If a failure is not yours to fix (a flaky test, main is broken, a check that wants a PR-description line you can add), fix what you can and say the rest in a PR comment. Then touch $JD/$name.done." --model opus --permission-mode acceptEdits --verbose >> "$log" 2>&1
  echo "[claude-job] exit $? $(date -u +%FT%TZ)" >> "$log"
  touch "$JD/$name.done"
}

run() {  # inside tmux
  name="$1"; d="$(wt_dir "$name")"; log="$LOGD/$name.log"; cd "$d" || exit 3
  export JOB_SCRATCH="$DATA/$name" TMPDIR="$DATA/$name/tmp"; mkdir -p "$TMPDIR"
  # Heartbeat (2026-10-04, #5709): `claude -p` writes nothing to the log until it exits, so an empty
  # log cannot tell a working job from one the OOM killer took with its tmux. This file can.
  ( while :; do date +%s > "$JD/$name.hb"; sleep 60; done ) & hb=$!
  trap 'kill $hb 2>/dev/null' EXIT
  rm -f "$JD/$name.stopped"
  if [ "${2:-fresh}" = manual ]; then  # `resume`: re-enter the session, then the same loop
    echo "[claude-job] manual resume $(date -u +%FT%TZ)" >> "$log"
    claude_capped -p --continue "$(rules $name)

Resumed by hand. Re-read your brief ($JD/$name.brief.txt) and the issue thread, establish the current state from data, and continue to done." --model opus --permission-mode acceptEdits --verbose >> "$log" 2>&1
  else
    claude_capped -p "$(rules $name; echo; cat $JD/$name.brief.txt)" --model opus --permission-mode acceptEdits --verbose >> "$log" 2>&1
  fi
  echo "[claude-job] exit $? $(date -u +%FT%TZ)" >> "$log"
  i=0; capped=""
  while [ ! -f "$JD/$name.done" ] && [ $i -lt $MAX_RESUMES ]; do
    # A usage/session limit is a wait, not a failure (2026-10-03: all 8 resumes burned in 3 min on
    # "You've hit your session limit", then GAVE UP for 7 h). When the last claude output is a
    # limit message, sleep 20 min and retry WITHOUT spending a resume, for up to 18 waits (6 h).
    # A WEEKLY cap resets in days, not inside the 6 h wait (#6360 fix 2: 15 jobs gave up on a limit in a
    # week, 10 of them on the weekly or monthly cap). Stop now; the GAVE UP path checkpoints and says
    # how to restart it on a box whose account has headroom.
    if grep -v '^\[claude-job\]' "$log" | tail -n 2 | grep -qiE "hit your (weekly|monthly) limit"; then
      echo "[claude-job] weekly cap: not waiting $(date -u +%FT%TZ)" >> "$log"; capped=weekly; break
    fi
    if grep -v '^\[claude-job\]' "$log" | tail -n 2 | grep -qiE "hit your (session|usage) limit|usage limit reached|rate limit"; then
      w=$((${w:-0}+1))
      if [ $w -gt 18 ]; then echo "[claude-job] limit wait exhausted (6 h) $(date -u +%FT%TZ)" >> "$log"; break; fi
      [ $w -eq 1 ] && ntfy_job low hourglass "Job waiting on usage limit: $name ($HOST)" "Retries every 20 min for up to 6 h without spending a resume."
      echo "[claude-job] limit wait $w/18 (20 min, resume not counted) $(date -u +%FT%TZ)" >> "$log"; sleep 1200
    else
      i=$((i+1)); sleep 30
    fi
    echo "[claude-job] resume $i/$MAX_RESUMES $(date -u +%FT%TZ) (no $name.done)" >> "$log"
    claude_capped -p --continue "$(rules $name)

You exited before writing $JD/$name.done. Any background task or watcher you started is GONE (detached nohup processes may still run — check with ps and their output files). Re-read your brief ($JD/$name.brief.txt) and the issue thread, establish the current state from data, and continue to done." --model opus --permission-mode acceptEdits --verbose >> "$log" 2>&1
    echo "[claude-job] exit $? $(date -u +%FT%TZ)" >> "$log"
  done
  if [ -f "$JD/$name.done" ]; then
    echo "[claude-job] DONE $(date -u +%FT%TZ)" >> "$log"
    pr_fix_once "$name"
    land=$(landing_check "$name"); echo "[claude-job] landing: $land" >> "$log"
    # One line per finished job, for the morning digest: ntfy.sh keeps only ~12 h of the topic.
    echo "$(date -u +%FT%TZ) | $HOST | $name | $land" >> "$JD/landings.txt"
    case "$land" in
      ok*) ntfy_job low white_check_mark "Job done + landed: $name ($HOST)" "${land#ok }" ;;
      AT-RISK:*) ntfy_job high warning "Job finished, work at risk on the box: $name ($HOST)" "${land#AT-RISK:} — commit and push it from the worktree, or \`claude-job.sh resume $name\`" ;;
      *) ntfy_job low mag "Job done, report not found: $name ($HOST)" "${land#REPORT:}" ;;
    esac
  else
    echo "[claude-job] GAVE UP${capped:+ on the $capped cap} after $i resumes $(date -u +%FT%TZ)" >> "$log"
    cp=$(checkpoint "$name" "${capped:+$capped cap}${capped:-gave up}")
    moved=""; [ -n "${capped:-}" ] && moved=$(move_job "$name" "${cp:-}")
    if [ -n "$moved" ]; then
      ntfy_job low arrow_right "Job moved on the weekly cap: $name ($HOST -> $moved)" "Continues as ${name%-mv}-mv on $moved from branch ${cp:-job-$name}."
    else
      move=""; [ -n "${capped:-}" ] && move=" No box could take it (box.sh pick). Move it by hand: job-where.sh on the laptop; branch ${cp:-job-$name} holds the work."
      ntfy_job high warning "Job GAVE UP${capped:+ (weekly cap)}: $name ($HOST)" "$(grep -vE '^\[claude-job\]|^\s*$' "$log" | tail -n 1 | cut -c1-160)${cp:+ — work checkpointed to $cp.}$move"
    fi
  fi
  collect_decisions "$name"
  rm -f "$JD/$name.hb"
  reap_if_clean "$name"
}

# DECISION: lines from the job's output -> one shared file + a page (#5709 follow-up, 2026-10-04).
collect_decisions() {
  local name="$1" log="$LOGD/$1.log" n
  grep -oE 'DECISION: .*' "$log" 2>/dev/null | sed 's/\\n.*//; s/[`"]*$//' | sort -u | while read -r l; do
    grep -qF "$name | $l" "$JD/decisions.txt" 2>/dev/null || echo "$(date -u +%F) | $name | $l" >> "$JD/decisions.txt"
  done
  # Decisions reach Derek through the morning digest, which reads decisions.txt, never one page each
  # (#6360 fix 3). TAKEN lines are the record of what a job decided alone, for the weekly measure.
  grep -oE 'TAKEN: .*' "$log" 2>/dev/null | sed 's/\\n.*//; s/[`"]*$//' | sort -u | while read -r l; do
    grep -qF "$name | $l" "$JD/taken.txt" 2>/dev/null || echo "$(date -u +%F) | $name | $l" >> "$JD/taken.txt"
  done
  return 0
}

# One line per job: LIVE / DONE / GAVE-UP / DIED / STOPPED (2026-10-04). DIED = no tmux, no done
# file, no terminal line in the log. For LIVE, the deepest child process says what it is waiting on.
job_state() {
  local name="$1" log="$LOGD/$1.log" hbage="-" now; now=$(date +%s)
  [ -f "$JD/$name.hb" ] && hbage=$(( (now - $(cat "$JD/$name.hb" 2>/dev/null || echo $now)) / 60 ))m
  if tmux has-session -t "=job-$name" 2>/dev/null; then
    local pid; pid=$(tmux list-panes -t "=job-$name" -F '#{pane_pid}' 2>/dev/null | head -1)
    local leaf; leaf=$(ps -eo pid=,ppid=,args= | awk -v root="$pid" '{p[$1]=$2; a[$1]=substr($0, index($0,$3))} END{best=""; bd=-1; for(k in p){d=0;x=k; while(x in p && x!=root && d<40){x=p[x];d++} if(x==root && d>bd && a[k] !~ /^(sleep|tail|tmux)/){bd=d;best=a[k]}} print best}' | cut -c1-110)
    echo "LIVE    $name  hb=$hbage  :: $leaf"
  elif [ -f "$JD/$name.stopped" ]; then echo "STOPPED $name"
  elif [ -f "$JD/$name.done" ]; then echo "DONE    $name  $(grep -oE '\[claude-job\] DONE [0-9T:-]+' "$log" 2>/dev/null | tail -1 | cut -c19-)"
  elif grep -q 'GAVE UP\|limit wait exhausted' "$log" 2>/dev/null; then echo "GAVE-UP $name  :: $(grep -vE '^\[claude-job\]|^\s*$' "$log" | tail -1 | cut -c1-110)"
  elif [ -f "$JD/$name.hb" ]; then echo "DIED    $name  hb=$hbage  :: no tmux, no done file — check dmesg/df; \`$0 sweep\` resumes it (max 2)"
  elif [ ! -s "$log" ]; then echo "NOSTART $name  :: brief only, empty log (never started, or died before the heartbeat existed)"
  else echo "ENDED?  $name  :: no done file, no terminal line (pre-heartbeat job) :: $(grep -vE '^\[claude-job\]|^\s*$' "$log" | tail -1 | cut -c1-90)"
  fi
}

case "${1:-status}" in
  start)
    name="$2"; brief="$3"; [ -f "$brief" ] || { echo "no brief file $brief"; exit 2; }
    # Preflight (#6223): a job started on a full root disk dies silently with an empty log.
    free=$(root_free_gb)
    if [ "${free:-0}" -lt "$MIN_ROOT_FREE_GB" ] && [ -z "${JOB_IGNORE_DISK:-}" ]; then
      echo "REFUSED: root disk has ${free}G free (< ${MIN_ROOT_FREE_GB}G). Free space first (disk-steward.sh), or JOB_IGNORE_DISK=1."
      ntfy_job high warning "Job refused, root disk ${free}G free: $name ($HOST)" "Run disk-steward.sh or move /root folders to the volume (#6223)."
      exit 5
    fi
    wk=$(weekly_pct)
    if [ -n "$wk" ] && [ "$wk" -ge "$MAX_WEEKLY_PCT" ] && [ -z "${JOB_IGNORE_LIMIT:-}" ]; then
      echo "REFUSED: this box's Claude account is at ${wk}% of its weekly limit (>= ${MAX_WEEKLY_PCT}%). Place it elsewhere (scripts/workers/job-where.sh), or JOB_IGNORE_LIMIT=1."
      exit 6
    fi
    d="$(wt_dir "$name")"
    if [ ! -d "$d" ]; then
      git -C "$SL" fetch -q origin main && git -C "$SL" worktree add -q "$d" -b "job-$name" origin/main || exit 3
      ln -s "$SL/node_modules" "$d/node_modules"
    fi
    mkdir -p "$d/src/lib/vendor"; cp "$SL/src/lib/vendor/lamejs-bundle.js" "$d/src/lib/vendor/" 2>/dev/null || true
    [ "$(realpath "$brief")" = "$JD/$name.brief.txt" ] || cp "$brief" "$JD/$name.brief.txt"
    landing_contract "$name" "$JD/$name.brief.txt"
    [ "$LC_ISSUE_SRC" = "Lands header" ] && [ "$LC_PR" != auto ] || echo "note: brief has no 'Lands: #NNNN' / 'PR: yes|no' header lines; the landing check will guess (issue: ${LC_ISSUE:-none found}${LC_ISSUE_SRC:+ from $LC_ISSUE_SRC}; PR: only if it commits)"
    rm -f "$JD/$name.done"
    tmux new -d -s "job-$name" "$0 _run $name"
    sleep 20  # a job that dies at launch must say so here, not look blank in `status` (#5709)
    if tmux has-session -t "=job-$name" 2>/dev/null || [ -f "$JD/$name.done" ]; then
      echo "started job-$name (tmux) → $LOGD/$name.log"
    else echo "job-$name DIED within 20 s:"; tail -5 "$LOGD/$name.log"; exit 4; fi ;;
  resume)
    name="$2"; rm -f "$JD/$name.done"
    tmux new -d -s "job-$name" "MAX_RESUMES=${MAX_RESUMES} $0 _run_resume $name"
    echo "resuming job-$name (tmux) → $LOGD/$name.log" ;;
  _run) run "$2" ;;
  _run_resume) run "$2" manual ;;
  _resume) run "$2" manual ;;  # name used by sessions started before 2026-10-01's rewrite
  status)  # jobs started in the last ${2:-3} days, plus anything still live; `status 30` looks further back
    [ "$HOST" = cloudlayer ] && systemctl show sourcelibrary.slice -p MemoryCurrent | sed 's/MemoryCurrent=/slice memory bytes: /'
    { tmux ls -F '#{session_name}' 2>/dev/null | sed -n 's/^job-//p'
      find "$JD" -maxdepth 1 -name '*.brief.txt' -mtime -"${2:-3}" -printf '%f\n' | sed 's/\.brief\.txt$//'; } | sort -u |
      while read -r n; do job_state "$n"; done | sort > "/tmp/cj-status.$$"
    # DONE jobs older than a day are counted, not listed: the list is for what needs eyes.
    since=$(date -u -d '1 day ago' +%FT%T)
    awk -v since="$since" '$1!="DONE" || $3>=since' "/tmp/cj-status.$$"
    echo "-- $(awk -v since="$since" '$1=="DONE" && $3<since' "/tmp/cj-status.$$" | wc -l) older DONE jobs not listed (see \`ls -t $JD/*.done\`)"
    rm -f "/tmp/cj-status.$$"
    [ -s "$JD/decisions.txt" ] && { echo "-- decisions for Derek (last 5; all in $JD/decisions.txt):"; tail -5 "$JD/decisions.txt" | cut -c1-200; } ;;
  sweep)  # cron: resume jobs that DIED (heartbeat era only: needs a .hb file), at most twice each
    for hb in "$JD"/*.hb; do [ -f "$hb" ] || continue; n=$(basename "$hb" .hb)
      tmux has-session -t "=job-$n" 2>/dev/null && continue
      [ -f "$JD/$n.done" ] || [ -f "$JD/$n.stopped" ] && { rm -f "$hb"; continue; }
      k=$(grep -c '\[claude-job\] sweep-resume' "$LOGD/$n.log" 2>/dev/null || true)
      if [ "${k:-0}" -ge 2 ]; then
        echo "[claude-job] sweep gave up after 2 resumes $(date -u +%FT%TZ)" >> "$LOGD/$n.log"; rm -f "$hb"
        cp=$(checkpoint "$n" "died twice")
        ntfy_job high warning "Job DIED twice, not resumed: $n" "Check dmesg/df on the box; \`claude-job.sh resume $n\` by hand.${cp:+ Work checkpointed to $cp.}"; continue; fi
      echo "[claude-job] sweep-resume $((k+1))/2: no tmux, no done file, heartbeat $(( ($(date +%s)-$(cat "$hb"))/60 ))m old $(date -u +%FT%TZ)" >> "$LOGD/$n.log"
      dmesg -T 2>/dev/null | grep -i 'killed process' | tail -1 >> "$LOGD/$n.log"
      tmux new -d -s "job-$n" "$0 _run_resume $n"
    done ;;
  log) tail -"${3:-40}" "$LOGD/$2.log" ;;
  stop) touch "$JD/$2.stopped"; tmux kill-session -t "=job-$2" && echo "stopped job-$2"
    cp=$(checkpoint "$2" stopped); [ -n "$cp" ] && echo "work checkpointed to $cp" ;;
  _reap) reap_if_clean "$2"; tail -1 "$LOGD/$2.log" ;;  # test/one-off: apply the reap rule to one job
  _land) landing_check "$2" ;;  # test/one-off: would this job count as landed?
  backtest)  # every finished job on this box: the verdict as logged (what Derek was paged) vs the check run again NOW
    # TSV: name, logged verdict, new verdict. The new column sees today's state (later comments, reaped worktrees).
    for b in "$JD"/*.brief.txt; do n=$(basename "$b" .brief.txt); [ -f "$JD/$n.done" ] || continue
      old=$(grep -h '\[claude-job\] landing:' "$LOGD/$n.log" 2>/dev/null | tail -1 | sed 's/.*landing: //')
      [ -n "$old" ] || continue  # finished before there was a landing check
      printf '%s\t%s\t%s\n' "$n" "$old" "$(landing_check "$n")"
    done ;;
  where)  # one line a dispatcher can compare across boxes (scripts/workers/job-where.sh asks each box)
    cores=$(nproc); load=$(cut -d' ' -f1 /proc/loadavg); load5=$(cut -d' ' -f2 /proc/loadavg)
    mem=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo)
    if [ "$HOST" != hetzner ]; then  # guest hosts: what the slice still allows, if that is less
      cap=$(systemctl show sourcelibrary.slice -p MemoryMax --value 2>/dev/null); cur=$(systemctl show sourcelibrary.slice -p MemoryCurrent --value 2>/dev/null)
      case "$cap$cur" in *[!0-9]*|"") ;; *) room=$(( (cap - cur) / 1048576 )); [ "$room" -lt "$mem" ] && mem=$room ;; esac
    fi
    disk=$(df -BG --output=avail "$DATA" | tail -1 | tr -dc '0-9')
    live=$(tmux ls -F '#{session_name}' 2>/dev/null | grep -c '^job-')
    # Can a job start here at all? Existence checks only; nothing is read or printed.
    why=""
    [ -x /root/.local/bin/claude ] || command -v claude >/dev/null 2>&1 || why="$why,no-claude"
    [ -s /root/.claude/.credentials.json ] || why="$why,claude-not-logged-in"
    gh auth status >/dev/null 2>&1 || why="$why,gh-not-logged-in"
    [ -s /root/sourcelibrary/.env.production.local ] || why="$why,no-env-file"
    [ -d "$SL/node_modules" ] || why="$why,no-node_modules"
    ready=yes; [ -n "$why" ] && ready="no:${why#,}"
    wk=$(weekly_pct); [ -n "$wk" ] && [ "$wk" -ge "$MAX_WEEKLY_PCT" ] && ready="no:weekly-${wk}pct"
    echo "host=$HOST cores=$cores load1=$load load5=$load5 mem_free_mb=$mem job_disk_free_gb=$disk root_free_gb=$(root_free_gb) live_jobs=$live weekly_pct=${wk:-?} ready=$ready" ;;
esac

#!/usr/bin/env bash
# claude-rc-job.sh — start an agent job you can SEE and STEER from the Claude phone app.
#
# Unlike claude-job.sh (headless `claude -p`, invisible in the app, resume loop),
# this starts an INTERACTIVE session with Remote Control on, inside tmux. It shows
# in the Claude app / claude.ai/code under the name "job-<name>" for the account
# this box is logged into (`claude auth status`). When it finishes a turn it waits
# for you rather than exiting, and any permission prompt can be answered from
# the phone. Each job gets its own git worktree (claude -w), never the live checkout.
#
# Trade-off: no resume loop, heartbeat or ntfy — this is for work a human watches.
# Unattended overnight work still belongs in claude-job.sh.
#
# Usage: claude-rc-job.sh start <name> <brief-file | "brief text">
#        claude-rc-job.sh list
#        claude-rc-job.sh attach <name>     # Ctrl-b d to detach
#        claude-rc-job.sh stop <name>       # graceful: /exit, then kill the pane
#        claude-rc-job.sh resume <name> [session-id] ["message"]
#                                           # restart the job's session in place (same name in the app,
#                                           # same conversation, current $MODE); id defaults to the newest
#                                           # transcript in the job's working directory
# Added 2026-11-09. Default mode auto since 2026-11-13: in acceptEdits a job stopped on every shell
# command the allow list could not parse ("Quoted text in this command can't be checked") and waited
# for a tap the phone app often doesn't show; auto lets the classifier decide and still blocks risky
# actions. The app cannot change a running session's mode, so `resume` is how to switch one.
set -eu
REPO=/root/sourcelibrary
DIR=/root/rc-jobs
MODE=${RC_JOB_PERMISSION_MODE:-auto}   # see header; claude-job.sh (headless) keeps acceptEdits + allow list
mkdir -p "$DIR"
cmd=${1:-list}; name=${2:-}

need_name() { [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "name must be lowercase letters, digits, dashes"; exit 2; }; }

case "$cmd" in
  start)
    need_name; src=${3:-}; [ -n "$src" ] || { echo "need a brief (file path or text)"; exit 2; }
    tmux has-session -t "rcjob-$name" 2>/dev/null && { echo "rcjob-$name already exists"; exit 1; }
    if [ -f "$src" ]; then cp "$src" "$DIR/$name.brief"; else printf '%s\n' "$src" > "$DIR/$name.brief"; fi
    tmux new -d -s "rcjob-$name" -c "$REPO" \
      "claude --remote-control 'job-$name' -w 'rcjob-$name' --permission-mode $MODE \"\$(cat $DIR/$name.brief)\"; echo SESSION EXITED; sleep 3600"
    echo "started rcjob-$name — in the Claude app (account: $(claude auth status 2>/dev/null | grep -o '"email": "[^"]*"' | cut -d'"' -f4)) look for job-$name"
    ;;
  resume)
    need_name; tmux has-session -t "rcjob-$name" 2>/dev/null || { echo "no rcjob-$name"; exit 1; }
    pid=$(tmux list-panes -t "rcjob-$name" -F '#{pane_pid}'); cpid=$(pgrep -P "$pid" -x claude || true)
    [ -n "$cpid" ] || { echo "rcjob-$name has no running claude; pass a session id"; }
    cwd=$(readlink "/proc/${cpid:-$pid}/cwd"); sid=${3:-}
    # Keep the job's Claude login: a job started under another account (CLAUDE_CONFIG_DIR) resumes there,
    # otherwise its transcript isn't found and it would come back on the wrong account.
    cfg=$( [ -n "$cpid" ] && tr '\0' '\n' < "/proc/$cpid/environ" | sed -n 's/^CLAUDE_CONFIG_DIR=//p' || true)
    if [ -z "$sid" ]; then
      proj=${cfg:-$HOME/.claude}/projects/$(printf '%s' "$cwd" | sed 's/[^A-Za-z0-9]/-/g')
      sid=$(ls -t "$proj"/*.jsonl 2>/dev/null | head -1 | xargs -r basename | sed 's/\.jsonl$//')
    fi
    [ -n "$sid" ] || { echo "no transcript found for $cwd; pass a session id"; exit 1; }
    msg=${4:-"Restarted in $MODE permission mode. Carry on where you left off."}
    tmux respawn-pane -k -t "rcjob-$name" -c "$cwd" \
      "${cfg:+CLAUDE_CONFIG_DIR='$cfg' }claude --resume '$sid' --remote-control 'job-$name' --permission-mode $MODE \"$msg\"; echo SESSION EXITED; sleep 3600"
    echo "resumed rcjob-$name (session $sid, $MODE, in $cwd)" ;;
  list)   tmux ls 2>/dev/null | grep '^rcjob-' || echo "no rc jobs" ;;
  attach) need_name; exec tmux attach -t "rcjob-$name" ;;
  stop)
    need_name
    tmux send-keys -t "rcjob-$name" Escape 2>/dev/null; sleep 1
    tmux send-keys -t "rcjob-$name" "/exit" Enter 2>/dev/null; sleep 5
    tmux kill-session -t "rcjob-$name" 2>/dev/null; echo "stopped rcjob-$name (worktree kept: $REPO/.claude/worktrees/rcjob-$name)" ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac

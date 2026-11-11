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
# Added 2026-11-09.
set -eu
REPO=/root/sourcelibrary
DIR=/root/rc-jobs
MODE=${RC_JOB_PERMISSION_MODE:-acceptEdits}   # same default as claude-job.sh; allow-list in ~/.claude/settings.json
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
  list)   tmux ls 2>/dev/null | grep '^rcjob-' || echo "no rc jobs" ;;
  attach) need_name; exec tmux attach -t "rcjob-$name" ;;
  stop)
    need_name
    tmux send-keys -t "rcjob-$name" Escape 2>/dev/null; sleep 1
    tmux send-keys -t "rcjob-$name" "/exit" Enter 2>/dev/null; sleep 5
    tmux kill-session -t "rcjob-$name" 2>/dev/null; echo "stopped rcjob-$name (worktree kept: $REPO/.claude/worktrees/rcjob-$name)" ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac

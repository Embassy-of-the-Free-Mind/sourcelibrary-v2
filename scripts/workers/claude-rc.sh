#!/usr/bin/env bash
# Start, watch, or stop the always-on Claude Code Remote Control server for
# Source Library on this box. Sessions it spawns run HERE, each in its own git
# worktree under /root/sourcelibrary/.claude/worktrees/, and appear at
# claude.ai/code and in the Claude phone app under this box's name ($NAME below)
# for the account `claude auth status` shows on this box. You only see a box's
# sessions in the app when the app is signed into that same account.
# Installed to /root/bin by install-claude-job.sh; started by cron (@reboot +
# `ensure` every 10 min) on the boxes that serve it (hetzner, gex45).
#
# Never serves the live checkout itself (--no-create-session-in-dir): the hourly
# auto-pull rewrites /root/sourcelibrary and the workers run from it. A session
# that needs secrets must say `node --env-file=/root/sourcelibrary/.env.production.local …`.
#
# Usage: claude-rc.sh            # start server in tmux session "claude-rc"
#        claude-rc.sh attach     # watch it (Ctrl-b d to detach)
#        claude-rc.sh stop       # graceful Ctrl-C, then kill the pane
#        claude-rc.sh status
#        claude-rc.sh ensure   # cron watchdog: silent when up, restarts + logs when down (2026-11-09)
set -u
S=claude-rc
# The name the app shows. Hostnames are not the names people use for the boxes.
case "$(hostname -s)" in clawdbot) NAME=hetzner ;; gex45-1) NAME=gex45 ;; *) NAME=$(hostname -s) ;; esac
# Bracket trick: the pattern never matches its own command line.
PAT='remote-control --sp[a]wn'
case "${1:-start}" in
  attach) exec tmux attach -t "$S" ;;
  status) tmux has-session -t "$S" 2>/dev/null && echo "tmux: up" || echo "tmux: down"; pgrep -af "$PAT" | grep -v tmux || echo "server process: none" ;;
  stop)
    tmux send-keys -t "$S" C-c 2>/dev/null; sleep 4
    pkill -INT -f "$PAT" 2>/dev/null; sleep 3
    pkill -f "$PAT" 2>/dev/null
    tmux kill-session -t "$S" 2>/dev/null; echo stopped ;;
  ensure)
    pgrep -f "$PAT" >/dev/null 2>&1 && exit 0
    echo "$(date -u +%FT%TZ) server not running - restarting"; exec "$0" start ;;
  start)
    if pgrep -f "$PAT" >/dev/null 2>&1 && tmux has-session -t "$S" 2>/dev/null; then echo "already running: $0 attach"; exit 0; fi
    pkill -f "$PAT" 2>/dev/null; tmux kill-session -t "$S" 2>/dev/null; sleep 1
    tmux new -d -s "$S" -c /root/sourcelibrary "claude remote-control --spawn worktree --no-create-session-in-dir --name $NAME --permission-mode bypassPermissions; echo SERVER EXITED; sleep 86400"
    echo "started in tmux session $S — attach with: $0 attach" ;;
esac

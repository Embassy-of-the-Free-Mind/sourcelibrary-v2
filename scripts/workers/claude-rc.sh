#!/usr/bin/env bash
# Always-on Claude Code Remote Control servers on this box: ONE PER CLAUDE ACCOUNT, so whichever
# account the Claude phone app (or claude.ai/code) is signed into, this box shows up in its
# environment list under the box's name ($NAME) and a new session can be started on it.
#
# Each server runs in the workspace /root/work (spawn same-dir): a session starts there and can
# reach every repo (gh is logged in), the live Source Library checkout, and the other boxes via
# box.sh. /root/work/CLAUDE.md (from scripts/workers/claude-rc-workspace.md) tells the session the
# rules — above all: never edit /root/sourcelibrary itself (workers run from it, auto-pull rewrites
# it); make a worktree. Secrets: `node --env-file=/root/sourcelibrary/.env.production.local …`.
#
# Accounts live in /root/claude-rc.accounts (per box, not in git), one per line:
#     <slug> <config-dir>          config-dir "-" = the default ~/.claude login
# A login is per config dir; `login <slug>` makes one without a terminal on the box (see below).
#
# Usage: claude-rc.sh ensure            # cron: start any account's server that is not running (silent when all up)
#        claude-rc.sh start  [slug]     # all accounts, or one
#        claude-rc.sh stop   [slug]     # graceful Ctrl-C (it deregisters itself), then kill the pane
#        claude-rc.sh status
#        claude-rc.sh attach <slug>     # watch it (Ctrl-b d to detach)
#        claude-rc.sh login  <slug>     # new config dir /root/.claude-rc-<slug> (used by nothing else) + `claude auth login` in tmux; prints the URL
#        claude-rc.sh code   <slug> <code>   # paste the code from the browser into that login
#
# Never kill a server's pane without `stop`: its registration stays live at Anthropic for ~10 min and
# a restart meanwhile is refused ("already served by a terminal claude remote-control on this device").
# History: one server, sourcelibrary worktrees (2026-10-01); per account + workspace (2026-11-09).
set -u
ACCTS=/root/claude-rc.accounts
WORK=/root/work
MODE=${RC_PERMISSION_MODE:-bypassPermissions}
case "$(hostname -s)" in clawdbot) NAME=hetzner ;; gex45-1) NAME=gex45 ;; *) NAME=$(hostname -s) ;; esac

accounts() { [ -f "$ACCTS" ] && grep -v -E '^\s*(#|$)' "$ACCTS" | awk '{print $1, $2}'; }
dir_of()   { accounts | awk -v s="$1" '$1==s {print $2}'; }
sess()     { echo "claude-rc-$1"; }
# IS_SANDBOX=1: these boxes run everything as root, and Claude Code refuses bypassPermissions as root
# unless told it is in a dedicated sandbox. Without it the server shows "Ready" but every session
# started from the phone dies at birth ("--dangerously-skip-permissions cannot be used with root/sudo
# privileges"); found 2026-11-11, every session on both boxes since 2026-11-09 had failed this way.
env_for()  { [ "$1" = "-" ] && echo "IS_SANDBOX=1 " || echo "IS_SANDBOX=1 CLAUDE_CONFIG_DIR=$1 "; }
# Up = the pane's child process is claude (after an exit the pane holds `sleep`, so the session alone proves nothing).
alive() {
  local p; p=$(tmux list-panes -t "$(sess "$1")" -F '#{pane_pid}' 2>/dev/null | head -1)
  [ -n "$p" ] && pgrep -P "$p" -x claude >/dev/null 2>&1
}
start_one() {
  local slug=$1 dir; dir=$(dir_of "$slug"); [ -n "$dir" ] || { echo "no account '$slug' in $ACCTS"; return 1; }
  alive "$slug" && { echo "$slug: already running"; return 0; }
  tmux kill-session -t "$(sess "$slug")" 2>/dev/null; mkdir -p "$WORK"
  tmux new -d -s "$(sess "$slug")" -c "$WORK" \
    "$(env_for "$dir")claude remote-control --spawn same-dir --name $NAME --permission-mode $MODE; echo SERVER EXITED; sleep 86400"
  echo "$slug: started (tmux $(sess "$slug"), app name $NAME)"
}
stop_one() {
  local s; s=$(sess "$1")
  tmux send-keys -t "$s" C-c 2>/dev/null; sleep 5
  tmux kill-session -t "$s" 2>/dev/null; echo "$1: stopped"
}
email_of() { local d; d=$(dir_of "$1"); eval "$(env_for "$d")claude auth status" 2>/dev/null | grep -o '"email": "[^"]*"' | cut -d'"' -f4; }

cmd=${1:-ensure}; slug=${2:-}
case "$cmd" in
  ensure)
    for s in $(accounts | awk '{print $1}'); do
      alive "$s" || { echo "$(date -u +%FT%TZ) $s: server not running - restarting"; start_one "$s"; }
    done ;;
  start)  if [ -n "$slug" ]; then start_one "$slug"; else for s in $(accounts | awk '{print $1}'); do start_one "$s"; done; fi ;;
  stop)   if [ -n "$slug" ]; then stop_one "$slug"; else for s in $(accounts | awk '{print $1}'); do stop_one "$s"; done; fi ;;
  status)
    for s in $(accounts | awk '{print $1}'); do
      printf '%-10s %-6s %s\n' "$s" "$(alive "$s" && echo up || echo DOWN)" "$(email_of "$s")"
    done ;;
  attach) exec tmux attach -t "$(sess "$slug")" ;;
  login)
    [[ "$slug" =~ ^[a-z0-9-]+$ ]] || { echo "usage: $0 login <slug>"; exit 2; }
    d=/root/.claude-rc-$slug; mkdir -p "$d"
    tmux kill-session -t "claude-login-$slug" 2>/dev/null
    tmux new -d -s "claude-login-$slug" -x 250 "CLAUDE_CONFIG_DIR=$d claude auth login; echo LOGIN EXITED; sleep 3600"
    sleep 6; tmux capture-pane -pJt "claude-login-$slug" | grep -v '^\s*$'
    echo "-> open the URL signed in as the account you want, then: $0 code $slug <code>"
    echo "-> afterwards add to $ACCTS:  $slug $d" ;;
  code)
    tmux send-keys -l -t "claude-login-$slug" "$3"; tmux send-keys -t "claude-login-$slug" Enter; sleep 8
    tmux capture-pane -pJt "claude-login-$slug" | grep -v '^\s*$' | tail -5
    echo "account: $(CLAUDE_CONFIG_DIR=/root/.claude-rc-$slug claude auth status 2>/dev/null | grep -o '"email": "[^"]*"' | cut -d'"' -f4)" ;;
  *) sed -n '2,26p' "$0"; exit 2 ;;
esac

#!/bin/bash
# agy-guard: the `agy` on every box's PATH. Heavy Gemini models (Argon, Pro) need an explicit reason and a box-wide
# daily cap; everything else passes straight through to the real CLI.
#
# PRIOR ART: scripts/lib/agy-cli.mjs ledgerGate (#7118) — caps heavy calls per JOB, but only for callers that go
# through that library; ~15 scripts spawn `agy` directly and ad-hoc `agy -p` from a claude job bypasses it. On
# 2026-10-22 argon-high was locked while the ledger held no Argon call. This shim sits on PATH so it sees every caller.
#
# Rules, print mode only (-p/--print/--prompt; an interactive `agy` is a person and passes):
#   - model matches argon or -pro: refused unless AGY_ALLOW_HEAVY=<issue or reason> is set, and then at most
#     AGY_HEAVY_BOX_CAP (default 40) such calls per UTC day on this box, counted in $AGY_GUARD_DIR/<date>.log.
#   - no --model: gemini-3.8-flash-low is added, so a bare `agy -p` can never land on a heavy default.
# A refusal prints "quota reached" on stderr and exits 75, so agy-cli.mjs and the scripts that copy its QUOTA regex
# stop as they would on a real lockout instead of retrying.
#
# Install (per box as root, or on the Mac): scripts/workers/agy-guard.sh --install. Undo: --uninstall.
# The real CLI updates itself in place (Linux ~/.local/bin/agy, Mac /opt/homebrew/bin/agy), so the guard is a
# separate file earlier on PATH, never a replacement of the binary.
if [ "$(uname)" = Darwin ]; then
  REAL="${AGY_REAL:-/opt/homebrew/bin/agy}"; SELF_DIR="$HOME/bin/agy-guard"
  # .zprofile's `brew shellenv` and path_helper re-prepend Homebrew after .zshenv, so login shells need it again.
  RCS="$HOME/.zshenv $HOME/.zprofile $HOME/.zshrc"
  GUARD_DIR="${AGY_GUARD_DIR:-$HOME/.agy-quota/heavy}"
else
  REAL="${AGY_REAL:-/root/.local/bin/agy}"; SELF_DIR=/root/bin/agy-guard; RCS="/root/.bashrc /root/.profile"
  GUARD_DIR="${AGY_GUARD_DIR:-/root/agy-quota/heavy}"
fi
CAP="${AGY_HEAVY_BOX_CAP:-40}"
HEAVY='argon|-pro'
MARK='# agy-guard PATH (#7075)'

if [ "$1" = "--install" ]; then
  mkdir -p "$SELF_DIR" && cp "$0" "$SELF_DIR/agy" && chmod 755 "$SELF_DIR/agy"
  for rc in $RCS; do
    grep -qF "$MARK" "$rc" 2>/dev/null || printf '\nexport PATH="%s:$PATH"  %s\n' "$SELF_DIR" "$MARK" >> "$rc"
  done
  # /usr/local/bin/agy is what a bare cron PATH or a non-login shell finds; point it at the guard too.
  [ -L /usr/local/bin/agy ] && ln -sfn "$SELF_DIR/agy" /usr/local/bin/agy
  echo "agy-guard installed: $SELF_DIR/agy -> $REAL (cap $CAP heavy calls/day)"; exit 0
fi
if [ "$1" = "--uninstall" ]; then
  for rc in $RCS; do sed -i.bak "\|$MARK|d" "$rc" && rm -f "$rc.bak"; done
  [ -L /usr/local/bin/agy ] && ln -sfn "$REAL" /usr/local/bin/agy
  rm -f "$SELF_DIR/agy"; echo "agy-guard removed"; exit 0
fi

print=0; model=''; prev=''
for a in "$@"; do
  case "$a" in -p|--print|--prompt) print=1 ;; --model=*) model="${a#--model=}" ;; esac
  [ "$prev" = "--model" ] && model="$a"
  prev="$a"
done
[ "$print" = 1 ] || exec "$REAL" "$@"

if [ -z "$model" ]; then
  echo "agy-guard: no --model given; using gemini-3.8-flash-low" >&2
  exec "$REAL" "$@" --model gemini-3.8-flash-low
fi

if echo "$model" | grep -qiE "$HEAVY"; then
  day=$(date -u +%F)
  if [ -z "$AGY_ALLOW_HEAVY" ]; then
    echo "agy-guard: quota reached (refused): $model needs AGY_ALLOW_HEAVY=<issue> — Argon/Pro are scarce on the shared account" >&2
    exit 75
  fi
  mkdir -p "$GUARD_DIR"
  used=$(cat "$GUARD_DIR/$day.log" 2>/dev/null | wc -l)
  if [ "$used" -ge "$CAP" ]; then
    echo "agy-guard: quota reached (refused): box cap of $CAP heavy calls for $day is used ($AGY_ALLOW_HEAVY)" >&2
    exit 75
  fi
  echo "$(date -u +%FT%TZ),$model,${AGY_JOB:-?},$AGY_ALLOW_HEAVY,$PPID" >> "$GUARD_DIR/$day.log"
fi
exec "$REAL" "$@"

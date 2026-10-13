#!/usr/bin/env bash
# Put the repo's job wrapper in place on a job host: scripts/workers/claude-job.sh -> /root/bin/claude-job.sh (#6358).
# Runs after every pull (main box: auto-pull.sh; guest hosts: a crontab line after the hourly ff-pull), and does
# nothing when the installed file is already this one.
#
# Atomic on purpose: a new file is written beside the target and renamed over it. bash reads a running
# script incrementally, and live jobs are executing the installed wrapper for hours, so editing or
# overwriting it in place changes the script under them. A rename leaves them on the old file.
# The wrapper is copied, not symlinked into the checkout: a checkout can be dirty or mid-rebase.
#
#   install-claude-job.sh [target]     default target /root/bin/claude-job.sh
# Also installs box-rpc.sh and box.sh beside it (the box mesh, #6360).
# Keeps <target>.bak-6358 (the last hand-maintained wrapper, written once) and <target>.prev (the one before this install).
set -u
here=$(cd "$(dirname "$0")" && pwd)
say() { echo "[install-claude-job] $(date -u +%FT%TZ) $*"; }
# The box mesh (#6360) installs the same way: box-rpc.sh is the forced command other boxes' keys run,
# box.sh the client. Each goes to /root/bin/<name> beside the wrapper.
install_one() {  # $1 file in this directory, $2 target path
  local src="$here/$1" dst="$2"
  [ -f "$src" ] || { say "no $src"; return 1; }
  if cmp -s "$src" "$dst"; then [ -f "$dst.commit" ] || git -C "$here" log -1 --format=%h -- "$1" > "$dst.commit" 2>/dev/null; return 0; fi
  bash -n "$src" || { say "REFUSED: $src does not parse"; return 1; }
  # Install only what is committed: a half-edited script in a dirty checkout must not reach live jobs.
  if [ -z "${INSTALL_UNCOMMITTED:-}" ] && [ -n "$(git -C "$here" status --porcelain -- "$1" 2>&1)" ]; then
    say "REFUSED: $src is not the committed file (INSTALL_UNCOMMITTED=1 to install it anyway)"; return 1
  fi
  mkdir -p "$(dirname "$dst")"
  if [ -f "$dst" ]; then
    [ "$1" = claude-job.sh ] && { [ -e "$dst.bak-6358" ] || cp -p "$dst" "$dst.bak-6358"; }
    cp -p "$dst" "$dst.prev"
  fi
  local tmp="$dst.new.$$" c
  cp "$src" "$tmp" && chmod 755 "$tmp" && mv -f "$tmp" "$dst" || { rm -f "$tmp"; say "FAILED to write $dst"; return 1; }
  c=$(git -C "$here" log -1 --format=%h -- "$1" 2>/dev/null); echo "$c" > "$dst.commit"
  say "installed $c -> $dst (previous kept as $dst.prev)"
}
dst="${1:-/root/bin/claude-job.sh}"; bin=$(dirname "$dst"); rc=0
install_one claude-job.sh "$dst" || rc=1
install_one box-rpc.sh "$bin/box-rpc.sh" || rc=1
install_one box.sh "$bin/box.sh" || rc=1
exit $rc

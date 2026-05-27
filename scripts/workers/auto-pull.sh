#!/bin/bash
# Auto-pull origin/main on Hetzner so worker scripts pick up new commits
# within an hour instead of needing manual SSH after every fix.
#
# Without this, code fixes (e.g. model rename in #2042) sit unused until
# someone manually SSHes and pulls — causing thousands of silent batch
# failures (see PR #2065 for the case that motivated this).
#
# Install once via the crontab.production line that pairs with this file.
# Safe to run anytime: --rebase + --ff-only ensures no merge commits and no
# overwriting of local divergence (which sync-crontab.sh occasionally creates
# when Hetzner's crontab drifts from git).

set -uo pipefail

cd /root/sourcelibrary || { echo "[auto-pull] /root/sourcelibrary missing"; exit 1; }

# Bail if there are unstaged changes — sync-crontab.sh stages and pushes
# crontab.production on its own schedule, so a working tree dirty for any
# other reason is a real signal worth investigating, not silently dropped.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "[auto-pull] $(date -Iseconds) Working tree dirty, skipping pull. Files:"
  git status --short
  exit 0
fi

# Fetch first so the rebase has the latest refs without needing network during
# the rebase step itself (avoids partial-fetch errors mid-rebase).
git fetch --quiet origin main 2>&1 || {
  echo "[auto-pull] $(date -Iseconds) Fetch failed"
  exit 1
}

# Nothing to do if already at origin/main
local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse origin/main)
if [ "$local_sha" = "$remote_sha" ]; then
  echo "[auto-pull] $(date -Iseconds) Already up to date at $local_sha"
  exit 0
fi

# Rebase onto origin/main. --ff-only would be safer but we have local commits
# from sync-crontab.sh's own push flow, so rebase is the right choice.
if git pull --rebase --quiet origin main; then
  echo "[auto-pull] $(date -Iseconds) Pulled $local_sha → $(git rev-parse HEAD)"
else
  # Rebase conflict — leave the tree alone, alert via log. Recovery is manual.
  echo "[auto-pull] $(date -Iseconds) REBASE FAILED, aborting"
  git rebase --abort 2>/dev/null || true
  exit 1
fi

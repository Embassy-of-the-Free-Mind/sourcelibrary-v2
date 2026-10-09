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

# Pulling moves the CHECKOUT; it does not move a process that loaded the old one. On every exit
# path, ask which running workers are now older than main (#5442) — a `--loop` worker kept code
# eight hours stale on 2026-10-01 while this script reported "Already up to date". The audit
# alerts via ntfy (deduplicated) and never restarts anything. Its exit code is reported, not
# propagated: auto-pull's own exit status means "did the pull work".
worker_drift() {
  [ -f scripts/audit/worker-code-drift.mjs ] || return 0
  node --env-file=/root/sourcelibrary/.env.production.local scripts/audit/worker-code-drift.mjs \
    --repo /root/sourcelibrary --alert 2>&1 | sed 's/^/[auto-pull] drift: /'
}
# The job wrapper lives in the repo (#6358); /root/bin/claude-job.sh is a copy of it. Refresh the copy on
# every exit path too: it is a no-op when nothing changed, and it refuses a file that is not committed.
install_job_wrapper() {
  [ -f scripts/workers/install-claude-job.sh ] || return 0
  bash scripts/workers/install-claude-job.sh 2>&1 | sed 's/^/[auto-pull] /'
}
trap 'worker_drift; install_job_wrapper' EXIT

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

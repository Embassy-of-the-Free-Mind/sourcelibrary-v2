#!/usr/bin/env bash
# situation — what is running and what is wrong across all four boxes, in one read (~7 s). Installed at
# /root/bin/situation on every box by install-claude-job.sh; on the laptop run scripts/workers/situation.sh.
# The work is scripts/maintenance/situation.mjs (reads the ops_reports every box pushes, ntfy, and the ops repo).
#   situation [--hours=12] [--box=main|gex45|l7a|cloudlayer] [--json]
set -u
repo=""
# Guests auto-pull /data/scratch/sl/sourcelibrary; main and gex45 pull /root/sourcelibrary; the laptop has ~/sourcelibrary.
for d in "${SL_REPO:-}" /data/scratch/sl/sourcelibrary /root/sourcelibrary "$HOME/sourcelibrary"; do
  [ -n "$d" ] && [ -f "$d/.env.production.local" ] && [ -f "$d/scripts/maintenance/situation.mjs" ] && { repo=$d; break; }
done
[ -n "$repo" ] || { echo "situation: no checkout with .env.production.local and scripts/maintenance/situation.mjs (set SL_REPO)" >&2; exit 2; }
# The ops repo copy on a box is read for RUNNING.md and DECISIONS-PENDING.md; bring it up to date first (fast-forward only).
[ -d /root/work/sourcelibrary-ops/.git ] && timeout 15 git -C /root/work/sourcelibrary-ops pull -q --ff-only >/dev/null 2>&1
exec node --env-file="$repo/.env.production.local" "$repo/scripts/maintenance/situation.mjs" "$@"

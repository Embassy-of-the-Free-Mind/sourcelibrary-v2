#!/bin/bash
# Detect drift between the live Hetzner crontab and the committed snapshot.
#
# HISTORY: this script used to `git push origin main` directly (see #498). That
# stopped working — direct pushes to main are blocked by branch protection and
# the DCO bot requires a Signed-off-by trailer the auto-commit never added, so
# the job silently failed and `crontab.production` drifted ~stale for weeks
# (#2332 Task 0). It was also not even installed in the live crontab.
#
# The live crontab is the SOURCE OF TRUTH; `crontab.production` is a derived
# snapshot kept fresh by hand via PR. This script no longer commits anything —
# it only reports drift so an operator (or Claude) opens a PR to re-snapshot.
#
# Install on Hetzner (logs drift daily; never mutates git):
#   0 4 * * * /root/sourcelibrary/scripts/workers/sync-crontab.sh >> /var/log/sourcelibrary/crontab-sync.log 2>&1
#
# To re-snapshot after a crontab change:
#   crontab -l > scripts/workers/crontab.production   # on Hetzner, then PR it
# or from a workstation with SSH:
#   ssh root@<hetzner> crontab -l > scripts/workers/crontab.production && open a PR

set -uo pipefail
cd /root/sourcelibrary || { echo "[sync-crontab] repo missing"; exit 1; }

CRONTAB_FILE="scripts/workers/crontab.production"

# Compare ignoring blank lines (crontab -l can vary trailing whitespace).
if diff -q \
    <(grep -vE '^[[:space:]]*$' "$CRONTAB_FILE" 2>/dev/null) \
    <(crontab -l 2>/dev/null | grep -vE '^[[:space:]]*$') > /dev/null 2>&1; then
  echo "[sync-crontab] $(date -Iseconds) No drift — crontab.production matches live"
  exit 0
fi

echo "[sync-crontab] $(date -Iseconds) DRIFT DETECTED — committed crontab.production is stale."
echo "[sync-crontab] Re-snapshot with: crontab -l > $CRONTAB_FILE  (then open a PR)"
echo "[sync-crontab] Diff (committed <  vs  live >):"
diff "$CRONTAB_FILE" <(crontab -l 2>/dev/null) || true
exit 0

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
NOT_LIVE_STATE="/var/lib/sourcelibrary/crontab-not-live.sha"
NTFY_TOPIC="https://ntfy.sh/sourcelibrary-uptime"

# Compare ignoring blank lines (crontab -l can vary trailing whitespace).
if diff -q \
    <(grep -vE '^[[:space:]]*$' "$CRONTAB_FILE" 2>/dev/null) \
    <(crontab -l 2>/dev/null | grep -vE '^[[:space:]]*$') > /dev/null 2>&1; then
  echo "[sync-crontab] $(date -Iseconds) No drift — crontab.production matches live"
  rm -f "$NOT_LIVE_STATE"
  exit 0
fi

echo "[sync-crontab] $(date -Iseconds) DRIFT DETECTED — committed crontab.production is stale."
echo "[sync-crontab] Re-snapshot with: crontab -l > $CRONTAB_FILE  (then open a PR)"
echo "[sync-crontab] Diff (committed <  vs  live >):"
diff "$CRONTAB_FILE" <(crontab -l 2>/dev/null) || true

# A line merged but not running is the drift that matters: merging installs nothing,
# so a cron can sit in the repo reading as done (#8353). Page once per distinct set.
# Lines live but not in the snapshot are routine hand edits, so those are only logged.
# Installing here would be wrong: the snapshot holds lines stopped on purpose, some paid.
jobs_only() { grep -vE '^[[:space:]]*(#|$)' | grep -vE '^[A-Z_]+=' | sort -u; }
NOT_LIVE=$(comm -13 <(crontab -l 2>/dev/null | jobs_only) <(jobs_only < "$CRONTAB_FILE"))
if [ -z "$NOT_LIVE" ]; then
  rm -f "$NOT_LIVE_STATE"
  exit 0
fi
SHA=$(printf '%s' "$NOT_LIVE" | sha256sum | cut -d' ' -f1)
if [ "$SHA" != "$(cat "$NOT_LIVE_STATE" 2>/dev/null)" ]; then
  COUNT=$(printf '%s\n' "$NOT_LIVE" | wc -l)
  if printf '%s cron line(s) are in crontab.production but not running on this box:\n%s\nInstall them, or take them out of the repo. Merging does not install a cron (#6323).' \
    "$COUNT" "$(printf '%s' "$NOT_LIVE" | cut -c1-120 | head -5)" \
    | curl -fsS --max-time 20 -H "Title: Merged cron not running: $COUNT" -H "Priority: high" --data-binary @- "$NTFY_TOPIC" > /dev/null; then
    mkdir -p "$(dirname "$NOT_LIVE_STATE")" && printf '%s' "$SHA" > "$NOT_LIVE_STATE"
  fi
fi
exit 0

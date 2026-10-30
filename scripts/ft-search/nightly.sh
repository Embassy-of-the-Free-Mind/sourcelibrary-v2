#!/bin/sh
# PRIOR ART: none in the repo — select-batch.mjs, run-batch.sh and meter-guard.sh are the three steps; this only
# chains them for an unattended run (#7598). Skill steps 1-3 as one command.
#
# Select the next N books for the fresh prior-translation search and start the batch, detached. The batch applies
# itself when it finishes (run-batch.sh) and pages ntfy once.
#
#   scripts/ft-search/nightly.sh <claude-config-dir> <account-email> <n>
#   e.g.  scripts/ft-search/nightly.sh ~/.claude-team team@sourcelibrary.org 1000
#
# Run it from a checkout on main. Needs MONGODB_URI (+ Supabase for the leads and the catalogue harvest): it sources
# $ENV_FILE (default <repo>/.env.production.local) unless MONGODB_URI is already set. It never touches an account
# other than the one named, and refuses to start while the previous nightly batch is still running.
# Batches live in ~/ft-batches/<date>-nightly-<hhmm>/; the path is written to ~/ft-batches/last-nightly.txt.
# --exclude: every ~/ft-batches/*/ids.txt not marked INGESTED (or recheck/held/gate dirs), so two un-ingested
# batches never draw the same books.
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
CFG=$1; EMAIL=$2; N=${3:-1000}
[ -n "$CFG" ] && [ -n "$EMAIL" ] || { echo "usage: nightly.sh <claude-config-dir> <account-email> <n>"; exit 1; }
ROOT=${FT_BATCHES:-$HOME/ft-batches}
NTFY=${NTFY:-https://ntfy.sh/sourcelibrary-uptime}
mkdir -p "$ROOT"
page() { curl -s -m 10 -H "Title: $1" -d "$2" "$NTFY" >/dev/null || true; }

# Which account is this really? A CLI's login is often not the account you think.
WHO=$(CLAUDE_CONFIG_DIR="$CFG" claude auth status 2>/dev/null | grep -i '"email"' | head -1)
case "$WHO" in *"$EMAIL"*) ;; *) page "ft-search nightly NOT started" "claude auth status under $CFG is '$WHO', not $EMAIL (#7598)"; exit 1;; esac

if [ -s "$ROOT/last-nightly.txt" ]; then
  LAST=$(cat "$ROOT/last-nightly.txt")
  if [ -d "$LAST" ] && ! grep -q BATCHDONE "$LAST/progress.log" 2>/dev/null && pgrep -f "run-batch.sh $LAST" >/dev/null; then
    echo "previous nightly batch still running: $LAST"; exit 0
  fi
fi

if [ -z "$MONGODB_URI" ]; then
  ENV_FILE=${ENV_FILE:-$REPO/.env.production.local}
  [ -f "$ENV_FILE" ] || { page "ft-search nightly NOT started" "no MONGODB_URI and no $ENV_FILE (#7598)"; exit 1; }
  set -a; . "$ENV_FILE"; set +a
fi

EXCL=""
for f in "$ROOT"/*/ids.txt; do
  [ -f "$f" ] || continue
  d=$(dirname "$f")
  [ -f "$d/INGESTED" ] && continue
  [ -f "$d/NO_POSTRUN" ] || [ -f "$d/GATE" ] && continue
  EXCL="$EXCL,$f"
done
DIR="$ROOT/$(date -u +%Y-%m-%d)-nightly-$(date -u +%H%M)"
cd "$REPO" || exit 1
if [ -n "$EXCL" ]; then
  node scripts/ft-search/select-batch.mjs --n "$N" --out "$DIR" --exclude "${EXCL#,}" || { page "ft-search nightly select FAILED" "select-batch.mjs exited nonzero; see the box log (#7598)"; exit 1; }
else
  node scripts/ft-search/select-batch.mjs --n "$N" --out "$DIR" || { page "ft-search nightly select FAILED" "select-batch.mjs exited nonzero; see the box log (#7598)"; exit 1; }
fi
[ -s "$DIR/ids.txt" ] || { echo "nothing eligible"; exit 0; }
echo "$DIR" > "$ROOT/last-nightly.txt"

CLAUDE_CONFIG_DIR="$CFG" nohup "$HERE/run-batch.sh" "$DIR" "${FT_PARALLEL:-4}" >/dev/null 2>&1 &
nohup "$HERE/meter-guard.sh" "$DIR" "$EMAIL" "${FT_CAP5:-85}" "${FT_CAPW:-20}" >/dev/null 2>&1 &
echo "started $DIR ($(wc -l < "$DIR/ids.txt") books)"

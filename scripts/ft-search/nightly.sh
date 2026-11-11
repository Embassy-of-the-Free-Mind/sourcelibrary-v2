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
# --exclude keeps two un-ingested batches from drawing the same books. Per batch dir:
#   INGESTED / NO_POSTRUN / GATE        -> not excluded (done, or not a real batch)
#   name starts with hold- OR has HOLD  -> ALL its ids excluded, always (a deliberate hold; `touch <dir>/HOLD`)
#   a live run-batch.sh on the dir      -> all its ids excluded (still being searched)
#   any other dir (stopped, dead)       -> only ids that have a verdict json (searched, awaiting ingest) are
#                                          excluded; unsearched ids return to the pool (#8482). If it holds
#                                          searched-but-uningested verdicts, ntfy is paged once (<dir>/PAGED).
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
  d=$(dirname "$f"); b=$(basename "$d")
  case "$b" in hold-*) EXCL="$EXCL,$f"; continue;; esac
  [ -f "$d/HOLD" ] && { EXCL="$EXCL,$f"; continue; }
  [ -f "$d/INGESTED" ] && continue
  [ -f "$d/NO_POSTRUN" ] || [ -f "$d/GATE" ] && continue
  if pgrep -f "run-batch.sh $d" >/dev/null; then EXCL="$EXCL,$f"; continue; fi
  # Stopped, dead batch: exclude only the ids already searched (a verdict json named <id>.json).
  S="$d/searched-ids.txt"; : > "$S"
  while read -r id; do
    [ -n "$id" ] && [ -f "$d/$id.json" ] && grep -q verdict "$d/$id.json" 2>/dev/null && echo "$id" >> "$S"
  done < "$f"
  if [ -s "$S" ]; then
    EXCL="$EXCL,$S"
    [ -f "$d/PAGED" ] || { page "ft-search results not ingested: $b" "$(wc -l < "$S" | tr -d ' ') searched verdicts sit in $d with no INGESTED; unsearched ids were released to the pool (#8482)"; touch "$d/PAGED"; }
  fi
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

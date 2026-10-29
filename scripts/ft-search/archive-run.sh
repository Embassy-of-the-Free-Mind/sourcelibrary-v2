#!/bin/sh
# PRIOR ART: none in the repo for a non-page object: storagePut() (src/lib/storage.ts) is TypeScript and the
# scripts/lib R2 helpers (r2-key.mjs, r2-version.mjs) only validate keys. So archive-upload.mjs does one PutObject.
#
# Archive one finished run (#7598): tar the batch dir plus <dir>-recheck and <dir>-workconflicts (prompts, raw
# claude -p outputs, ingest logs). Always written to $FT_ARCHIVE (default ~/ft-batches/archive/<name>.tgz); then
# uploaded to R2 as ft-search-runs/<name>.tgz. The last output line is `ARCHIVE r2=ok|failed local=<path>`.
# An R2 failure does not fail the run (the local copy stands); a tar failure does.
#
#   scripts/ft-search/archive-run.sh <batch-dir>
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=$(cd "$1" && pwd) || exit 1
NAME=$(basename "$DIR")
OUT=${FT_ARCHIVE:-$HOME/ft-batches/archive}
mkdir -p "$OUT" || exit 1
PARTS="$NAME"
for suffix in -recheck -workconflicts; do [ -d "$DIR$suffix" ] && PARTS="$PARTS $NAME$suffix"; done
tar czf "$OUT/$NAME.tgz" -C "$(dirname "$DIR")" $PARTS || { echo "ARCHIVE tar failed"; exit 1; }
if node "$HERE/archive-upload.mjs" "$OUT/$NAME.tgz" "ft-search-runs/$NAME.tgz" >/dev/null 2>&1; then R2=ok; else R2=failed; fi
echo "ARCHIVE r2=$R2 local=$OUT/$NAME.tgz"

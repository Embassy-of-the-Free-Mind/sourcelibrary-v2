#!/bin/bash
# ft-census-daily.sh — TEMPORARY daily driver for the grounded FT census (#2933).
#
# Processes the master worklist (every visible non-English book without a
# modern recorded search) in free-quota-sized tranches: TRANCHE books/day
# ≈ TRANCHE/7 grounded Google searches per Gemini key, inside the per-key
# daily grounding allotments, so the census costs tokens only (~$0.0005/book).
#
# Each run: slice the next tranche of not-yet-adjudicated books → grounded
# adjudication (ft-gemini-adjudicate.mjs, resumable JSONL) → ingest evidence
# to the attempts ledger (Sink A) → harvest found priors into
# translation_catalogs (Sink C). All steps idempotent. The nightly 05:30
# single-writer loop folds the evidence into verdicts; NOTHING here can flip
# a public badge (that stays behind the verified-only reconcile).
#
# No-ops (exit 0) when the master worklist is exhausted — then remove the
# #TEMP-FT-CENSUS cron line and this note in #2933.
#
# Files (on the pipeline box):
#   MASTER  scripts/output/ft-census-master-worklist.json   [{id,t,a,l},...]
#   OUT     scripts/output/ft-census-out.jsonl.jsonl        (appended by the adjudicator)
set -euo pipefail
cd /root/sourcelibrary
set -a; source .env.production.local; set +a

MASTER=scripts/output/ft-census-master-worklist.json
OUTBASE=scripts/output/ft-census-out.jsonl
OUT="$OUTBASE.jsonl"
TODAY=/tmp/ft-census-tranche-today.json
TRANCHE="${TRANCHE:-3400}"

REMAINING=$(node -e '
const fs = require("fs");
const master = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const done = new Set();
try {
  for (const line of fs.readFileSync(process.argv[2], "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const id = JSON.parse(line).book_id; if (id) done.add(String(id)); } catch {}
  }
} catch {}
const todo = master.filter(b => !done.has(String(b.id)));
fs.writeFileSync(process.argv[3], JSON.stringify(todo.slice(0, Number(process.argv[4]))));
console.log(todo.length);
' "$MASTER" "$OUT" "$TODAY" "$TRANCHE")

echo "[ft-census] $(date -Is) remaining=$REMAINING tranche=$((REMAINING < TRANCHE ? REMAINING : TRANCHE))"
if [ "$REMAINING" -eq 0 ]; then
  echo "[ft-census] master worklist exhausted — remove the #TEMP-FT-CENSUS cron line."
  exit 0
fi

node scripts/eval/ft-gemini-adjudicate.mjs "$TODAY" "$OUTBASE" --concurrency=6
node scripts/maintenance/ingest-ft-attempts.mjs "$OUT" --apply
node scripts/enrichment/harvest-ft-into-translation-catalogs.mjs --from-enum "$OUT" --apply

#!/usr/bin/env bash
# PRIOR ART: claude-job.sh's landing contract (`Lands:` / `PR:` header lines, #6358) — the same header shape; it
# checks what a job reports, not which route it reads with, so this is a second header beside it.
#
# brief-route-check.sh <brief-file> — does an OCR or translation brief name its ROUTER cell? (#7701)
#
# A brief that writes OCR or translation text must carry a `Route:` line in its first 15 lines, saying which cell of
# the router table (#6740, scripts/eval/estimator/router-table/) its books fall in and the route's measured k/n:
#   Route: Latin print, lite text → lite>agy-flash-low 24/30
#   Route: untested → cell test (30 pages, one per book, blind Opus judge, k/n into the table)
#   Route: none — eval only, no production writes
# Why a check and not a sentence: the rule "consult the router before dispatch" was written down on 2026-10-28 and
# broken again the next day. Twice an OCR/translation job was dispatched on a model picked by habit, and both times
# Derek had to ask "is the router being used?" (13 reader-request books on 10-28; 23.7K no-OCR books on 10-29, #7701).
#
# Prints "ok: <route>", "skip: not an OCR/translation write brief", or "REFUSED: <why>" and exits 0 / 0 / 8.
set -u
brief="${1:-}"
[ -f "$brief" ] || { echo "REFUSED: no brief file '$brief'"; exit 8; }

# An OCR/translation brief that writes: it runs a lane that writes page text, or says it will OCR / translate / correct
# books or pages, AND it writes (an --apply run, a cron, a write). Reading results, designing pages and metadata jobs skip.
LANES='cli-ocr|cli-translate|claude-translate|siku-translate|translate-lane|ocr-lane|paddle-zh-lane|paddle-print|gpu-print-lane|euro-draft|ocr-filler|batch-translate|retranslat[a-z]*'
DOES='\b(ocr|translat[a-z]*|re-?read|correct)[a-z]*[[:space:]]+(the|these|all|its|their|every|each|[0-9][0-9,.]*[kKmM]?)?[[:space:]]*([a-z-]+[[:space:]]+){0,3}(books|pages|volumes|leaves|frames)\b'
if ! grep -qiE -- "$LANES|$DOES" "$brief" || ! grep -qiE -- '--apply|\bapply\b|\bwrites?\b|\bcron' "$brief"; then
  echo "skip: not an OCR/translation write brief"; exit 0
fi

route=$(head -15 "$brief" | grep -m1 -iE '^[[:space:]]*Route:[[:space:]]' | sed -E 's/^[^:]*:[[:space:]]*//; s/[[:space:]]+$//')
how="Add a 'Route:' line to the brief's first 15 lines: the router cell and its k/n (e.g. 'Route: German print, lite text → lite>agy-flash-low 28/30'), 'Route: untested → cell test', or 'Route: none — <why>'. Router: scripts/eval/estimator/router-table/ (#6740)."
[ -n "$route" ] || { echo "REFUSED: this brief reads or writes OCR/translation text but names no router cell. $how"; exit 8; }

if echo "$route" | grep -qE '[0-9]+[[:space:]]*/[[:space:]]*[0-9]+'; then :            # a measured k/n
elif echo "$route" | grep -qiE '^untested\b.*cell test'; then :                         # an unmeasured cell, tested first
elif echo "$route" | grep -qiE '^none[[:space:]]*(—|-|–|:)[[:space:]]*[^[:space:]].{5,}'; then : # not a routed write, with a reason
else echo "REFUSED: 'Route: $route' has no k/n, is not 'untested → cell test', and is not 'none — <why>'. $how"; exit 8; fi
echo "ok: $route"

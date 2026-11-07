#!/bin/sh
# PRIOR ART: none — loops scripts/maintenance/withhold-stale-translations.mjs --by-eye-pages over a containment plan (one book a call, as that tool requires).
# $1 = "" (dry run) or --apply
MODE=$1
node -e 'const p=require(process.env.JOB_SCRATCH+"/work/contain-plan.json").contain;for(const b of p)console.log(b.book_id+"\t"+b.pages.join(",")+"\t"+String(b.evidence||"").replace(/[\t\n"`$\\]/g," ").slice(0,220))' | while IFS="$(printf '\t')" read id pages ev; do
  out=$(node --env-file=/data/scratch/sl/sourcelibrary/.env.production.local scripts/maintenance/withhold-stale-translations.mjs --book=$id --by-eye-pages=$pages --evidence="Opus with the scans of n-1, n, n+1, blind to direction (shift screen #5021, 2026-11-03): English renders the neighbouring leaf. e.g. $ev" --issue=5021 $MODE 2>&1)
  n=$(printf '%s' "$out" | grep -o '"invented_by_eye": [0-9]*' | grep -o '[0-9]*$')
  printf '%s\t%s\t%s\n' "$id" "$pages" "${n:-ERR}"
  [ -z "$n" ] && printf '%s\n' "$out" | tail -5 >&2
done

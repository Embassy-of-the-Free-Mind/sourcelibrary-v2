#!/bin/sh
# Plan + read translations for written, untranslated pages in a range (sequential Opus calls), into $JOB_SCRATCH/tr-<tag>.
# Usage: sh run-translate.sh <first> <last> <tag>
set -e
H="$(cd "$(dirname "$0")" && pwd)"; R="$H/../../../.."
node --env-file=/root/sourcelibrary/.env.production.local "$H/translate-plan.mjs" "$1" "$2" "$H/translate/p$3"
cd "$R" && node --env-file=/root/sourcelibrary/.env.production.local scripts/batch/claude-translate.mjs read --page-ids-file="$H/translate/p$3.ids.json" --instructions-file="$H/translate/p$3.instr.json" --out="$JOB_SCRATCH/tr-$3" --per-call=3 --job=whish147-tr

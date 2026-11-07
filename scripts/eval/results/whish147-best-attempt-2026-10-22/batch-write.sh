#!/bin/sh
# Assemble and write every page in a range whose reads are complete; write-ocr never touches a page that has OCR.
# Usage: sh batch-write.sh <first> <last>
cd "$(dirname "$0")"
node assemble.mjs "$1" "$2" | grep -c SKIP | sed 's/^/not ready: /'
node --env-file=/root/sourcelibrary/.env.production.local write-ocr.mjs "$1" "$2" --apply 2>&1 | grep -E "^WRITE|^written" | tail -2

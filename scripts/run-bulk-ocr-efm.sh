#!/bin/bash
# Submits batch OCR jobs for EFM books that have pages but incomplete OCR.
# Uses the batch-ocr-async route which targets pages WITHOUT OCR.
#
# Usage: secret-lover run -- bash scripts/run-bulk-ocr-efm.sh [--dry-run] [--limit=N]
#
# Requires CRON_SECRET and AUTH_SECRET in env (via secret-lover).
# The batch-ocr-async route uses withAdminAuth, so we need a session cookie.
# Alternative: we use CRON_SECRET with the bulk-reocr pattern instead.

# Since batch-ocr-async requires admin auth (not cron auth), we'll use a
# different approach: call a lightweight script that queries MongoDB for
# EFM book IDs with incomplete OCR, then calls the bulk-reocr-style endpoint.
#
# Actually, the simplest approach: create a list of book IDs and call
# batch-ocr-async for each via curl with admin auth.
#
# For now, let's use the admin/bulk-ocr-new endpoint (we'll create it).

BASE_URL="https://sourcelibrary.org/api/admin/bulk-ocr-new"
DRY_RUN=""
LIMIT=5

# Parse args
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="&dry_run=true" ;;
    --limit=*) LIMIT="${arg#--limit=}" ;;
  esac
done

OFFSET=0
TOTAL_PAGES=0
TOTAL_BOOKS=0
CONSECUTIVE_ERRORS=0
MAX_ERRORS=5
CONSECUTIVE_EMPTY=0
MAX_EMPTY=10

echo "=== Bulk OCR (new pages): Starting (limit=$LIMIT) ==="
echo ""

while true; do
  echo "--- Calling offset=$OFFSET ---"
  RESPONSE=$(curl -s --max-time 310 -H "Authorization: Bearer $CRON_SECRET" \
    "${BASE_URL}?offset=${OFFSET}&limit=${LIMIT}&provider=efm${DRY_RUN}" 2>&1)

  # Check for curl errors
  if ! echo "$RESPONSE" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    CONSECUTIVE_ERRORS=$((CONSECUTIVE_ERRORS + 1))
    echo "  ERROR ($CONSECUTIVE_ERRORS/$MAX_ERRORS): Non-JSON response, retrying in 10s..."
    echo "  Response: $(echo "$RESPONSE" | head -c 200)"
    if [[ $CONSECUTIVE_ERRORS -ge $MAX_ERRORS ]]; then
      echo "Too many consecutive errors. Stopping at offset=$OFFSET"
      break
    fi
    sleep 10
    continue
  fi
  CONSECUTIVE_ERRORS=0

  BOOKS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('booksSubmitted',0))")
  PAGES=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('totalPages',0))")
  NEXT=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('nextOffset',0))")
  EXAMINED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('booksExamined',0))")
  COST=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('estimatedCost','?'))")
  DURATION=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('duration_ms',0))")
  SKIPPED_BP=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('skipped') is True else 'false')" 2>/dev/null || echo "false")
  ERROR=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

  if [[ -n "$ERROR" ]]; then
    echo "  API error: $ERROR — retrying in 10s..."
    sleep 10
    continue
  fi

  if [[ "$SKIPPED_BP" == "true" ]]; then
    echo "Backpressure: too many active jobs. Waiting 2 minutes..."
    sleep 120
    continue
  fi

  echo "  Books: $BOOKS/$EXAMINED | Pages: $PAGES | Cost: $COST | Time: ${DURATION}ms"

  TOTAL_PAGES=$((TOTAL_PAGES + PAGES))
  TOTAL_BOOKS=$((TOTAL_BOOKS + BOOKS))

  if [[ "$BOOKS" == "0" ]]; then
    CONSECUTIVE_EMPTY=$((CONSECUTIVE_EMPTY + 1))
  else
    CONSECUTIVE_EMPTY=0
  fi

  if [[ "$EXAMINED" == "0" ]] || [[ $CONSECUTIVE_EMPTY -ge $MAX_EMPTY ]]; then
    echo ""
    echo "=== Done ==="
    echo "Total books submitted: $TOTAL_BOOKS"
    echo "Total pages: $TOTAL_PAGES"
    break
  fi

  OFFSET=$NEXT
done

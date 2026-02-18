#!/bin/bash
# Calls the bulk-reocr admin endpoint repeatedly with offset pagination.
# Usage: secret-lover run -- bash scripts/run-bulk-reocr.sh [--dry-run]
#
# Requires CRON_SECRET in env (via secret-lover).

BASE_URL="https://sourcelibrary.org/api/admin/bulk-reocr"
DRY_RUN=""
START_OFFSET=0

# Parse args
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="&dry_run=true" ;;
    --offset=*) START_OFFSET="${arg#--offset=}" ;;
  esac
done

OFFSET=$START_OFFSET
TOTAL_PAGES=0
TOTAL_BOOKS=0
CONSECUTIVE_ERRORS=0
MAX_ERRORS=5
CONSECUTIVE_EMPTY=0
MAX_EMPTY=10  # Stop after N consecutive calls with 0 submitted books

echo "=== Bulk Re-OCR: Starting (offset=$OFFSET) ==="
echo ""

while true; do
  echo "--- Calling offset=$OFFSET ---"
  RESPONSE=$(curl -s --max-time 310 -H "Authorization: Bearer $CRON_SECRET" \
    "${BASE_URL}?offset=${OFFSET}&limit=3${DRY_RUN}" 2>&1)

  # Check for curl errors (non-JSON response)
  if ! echo "$RESPONSE" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    CONSECUTIVE_ERRORS=$((CONSECUTIVE_ERRORS + 1))
    echo "  ERROR ($CONSECUTIVE_ERRORS/$MAX_ERRORS): Non-JSON response, retrying in 30s..."
    echo "  Response: $(echo "$RESPONSE" | head -c 200)"
    if [[ $CONSECUTIVE_ERRORS -ge $MAX_ERRORS ]]; then
      echo "Too many consecutive errors. Stopping at offset=$OFFSET"
      break
    fi
    sleep 30
    continue
  fi
  CONSECUTIVE_ERRORS=0

  # Parse response
  BOOKS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('booksSubmitted',0))")
  PAGES=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('totalPages',0))")
  NEXT=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('nextOffset',0))")
  EXAMINED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('booksExamined',0))")
  COST=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('estimatedCost','?'))")
  DURATION=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('duration_ms',0))")
  SKIPPED_LIST=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('skipped',[]); print(len(s) if isinstance(s, list) else 0)" 2>/dev/null || echo "0")
  SKIPPED_BP=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('skipped') is True else 'false')" 2>/dev/null || echo "false")
  ERROR=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

  # Check for API errors
  if [[ -n "$ERROR" ]]; then
    echo "  API error: $ERROR — retrying in 30s..."
    sleep 30
    continue
  fi

  # Check for backpressure
  if [[ "$SKIPPED_BP" == "true" ]]; then
    echo "Backpressure: too many active jobs. Waiting 5 minutes..."
    sleep 300
    continue
  fi

  echo "  Books: $BOOKS/$EXAMINED | Pages: $PAGES | Skipped: $SKIPPED_LIST | Cost: $COST | Time: ${DURATION}ms"

  TOTAL_PAGES=$((TOTAL_PAGES + PAGES))
  TOTAL_BOOKS=$((TOTAL_BOOKS + BOOKS))

  # Track consecutive empty calls
  if [[ "$BOOKS" == "0" ]]; then
    CONSECUTIVE_EMPTY=$((CONSECUTIVE_EMPTY + 1))
  else
    CONSECUTIVE_EMPTY=0
  fi

  # If no books examined (ran out of candidates) or too many empty calls, we're done
  if [[ "$EXAMINED" == "0" ]] || [[ $CONSECUTIVE_EMPTY -ge $MAX_EMPTY ]]; then
    echo ""
    echo "=== Done ==="
    echo "Total books submitted: $TOTAL_BOOKS"
    echo "Total pages: $TOTAL_PAGES"
    if [[ $CONSECUTIVE_EMPTY -ge $MAX_EMPTY ]]; then
      echo "(Stopped after $MAX_EMPTY consecutive empty calls)"
    fi
    break
  fi

  OFFSET=$NEXT

  # Brief pause between calls
  sleep 2
done

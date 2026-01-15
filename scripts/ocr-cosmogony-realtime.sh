#!/bin/bash
# OCR Cosmogony Books via Realtime API
# Usage: ./scripts/ocr-cosmogony-realtime.sh

BASE_URL="https://sourcelibrary.org"
# IMPORTANT: Always use gemini-3-flash-preview for OCR (per user instructions)
# DO NOT use gemini-2.5-flash
MODEL="gemini-3-flash-preview"
BATCH_SIZE=5
SLEEP_TIME=1  # 1 second between batches for rate limiting

ocr_book() {
  BOOK_ID=$1
  TITLE=$2
  LANG=$3
  IA_ID=$4

  echo "============================================================"
  echo "Processing: $TITLE"
  echo "Book ID: $BOOK_ID"
  echo "Language: $LANG"
  echo "============================================================"

  # Get book data
  BOOK=$(curl -s "$BASE_URL/api/books/$BOOK_ID")

  # Get all pages (skip page 0 which is often a Google disclaimer)
  # Using overwrite=true to re-OCR with correct model (gemini-3-flash-preview)
  PAGES=$(echo "$BOOK" | jq '[.pages[] | select(.page_number > 0) | {pageId: .id, imageUrl: .image_url, pageNumber: .page_number}]')
  TOTAL=$(echo "$PAGES" | jq 'length')

  echo "Pages needing OCR: $TOTAL"

  if [ "$TOTAL" = "0" ]; then
    echo "No pages need OCR!"
    return
  fi

  PROCESSED=0
  FAILED=0

  # Process in batches
  for ((i=0; i<TOTAL; i+=BATCH_SIZE)); do
    BATCH=$(echo "$PAGES" | jq ".[$i:$((i+BATCH_SIZE))]")
    BATCH_LEN=$(echo "$BATCH" | jq 'length')

    echo -n "Batch $((i/BATCH_SIZE + 1)) (pages $((i+1))-$((i+BATCH_LEN)))... "

    RESP=$(curl -s -X POST "$BASE_URL/api/process/batch-ocr" \
      -H "Content-Type: application/json" \
      -d "{
        \"pages\": $BATCH,
        \"model\": \"$MODEL\",
        \"language\": \"$LANG\",
        \"overwrite\": true
      }" --max-time 180)

    # Check for errors
    if echo "$RESP" | grep -q '"error"'; then
      ERROR=$(echo "$RESP" | jq -r '.error // "unknown"')
      echo "ERROR: $ERROR"
      FAILED=$((FAILED + BATCH_LEN))

      # Check for rate limit
      if echo "$ERROR" | grep -qi "rate\|429\|quota"; then
        echo "Rate limited, waiting 30s..."
        sleep 30
        i=$((i-BATCH_SIZE))  # Retry
        continue
      fi
    else
      PROC=$(echo "$RESP" | jq -r '.processedCount // 0')
      SKIP=$(echo "$RESP" | jq -r '.skippedCount // 0')
      FAIL=$(echo "$RESP" | jq -r '.failedPageIds | length // 0')
      echo "processed=$PROC, skipped=$SKIP, failed=$FAIL"
      PROCESSED=$((PROCESSED + PROC))
      FAILED=$((FAILED + FAIL))
    fi

    sleep $SLEEP_TIME
  done

  echo ""
  echo "Completed: $TITLE"
  echo "  Processed: $PROCESSED"
  echo "  Failed: $FAILED"
  echo ""
}

# Process all 5 cosmogony books
echo "Starting OCR for Cosmogony Collection"
echo "Model: $MODEL"
echo "Batch size: $BATCH_SIZE"
echo ""

# Philo De Opificio (Greek)
ocr_book "6964bfcbd00c6d84781505ff" "Philo De Opificio Mundi" "Greek" "philonisalexand00philgoog"

# 2 Enoch (English - translation from Slavonic)
ocr_book "6964bfdcb60c0197a3ae873e" "2 Enoch (Secrets of Enoch)" "English" "bookofsecretsofe00morf"

# Hesiod Theogony (Greek)
ocr_book "6964bfddb60c0197a3ae87db" "Hesiod Theogony" "Greek" "hesiod-theogony_202405"

# Enuma Elish (English - translation from Akkadian)
ocr_book "6964bfdeb60c0197a3ae89a7" "Enuma Elish (Seven Tablets)" "English" "seventabletsofcr02kinguoft"

# Babylonian Creation Myths (English)
ocr_book "6964bfdeb60c0197a3ae8aa6" "Babylonian Creation Myths" "English" "babylonian-creation-myths"

echo "============================================================"
echo "ALL BOOKS PROCESSED"
echo "============================================================"

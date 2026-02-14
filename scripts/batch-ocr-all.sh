#!/bin/bash
# Batch OCR submission for all Session 028+029 books
# Submits each book to Gemini Batch API (50% cheaper than realtime)
# Usage: ./scripts/batch-ocr-all.sh [limit_per_book]

BASE_URL="https://sourcelibrary.org"
LOG_FILE="/tmp/batch-ocr-submissions.log"
ERROR_FILE="/tmp/batch-ocr-errors.log"
IDS_FILE="/tmp/all_session_ids.txt"
LIMIT="${1:-50}"  # Pages per book per submission (default 50)

echo "=== Batch OCR Submission Started: $(date) ===" | tee "$LOG_FILE"
echo "Limit per book: $LIMIT" | tee -a "$LOG_FILE"
echo "" > "$ERROR_FILE"

TOTAL=$(wc -l < "$IDS_FILE")
CURRENT=0
SUCCESS=0
SKIPPED=0
FAILED=0
TOTAL_PAGES=0

while read -r BOOK_ID; do
    CURRENT=$((CURRENT + 1))

    # Submit batch OCR
    RESPONSE=$(curl -s -X POST "${BASE_URL}/api/books/${BOOK_ID}/batch-ocr-async" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"gemini-3-flash-preview\",\"limit\":${LIMIT}}" \
        --max-time 300 2>/dev/null)

    # Parse response
    if echo "$RESPONSE" | grep -q '"jobName"'; then
        PAGES=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('pagesSubmitted','?'))" 2>/dev/null)
        TOTAL_PAGES=$((TOTAL_PAGES + ${PAGES:-0}))
        echo "[$CURRENT/$TOTAL] OK: $BOOK_ID ($PAGES pages)" | tee -a "$LOG_FILE"
        SUCCESS=$((SUCCESS + 1))
    elif echo "$RESPONSE" | grep -q '"processed":0\|"message".*No pages need OCR'; then
        echo "[$CURRENT/$TOTAL] SKIP: $BOOK_ID (no pages need OCR)" | tee -a "$LOG_FILE"
        SKIPPED=$((SKIPPED + 1))
    elif echo "$RESPONSE" | grep -q '"error"'; then
        ERROR_MSG=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null)
        echo "[$CURRENT/$TOTAL] FAIL: $BOOK_ID - $ERROR_MSG" | tee -a "$LOG_FILE"
        echo "$BOOK_ID: $ERROR_MSG" >> "$ERROR_FILE"
        FAILED=$((FAILED + 1))
    else
        # Check for timeout/empty response
        if [ -z "$RESPONSE" ]; then
            echo "[$CURRENT/$TOTAL] TIMEOUT: $BOOK_ID" | tee -a "$LOG_FILE"
            echo "$BOOK_ID: timeout" >> "$ERROR_FILE"
        else
            echo "[$CURRENT/$TOTAL] ???: $BOOK_ID - $(echo "$RESPONSE" | head -c 200)" | tee -a "$LOG_FILE"
            echo "$BOOK_ID: $RESPONSE" >> "$ERROR_FILE"
        fi
        FAILED=$((FAILED + 1))
    fi

    # Small delay between requests
    sleep 2
done < "$IDS_FILE"

echo "" | tee -a "$LOG_FILE"
echo "=== Batch OCR Submission Complete: $(date) ===" | tee -a "$LOG_FILE"
echo "Total: $TOTAL | Success: $SUCCESS | Skipped: $SKIPPED | Failed: $FAILED" | tee -a "$LOG_FILE"
echo "Total pages submitted: $TOTAL_PAGES" | tee -a "$LOG_FILE"
echo "Log: $LOG_FILE"
echo "Errors: $ERROR_FILE"

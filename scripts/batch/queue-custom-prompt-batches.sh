#!/bin/bash
# Queue books with custom OCR prompts for non-Latin-script and multi-script texts
# Each category gets a tailored prompt that replaces DEFAULT_PROMPTS.ocr

API="https://sourcelibrary.org/api/jobs/queue-books"

queue_book() {
  local BOOK_ID="$1"
  local LABEL="$2"
  local PROMPT_FILE="$3"

  PROMPT=$(cat "$PROMPT_FILE")

  RESP=$(curl -s -X POST "$API" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg bid "$BOOK_ID" --arg prompt "$PROMPT" '{bookId: $bid, action: "ocr", customPrompt: $prompt}')")

  echo "$LABEL: $RESP"
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROMPT_DIR="$SCRIPT_DIR/custom-prompts"

echo "=== Queuing Complutensian Polyglot ==="
queue_book "699209c4bed8f4b5ff5b2c6b" "Polyglot (17181p)" "$PROMPT_DIR/polyglot.txt"

echo ""
echo "=== Queuing Codex Sinaiticus ==="
queue_book "6953a8b277f38f6761bd365c" "Sinaiticus - Tischendorf (628p)" "$PROMPT_DIR/sinaiticus.txt"
queue_book "69920bbfe0a548a13d885514" "Sinaiticus - NT (337p)" "$PROMPT_DIR/sinaiticus.txt"
queue_book "69920bc6e0a548a13d885667" "Sinaiticus - OT (527p)" "$PROMPT_DIR/sinaiticus.txt"

echo ""
echo "=== Queuing Zohar ==="
queue_book "6990630be7b7642c081de08b" "Zohar Cremona (548p)" "$PROMPT_DIR/zohar.txt"
queue_book "6990633def12272ffdc907b0" "Zohar Mantua (612p)" "$PROMPT_DIR/zohar.txt"
queue_book "699067ef249ce014347d4e4f" "Zohar Book of Splendour (655p)" "$PROMPT_DIR/zohar.txt"

echo ""
echo "=== Queuing Rig Veda ==="
queue_book "69920bd5e0a548a13d886144" "Rig Veda Vol 1 (1042p)" "$PROMPT_DIR/rigveda.txt"
queue_book "69920bdbe0a548a13d886f1d" "Rig Veda Vol 2 (1098p)" "$PROMPT_DIR/rigveda.txt"
queue_book "699209a9bed8f4b5ff5b1fd0" "Rig Veda Vol 3 (1062p)" "$PROMPT_DIR/rigveda.txt"
queue_book "69920be3e0a548a13d887575" "Rig Veda Vol 4 (1084p)" "$PROMPT_DIR/rigveda.txt"
queue_book "69920beee0a548a13d887aeb" "Rig Veda Vol 5 (1086p)" "$PROMPT_DIR/rigveda.txt"

echo ""
echo "=== Queuing Kircher Oedipus Aegyptiacus ==="
queue_book "695273a1ab34727b1f049baf" "Oedipus Vol II (577p)" "$PROMPT_DIR/kircher.txt"
queue_book "695273a7ab34727b1f04a708" "Oedipus Vol III (645p)" "$PROMPT_DIR/kircher.txt"
queue_book "694f4a642bef28522211754c" "Oedipus Vol II-alt (590p)" "$PROMPT_DIR/kircher.txt"

echo ""
echo "=== Done ==="

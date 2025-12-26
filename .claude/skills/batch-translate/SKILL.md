---
name: batch-translate
description: Batch process books through the complete pipeline - generate cropped images for split pages, OCR all pages, then translate with context. Use when asked to process, OCR, translate, or batch process one or more books.
---

# Batch Book Translation Workflow

Process books through the complete pipeline: Crop → OCR → Translate

## Overview

This workflow handles the full processing pipeline for historical book scans:
1. **Generate Cropped Images** - For split two-page spreads, extract individual pages
2. **OCR** - Extract text from page images using Gemini vision
3. **Translate** - Translate OCR'd text with prior page context for continuity

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/books` | List all books |
| `GET /api/books/BOOK_ID` | Get book with all pages |
| `POST /api/jobs` | Create a processing job |
| `POST /api/jobs/JOB_ID/process` | Process next chunk of a job |
| `POST /api/process/batch-ocr` | OCR up to 5 pages directly |
| `POST /api/process/batch-translate` | Translate up to 10 pages directly |

## Models

| Model ID | Description | Best For |
|----------|-------------|----------|
| `gemini-3-flash-preview` | Best quality, handles complex layouts | Tables, symbols, difficult text |
| `gemini-2.5-flash` | Good balance of speed/quality | Normal text (recommended default) |
| `gemini-2.0-flash` | Fast and cheap | Simple, clear text |

## Step 1: Analyze Book Status

First, check what work is needed for a book:

```bash
# Get book and analyze page status
curl -s "https://sourcelibrary-v2.vercel.app/api/books/BOOK_ID" > /tmp/book.json

# Count pages by status (IMPORTANT: check length > 0, not just existence - empty strings are truthy!)
jq '{
  title: .title,
  total_pages: (.pages | length),
  split_pages: [.pages[] | select(.crop)] | length,
  needs_crop: [.pages[] | select(.crop) | select(.cropped_photo | not)] | length,
  has_ocr: [.pages[] | select((.ocr.data // "") | length > 0)] | length,
  needs_ocr: [.pages[] | select((.ocr.data // "") | length == 0)] | length,
  has_translation: [.pages[] | select((.translation.data // "") | length > 0)] | length,
  needs_translation: [.pages[] | select((.ocr.data // "") | length > 0) | select((.translation.data // "") | length == 0)] | length
}' /tmp/book.json
```

### Detecting Bad OCR

Pages that were OCR'd before cropped images were generated have incorrect OCR (contains both pages of the spread). Detect these:

```bash
# Find pages with crop data + OCR but missing cropped_photo at OCR time
# These often contain "two-page" or "spread" in the OCR text
jq '[.pages[] | select(.crop) | select(.ocr.data) |
  select(.ocr.data | test("two-page|spread"; "i"))] | length' /tmp/book.json
```

## Step 2: Generate Cropped Images

For books with split two-page spreads, generate individual page images:

```bash
# Get page IDs needing crops
CROP_IDS=$(jq '[.pages[] | select(.crop) | select(.cropped_photo | not) | .id]' /tmp/book.json)

# Create crop job
curl -s -X POST "https://sourcelibrary-v2.vercel.app/api/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"generate_cropped_images\",
    \"book_id\": \"BOOK_ID\",
    \"book_title\": \"BOOK_TITLE\",
    \"page_ids\": $CROP_IDS
  }"
```

Process the job:

```bash
# Trigger processing (40 pages per request, auto-continues)
curl -s -X POST "https://sourcelibrary-v2.vercel.app/api/jobs/JOB_ID/process"
```

## Step 3: OCR Pages

### Option A: Using Job System (for large batches)

```bash
# Get page IDs needing OCR
OCR_IDS=$(jq '[.pages[] | select(.ocr.data | not) | .id]' /tmp/book.json)

# Create OCR job
curl -s -X POST "https://sourcelibrary-v2.vercel.app/api/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"batch_ocr\",
    \"book_id\": \"BOOK_ID\",
    \"book_title\": \"BOOK_TITLE\",
    \"model\": \"gemini-3-flash-preview\",
    \"language\": \"Latin\",
    \"page_ids\": $OCR_IDS
  }"
```

### Option B: Using Batch API Directly (for small batches or overwrites)

```bash
# OCR with overwrite (for fixing bad OCR)
curl -s -X POST "https://sourcelibrary-v2.vercel.app/api/process/batch-ocr" \
  -H "Content-Type: application/json" \
  -d '{
    "pages": [
      {"pageId": "PAGE_ID_1", "imageUrl": "", "pageNumber": 0},
      {"pageId": "PAGE_ID_2", "imageUrl": "", "pageNumber": 0}
    ],
    "language": "Latin",
    "model": "gemini-3-flash-preview",
    "overwrite": true
  }'
```

The batch-ocr API automatically uses `cropped_photo` when available.

## Step 4: Translate Pages

### Option A: Using Job System

```bash
# Get page IDs needing translation (must have OCR)
TRANS_IDS=$(jq '[.pages[] | select(.ocr.data) | select(.translation.data | not) | .id]' /tmp/book.json)

# Create translation job
curl -s -X POST "https://sourcelibrary-v2.vercel.app/api/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"batch_translate\",
    \"book_id\": \"BOOK_ID\",
    \"book_title\": \"BOOK_TITLE\",
    \"model\": \"gemini-3-flash-preview\",
    \"language\": \"Latin\",
    \"page_ids\": $TRANS_IDS
  }"
```

### Option B: Using Batch API with Context

For better continuity, translate with previous page context:

```bash
# Get pages sorted by page number with OCR text
PAGES=$(jq '[.pages | sort_by(.page_number) | .[] |
  select(.ocr.data) | select(.translation.data | not) |
  {pageId: .id, ocrText: .ocr.data, pageNumber: .page_number}]' /tmp/book.json)

# Translate with context (process in batches of 5-10)
curl -s -X POST "https://sourcelibrary-v2.vercel.app/api/process/batch-translate" \
  -H "Content-Type: application/json" \
  -d "{
    \"pages\": $BATCH,
    \"model\": \"gemini-3-flash-preview\",
    \"sourceLanguage\": \"Latin\",
    \"targetLanguage\": \"English\",
    \"previousContext\": \"PREVIOUS_PAGE_TRANSLATION_TEXT\"
  }"
```

## Complete Book Processing Script

Process a single book through the full pipeline:

```bash
#!/bin/bash
BOOK_ID="YOUR_BOOK_ID"
MODEL="gemini-3-flash-preview"
BASE_URL="https://sourcelibrary-v2.vercel.app"

# 1. Fetch book data
echo "Fetching book..."
BOOK=$(curl -s "$BASE_URL/api/books/$BOOK_ID")
TITLE=$(echo "$BOOK" | jq -r '.title[0:40]')
echo "Processing: $TITLE"

# 2. Generate missing crops
NEEDS_CROP=$(echo "$BOOK" | jq '[.pages[] | select(.crop) | select(.cropped_photo | not)] | length')
if [ "$NEEDS_CROP" != "0" ]; then
  echo "Generating $NEEDS_CROP cropped images..."
  CROP_IDS=$(echo "$BOOK" | jq '[.pages[] | select(.crop) | select(.cropped_photo | not) | .id]')
  JOB=$(curl -s -X POST "$BASE_URL/api/jobs" -H "Content-Type: application/json" \
    -d "{\"type\":\"generate_cropped_images\",\"book_id\":\"$BOOK_ID\",\"page_ids\":$CROP_IDS}")
  JOB_ID=$(echo "$JOB" | jq -r '.job.id')

  while true; do
    RESULT=$(curl -s -X POST "$BASE_URL/api/jobs/$JOB_ID/process")
    [ "$(echo "$RESULT" | jq -r '.done')" = "true" ] && break
    sleep 2
  done
  echo "Crops complete!"
  BOOK=$(curl -s "$BASE_URL/api/books/$BOOK_ID")
fi

# 3. OCR missing pages
NEEDS_OCR=$(echo "$BOOK" | jq '[.pages[] | select(.ocr.data | not)] | length')
if [ "$NEEDS_OCR" != "0" ]; then
  echo "OCRing $NEEDS_OCR pages..."
  OCR_IDS=$(echo "$BOOK" | jq '[.pages[] | select(.ocr.data | not) | .id]')

  TOTAL=$(echo "$OCR_IDS" | jq 'length')
  for ((i=0; i<TOTAL; i+=5)); do
    BATCH=$(echo "$OCR_IDS" | jq ".[$i:$((i+5))] | [.[] | {pageId: ., imageUrl: \"\", pageNumber: 0}]")
    curl -s -X POST "$BASE_URL/api/process/batch-ocr" -H "Content-Type: application/json" \
      -d "{\"pages\":$BATCH,\"model\":\"$MODEL\"}" > /dev/null
    echo -n "."
  done
  echo " OCR complete!"
  BOOK=$(curl -s "$BASE_URL/api/books/$BOOK_ID")
fi

# 4. Translate with context
NEEDS_TRANS=$(echo "$BOOK" | jq '[.pages[] | select(.ocr.data) | select(.translation.data | not)] | length')
if [ "$NEEDS_TRANS" != "0" ]; then
  echo "Translating $NEEDS_TRANS pages..."
  PAGES=$(echo "$BOOK" | jq '[.pages | sort_by(.page_number) | .[] |
    select(.ocr.data) | select(.translation.data | not) |
    {pageId: .id, ocrText: .ocr.data, pageNumber: .page_number}]')

  TOTAL=$(echo "$PAGES" | jq 'length')
  PREV_CONTEXT=""

  for ((i=0; i<TOTAL; i+=5)); do
    BATCH=$(echo "$PAGES" | jq ".[$i:$((i+5))]")

    if [ -n "$PREV_CONTEXT" ]; then
      RESP=$(curl -s -X POST "$BASE_URL/api/process/batch-translate" -H "Content-Type: application/json" \
        -d "{\"pages\":$BATCH,\"model\":\"$MODEL\",\"previousContext\":$(echo "$PREV_CONTEXT" | jq -Rs .)}")
    else
      RESP=$(curl -s -X POST "$BASE_URL/api/process/batch-translate" -H "Content-Type: application/json" \
        -d "{\"pages\":$BATCH,\"model\":\"$MODEL\"}")
    fi

    # Get last translation for context
    LAST_ID=$(echo "$BATCH" | jq -r '.[-1].pageId')
    PREV_CONTEXT=$(echo "$RESP" | jq -r ".translations[\"$LAST_ID\"] // \"\"" | head -c 1500)
    echo -n "."
  done
  echo " Translation complete!"
fi

echo "Book processing complete!"
```

## Fixing Bad OCR

When pages were OCR'd before cropped images existed, they contain text from both pages. Fix with:

```bash
# 1. Generate cropped images first (Step 2 above)

# 2. Find pages with bad OCR
BAD_OCR_IDS=$(jq '[.pages[] | select(.crop) | select(.ocr.data) |
  select(.ocr.data | test("two-page|spread"; "i")) | .id]' /tmp/book.json)

# 3. Re-OCR with overwrite
TOTAL=$(echo "$BAD_OCR_IDS" | jq 'length')
for ((i=0; i<TOTAL; i+=5)); do
  BATCH=$(echo "$BAD_OCR_IDS" | jq ".[$i:$((i+5))] | [.[] | {pageId: ., imageUrl: \"\", pageNumber: 0}]")
  curl -s -X POST "https://sourcelibrary-v2.vercel.app/api/process/batch-ocr" \
    -H "Content-Type: application/json" \
    -d "{\"pages\":$BATCH,\"model\":\"gemini-3-flash-preview\",\"overwrite\":true}"
done
```

## Processing All Books

To process all books in the library:

```bash
# Get all book IDs
curl -s "https://sourcelibrary-v2.vercel.app/api/books" | jq -r '.[] | .id' > /tmp/book_ids.txt

# Process each book
while read -r BOOK_ID; do
  # Run the single-book script above for each
  ./process_book.sh "$BOOK_ID"
done < /tmp/book_ids.txt
```

## Monitoring Progress

Check overall library status:

```bash
curl -s "https://sourcelibrary-v2.vercel.app/api/books" | jq '[.[] | {
  title: .title[0:30],
  pages: .pages_count,
  ocr: .ocr_count,
  translated: .translation_count
}] | sort_by(-.pages)'
```

## Troubleshooting

### Rate Limits (429 errors)
- Add `sleep 1` between API calls
- Use smaller batch sizes (3 instead of 5)
- The system has API key rotation built-in

### Function Timeouts
- Jobs have `maxDuration=300s` for Vercel Pro
- If hitting timeouts, reduce `CROP_CHUNK_SIZE` in job processing

### Missing Cropped Photos
- Check if crop job completed successfully
- Verify page has `crop` data with `xStart` and `xEnd`
- Re-run crop generation for specific pages

### Bad OCR Detection
Look for these patterns in OCR text indicating wrong image was used:
- "two-page spread"
- "left page" / "right page" descriptions
- Duplicate text blocks
- References to facing pages

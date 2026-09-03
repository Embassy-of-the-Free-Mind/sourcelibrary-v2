---
name: batch-translate
description: Batch process books through the complete pipeline - generate cropped images for split pages, OCR all pages, then translate with context. Use when asked to process, OCR, translate, or batch process one or more books.
---

# Batch Book Translation Workflow

Process books through the complete pipeline: Crop → OCR → Translate

## Current-state corrections — read before using any recipe below (verified 2026-08-29)

Three parts of this doc drifted from production; the recipes are kept for reference
but these corrections win:

1. **`POST /api/jobs/queue-books` requires auth and a different payload.** Send
   `Authorization: Bearer $CRON_SECRET`, and the body takes singular `bookId` plus an
   explicit `pageIds` array (`{"bookId": "...", "pageIds": [...], "action": "ocr"}`).
   The unauthenticated plural-`bookIds` examples below return 401 / missing-fields.

2. **Every jq status recipe below is dead for anonymous callers.** The public
   `GET /api/books/[id]` no longer includes `pages[].ocr.data` or
   `pages[].translation.data` (side effect of the per-caller harvest budgets, #4306),
   so `select((.ocr.data // "") | length > 0)` counts **0 on a fully-OCR'd book**.
   This produced a false "stalled at 0/592" alarm on 2026-08-28. Count in Mongo instead:

   ```bash
   set -a; source .env.production.local; set +a
   node -e "const {MongoClient}=require('mongodb');(async()=>{const c=new MongoClient(process.env.MONGODB_URI);await c.connect();
   const p=c.db('bookstore').collection('pages');
   console.log('ocr:',await p.countDocuments({book_id:'BOOK_ID','ocr.data':{\$exists:true,\$ne:''}}),
   'translated:',await p.countDocuments({book_id:'BOOK_ID','translation.data':{\$exists:true,\$ne:''}}));
   await c.close()})()"
   ```

   Positive-control any monitor built on a count: verify it reads nonzero on a
   known-processed book before trusting its zero.

3. **While the pipeline line is paused (#3826), prefer the local scripts** over the
   Lambda queue: `scripts/batch/bulk-reocr-local.mjs --new-only --book-id=<id>` for OCR
   (Gemini Batch API, ~$0.0008/page; caps at 500 pages/run — rerun until clean; collect
   early with `scripts/batch/collect-batch-results.mjs`) and
   `scripts/batch/queue-translations.mjs --book-id=<id>` for translation (direct SQS,
   FIFO prior-page context, tags `initiated_by`). A page whose OCR marks it
   `<page-type>blank</page-type>` never receives `translation.data` — a book that
   plateaus at N−1 with only a stamp/blank leaf missing is complete, not stalled.

## Roadmap Reference

See `.claude/ROADMAP.md` for the translation priority list.

**Priority 1 = UNTRANSLATED** - These are highest priority for processing:
- Kircher encyclopedias (Oedipus, Musurgia, Ars Magna Lucis)
- Fludd: Utriusque Cosmi Historia
- Theatrum Chemicum, Musaeum Hermeticum
- Cardano: De Subtilitate
- Della Porta: Magia Naturalis
- Lomazzo, Poliziano, Landino

```bash
# Get roadmap with priorities
curl -s "https://sourcelibrary.org/api/books/roadmap" | jq '.books[] | select(.priority == 1) | {title, notes}'
```

Roadmap source: `src/app/api/books/roadmap/route.ts`

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
| `POST /api/jobs/queue-books` | Queue pages for Lambda worker processing (primary path) |
| `GET /api/jobs` | List processing jobs |
| `POST /api/jobs/JOB_ID/retry` | Retry failed pages in a job |
| `POST /api/jobs/JOB_ID/cancel` | Cancel a running job |
| `POST /api/books/BOOK_ID/batch-ocr-async` | Submit Gemini Batch API OCR job (50% cheaper, ~24h) |
| `POST /api/books/BOOK_ID/batch-translate-async` | Submit Gemini Batch API translation job |

## Processing Options

### Option 1: Lambda Workers via Job System (Primary Path)

The primary processing path uses AWS Lambda workers via SQS queues. Each page is processed independently with automatic job tracking.

```bash
# Queue OCR for a book's pages
curl -s -X POST "https://sourcelibrary.org/api/jobs/queue-books" \
  -H "Content-Type: application/json" \
  -d '{"bookIds": ["BOOK_ID"], "action": "ocr"}'

# Queue translation
curl -s -X POST "https://sourcelibrary.org/api/jobs/queue-books" \
  -H "Content-Type: application/json" \
  -d '{"bookIds": ["BOOK_ID"], "action": "translation"}'

# Queue image extraction
curl -s -X POST "https://sourcelibrary.org/api/jobs/queue-books" \
  -H "Content-Type: application/json" \
  -d '{"bookIds": ["BOOK_ID"], "action": "image_extraction"}'
```

**Model selection:** Don't hardcode a model — prefer `getModelForBook(book)` from `src/lib/types/ai-models.ts`, which routes BPH books and non-Latin-script languages to `gemini-3-flash-preview` (full quality) and everything else to `gemini-3.1-flash-lite-preview` (50% cheaper, comparable quality on Latin script). If you must specify a model in a job payload, pick based on this rule. Never use Gemini below v3 (`gemini-2.x` is deprecated).

### Option 2: Gemini Batch API (50% Cheaper, Automated Pipeline)

The post-import-pipeline cron uses Gemini Batch API for automated processing of newly imported books. Results arrive in ~24 hours at 50% cost.

| Job Type | API | Model | Cost |
|----------|-----|-------|------|
| Single page | Realtime (Lambda) | per `getModelForBook(book)` | Full price |
| batch_ocr | Batch API | per `getModelForBook(book)` | **50% off** |
| batch_translate | Batch API | per `getModelForBook(book)` | **50% off** |

Stacking discounts: lite + Batch API on a Latin-script non-BPH book is ~75% off full flash realtime.

## OCR Output Format

OCR uses **Markdown output** with semantic tags:

### Markdown Formatting
- `# ## ###` for headings (bigger text = bigger heading)
- `**bold**`, `*italic*` for emphasis
- `->centered text<-` for centered lines (NOT for headings)
- `> blockquotes` for quotes/prayers
- `---` for dividers
- Tables only for actual tabular data

### Metadata Tags (hidden from readers)
| Tag | Purpose |
|-----|---------|
| `<lang>X</lang>` | Detected language |
| `<page-num>N</page-num>` | Page/folio number |
| `<header>X</header>` | Running headers |
| `<sig>X</sig>` | Printer's marks (A2, B1) |
| `<meta>X</meta>` | Hidden metadata |
| `<warning>X</warning>` | Quality issues |
| `<vocab>X</vocab>` | Key terms for indexing |

### Inline Annotations (visible to readers)
| Tag | Purpose |
|-----|---------|
| `<margin>X</margin>` | Marginal notes (before paragraph) |
| `<gloss>X</gloss>` | Interlinear annotations |
| `<insert>X</insert>` | Boxed text, additions |
| `<unclear>X</unclear>` | Illegible readings |
| `<note>X</note>` | Interpretive notes |
| `<term>X</term>` | Technical vocabulary |
| `<image-desc>X</image-desc>` | Describe illustrations |

### Critical OCR Rules
1. Preserve original spelling, capitalization, punctuation
2. Page numbers/headers/signatures go in metadata tags only
3. IGNORE partial text at edges (from facing page in spread)
4. Describe images/diagrams with `<image-desc>`, never tables
5. End with `<vocab>key terms, names, concepts</vocab>`

## Step 1: Analyze Book Status

First, check what work is needed for a book:

```bash
# Get book and analyze page status
curl -s "https://sourcelibrary.org/api/books/BOOK_ID" > /tmp/book.json

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
curl -s -X POST "https://sourcelibrary.org/api/jobs" \
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
curl -s -X POST "https://sourcelibrary.org/api/jobs/JOB_ID/process"
```

## Step 3: OCR Pages

### Option A: Using Job System (for large batches)

```bash
# Get page IDs needing OCR (check for empty strings, not just null)
OCR_IDS=$(jq '[.pages[] | select((.ocr.data // "") | length == 0) | .id]' /tmp/book.json)

# Create OCR job
curl -s -X POST "https://sourcelibrary.org/api/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"batch_ocr\",
    \"book_id\": \"BOOK_ID\",
    \"book_title\": \"BOOK_TITLE\",
    \"model\": \"gemini-3.1-flash-lite-preview\",
    \"language\": \"Latin\",
    \"page_ids\": $OCR_IDS
  }"
```

### Option B: Using Lambda Workers with Page IDs

```bash
# OCR specific pages (including overwrite)
curl -s -X POST "https://sourcelibrary.org/api/jobs/queue-books" \
  -H "Content-Type: application/json" \
  -d '{
    "bookIds": ["BOOK_ID"],
    "action": "ocr",
    "pageIds": ["PAGE_ID_1", "PAGE_ID_2"],
    "overwrite": true
  }'
```

Lambda workers automatically use `cropped_photo` when available.

## Step 4: Translate Pages

### Option A: Using Job System

```bash
# Get page IDs needing translation (must have OCR content, check for empty strings)
TRANS_IDS=$(jq '[.pages[] | select((.ocr.data // "") | length > 0) | select((.translation.data // "") | length == 0) | .id]' /tmp/book.json)

# Create translation job
curl -s -X POST "https://sourcelibrary.org/api/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"batch_translate\",
    \"book_id\": \"BOOK_ID\",
    \"book_title\": \"BOOK_TITLE\",
    \"model\": \"gemini-3.1-flash-lite-preview\",
    \"language\": \"Latin\",
    \"page_ids\": $TRANS_IDS
  }"
```

### Option B: Using Lambda Workers (Recommended)

Lambda FIFO queue automatically provides previous page context for translation continuity:

```bash
# Queue translation for pages that have OCR but no translation
curl -s -X POST "https://sourcelibrary.org/api/jobs/queue-books" \
  -H "Content-Type: application/json" \
  -d '{"bookIds": ["BOOK_ID"], "action": "translation"}'
```

The translation Lambda worker processes pages sequentially via FIFO queue and fetches the previous page's translation for context.

## Complete Book Processing Script

Process a single book through the full pipeline using Lambda workers:

```bash
#!/bin/bash
BOOK_ID="YOUR_BOOK_ID"
BASE_URL="https://sourcelibrary.org"

# 1. Fetch book data
echo "Fetching book..."
BOOK=$(curl -s "$BASE_URL/api/books/$BOOK_ID")
TITLE=$(echo "$BOOK" | jq -r '.title[0:40]')
echo "Processing: $TITLE"

# 2. Queue OCR (Lambda workers handle all pages automatically)
NEEDS_OCR=$(echo "$BOOK" | jq '[.pages[] | select((.ocr.data // "") | length == 0)] | length')
if [ "$NEEDS_OCR" != "0" ]; then
  echo "Queueing OCR for $NEEDS_OCR pages..."
  curl -s -X POST "$BASE_URL/api/jobs/queue-books" \
    -H "Content-Type: application/json" \
    -d "{\"bookIds\": [\"$BOOK_ID\"], \"action\": \"ocr\"}"
  echo "OCR job queued!"
fi

# 3. Queue translation (after OCR completes — check /jobs page)
NEEDS_TRANS=$(echo "$BOOK" | jq '[.pages[] | select((.ocr.data // "") | length > 0) | select((.translation.data // "") | length == 0)] | length')
if [ "$NEEDS_TRANS" != "0" ]; then
  echo "Queueing translation for $NEEDS_TRANS pages..."
  curl -s -X POST "$BASE_URL/api/jobs/queue-books" \
    -H "Content-Type: application/json" \
    -d "{\"bookIds\": [\"$BOOK_ID\"], \"action\": \"translation\"}"
  echo "Translation job queued!"
fi

echo "Jobs queued! Monitor progress at $BASE_URL/jobs"
```

## Fixing Bad OCR

When pages were OCR'd before cropped images existed, they contain text from both pages. Fix with:

```bash
# 1. Generate cropped images first (Step 2 above)

# 2. Find pages with bad OCR
BAD_OCR_IDS=$(jq '[.pages[] | select(.crop) | select(.ocr.data) |
  select(.ocr.data | test("two-page|spread"; "i")) | .id]' /tmp/book.json)

# 3. Re-OCR with overwrite via Lambda workers
curl -s -X POST "https://sourcelibrary.org/api/jobs/queue-books" \
  -H "Content-Type: application/json" \
  -d "{\"bookIds\": [\"BOOK_ID\"], \"action\": \"ocr\", \"pageIds\": $BAD_OCR_IDS, \"overwrite\": true}"
```

## Processing All Books

Use the Lambda worker job system for bulk processing:

```bash
#!/bin/bash
BASE_URL="https://sourcelibrary.org"

# Get all book IDs
BOOK_IDS=$(curl -s "$BASE_URL/api/books" | jq -r '[.[].id]')

# Queue OCR for all books (Lambda workers handle parallelism and rate limiting)
curl -s -X POST "$BASE_URL/api/jobs/queue-books" \
  -H "Content-Type: application/json" \
  -d "{\"bookIds\": $BOOK_IDS, \"action\": \"ocr\"}"

# After OCR completes, queue translation
curl -s -X POST "$BASE_URL/api/jobs/queue-books" \
  -H "Content-Type: application/json" \
  -d "{\"bookIds\": $BOOK_IDS, \"action\": \"translation\"}"
```

Monitor progress at https://sourcelibrary.org/jobs

## Monitoring Progress

Check overall library status:

```bash
curl -s "https://sourcelibrary.org/api/books" | jq '[.[] | {
  title: .title[0:30],
  pages: .pages_count,
  ocr: .ocr_count,
  translated: .translation_count
}] | sort_by(-.pages)'
```

## Troubleshooting

### Empty Strings vs Null (CRITICAL)
In jq, empty strings `""` are truthy! This means:
- `select(.ocr.data)` matches pages with `""` (WRONG)
- `select(.ocr.data | not)` does NOT match pages with `""` (WRONG)
- Use `select((.ocr.data // "") | length == 0)` to find missing/empty OCR
- Use `select((.ocr.data // "") | length > 0)` to find pages WITH OCR content

### Rate Limits (429 errors)

#### Gemini API Tiers
| Tier | RPM | How to Qualify |
|------|-----|----------------|
| Free | 15 | Default |
| Tier 1 | 300 | Enable billing + $50 spend |
| Tier 2 | 1000 | $250 spend |
| Tier 3 | 2000 | $1000 spend |

#### Optimal Sleep Times by Tier
| Tier | Max RPM | Safe Sleep Time | Effective Rate |
|------|---------|-----------------|----------------|
| Free | 15 | 4.0s | ~15/min |
| Tier 1 | 300 | 0.4s | ~150/min |
| Tier 2 | 1000 | 0.12s | ~500/min |
| Tier 3 | 2000 | 0.06s | ~1000/min |

**Note:** Use ~50% of max rate to leave headroom for bursts.

#### API Key Rotation
The system supports multiple API keys for higher throughput:
- Set `GEMINI_API_KEY` (primary)
- Set `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, ... up to `GEMINI_API_KEY_10`
- Keys rotate automatically with 60s cooldown after rate limit

With N keys at Tier 1, you get N × 300 RPM = N × 150 safe req/min

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

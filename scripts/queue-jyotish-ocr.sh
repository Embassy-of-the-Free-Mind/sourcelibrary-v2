#!/bin/bash
# Queue OCR for all jyotish books imported in Session 029
# Uses Lambda workers via queue-books endpoint

BASE_URL="https://sourcelibrary.org"
QUEUED=0
FAILED=0
SKIPPED=0
TOTAL_PAGES=0

# All 190 jyotish book IDs from Session 029 (Batches 1-27)
BOOK_IDS=(
  # Batch 1-7 (from first continuation)
  69905f3d40bc3a0478efb0a8
  69905f4140bc3a0478efb47b
  69905f4440bc3a0478efb9b2
  69905f4640bc3a0478efbc86
  69905f4940bc3a0478efc423
  69905f4a40bc3a0478efc4b1
  69905f5340bc3a0478efc535
  699060198cbcc9a4dba2c10a
  6990601c8cbcc9a4dba2c47a
  6990601f8cbcc9a4dba2c624
  699060218cbcc9a4dba2c8e3
  6990605019adda121f1b17d6
  69906055ef12272ffdc8cd84
  69906304e7b7642c081dd7a9
  69906310e7b7642c081de48e
  69906461ef12272ffdc91870
  69906464ef12272ffdc91ca1
  69906467ef12272ffdc91f4e
  69906469ef12272ffdc9204a
  6990646bef12272ffdc922d6
  6990646def12272ffdc92547
  69906478ef12272ffdc92571
  6990647bef12272ffdc925d4
  6990647eef12272ffdc92999
  69906481ef12272ffdc938fc
  # Batch 8-15 (from second continuation)
  6990653d726f64800c10a280
  69906540726f64800c10a6ff
  6990654d726f64800c10b230
  69906550726f64800c10b7a9
  69906553726f64800c10b9d5
  69906559726f64800c10be77
  6990655b726f64800c10be8a
  6990656e3dc2ed39a49f0fc7
  6990659d3dc2ed39a49f1fa6
  699065422ec9f7db57179f78
  6990653e2ec9f7db57179f55
  699066532ec9f7db5717a012
  6990665c2ec9f7db5717a19a
  6990665e2ec9f7db5717a1dd
  6990666a2ec9f7db5717a293
  6990666f2ec9f7db5717a544
  699066b9249ce014347d1688
  699066c0249ce014347d18f1
  699066c3249ce014347d1d23
  699066c8249ce014347d1da1
  699066d4249ce014347d1db8
  699066d6249ce014347d1dc1
  699066db249ce014347d1df8
  699066de249ce014347d1e4c
  699066ed249ce014347d2094
  699066f2249ce014347d20d5
  699066f5249ce014347d21b6
  6990670d249ce014347d2594
  69906710249ce014347d27a2
  69906715249ce014347d2ac9
  699067158da6face82f775b1
  6990671b249ce014347d2b59
  6990671e249ce014347d2d5b
  69906735249ce014347d3386
  69906737249ce014347d3654
  6990673c249ce014347d3706
  6990674b249ce014347d38b2
  6990674f249ce014347d3a94
  69906756249ce014347d3b0c
  69906760249ce014347d3b97
  69906763249ce014347d3bc2
  69906766249ce014347d3c2a
  699067708da6face82f775dc
  # Batch 16-17
  6990681a249ce014347d55cf
  69906821249ce014347d5660
  69906825249ce014347d5b25
  69906828249ce014347d5b4d
  69906834249ce014347d5cef
  6990683c249ce014347d5ede
  699068458da6face82f77c58
  699068be90f6a221d3a9a7fa
  6990687b249ce014347d648c
  6990687d249ce014347d64b7
  69906880249ce014347d6584
  69906883249ce014347d6632
  69906885249ce014347d66a6
  6990688a249ce014347d6c74
  699068a18034a3640265bd30
  # Batch 18-19
  699068c290f6a221d3a9a8c2
  699068c790f6a221d3a9a90f
  699068e42e4efe9106769c67
  699068e72e4efe9106769d4e
  699068ea2e4efe9106769e41
  699068ed2e4efe910676a6a3
  699068f92f82e0fda4803d74
  699068fd2f82e0fda4803ec9
  699069002f82e0fda480401e
  699069022f82e0fda480408c
  699069172f82e0fda4804135
  6990691a2f82e0fda480421d
  6990691e2f82e0fda4804229
  699069202f82e0fda4804235
  699069232f82e0fda48045ea
  699069262f82e0fda4804ae7
  # Batch 20
  6990693f2f82e0fda4805a70
  699069412f82e0fda4805ae0
  699069442f82e0fda4805caa
  699069472f82e0fda480618d
  6990694b2f82e0fda4806596
  6990694d2f82e0fda48068c9
  # Batch 21-23
  69906a47d69de0e69807024f
  69906a4ad69de0e6980706b9
  69906a4d1cf6ed5fbc8f4ee2
  69906a50d69de0e6980709ab
  69906a531cf6ed5fbc8f5096
  69906a571cf6ed5fbc8f5622
  69906a601cf6ed5fbc8f57c7
  69906a631cf6ed5fbc8f57d8
  69906a671cf6ed5fbc8f58a2
  69906a691cf6ed5fbc8f5924
  69906a6c1cf6ed5fbc8f5b3c
  69906a6f1cf6ed5fbc8f5cc5
  69906a861cf6ed5fbc8f5d21
  69906a891cf6ed5fbc8f5df0
  69906a8c1cf6ed5fbc8f5eaa
  69906a8f1cf6ed5fbc8f6943
  69906a931cf6ed5fbc8f6e0a
  69906a961cf6ed5fbc8f7135
  # Batch 24-26 (CGV manuscripts)
  69906d0664d44bd0a0ef50a1
  69906d0a64d44bd0a0ef50e9
  69906d0d64d44bd0a0ef5160
  69906d1164d44bd0a0ef51c3
  69906d1564d44bd0a0ef51f3
  69906d2364d44bd0a0ef521d
  69906d2864d44bd0a0ef524f
  69906d2c64d44bd0a0ef5275
  69906d3064d44bd0a0ef528e
  69906d3564d44bd0a0ef52a9
  69906d3964d44bd0a0ef52bf
  69906d4264d44bd0a0ef52df
  69906d4564d44bd0a0ef52ef
  69906d4964d44bd0a0ef5314
  69906d4d64d44bd0a0ef5331
  69906d5064d44bd0a0ef533c
  69906d5364d44bd0a0ef5344
  # Batch 27 (printed editions)
  69906d7364d44bd0a0ef534f
  69906d7764d44bd0a0ef574b
  69906d7a64d44bd0a0ef57b1
  69906d7f64d44bd0a0ef59da
  69906d8364d44bd0a0ef5a44
  69906d8764d44bd0a0ef5b19
)

echo "Starting OCR queue for ${#BOOK_IDS[@]} jyotish books..."
echo "=================================================="

for BOOK_ID in "${BOOK_IDS[@]}"; do
  # Get page IDs without OCR
  PAGE_IDS=$(curl -s "$BASE_URL/api/books/$BOOK_ID?pages=nav" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    pages = d.get('pages', [])
    ids = [p.get('id') for p in pages if not p.get('ocr', {}).get('data')]
    print(json.dumps(ids))
except:
    print('[]')
" 2>/dev/null)

  PAGE_COUNT=$(echo "$PAGE_IDS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)

  if [ "$PAGE_COUNT" = "0" ] || [ -z "$PAGE_COUNT" ]; then
    echo "SKIP $BOOK_ID (no pages need OCR)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Submit OCR job
  RESULT=$(curl -s -X POST "$BASE_URL/api/jobs/queue-books" \
    -H "Content-Type: application/json" \
    -d "{\"bookId\":\"$BOOK_ID\",\"pageIds\":$PAGE_IDS,\"action\":\"ocr\"}")

  SUCCESS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',''))" 2>/dev/null)

  if [ "$SUCCESS" = "True" ]; then
    QUEUED=$((QUEUED + 1))
    TOTAL_PAGES=$((TOTAL_PAGES + PAGE_COUNT))
    echo "OK   $BOOK_ID ($PAGE_COUNT pages) [total: $TOTAL_PAGES pages queued]"
  else
    ERROR=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null)
    echo "FAIL $BOOK_ID ($PAGE_COUNT pages) - $ERROR"
    FAILED=$((FAILED + 1))
  fi

  # Small delay to avoid overwhelming the API
  sleep 0.5
done

echo "=================================================="
echo "DONE: Queued=$QUEUED Failed=$FAILED Skipped=$SKIPPED TotalPages=$TOTAL_PAGES"

# BPH page-dedup workflow (SHA-256 + OCR)

The goal: hide duplicate page uploads (same physical scan uploaded twice, or
the same content re-encoded) without re-sequencing visible pages — so citations
and external links stay valid.

## Why this exists

Earlier this session we tried a 9×8 perceptual hash (dHash) for dedup. It
over-grouped text-heavy pages with similar column structure/margins/line
density: pages that looked statistically similar at 9×8 grayscale but had
completely different printed content. Rolled back ~1,600 hidden pages across
~290 books once the error was caught visually.

The current approach uses two **strong, independent** signals:

1. **SHA-256 of the cropped image bytes** — exact match catches "same scan
   uploaded twice." Zero false positives (collision probability ≈ 2⁻²⁵⁶).
2. **OCR-text Jaccard ≥ 0.95** on word trigrams + Gemini-vision verification —
   catches re-encoded uploads (different bytes, same content).

SHA matches apply silently (cannot false-positive). OCR matches go through
Gemini-3-flash vision: "are these the same printed page?" — only applied when
vision says SAME. Anything else queues for human review.

See `memory/lesson-dedup-method-failures.md` for the full retrospective.

## Workflow

```bash
set -a; source .env.production.local; set +a
```

1. **Scan books** (writes proposals to `.claude/docs/dedup-proposals/<id>.json`):

   ```bash
   node scripts/dedup-scan-strict.mjs --book <id>
   node scripts/dedup-scan-strict.mjs --book-list /tmp/ids.txt --concurrency 4
   ```

2. **Autoapply** (SHA silently, OCR via vision-verify, ambiguous to queue):

   ```bash
   node scripts/dedup-autoapply.mjs --in-dir .claude/docs/dedup-proposals
   ```

   Snapshots go to `.claude/docs/snapshots/dedup-reviewed-<id>-<ts>.json`
   (timestamped — never overwritten).

3. **Library-wide batch driver** (used by Phase 2):

   ```bash
   bash scripts/phase2-scan-and-apply.sh   # iterates /tmp/phase2-ids.txt
   ```

4. **Review ambiguous pairs** (Gemini said DIFFERENT or UNSURE):

   ```bash
   node scripts/dedup-review-queue-build.mjs
   open /tmp/dedup-review/queue.html
   # User accepts/rejects in browser → exports JSON → paste back → apply
   node scripts/dedup-apply-approved.mjs --in /tmp/decisions.json
   ```

5. **Spot-check a random sample of auto-applied pairs:**

   ```bash
   node scripts/dedup-sample-review.mjs --ocr --n 20    # OCR-only sample
   open /tmp/dedup-sample-ocr-*.html
   ```

6. **Gallery cleanup** (multiple `gallery_images` entries for same page+image):

   ```bash
   node scripts/dedup-gallery-within-book.mjs --provider bph --dry-run
   node scripts/dedup-gallery-within-book.mjs --provider bph --apply
   ```

## Hide-only semantics

A dedup mark sets the page's `page_number` negative (`-original_page_number`)
and adds `is_duplicate: true`, `duplicate_of: <canon._id>`. The page doc and
all its OCR/translation/embeddings stay intact. The reading view, search, and
gallery filter `page_number > 0` (or `book_visible: true` for gallery), so
hidden pages drop out of UX without losing data.

**Citations stay valid** because surviving pages keep their original
`page_number` — no re-sequencing. Visible pages may have gaps in the sequence
(e.g., 1,2,…,99,101,…) which is fine: readers iterate visible pages by sort
order, not by index value.

## Emergency rollback

If a batch goes wrong:

```bash
# 1. Targeted (single book, when its dedup-reviewed-*.json snapshot exists):
node -e "..."  # restore from snapshot (build similar to undo-spread-dedup.mjs)

# 2. Brute-force across all BPH books with hidden pages
#    (skips legitimately-hidden `archived-spread` page_type):
node scripts/force-restore-hidden-pages.mjs --dry-run
node scripts/force-restore-hidden-pages.mjs --apply
```

After restoring, run `node scripts/recount-pages-count-deduped.mjs` to fix
`books.pages_count`.

## Code touch-points

| File | Why it matters |
|---|---|
| `src/lib/atlas-search.ts` | Page search must filter `page_number > 0` |
| `src/app/api/search/route.ts` | Belt-and-suspenders `$match` after `$search` |
| `scripts/workers/sync-worker.mjs` | The pages_count cron must filter `page_number > 0` or it re-inflates counts every 6 h |
| `src/app/api/admin/sync-page-counts/route.ts` | Same filter for the admin recount endpoint |

## Transient dirs (gitignored)

- `.claude/docs/dedup-proposals/` — current scan output, consumed by autoapply
- `.claude/docs/dedup-proposals-staging/` — batch staging during phase2.sh
- `.claude/docs/dedup-proposals-applied/` — archive of consumed proposals
- `.claude/docs/dedup-review-queue/` — ambiguous OCR pairs awaiting human review
- `.claude/docs/dedup-review-queue-resolved/` — archived after resolution
- `.claude/docs/snapshots/dedup-reviewed-*.json` — per-apply rollback snapshots

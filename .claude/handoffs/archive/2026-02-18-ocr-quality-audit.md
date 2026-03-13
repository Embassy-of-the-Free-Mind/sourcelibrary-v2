# OCR Quality Audit & Batch Re-OCR Session — 2026-02-18

## What happened

### Prompt routing fix
Discovered that `bulk-reocr-local.mjs` was routing Latin/German books to language-specific prompts (Latin OCR v3, German OCR v3), but **all production code uses a single Standard OCR v5 prompt**. The language-specific prompts exist in the DB but no production code calls them. Fixed the script to match production behavior.

### Wrong-prompt batch jobs cancelled
- 82 batch jobs cancelled across 6 books (~2,910 pages)
- 63 cancelled on Gemini API side, all 82 in DB
- Books: Artis auriferae, Novum lumen, Colloquium Rhodostauroticum, Comenius Vestibulum, Utriusque Cosmi, Ficino Opera

### Realtime quality sampling
Ran 5 sample pages per book (at 20/40/50/60/80% positions) through Standard OCR v5 via realtime Gemini API. Results saved to DB. Quality was good across all books — proper metadata tags, column detection, blank page handling, Fraktur support.

### Ficino data loss incident
The sampling script (`tmp/realtime-ocr-sample.mjs`) used `maxOutputTokens: 8192`. With `gemini-3-flash-preview` (a thinking model), **thinking tokens consume the output budget**. Ficino's dense Latin pages triggered 7,862 thinking tokens, leaving only ~330 for actual OCR text. All 5 sampled pages were truncated to ~900 chars (from ~4,800 originals) and overwritten with no snapshot.

**Root cause:** `maxOutputTokens` is shared between thinking and output tokens. 8192 is not enough for a thinking model doing OCR on dense pages.

**Recovery:** Re-ran all 5 pages. 3 fixed with `maxOutputTokens: 16384`, 1 more with 32768 (nondeterministic thinking budget), last one fixed by disabling thinking entirely (`thinkingBudget: 0`). All 5 pages now restored to ~4,800+ chars.

**Old data is gone** — no snapshots existed, batch jobs were cancelled before collecting results, `gemini_usage` doesn't store OCR text.

### Key finding: thinking tokens
The `gemini-3-flash-preview` model uses "thinking" internally. Token usage breakdown for one Ficino page:
- With thinking: 4,600 thinking + 1,600 output = 6,200 total
- Without thinking: 0 thinking + 1,672 output = 1,672 total
- Output quality identical. **Thinking adds no value for OCR.**

One page was pathological — 31,456 thinking tokens (the model was analyzing Ficino's Neoplatonic celestial hierarchies before transcribing them).

## Changes made

### `scripts/bulk-reocr-local.mjs`
- Removed language-specific prompt routing (now always uses `{ type: 'ocr', is_default: true }`)
- Added `generationConfig` to batch requests: `temperature: 0.1`, `maxOutputTokens: 16384`, `thinkingConfig: { thinkingBudget: 0 }`

### `~/.claude/skills/daily-sourcelibrary/skill.md`
- Complete rewrite from outdated Python references to current Node.js architecture

### `.claude/docs/batch-processing.md`
- Added sections: Local Bulk Processing, Inline vs File-Based Submission, API Key Management

### GitHub issue #33
https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/33
"All OCR/translation save paths must snapshot before overwriting"

## Open questions

### Broader version control for page content
Current snapshot system only protects manual edits (`source === 'manual'`). Derek wants to think about **full version control for all page content** — every OCR/translation write creates a version, not just manual edits. This would:
- Prevent any data loss from re-processing
- Enable quality comparison between model versions
- Support rollback to any previous version
- Create an audit trail of how content evolved

Design considerations:
- Storage cost: ~1KB per page version × 130k+ pages × N versions
- Could use a `page_versions` collection with `{ page_id, field, version, data, model, prompt_version, created_at }`
- Or simpler: just store `previous_ocr_data` / `previous_translation_data` on the page doc (only 1 version back)
- Or use MongoDB change streams to capture all writes (infrastructure-heavy)
- The `prompts` collection already uses immutable versioning — same pattern could work for page content

### Batch resubmission ready but not started
The 6 books (~2,910 pages) are ready to resubmit via batch with the fixed script. Script has thinking disabled and correct prompt. Gemini Batch API quota may need to recover first.

### Production Lambda workers
Workers (`src/lib/ai.ts`) don't set `maxOutputTokens` at all — they use SDK defaults, which apparently work fine (Ficino was originally OCR'd by Lambda and got 4,800+ chars). But they also don't disable thinking, so they may be spending unnecessary tokens/cost on thinking. Worth investigating whether to add `thinkingBudget: 0` to production OCR calls too.

### Other 25 sample pages
The other 5 books' sample pages (25 total) looked fine in the output — char counts were similar to originals. Only Ficino had dense enough pages to trigger the thinking overflow. But those pages should be spot-checked in the reader too.

## Files created (tmp, not committed)
- `tmp/realtime-ocr-sample.mjs` — realtime OCR sampling script
- `tmp/cancel-and-resubmit.mjs` — batch job cancellation
- `tmp/check-prompts.mjs` — identify wrong-prompt books
- `tmp/fix-ficino-pages.mjs` — fix truncated pages (maxOutputTokens: 16384)
- `tmp/fix-ficino-remaining.mjs` — fix remaining pages (maxOutputTokens: 32768)
- `tmp/fix-ficino-513.mjs` — fix page 513 with thinking disabled
- `tmp/diagnose-ficino.mjs` — diagnostic with full API response logging
- `tmp/audit-ficino.mjs` — page-level audit

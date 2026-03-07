# Experiment: Multi-Page Batch Translation

**Date:** March 7, 2026
**Status:** Failed — not viable for production
**Test book:** Novum Lumen Chymicum (Sendivogius) — `690986dccf28baa1b4cae0e3`

## Hypothesis

Sending 5-10 OCR pages plus one prior translated page to Gemini in a single API call would:
1. Reduce API calls by 5-10x (fewer Lambda invocations, lower prompt overhead)
2. Improve translation quality (model sees full cross-page context, not just 2,000 chars of prior page)
3. Save ~30-40% on token costs (prompt/system instructions amortized over multiple pages)

Current architecture sends 1 page per Gemini call via Lambda FIFO queue, with sequential processing to maintain context continuity.

## Token Budget Analysis

Average page sizes (sampled from 50 pages):
- OCR text: ~1,400 chars (p50: 1,180, p90: 2,700) = ~405 tokens
- Translation output: ~1,700 chars (p50: 1,260, p90: 4,200) = ~491 tokens

Multi-page estimates vs Gemini Flash limits:
| Batch size | Input tokens | Output tokens | Within limits? |
|------------|-------------|---------------|----------------|
| 5 pages | ~3,000 | ~2,500 | Yes (65k output limit) |
| 10 pages | ~5,000 | ~5,000 | Yes |
| 20 pages | ~9,000 | ~10,000 | Yes |

Token budget is not a constraint. Even 20 pages uses <1% of Flash's 1M context and <15% of its 65k output limit.

## Test Setup

**Script:** `_tmp-test-batch-translate.mjs`
**Model:** `gemini-3-flash-preview`, temperature 0.2
**Pages tested:** Pages 21-30 (batch of 10) and pages 21-25 (batch of 5) from Sendivogius
**Prior context:** Page 20's existing translation (full text, not truncated)
**Comparison baseline:** Existing single-page translations produced by the standard pipeline

### Output formats tested

1. **JSON mode** (`responseMimeType: 'application/json'`) — array of `{page, translation}` objects
2. **Delimiter mode** — plain text with `===PAGE N===` markers between translations
3. **JSON mode with maxOutputTokens: 32000** — explicit high output cap

## Results

### Trial 1: JSON mode, 10 pages
- **Returned:** 6 of 10 pages (pages 27-30 missing)
- **Time:** 21.6s
- **Tokens:** 5,019 input, 2,632 output
- **Quality:** Plain text only — no `<note>`, `<term>`, `<meta>` annotations (prompt was too stripped down)

### Trial 2: JSON mode, 5 pages (production-quality prompt)
- **Returned:** 1 of 5 pages (pages 22-25 missing)
- **Time:** 21.0s
- **Tokens:** 3,248 input, 2,167 output
- **Quality:** Page 21 was good — proper annotations, similar length to existing translation

### Trial 3: Delimiter mode, 5 pages (production-quality prompt, maxOutputTokens: 32000)
- **Returned:** 3 of 5 pages (pages 24-25 missing)
- **Time:** 157.1s (very slow)
- **Tokens:** 3,254 input, 1,277 output
- **Quality:** All 3 returned pages were high quality — correct `<meta>`, `<note>`, `<term>` tags, scholarly style, comparable to existing translations

### Quality comparison (pages that did return)

For completed pages, batch translations were comparable to single-page translations:
- Proper use of `<meta>` continuity notes, `<note>` for Latin originals, `<term>` for technical vocabulary
- Similar scholarly tone and accuracy
- Slightly shorter (~20-30%) due to less verbose annotations
- Cross-page continuity handled well within the returned pages

## Failure Mode

The model consistently **stops generating early**, producing translations for the first 1-6 pages of a batch then halting. This is NOT a token limit issue:
- Output tokens used: 1,277-2,632 (well under the 65k limit)
- `maxOutputTokens` set to 32,000 made no difference
- Happened with both JSON and delimiter output formats

The likely cause: each page translation is a natural completion point. The model treats the end of a page translation (especially after `<keywords>` tags) as a reasonable stopping point. Structured output (JSON arrays, delimiters) gives the model easy exit ramps that it takes after 1-3 pages.

## Cost Analysis (theoretical, if it worked)

| Metric | Single-page (current) | Batch of 10 |
|--------|----------------------|-------------|
| API calls per 10 pages | 10 | 1 |
| Prompt overhead | 10x ~500 tokens = 5,000 | 1x ~1,500 tokens = 1,500 |
| Total input tokens | ~11,000 | ~5,500 |
| Token savings | — | ~35% input |
| Lambda invocations | 10 | 1 |

Theoretical savings of ~35% on input tokens and 10x fewer Lambda invocations. But reliability makes it impractical.

## Conclusion

**Multi-page batch translation is not viable with Gemini Flash.** The model reliably produces high-quality translations for individual pages but cannot be trusted to complete a full batch of 5-10 pages.

A validation + retry loop could work around this (detect missing pages, resubmit individually), but this erodes the efficiency gain and adds complexity. The current single-page FIFO approach is simpler, 100% reliable, and already provides cross-page context via the previous page's translation.

### Better paths to faster translation

1. **Increase Lambda concurrency** — `MAX_ACTIVE_LAMBDA_TRANSLATE` (currently 100) is the real bottleneck, not per-call overhead. More concurrent workers = more books translating in parallel.
2. **Skip already-translated pages more aggressively** — re-enrolled books resubmit all untranslated pages, but some may have been translated since the last count sync.
3. **Batch API for non-context-sensitive tasks** — OCR and image extraction already use batch for 50% cost savings. Translation is the one task that genuinely needs sequential processing.

## Files

- Test script: `_tmp-test-batch-translate.mjs`
- This report: `.claude/docs/experiment-batch-translation.md`

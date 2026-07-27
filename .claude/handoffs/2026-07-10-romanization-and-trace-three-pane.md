# Romanization on the Armenian Buzand + three-pane trace

**Date:** 2026-07-10
**PRs:** #3122 (merged), #3125 (merged) · **Issue filed:** #3126
**Status:** all merged and deployed to production; verified live.

## What the session did

Started from a request to apply romanization mode (already used on Greek books) to the
Armenian *Patmutʻiwn Hayotsʻ / History of the Armenians* (Buzand),
`book 69a5ead1d507939f0352ced7`. Grew into two shipped changes and a filed issue.

### 1. Romanized the Buzand
- Ran `scripts/batch/batch-transliterate.mjs --book-id 69a5ead1d507939f0352ced7`.
  Armenian was already in the script's non-Latin set with an LC romanization convention —
  no code change needed. 311 pages, ~$0.14, `gemini-3.1-flash-lite`.
- 2 pages (59, 183) failed with a **Gemini quirk**: HTTP 200 + empty candidate array on
  the long prompt, deterministic, not safety/recitation/rate-limit. A shorter prompt
  succeeded. Fixed those two with a trimmed-prompt fallback script.

### 2. PR #3122 — ISR layout revalidation is prefix-literal (caching bug)
- Symptom: the Romanized toggle appeared under `/book/<slug>/page/<id>` but NOT under
  `/book/<bookId>/page/<id>`, even after revalidate + Cloudflare `purge_everything`.
- Cause: `revalidate-book` called `revalidatePath(path, 'layout')` for the slug only.
  Next keys layout invalidation on the literal `/book/<x>` prefix, so id-form page URLs
  served a stale ISR render for the full 24h window. A CF purge doesn't help — it
  re-fetches the same stale render from Vercel.
- Fix: layout-invalidate every key in `{slug, route param, book.id}`, on the global and
  both tenant path shapes.

### 3. PR #3125 — three-pane trace + click-snap fix
User asked to extend trace so the romanized pane highlights too, and (mid-session) to
spot-check trace quality. Both delivered.

- **Romanized spans via a SEPARATE additive Gemini call** (`generateRomanSpans` →
  `resolveRomanSpans` in `src/lib/word-alignment.ts`). Takes already-resolved source
  spans, asks only for their transliteration counterparts. 94% of pairs get a verified,
  strictly-forward romanized span. The existing source↔translation call is byte-identical.
  `translit_hash` gates it, so a page that gains a transliteration later pays only the
  cheap pass — verified end-to-end that source pairs come back identical.
  - **Tried and rejected:** folding a `rom` field into the pair prompt dragged mean
    coverage 74%→67% and collapsed one page 97%→24%. The pair prompt is unstable under
    edits — treat as frozen.
- **`normEnd` bug** (`src/lib/align-text.ts`): `locateSpan` returned only raw offsets, and
  the click handler derived a *normalized* span end from a *raw* length ("approximate but
  adequate"). Folding changes length both ways (æ→ae grows; dehyphenation/diacritic
  stripping shrink), so the containment test was systematically wrong on the early-modern
  pages trace targets. `locateSpan` now returns `normEnd`; tests pin both directions.
- **60-char snap** (`TraceAlignment.tsx`): a click outside every span snapped to the
  nearest within 60 normalized chars (~10 words). The aligner leaves ~33% of a page
  uncovered (mean source coverage 67% over 14 pages), so clicking unaligned text
  highlighted an unrelated phrase — the "trace doesn't always work" symptom. Tolerance
  now 12 chars; beyond that trace says nothing.

### Issue #3126 — coverage second pass (measured, NOT shipped)
A second pass over uncovered regions lifts mean source coverage 67%→74% for one extra
cached call, but doubles first-open latency on low-coverage pages and I only measured
coverage, not precision. Written up rather than shipped. A coverage-oriented prompt
rewrite was *worse* (61%) — also documented there.

## Verification
- `npx tsc --noEmit` clean; 510 unit tests pass (8 new).
- End-to-end `getOrCreateWordAlignment` against prod data on Buzand p27: 22/22 romanized
  spans, all verbatim at stored offsets, zero out of order.
- Drove the live production reader (chrome-devtools MCP): clicking an English phrase lit
  the Armenian + romanized spans; clicking a 190-char unaligned run highlighted nothing.

## Files touched (all via PRs, nothing uncommitted)
- `src/lib/word-alignment.ts`, `src/lib/align-text.ts`
- `src/components/reader/TraceAlignment.tsx`, `src/components/pipeline/TranslationEditor.tsx`
- `src/app/api/books/[id]/pages/[pageId]/alignment/route.ts`
- `src/app/api/admin/revalidate-book/[id]/route.ts` (#3122)
- `tests/unit/word-alignment-resolve.test.ts`

## CLAUDE.md check
No new invariant needed. Both lessons are captured: as CLAUDE.md-adjacent auto-memory
(`lesson_isr_layout_revalidation_is_prefix_literal`, `lesson_normalized_offset_vs_raw_length`,
`lesson_gemini_empty_candidate_long_prompt`, `project_trace_alignment_quality`) and the
frozen-prompt / coverage findings in issue #3126. The quote-integrity and revalidation
doctrine already in CLAUDE.md covers the general cases.

## Next
- #3126 if we want higher trace coverage (weigh latency).
- Romanization is a per-book batch job; other non-Latin books can be run the same way.

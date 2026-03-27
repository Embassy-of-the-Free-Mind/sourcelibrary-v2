# Chapter Text Materialization — 2026-03-27

## What was done
- **New `chapter_texts` collection** — concatenates page text into chapter-sized chunks (~10K-50K tokens) with `[Page N]` markers for citation and chapter title headers. PR #465.
- **Backfill complete:** 3,579 books, 78,487 chapters, ~888M tokens materialized.
- **100K token cap:** Chapters exceeding 100K tokens are split at page boundaries into numbered parts. 654 books re-split.
- **API:** `GET /api/books/{id}/text?chapter=N&part=P` returns chapter text.
- **MCP server:** `get_book_text` tool supports `chapter` and `part` params.
- **Chat RAG upgraded:** Searches chapter texts first (full chapter context), falls back to page-level.
- **Pipeline:** Auto-materializes after chapter extraction in `enrich-books` cron.
- **Chapter type extended** with `endPage` field, computed from next chapter's start.

## Key files
- `src/lib/chapter-text.ts` — materialize, query, computeEndPages
- `src/app/api/books/[id]/text/route.ts` — chapter param
- `src/app/api/books/[id]/materialize-chapters/route.ts` — manual trigger
- `src/app/api/books/[id]/chat/route.ts` — chapter-aware RAG
- `src/app/api/cron/enrich-books/route.ts` — pipeline integration
- `mcp-server/src/{api,index}.ts` — chapter + part params
- `scripts/backfill-chapter-texts.mjs` — backfill script

## Known issues

### 340 books with broken chapter extraction
One chapter has >80% of content. Root cause: chapter extractor detects TOC headings at front of book instead of actual chapter starts in the body. Examples: Ficino's Theologia Platonica, Kircher's Mundus Subterraneus, Vesalius's Fabrica.

**Regex approach was tried and abandoned** (scripts/fix-broken-chapters.mjs) — too many false positives from running headers, margin notes, cross-references in 16th-century texts.

**Better approach:** Have an AI agent actually read samples from the book to understand its structure, then set chapter boundaries. This converges with the reading notes idea — an agent that reads chapters can both fix boundaries and generate notes.

### 2 books failed materialization (16MB limit)
- Siddhanta Shiromani (6990647eef12272ffdc92999)
- De historia plantarum (6958ea4dd3a892833481514e)

The chapter_texts docs are too large even after splitting. Would need individual chapter_text docs split further or these books excluded.

### 1 chunk still >100K tokens
Edge case — probably a single enormous page.

## Chapter extraction v2 (PR #472, merged)
- Extracts inline centered markers (`->*Cap. 5.*<-`) and bold standalone labels
- Includes 3 lines of context after each heading in Gemini prompt
- Tags TOC page headings as `[TOC]` so Gemini can distinguish from body
- Better JSON parsing (handles fences, extracts arrays from surrounding text)
- Tested: Ficino 8→96, Kircher 3→118, Vesalius 6→85, Maier 8→9 (stable)

## Re-extraction results
- 150/161 broken books re-extracted and re-materialized
- 11 failures (rate limits + parse errors — can retry)
- Total cost: ~$0.05 (724K tokens)
- Spot check issues found:
  - Homer (2 ch for 463p) — manuscript, no headings in OCR
  - The Magus (1 ch for 460p) — OCR missed the headings
  - Faust grimoire (73 ch for 112p) — too granular, every spell = chapter
  - These are the hard tail cases that need an AI reader, not heading extraction

## Next steps (discussed with Derek)
1. **Align index batches to chapters** — replace arbitrary 50K-char batches in `/api/books/[id]/index` with `getChapterTexts()`. Each batch = one chapter. Makes sectionSummaries chapter-aligned. ~20 lines of code. GitHub issue #469.
2. **Improve existing summaries** — regenerate sectionSummaries from full chapter text (~$47 for all books with Flash Lite)
3. **Reading notes layer** — multiple AI agents accumulate observations as chapters are read. Schema: `chapter_notes { book_id, chapter_index, agent, context, note, connections, created_at }`. Issue #469.
4. **Use topic discontinuity for failed books** — run AI batch index, detect theme shifts between batches to propose chapter boundaries for books where heading-based extraction fails.
5. **TOC title matching** — validate extracted chapters by matching chapter titles against printed TOC entries (title similarity, not page numbers, since pagination systems vary in early printed books).

## Stats
- chapter_texts collection: ~78K docs, ~888M tokens
- Token distribution: 93% of chapters under 100K tokens (sweet spot 10K-50K)
- Broken chapters: ~11 remaining (down from 340)

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

## Next steps (discussed with Derek)
1. **Fix broken chapters** — AI agent reads book structure, not regex
2. **Improve existing summaries** — regenerate sectionSummaries from full chapter text (~$47 for all books with Flash Lite)
3. **Reading notes layer** — multiple AI agents accumulate observations as chapters are read. Schema: `chapter_notes { book_id, chapter_index, agent, context, note, connections, created_at }`. Converges with #1 — same agent capability.

## Stats
- chapter_texts collection: ~78K docs, ~888M tokens
- Token distribution: 93% of chapters under 100K tokens (sweet spot 10K-50K)
- Broken chapters: 340 books (9.5% of chaptered books)

# Search ranking, routing & the measurement loop

How Source Library decides the *order* of search results, how the LLM step at
search start feeds that decision, and how we measure whether it's any good.

> Status (2026-05-29): the leak fix + click instrumentation are/should be on
> `main`; ranking routing (`auto`, LLM intent) is in PR #2154; the BPH compare
> tool is in PR #2161 (preview-only). "Live vs in-PR" is marked per section.

---

## Surfaces

Three places run search, with different intelligence:

1. **The search page** (`src/app/search/page.tsx`) → `/api/search` for results, plus `/api/search/ai-expand` for an LLM narration / expanded terms / intent. This is the high-traffic public surface.
2. **The Librarian** (`src/lib/embassy/librarian.ts`) → `src/lib/search/librarian-search.ts` (`hybridSearch`), one unified `search` tool. RRF is **live** here (PR #2137). It's a research assistant, so conceptual queries dominate.
3. **The BPH compare tool** (`/embed/[tenant]/search-compare`, PR #2161) → `/api/search/compare`. A librarian A/B harness, not a public surface.

## The four lanes (`/api/search`)

Every query fans out to four lanes in parallel, each tenant-scoped:
- **keyword books** — Supabase trigram (`books_catalog`) → Mongo metadata.
- **keyword pages** — Atlas Search `pages_search` (phrase/fuzzy on translation+OCR).
- **semantic books** — `match_books_semantic` (Gemini 768-dim). ⚠️ global RPC (no `tenant_id` column); tenant scope is re-applied in the Mongo materialization — see "Tenant scoping" below.
- **semantic pages** — `match_semantic` (passes `filter_tenant_id`, so tenant-safe at the RPC).

Lane results are concatenated, then **ordered** by the chosen ranking strategy, then work-id-deduped and paginated.

## Ranking strategies

`?ranking=` on `/api/search` (default `auto`):

- **`ladder`** — the legacy curatorial heuristic, and still the right answer for navigational lookups: books > pages → title/author word match → exact-phrase-in-title → **original language beats English translation** → **older edition wins** → quality. Encodes real curation; don't treat it as a naive baseline.
- **`rrf`** — Reciprocal Rank Fusion (`src/lib/search/rrf.ts`, k=60) of the four lanes' ranked id-lists. Lets a cross-confirmed passage outrank a weakly-matched book. Wins conceptual/niche queries.
- **`auto`** (default, PR #2154) — routes per query:
  - If an LLM **intent** is supplied (`&intent=`), use it: `navigational → ladder`, `conceptual`/`verbatim → rrf`.
  - Else fall back to **word count**: 1–2 words → ladder, 3+ → rrf.
  - The response + log report the applied mode (`auto-rrf:conceptual`, `auto-ladder:words`, …).

### Why routing, not wholesale RRF
Two evals + the real query mix drove this:
- **Eval (Librarian golden set):** RRF wins overall (P@1 0.53 vs 0.47, MRR 0.63) and ~doubles niche-passage recall, **but halves verbatim-quote recall (0.75→0.38)** and hurts broad-theme. No single ranker wins every category.
- **Real `/api/search` traffic (28K queries):** **~69% one word, 84% ≤2 words (navigational), ~16% 3+ words (conceptual), ~0% quoted.** RRF helps the 16% tail and would risk the 84% majority where the ladder is already strong (verified live: `boehme`, `kircher`, `paracelsus`, `agrippa` all return the right canonical/original-language books).

So `auto` keeps the majority on the proven ladder and applies RRF only where it wins.

## LLM intent at search start (PR #2154)

`/api/search/ai-expand` (gemini-3.1-flash-lite, streaming SSE) runs per search-page query. It emits:
- `display` hint (`images_first | books_first | not_in_collection`) — **layout** only.
- `strategy` (`navigational | conceptual | verbatim`) — **retrieval routing**. New. Streamed as a `strategy` SSE event, cached/replayed.
- `narration`, `terms` (expanded search terms), `image_terms`.

The `strategy` is the better routing signal than word count (e.g. 2-word "sympathetic magic" is conceptual). Consumed via `&intent=` on `/api/search`. **The live search page is intentionally NOT serialized behind the LLM** — `/api/search` fires immediately with word-count `auto` (zero added latency); the intent param is exercised by the compare tool first to validate routing quality before wiring a live re-rank.

**Latent opportunity (not built):** the LLM `terms` (Latin titles, original-language names) could be embedded and fused into the RRF as extra ranked lists — a multi-query attack on cross-lingual + niche recall.

## Tenant scoping (lockdown) — fixed in #2159

Partner subdomains (BPH/EFM) must never show non-tenant content. The keyword lanes and the semantic *page* lane scope by tenant; the semantic *book* lane did **not** (its RPC is global and `book_embeddings` has no `tenant_id` column), so it leaked global books into BPH results — measured at up to 18/25 for "hermetic philosophy and the soul". Fixed by re-applying the tenant filter in the semantic materialization queries. Guard: `scripts/audit/search-tenant-purity.mjs` (asserts 0 cross-tenant survivors; re-run after touching the semantic lanes).

## The BPH compare tool (PR #2161, preview-only)

`/embed/bph/search-compare` — librarians compare **Current (ladder)** vs **New (RRF)** side by side on their corpus, thumb individual results, pick a winner, leave a note → `search_compare_votes` (anonymous). Features: scope toggle (BPH-only vs whole library), clickable results (BPH → `bph.sourcelibrary.org`, else `sourcelibrary.org`), and an LLM-intent banner ("Search read this as a *conceptual* query → production would show New (RRF)"). The vote stores `scope` + `strategy`, so we can ask "for queries the LLM called conceptual, did librarians prefer RRF?" — the validation for flipping `auto` on in production.

## The measurement loop — click instrumentation (this PR)

Until now we logged **what** people search (`search_query`, 29K/90d) and **what** they read (`page_read`, `book_read`) but **not the click that connects them** — so result quality wasn't measurable, hence the manual compare tool.

`POST /api/search/click` (fired via `navigator.sendBeacon` from the search page) records `event: search_result_click` in `analytics_events`: `{query, ranking, slug, page_number, rank, view, total, ip, created_at}`. A single delegated capture-phase listener on the search page beacons any `/book/` result click; `clickCtx` attributes it to the query + ranking strategy that produced it.

This enables, per ranking strategy (`auto-rrf` / `auto-ladder` / `ladder`):
- **CTR** — clicks ÷ searches.
- **Mean clicked-rank** — the core ranking-quality metric (lower = better ordering).
- **Zero-click / abandonment rate** — searches with no follow-up click (the strongest "bad results" signal). Derive from `search_query` events with no matching `search_result_click` by ip+time.

Once #2154 is live, this **automatically A/B-measures `auto-rrf` vs `auto-ladder` on real behavior** — no manual eval needed. Before #2154, it captures a `ladder`/baseline CTR + clicked-rank to compare against.

## Where to look
| Concern | File |
|---|---|
| Lanes + ranking + auto routing + intent | `src/app/api/search/route.ts` |
| RRF util | `src/lib/search/rrf.ts` |
| Ladder (legacy) | inline in `route.ts` (`ladderCompare`) + mirrored in `compare-search.ts` |
| LLM intent | `src/app/api/search/ai-expand/route.ts` (`<strategy>`) |
| Librarian hybrid (live) | `src/lib/search/librarian-search.ts` |
| Compare tool | `src/lib/search/compare-search.ts`, `src/app/api/search/compare/*`, `src/app/embed/[tenant]/search-compare/*` |
| Click telemetry | `src/app/api/search/click/route.ts` + delegated listener in `src/app/search/page.tsx` |
| Tenant-purity guard | `scripts/audit/search-tenant-purity.mjs` |

## Open follow-ups
1. **Decide `auto`'s fate** from compare votes + click data (CTR / clicked-rank per strategy). Likely keep routing; tune the navigational/conceptual boundary.
2. **Wire the live search page to pass `intent`** (re-rank when the LLM disagrees with word count) once routing is validated — handle latency (instant word-count results, async refine).
3. **LLM terms → RRF multi-query** (the recall play).
4. Extend click tracking to index/image result cards (currently book/page links).

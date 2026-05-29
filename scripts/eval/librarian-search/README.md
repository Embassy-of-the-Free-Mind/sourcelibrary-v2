# Librarian Search Evaluation

Quantitative evaluation harness for the Librarian's search tools. Compares
multiple search variants against a hand-validated golden set and reports
precision@5, recall@5, and MRR per variant.

## Why this exists

The Librarian currently uses two tools — `search_collection` (Atlas keyword)
and `search_semantic` (book-then-page Supabase) — and the model picks between
them. Known issues:

1. Book-then-page misses passages in books whose summaries don't match the
   query (the "Martial's masturbator epigram in a 400-page book about Roman
   wit" case the `semanticPageSearchGlobal` comment cites).
2. There's no hybrid scoring or cross-encoder reranking.

Fixing (1) and (2) without a measurement framework is guesswork. This harness
lets us A/B variants — auto-fallback to global, RRF merge, cross-encoder rerank
— against a fixed query set.

## Layout

- `golden-set.json` — query → expected (book_slug, page-range) tuples.
  Hand-validated, marked with `confidence` (high/medium/low). Treat low-
  confidence entries as diagnostics, not ground truth.
- `variants.mjs` — one async function per search variant. Each takes a query
  string and returns ranked `{book_id, book_slug, page_number, ...}` hits.
- `metrics.mjs` — `precisionAtK`, `recallAtK`, `mrr`, plus a matcher that
  honors the optional `page_min`/`page_max` page-range tolerance.
- `run.mjs` — runner. Iterates queries × variants, computes metrics, writes
  a JSON report and prints a per-category table.

## Running

```bash
# Env is required (MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY)
set -a; source ../../../../.env.production.local; set +a

# Run all variants against the full golden set
node scripts/eval/librarian-search/run.mjs

# Run a single variant (registry in variants.mjs: keyword, book-then-page,
# global-page, rrf, rrf-tuned, rrf-floor, auto-fallback, ai-expand-multiquery)
node scripts/eval/librarian-search/run.mjs --variant=rrf

# Run a single query (for debugging)
node scripts/eval/librarian-search/run.mjs --query=agrippa-planetary-seals

# Verbose mode (prints every hit)
node scripts/eval/librarian-search/run.mjs --verbose
```

Reports are written to `scripts/eval/librarian-search/results/<timestamp>.json`.

## Golden set conventions

A "correct" hit for a query is one whose `book_slug` matches an entry in
`expected[]`. If the entry has `page_min`/`page_max`, the hit's `page_number`
must fall within. If not, any page from that book counts.

Categories:
- `well-known-concept` — the topic is famous; book-level search should find it
- `niche-passage` — a specific passage inside a (possibly famous) book that
  book-level search will likely miss
- `verbatim-quote` — user is searching for a phrase they expect to find verbatim
- `cross-lingual` — query in English, expected hits in non-English originals
  (English translations are what's indexed, so this tests translation coverage)
- `broad-theme` — wide topic; multiple books should match
- `bibliographic` — "what do you have about X" — books-as-results

## Findings to date (2026-05-29, 31-query set)

- **`rrf` (k=60) is the best balanced variant** — P@1 0.419, MRR 0.513, beating
  book-then-page (0.290 / 0.395). It nearly doubles niche-passage recall (the
  buried-passage problem). **k=60 ≥ k=20** — the lower-k "tuned" variant gave up
  ranking quality for speed it didn't need.
- **`auto-fallback` and `rrf-floor` are dead weight** — byte-identical metrics to
  their base variants. Don't ship them; candidates for removal.
- **No single variant wins every category.** RRF lifts niche/cross-lingual but
  regresses verbatim-quote and broad-theme vs book-then-page. The likely answer
  is query-aware routing (the search page's `ai-expand` HINT already classifies
  intent — see `src/app/api/search/ai-expand/route.ts`).
- **`ai-expand-multiquery` is currently inconclusive — not a verdict.**

### ⚠ Known confound — read before trusting thematic-category numbers

The 2026-05-29 expansion (`_expand-golden-set.mjs`) resolved `expected[]` by
**title-regex**. For thematic categories (`broad-theme`, `cross-lingual`,
`bibliographic`) this is too narrow and **biased toward keyword search**:
semantic/RRF correctly surface topically-relevant books with *non-matching
titles* that then score 0 (e.g. `zohar-sefirot` returns Pardes Rimonim /
Gikatilla — genuinely about sefirot — for 0.00). So absolute recall on those
categories is deflated for exactly the variants under test.

**Trust the specific-answer categories** (`well-known-concept`, `niche-passage`,
`verbatim-quote`) for the variant ranking. Treat the thematic categories as
directional only. **Fix before the next iteration:** replace exact-slug recall
with an LLM relevance judge ("is this returned book on-topic?") for the thematic
categories. Full context: `.claude/handoffs/2026-05-29-librarian-search-eval.md`.

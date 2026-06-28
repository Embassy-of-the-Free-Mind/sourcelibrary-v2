# Finding works we're missing (esp. Latin) — the acquisition map

**Read this before building any "what works are we missing / let's bulk-import"
tooling.** This capability is ~80% built and spread across MongoDB, Supabase, and
a dozen scripts. People (including AI sessions) keep re-deriving it badly. Don't.

## The trap (2026-06-28)

The intuitive approach — "enumerate IA's Latin, cluster by title, diff against our
holdings, import the gaps" — **fails**, and fails in the worst way: it *over*-reports
missing works and would have us **re-importing texts we already hold**.

Validated example: a naive title-key engine flagged 136 "missing" works across 16
esoteric authors (Pymander, Ficino *De vita*, Libavius *Neoparacelsica* 1594…).
**We hold every one of them** — often in multiple editions. The diff failed because
crude title normalization can't recognize a held work under variant transcriptions
(*Libaui* vs *Libavii*), a different author-field value, or a divergent title
(Pymander / Pimander / Poimandres / Corpus Hermeticum). A weak work-matcher inverts
the goal. **The matcher must be real work identity, not title strings.**

## What already exists (the real system)

### 1. Internal work identity — `books.work_id` (~97% coverage)
- Editions cluster under a shared `work_id`; coverage census + design in
  **`.claude/docs/work-identity-coverage.md`**. Latin ~95% (Wikidata-direct, 745
  works); cross-language merge layer at 91.6% (`work-merge:llm-verified`, the 2,491
  LLM-verified merges).
- **Known limitation — the divergent-title tail:** famous classics with many title
  variants across languages/authors don't fully collapse. Our *own* 35 Pymander
  editions sit under **12 distinct work_ids** (+ 2 authors, Iamblichus bundled in).
  This is the documented residual ~8%, not a bug to "discover." Any holdings diff
  must account for it.
- Tools: `scripts/analysis/{mint-local-work-ids,resolve-work-ids,resolve-work-ids-wikidata,llm-verify-work-merges,cluster-works-by-embedding}.mjs`.

### 2. The Latin universe — USTC in Supabase (the thing to diff against)
- **`ustc_editions`: 1,628,578 rows**; **`ustc_enrichments`: 1,624,437** — every
  early-modern European edition, collapsed to `work_cluster_id` (`author::norm-title`).
  ~503k Latin → ~366k distinct Latin work clusters. *This is the "universe of distinct
  Latin works" — it already exists. Don't re-cluster IA from scratch.*
- Digitisation links (which editions are scanned + where, by source) are harvested by
  `scripts/catalog-coverage/harvest-ustc-holdings.mjs`.

### 3. Holdings → USTC match — `books.ustc_id` (PARTIAL — the loose end)
- `scripts/catalog-coverage/backfill-ustc-matches.mjs` links our books to USTC
  (fast word-overlap + Gemini flash-lite fallback, ~$0.001/book).
- **Current coverage: only ~2,763 / 8,169 Latin books matched (~34%).** Finishing
  this backfill is the prerequisite for a trustworthy gap.

## How to actually produce the "missing works to acquire" list

1. **Finish the holdings match** — run `backfill-ustc-matches.mjs` to ~full Latin
   coverage (the other ~66%). Cost ≈ books × ~$0.001.
2. **Diff** USTC work clusters that (a) have a digitisation link and (b) have **no**
   matched Source Library holding → genuine missing works, one cluster each.
3. **Rank** by `scan_quality` (bsb/e-rara → high, gallica/biblissima → medium,
   ia_microfilm → low — see `catalog-coverage/_tmp-backfill-import-candidates.mjs`)
   and import the best edition per cluster (hidden → archive → OCR → translate).
4. **The `import_candidates` table was scripted but never materialized** — that final
   step (build the table from the diff) is the remaining work. It does not exist yet
   in Supabase; the upstream pieces (universe, match, digitisation) do.

## Reality check before any Latin "dump"

We are **not** thin on Latin: 8,169 Latin books, deep canonical-esoterica coverage
(Pymander, *De vita*, *Platonica theologia*, Libavius, Kircher, Fludd, Agrippa all
held in multiple editions). The treemap "imbalance" is mostly the hidden 13k Chinese
dwarfing everything, not a Latin deficit. Acquire by **verified gap** (the procedure
above), never by volume.

## Related docs (don't duplicate — link)
- `work-identity-coverage.md` — work_id model, fit rule, coverage census, merge layer
- `translation-works-architecture.md` — the whole stack (work id + catalog + gap + holdings + FT)
- `work-dedup-methods.md`, `work-identity-matching-research.md` — clustering method research
- `translation-gap-methodology.md` / `translation-gap-paper.md` — the USTC translation-prior gap (#2626)
- `works-catalog-provenance.md` — work_id source provenance

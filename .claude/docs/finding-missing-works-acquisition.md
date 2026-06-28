# Finding works we're missing — the acquisition map

**For future sessions / systems: read this before building any "what works are we
missing / let's bulk-import" tooling.** This is ~80% built and spread across MongoDB,
Supabase, and a dozen scripts, so people (human + AI) keep re-deriving it badly. Don't.

---

## Get this right first: there are TWO layers, and they are NOT the same thing

Conflating them is what produces wrong gap lists and redundant imports.

### Layer 1 — OUR works system: `books.work_id` (USTC-INDEPENDENT)
This **is** "our works system." It clusters **our own holdings** into distinct works.
It does not depend on USTC or any single external catalog.
- **Tradition-agnostic, ~99% coverage everywhere:** Chinese 100%, German 100%,
  Tibetan 100%, Latin 99%, Greek 99%, Hebrew 95%, Sanskrit 98%, Pali 97%, Arabic 85%.
- **Sources of the work_ids:** `local-mint` (~21.8k), `kanripo-catalog` (~12.1k),
  `work-merge:llm-verified` (~2.5k), `wikidata:P50` (683), hand/deterministic merges.
  **Zero come from USTC.**
- **What it answers:** "do we hold this work / which editions of it / is this
  translation's original in the library / dedup." Cluster by `work_id`; read coverage
  with `scripts/analysis/work-coverage.mjs`.
- **Design / model / fit-rule / coverage census:** `.claude/docs/work-identity-coverage.md`.
- **Known limit — the divergent-title tail:** famous classics with many title variants
  across languages/authors don't fully collapse. Our *own* 35 Pymander editions sit
  under **12 distinct work_ids** (+2 authors). This is the documented residual ~8%,
  not a bug to "discover." Any holdings diff must account for it.

### Layer 2 — EXTERNAL universes: "what works exist that we DON'T have"
The acquisition gap = **diff( Layer-1 work_ids , an external universe of what exists )**.
There is more than one external universe; **USTC is just one of them, NOT special, and
NOT "our works system":**
- **USTC** (Supabase `ustc_editions` ~1.63M, work-clustered by `work_cluster_id`) —
  continental **printed** editions, **1450–1700**. Best for the Latin / German / French
  / Italian printed-book slice. Holdings link via `books.ustc_id`
  (`catalog-coverage/backfill-ustc-matches.mjs`; the match is also written back to
  `ustc_editions.in_source_library` / `source_library_id`). **Limits:** misses
  manuscripts, English alchemy, grimoires, and everything outside early-modern European
  print. A high *no-match* rate on our esoterica is **expected and correct** (Key of
  Solomon, Boehme's *Aurora*, Vatican shelfmarks are simply not in USTC) — not a matcher
  failure. The matcher is conservative (rejects with reasoning); trust its no-matches.
- **Wikidata P50** (an author's complete works) — tradition-agnostic; the path for
  everything USTC misses (Greek, Arabic, Hebrew, manuscript esoterica, non-European).
  `scripts/analysis/resolve-work-ids-wikidata.mjs`.

**Rule of thumb:** continental printed-Latin gap → USTC. Anything else → our `work_id`
layer + Wikidata. **Never treat USTC as "our works system."**

---

## The trap (validated 2026-06-28 — do not reinvent)

The intuitive approach — "enumerate IA's Latin, cluster by title, diff against our
holdings, import the gaps" — **fails**, and fails in the worst way: it *over*-reports
missing works and would have us **re-importing texts we already hold**.

A naive title-key engine flagged 136 "missing" works across 16 esoteric authors
(Pymander, Ficino *De vita*, Libavius *Neoparacelsica* 1594…). **We hold every one** —
often in multiple editions. The diff failed because crude title normalization can't
recognize a held work under variant transcriptions (*Libaui* vs *Libavii*), a different
author-field value, or a divergent title (Pymander / Pimander / Poimandres / Corpus
Hermeticum). A weak work-matcher inverts the goal. **The matcher must be real work
identity (Layer 1 + a real external universe), not title strings.**

## How to produce a trustworthy missing-works list

1. **Pick the right external universe for the tradition** (USTC for printed Latin;
   Wikidata P50 otherwise).
2. **Make sure holdings are linked to it.** For USTC: `backfill-ustc-matches.mjs`
   (word-overlap free + Gemini flash-lite fallback, ~$0.001/book; run with `tsx`, it
   imports `.ts` libs). Conservative — trust its no-matches.
3. **Diff:** external work clusters that (a) have a digitisation link and (b) have **no**
   matched Source Library holding → genuine missing works, one cluster each.
4. **Rank** by `scan_quality` (bsb/e-rara → high, gallica/biblissima → medium,
   ia_microfilm → low) and import the best edition per cluster (hidden → archive → OCR
   → translate). **The `import_candidates` table was scripted
   (`catalog-coverage/_tmp-backfill-import-candidates.mjs`) but never materialized** —
   building it from the diff is the remaining work.

## Reality check before any Latin "dump"

We are **not** thin on Latin: 8,169 Latin books, deep canonical-esoterica coverage
(Pymander, *De vita*, *Platonica theologia*, Libavius, Kircher, Fludd, Agrippa all held
in multiple editions). The treemap "imbalance" is mostly the hidden 13k Chinese dwarfing
everything, not a Latin deficit. Acquire by **verified gap** (above), never by volume.

## Related docs (don't duplicate — link)
- `work-identity-coverage.md` — Layer 1: work_id model, fit rule, coverage census, merge layer
- `translation-works-architecture.md` — the whole stack (work id + catalog + gap + holdings + FT)
- `work-dedup-methods.md`, `work-identity-matching-research.md` — clustering method research
- `translation-gap-methodology.md` / `translation-gap-paper.md` — the USTC translation-prior gap (#2626)
- `works-catalog-provenance.md` — work_id source provenance

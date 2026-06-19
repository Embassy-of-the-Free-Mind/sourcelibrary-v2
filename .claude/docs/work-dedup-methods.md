# Work-level dedup / entity resolution — methods reference

Field survey behind our work-identity approach (#2318/#2264/#1634). Grounds the
architecture in established library-science + ML practice. The headline: **our
design is the field consensus** — a conservative deterministic key as the spine,
a similarity/LLM layer that *only merges, never splits*, and a cross-catalog
ID join that resolves cross-script/title-divergence for free.

## The consensus architecture (what mature systems do)

1. **Deterministic author + uniform-title key = the backbone.**
   OCLC's **FRBR Work-Set Algorithm / Work Identifier (OWI)** builds an
   author/title key: authorized author form (from authority records) +
   normalized uniform/preferred title (drop leading articles, lowercase, strip
   punctuation + language qualifiers). Identical key → one work. It
   **under-clusters by design** (a single shared key is a high bar): precision
   over recall. HathiTrust/Zephir is even more conservative — clusters on shared
   **identifiers** first, ML only for the id-less tail (their 2025 MARC-AI work).

2. **Similarity / ML is an additive MERGE layer — never a splitter.**
   OCLC's **GLIMIR** runs *after* FRBR and may **only merge** existing work-key
   clusters, never split them and never merge across different authors. This
   structurally caps over-clustering. GLIMIR is our blueprint: it also handles
   multilingual/parallel records (language-equivalence tables, original-title
   recovery across MARC linking fields) — i.e. it resolves translations back to
   the original work via catalog links, not fuzzy string match.

3. **Title divergence is solved by the UNIFORM TITLE (human authority), not by
   string similarity.** "De occulta philosophia" ⇄ "Three Books of Occult
   Philosophy" key together because a cataloger assigned both the same 240
   uniform title. The Work boundary is **partly editorial** (does an abridgment/
   commentary count?) → human-in-the-loop is standard, not a failure mode.

4. **Cross-catalog ID join resolves cross-script + translation for free.**
   Same **Wikidata QID** (or OCLC OWI) on two books ⇒ same work, zero string
   matching. Wikidata carries multilingual labels + edition/translation links
   (P629/P747). More reliable than any embedding for the canon. (Our limit:
   Wikidata doesn't model the early-modern esoteric tail — resolver exhausted at
   ~928 books, see work-identity-coverage.md.)

## The boilerplate false-merge — diagnosed and resolved
We empirically found **full-page embedding cosine fails** for work identity:
different works by one author share title pages / series headers / prefaces, so
even max-page-pair cosine can't separate them (#1634, ~47% precision). The field
fix matches our finding: **match on title + structured metadata + the work's
distinctive incipit (first body line, post-front-matter) — never full-page
embeddings.** In an LLM verify step, instruct it to ignore shared front-matter/
series boilerplate and weight the unique opening + specific title.

## Methods taxonomy (for the merge layer, when we build it)
- **Probabilistic record linkage (Fellegi-Sunter):** per-field m/u weights, EM-
  trained (unsupervised), thresholded into match/possible/non-match. Needs
  **blocking** (sorted-neighborhood, canopy, embedding-block) to avoid O(n²).
  String sims: Jaro-Winkler (names), token-sort/token-set (word reorder).
  Production tool: **Splink** (SQL/Spark, drops in cleanly for the messy tail).
- **Deep EM:** **Ditto** (VLDB 2020) — fine-tuned Transformer, record-pair
  classification + domain-token injection + string summarization. Strong small-
  model baseline.
- **LLM EM (2024-26):** "Match / Compare / Select" regimes (COLING 2025); the
  efficient pattern is **embedding-block then LLM-verify** only the survivors.
  Small fine-tuned models (**AnyMatch**, **Jellyfish-7B**) hit within ~4% F1 of
  GPT-4 at ~1000-4000× lower cost. For us: Gemini-flash-lite in **Compare** mode
  ("same work, or different works by same author?") on candidate pairs is cheap.
- **Cross-lingual:** multilingual sentence embeddings (LaBSE / multilingual-E5)
  on **titles** (noisy for short strings); transliteration+phonetic for CJK/
  Semitic; **KG anchoring (Wikidata QID) is the most reliable** cross-lingual
  signal.
- **Evaluate at the CLUSTER level (B³ precision/recall)**, not pairwise F1 —
  pairwise hides transitivity failures. Build a small per-tradition gold set.

## Nearest peer to study
**BookReconciler** (arXiv 2512.10165, Dec 2025; github Post45-Data-Collective/
BookReconciler) — OpenRefine extension doing *exactly* our task: six-authority
join (LoC/VIAF/OCLC/HathiTrust/Google Books/Wikidata), native work-id when
available + fuzzy fallback + **Flask human-review UI**. Worth running the merge
tail through rather than rebuilding the review surface.

## Key citations
- OCLC FRBR Work-Set Algorithm v2.0 (Hickey & Toves 2009) — oclc.org/content/dam/research/activities/frbralgorithm/2009-08.pdf
- GLIMIR (Code4Lib Journal 2012) — journal.code4lib.org/articles/6812
- BookReconciler (arXiv 2512.10165, 2025) — arxiv.org/abs/2512.10165
- Splink (IJPDS 2022) — github.com/moj-analytical-services/splink
- Ditto (Li et al., VLDB 2020) — arxiv.org/abs/2004.00584
- Match/Compare/Select LLMs for EM (COLING 2025) — aclanthology.org/2025.coling-main.8/
- AnyMatch small-model EM (arXiv 2409.04073, 2024) — arxiv.org/abs/2409.04073
- HathiTrust/CDL Matching Algorithms Task Force Report (2025) — cdlib.org/wp-content/uploads/2025/11/2025-Matching_Algorithms_Task_Force_Report.pdf

## How this maps to our build
- **Backbone (DONE):** `scripts/analysis/mint-local-work-ids.mjs` — deterministic
  `local:{author_id}:{uniform-title-slug}`, alphabetical-token key (word-order
  invariant), under-cluster bias. Singletons auto-applied (zero merge risk);
  multi-edition clusters held for review. = OCLC FRBR Work-Set, local.
- **Merge layer (NEXT):** the 726 held clusters → review queue (BookReconciler
  model) → confirm with title+incipit LLM-verify (GLIMIR "merge-only" rule).
- **Cross-catalog enrichment:** Wikidata QID (have it) + `translation_catalogs`
  join (54% author-surname overlap with the gap) → attach work + FT evidence.

# `contents_works[]` — the contents-manifest layer

Issues: #2913 (the honest book-floored count) · #2916 (ingest container sub-works).
Source of truth for the model: `.claude/docs/title-and-work-identity-principles.md`
(Set F — counting). Read that first; this doc is the schema + operational contract.

## Why this layer exists

The works DB tracks works at the **book grain** — each container book is modeled as
**one** `work_id`. But a *container* book (Articella = Hippocrates + Galen + Ḥunayn;
"Collected Drukpa Kagyu texts") holds **many** works. The first-translation headline,
computed book-by-book, therefore **under-counts**: ~463 FT containers with a chapter
index hold ~3,157 constituent works we demonstrably already hold.

`contents_works[]` is a **book → sub-works decomposition**. It is *additive* and does
not touch `work_id`.

> **Two relations, never conflate** (the load-bearing distinction):
> | | what it is | cardinality |
> |---|---|---|
> | `work_id` (clustering) | groups editions+translations of one work → "do we hold the original?" | **≤ books** |
> | `contents_works[]` + the count | distinct works inside a book; the curatorial tally | **≥ books** (book-floored) |
>
> The count is **never** `distinct work_id`. A book is **at least** one work.

## Where it lives

A subdoc array on the **`books`** document (chosen over works-catalog rows: simple,
local, and the book is the natural floor). One entry per constituent work:

```jsonc
book.contents_works = [
  {
    "title":              "Liber Azoth",        // as it appears in the source
    "title_en":           "The Book of Azoth",  // English form if distinct, else null
    "source_language":    null,                  // language we translated FROM (null until set)
    "page_from":          12,                    // 1-based page index in this book
    "page_to":            48,
    "work_id":            null,                  // optional link into the work cluster (#2453)
    "is_first_translation": null,                // tri-state: true | false | null(unproven)
    "verified":           false,                 // has this constituent been ft-verify'd? (#2880)
    "provenance":         "chapter_index",       // how this entry was derived
    "confidence":         0.96                   // [0,1] — index-reach × thin-penalty
  }
]
```

And a small derivation marker on the book:

```jsonc
book.contents_works_meta = {
  "provenance":  "chapter_index",   // seeder that wrote contents_works
  "index_reach": 1.0,               // chapter index coverage of the book (validation)
  "est_works":   7,                 // contents_works.length at seed time
  "derived_at":  "2026-06-30T…Z"
}
```

### Field contract

- **`provenance`** — `chapter_index` (derived free from `books.chapters[]`, #2914),
  later `ai_toc` (AI extraction of chapterless containers — paid, cost-gated), or
  `manual`. Lets consumers filter provisional from authoritative.
- **`confidence`** — derived rows: book index-reach, ×0.4 if the entry is "thin"
  (<2pp extent → likely a mis-leveled section-head). A floor signal, not a verdict.
- **`is_first_translation` is tri-state** (`true` / `false` / `null=unproven`), per
  Principle Set E. **A container being FT-badged does NOT make its constituents
  firsts.** Every `true` must pass ft-verify (`verified: true`) before it is
  authoritative or counts.
- **`verified`** — `false` for everything chapter-derived. Flips to `true` only after
  the #2880 / catalog-match discipline confirms the per-constituent claim.

## Provisional → verified pipeline

1. **Seed (free).** `scripts/maintenance/seed-contents-works.mjs` writes the
   chapter-derived manifest as **provisional** (`provenance: 'chapter_index'`,
   `verified: false`). Dry-run by default; `--apply` writes; `--clear` reverses.
   Backup written before any write. The container set is identified by
   `isContainerSignal()` (title/author tokens) — kept **multilingual but
   high-precision** (`CONTAINER_RE`): English/Latin collected-works tokens plus
   precision-validated Tibetan (`thor bu`, `bka' 'bum`, `gsung 'bum`) and Greek/
   Latin (`operum`, `corpus`). A broad "decompose anything with ≥2 chapters" rule
   is **deliberately rejected** — Latin/German/Sanskrit FT books are
   monograph-dominated (descriptive chapter titles ≠ distinct works), so it would
   over-count. CJK collected-works tokens were measured and dropped (no genuine
   yield in this corpus). Re-validate any new token against a sample before adding.
2. **Clean.** Thin (<2pp) entries carry low confidence — they are kept but
   down-weighted, not silently dropped. The 76 chapterless containers + thin/low-reach
   residual route to AI extraction — **paid, ask before scaling** (Derek's rule).
3. **Verify per constituent.** ft-verify each `is_first_translation` before it counts.
4. **Promote.** `verified: true` only after validation. `confidence`/`provenance`
   stay so consumers can filter.

## The count

`countFirstTranslatedWorks(ftBooks, { mode })` in `scripts/lib/contents-works.mjs` is
the single canonical function, wired into **both** stats writers
(`update-homepage-stats.mjs`, `prewarm-browse.mjs`):

- **`mode: 'verified'`** (default, surfaceable) — `Σ max(1, verified-FT constituents)`.
  Book-floored. Equals the book count until the ft-verify pass lands, then grows.
  Written to `homepage_stats.firstTranslatedWorks`.
- **`mode: 'provisional'`** (internal upper bound) — `Σ max(1, contents_works.length)`.
  Written to `homepage_stats.firstTranslatedWorksProvisional`, clearly an upper bound.

The existing **book** count (`firstTranslationCount`) is unchanged and stays the
rendered headline — the new figures are additive until verification justifies the
swap (#2913 Phase 4). Hard invariant, asserted in code: **count ≥ books** — a result
below the floor means clustering was conflated with counting (a bug).

## Guardrails (carried from #2913 / #2916)

- Provisional by default; never seed unverified sub-works as authoritative.
- Per-constituent FT is **unverified** until ft-verify'd — ~3,157 is an **upper
  bound** on first-translated works, not a fact.
- Reversible writes only (dry-run + backup, #2318 discipline). Ask before paid AI.
- The only downward correction to the count is **exact duplicate records** — never
  multi-volume sets, never multi-edition holdings.

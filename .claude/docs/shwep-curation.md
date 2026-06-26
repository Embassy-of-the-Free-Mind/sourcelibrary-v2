# Podcast/Lecture Series Curation

## Overview

Replicable process for creating curated pages that cross-reference podcast episodes with Source Library books. Built for SHWEP (Secret History of Western Esotericism Podcast); same pattern applies to any lecture series with bibliographic references.

## Pipeline

```
CRAWL EPISODES → MATCH BOOKS → ASSIGN PERIODS → GENERATE TS DATA → CLEAN TAGS → RENDER PAGE → IMPORT MISSING BOOKS
```

## Steps

### 1. Crawl Episodes

Scrape the podcast's website for episode metadata. Output: JSONL with one episode per line.

```bash
# SHWEP: WordPress post indices n=0-322
node _tmp-add-new-episodes.mjs
# Output: /tmp/shwep_crawled_all.jsonl
```

Each episode record: `{ number, title, url, cited_works[] }`.

### 2. Cited-works → holdings (the "process matcher")

> Superseded the old naive exact/substring tag match. Driver:
> `scripts/enrichment/shwep-cited-works.mjs` (staged + resumable; cache in
> `/tmp/shwep-cited/`). Model: `gemini-3.1-flash-lite` throughout.

Stages (`--extract | --dedupe | --holdings | --emit | --linkbib | --gap-audit`):

1. **extract** — per episode, LLM pulls the historical primary works cited in Earl
   Fontainelle's bibliography (originals, even when cited via a modern edition).
2. **dedupe** — cluster raw works → canonical works (exact key + LLM canonicalisation).
3. **holdings** — the matcher proper, validated 10/10 (#76) and 9/9 + 0 FP (Islamicate/
   Byzantine tail) vs 6/10 single-shot:
   - **normalize** each work → canonical title forms in ALL languages + extant/lost status;
   - **retrieve** = embed title-forms (`match_books_semantic`) ∪ **author-anchored**
     collected-works editions (embedding ranks a treatise title poorly against
     "Complete Works of X");
   - **per-candidate confirm** (flash-lite) — accepts an edition/translation/commentary
     of *this exact work by this author*, OR a complete-works of the author that would
     *contain* it (genre-aware: an alchemical epistle is not in a "Philosophical Works");
     rejects lost works, same-author-wrong-work, name collisions (Philo ≠ Philoponus).
   - A deterministic **author guard** drops title-coincidence false positives.
4. **emit** — writes the data files (below).
5. **linkbib** — injects inline `/book/…` links into each episode's displayed
   bibliography (verbatim-faithful — spliced, never regenerated), and emits
   supplementary cards for held works not inline-linked. Skips works cited only in a
   **dated edition citation** (linking our edition there would misattribute the cited
   edition). Hand-curated #76/#323 preserved verbatim as the quality bar.
6. **gap-audit** (read-only) — re-checks "acquire" works against the FULL catalog
   (incl. hidden/draft) → `held_readable` / `held_unprocessed` / `absent`. Run this
   before concluding we don't own something (visible-only checks undercount ownership).

**Shared primitives** live in `scripts/lib/holdings-resolver.mjs` (`translatedRatio`,
`bestEdition` = completeness-tiered + dedicated-over-collected, `holdingStatus`,
`isCollected`, `editionReadable`/`editionVisible`) — the works-catalog (#2453/#2567)
imports the same logic. **Two predicates, kept separate:** OWNERSHIP+PROCESSED
(full-catalog) vs the PUBLIC-LINK gate (visible) — collapsing them re-acquires what we own.

**Parts of books:** when a cited work resolves to a collected/omnibus edition, it
deep-links to the treatise's page via `book.chapters[].pageId` (`chapterMatch`, ≥0.8
token overlap, conservative) — inline links, supplementary cards, and the grid all do this.

**Author/year filters:** retrieval already gates `visible:true && pages_count>0`; inline
links additionally require `pages_translated>0` (readable). No pre-1930 filter.

### 3. Assign Periods

Categorize episodes by keyword matching in the title. Each series defines its own period taxonomy.

SHWEP periods: `intro`, `nearEast`, `preSocratic`, `plato`, `hellenistic`, `roman`, `hermetica`, `neoplatonism`, `iamblichus`, `lateMagic`, `christianFathers`, `athenianAcademy`, `postAntiquity`.

### 4. Generate TypeScript Data File

Episodes stored as typed arrays organized by period in `src/data/<series>-episodes.ts`.

```typescript
{ number: 42, title: "Plato's Allegory of the Cave", url: "https://...", period: "plato", tags: ["Plato", "Republic"] }
```

**Note:** `src/data/` is in `.gitignore` — use `git add -f` to commit data files.

### 5. Clean Noisy Tags

Remove bibliography fragments, common words, overly generic terms. Manual review of tag list sorted alphabetically.

```bash
node /tmp/list-shwep-tags.mjs    # Extract and count unique tags
node /tmp/clean-shwep-tags.mjs   # Remove noisy tags from TS file
```

### 6. Render Page

The reading room reads pre-computed data (no render-time matching). The episode page
(`src/app/shwep/[number]/page.tsx` via `src/app/shwep/shwep-data.ts`): if the episode has
an inline-linked bibliography it renders that (works underlined in rust = "read here"),
plus an "Also in Source Library" grid of held works not linked inline; otherwise it renders
the plain bibliography + the work-centric "Read in Source Library" grid. Both surfaces
deep-link to a treatise page when the edition is a collected volume.

### 7. Acquisition (don't over-acquire)

Run `--gap-audit` first: most apparent gaps are held-but-hidden/unprocessed, not absent
(we hold 16 Philo editions; the visible-only matcher saw one). Genuine absent works are
mostly copyright-only translations (defer). Triage PD availability before importing.

## Key Files

| File | Purpose |
|------|---------|
| `scripts/enrichment/shwep-cited-works.mjs` | The cited-works → holdings → linked-bib pipeline (all stages) |
| `scripts/lib/holdings-resolver.mjs` | Shared holdings primitives (bestEdition, holdingStatus, …) — also used by the works-catalog |
| `src/data/shwep-cited-works.ts` | Works DB (held vs acquire, per edition) |
| `src/data/shwep-book-matches.ts` | Work-centric "Read in Source Library" grid per episode (`{id, page?}[]`) |
| `src/data/shwep-linked-bibliographies.ts` | Inline-linked bibliographies (auto + hand-curated #76/#323) |
| `src/data/shwep-supplementary-works.ts` | Held works not inline-linked, shown as cards (`{id, page?}[]`) |
| `src/data/shwep-episodes.ts` | Episode data (period taxonomy) |
| `src/app/shwep/shwep-data.ts`, `src/app/shwep/[number]/page.tsx` | Reading-room data layer + episode page |
| `/tmp/shwep-cited/` | Stage cache (extracted/works/works-held/gap-audit) |

Convergence with the universal works catalog (#2453) and the shared resolver is tracked in
**#2632** (acquisition triage) and **#2567** (works knowledge-layer architecture).

## Replicability

Same pattern works for any series with bibliographic references:

| Candidate | Source format |
|-----------|--------------|
| History of Philosophy Without Any Gaps | WordPress blog |
| Wouter Hanegraaff lectures | YouTube/course listings |
| The Symposium podcast | Podcast RSS feed |

Each new series needs:
1. A crawl script tailored to the source website
2. Period/category taxonomy defined for the series
3. Tag noise filtering pass (always needed — raw matches are noisy)
4. A page component (can be templated from `src/app/shwep/page.tsx`)

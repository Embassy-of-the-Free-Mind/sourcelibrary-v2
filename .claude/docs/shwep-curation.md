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

### 2. Cross-Reference Against MongoDB

Match cited works against `books` collection (`bookstore` database).

| Match type | Logic |
|-----------|-------|
| Exact | Case-insensitive on `title`, `display_title`, `author` |
| Substring | Minimum 12 chars on same fields |
| Year filter | Pre-1930 books only (`year` or `published` field) |

**Noise filter:** Skip words <5 chars, lowercase-starting words, journal/proceedings names, HTML entities.

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

Page component matches tags at render time against MongoDB books via regex search. Clicking a tag opens Source Library search for that text.

### 7. Import Missing Books

Identify referenced works not yet in the collection. Search digital archives (IA, Gallica, MDZ, etc.) and import via standard import APIs.

## Key Files

| File | Purpose |
|------|---------|
| `src/data/shwep-episodes.ts` | Episode data (260 episodes, 199 unique tags) |
| `src/app/shwep/page.tsx` | Rendering page |
| `/tmp/shwep_crawled_all.jsonl` | Raw crawl data |

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

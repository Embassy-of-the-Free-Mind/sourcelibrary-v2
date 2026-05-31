# Author thesaurus read-path migration (#2250)

Step 2.5 of #2179. Wires the built-but-orphaned `authors` collection into
`/author/[slug]` so every person has one canonical URL and variant slugs 301 to
it. Flag-gated; off by default.

## State verified (2026-05-31, production `bookstore`)

- `authors`: **4,815** docs (4,792 `is_person`); 3,353 carry a `wikidata_id`,
  2,528 a `viaf_id`. 3,276 have ≥1 `entity_ids`.
- `system_config.author_slugs` cache: **8,854** entries — vs 4,815 persons → the
  duplicate-URL surface.
- Live books (`visible:true, pages_count>0`): **17,456**; **6,295** have no
  `author_entity_id`.
- **Zero production read-path consumers of `authors`** before this change — the
  route resolved via `author_slugs` cache + legacy `entities`.

## What this PR ships (Part A — read-path dedup)

`src/lib/author-thesaurus.ts` — `resolveCanonicalAuthor(db, slug, projection)`:

1. Match slug against `authors` `_id`/`slug`/`variant_slugs`.
2. Miss → look up slug in `author_slugs` cache, match its NAME (normalized)
   against `variants[]`. This auto-resolves orphan slugs with **no static map**.
3. Fetch books as a UNION: `author_entity_id ∈ entity_ids` **OR**
   `author ∈ variants`. The second arm is why ~2,278 entity-less but
   name-matching books land on the right page for free, no DB write.
4. Enrich description/portrait/life-dates from the first linked `entities` doc.

`src/app/author/[name]/page.tsx` — behind `AUTHOR_THESAURUS_READPATH`: resolve
canonically, 301 when the requested slug ≠ canonical slug, else fall back to the
legacy path (no page regresses while the tail is still being linked).

### Proven against production data (query logic replicated)

- `kircher-athanasius` → **301** → `athanasius-kircher` (191 books, vs the stale
  `book_count:71`). Kircher's 8 URLs collapse toward 1.
- `philip-melanchthon` → **301** → `melanchthon-philipp` (Latin/vernacular merge).
- `john-calvin` → canonical, 9 books (entity-less books surfaced by name arm).
- Coverage over all 8,854 cache slugs: **6,833 resolve via thesaurus** (3,034
  already canonical, 2,525 variant-slug 301s, 1,274 name-fallback 301s); 2,021
  unresolved fall through to the legacy path. → **~3,799 duplicate URLs collapse
  to a canonical.**

## Part B — the 6,295 entity-less books (profiled, not all "fragmented")

The issue's "6,253 fragmented persons" overstates it:

- **3,168** are placeholder / anonymous / institution strings (Unknown,
  Anonymous, monastery collections, "Egyptian", Catholic Church, Various) — these
  are correctly anonymous/collection, not persons. Top: Unknown (943), Anonymous
  (469), Ogyen Choling Collection (440).
- **42** empty author.
- **2,278** books whose author string **exactly matches a canonical author name**
  → fixed at read time by the variant-name arm above; no write needed.
- The genuine hard tail is the remainder (~800 books across ~700 distinct
  strings) — needs fuzzy match or scholar curation (Part E).

## Part C — redirect map + a NEW data-quality finding

No static redirect map needed — the resolver redirects dynamically (see Part A
coverage). But the proof surfaced that **the build script wrote
title-contaminated strings as their own "person" docs**:

- `kircher-mundus`, `kircher-oedipus`, `kircher-musurgia`, `kircher-magneticum`
  exist as separate `authors` docs (work titles leaked into the author field).
  They resolve to *themselves* (no redirect) and won't merge into Athanasius
  Kircher without a cleanup pass.
- Scale: **804 unanchored docs** (no viaf/wikidata/entity), **667 with ≤1 book** —
  a mix of these junk title-contaminated docs and the genuine obscure tail.

**Follow-up (not in this PR):** a merge script that detects author docs whose
surname matches a richer anchored canonical doc and folds them in (precision-
first, under-merge over mis-merge — the #2218 stance). The quarantine pass
(#2230) flagged institutions but not title-contaminated strings.

## How to enable / test

Set `AUTHOR_THESAURUS_READPATH=1`. **Verify on a Vercel preview before
production cutover** (per #2250 guardrail): spot-check canonical URL + 301 on
Kircher, Melanchthon, a co-author compound, and a legacy-fallback miss.

## Not in this PR (deliberately out of scope)

- Browse-by-author / sitemaps / `warm-author-pages.mjs` enumerating canonical
  persons instead of strings (Part B of the issue).
- Internal byline links building from the canonical person.
- The title-contamination merge script + tail linking (Part C/E).
- SKOS schema extension (`pref_label`/`alt_labels`/`related`/`provenance`) and
  Wikidata contribution (Parts A-schema / D).

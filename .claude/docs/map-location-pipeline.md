# `/explore/map` location pipeline

How dots get onto the map at https://sourcelibrary.org/explore/map, and which
script owns which step. Written after the 2026-06-27 coverage push
(38.5% → 60.3% of visible books plotted).

## The shape of it

The map page (`src/app/explore/map/page.tsx`) does **not** query books live. It
reads a pre-computed snapshot from `system_config.map_data` (Mongo) and only
falls back to a live aggregate when that doc is empty. Page ISR is daily
(`revalidate = 86400`).

A book appears on the map iff it has at least one entry in `books.locations[]`
with `lat`/`lng`/`city`. Each entry has a `type` (`publication`, `author_birth`,
`author_death`, `origin`), a `source`, and a `confidence`. One book can carry
several dots (e.g. publication city + author birthplace).

```
books.locations[]  ──(group by city+type)──►  system_config.map_data  ──►  page.tsx
        ▲                                              ▲
        │ written by geocoders                         │ rebuilt nightly by
        │                                              └─ build-map-cache.mjs (cron 05:45)
        └── publication / author / origin geocoders (cron 05:15)
```

**Two cron jobs on the Hetzner box** (`root@46.224.122.120`, `crontab -l`):

- `15 5 * * *` — geocoders that **create** `locations[]` on books (chained).
- `45 5 * * *` — `build-map-cache.mjs`, which **re-snapshots** existing
  `locations[]` into `system_config.map_data`.

The cache rebuild only re-reads what the geocoders wrote. If the geocoders stop,
the cache still refreshes nightly but reaches the same books — the map looks
"stale" (frozen reach) even though the cron is green. This is the failure mode
that was fixed on 2026-06-27.

## The location writers

### Publication place — `scripts/enrichment/geocode-publication-places.mjs`
Geocodes `place_of_publication` / `place_published` imprint strings to
coordinates via Wikidata + a curated city gazetteer. `type: 'publication'`.

### Tradition origin — `scripts/enrichment/geocode-origin-by-tradition.mjs`
Infers a heartland from language for *strongly-bound* traditions only
(Tibetan→Lhasa, Ge'ez→Aksum, Sanskrit→Varanasi, …). Diffuse languages
(Latin/Greek/Hebrew/Arabic/European vernaculars) are deliberately **excluded** —
a single dot would misrepresent them. `type: 'origin'`, `confidence: 'inferred'`,
fallback-only.

### Author birth/death — two scripts, two identity layers

Author dots come from a person's Wikidata P19 (birthplace) / P20 (deathplace).
The question is *which* author-identity layer supplies the Wikidata QID:

| Script | Identity source | QID provenance | Risk |
| --- | --- | --- | --- |
| `backfill-author-locations.mjs` | legacy `entities` collection, joined via `books.author_entity_id` | name-matched to Wikidata | can grab the wrong same-name person (see the William-Law→Shirer class of bug) |
| **`backfill-thesaurus-author-locations.mjs`** ⭐ | canonical `authors` thesaurus, joined via `books.author_id` | **pre-grounded** `authors.wikidata_id` (VIAF/Wikidata-anchored, incl. PR #2630 fixes) | none beyond what's already in the thesaurus |

**The thesaurus script is the preferred path.** It takes identity as *given*
from the canonical layer (no name-matching), fills `authors.birth_place` /
`authors.death_place` (the thesaurus shipped with zero of these), and writes
dots to books via `author_id`. Its dots carry `source: 'wikidata-thesaurus'`.

The entities script still has a job: authors that aren't in the thesaurus yet.
Both scripts skip any book that already has an `author_birth`/`author_death`
dot, so they never double-write against each other.

> **Important nuance:** `backfill-author-locations.mjs` only propagates author
> places to books when run with `--write-books` (step 3 is gated on it). Without
> the flag it enriches `entities.birth_place` but the books never get a dot.
> Both the cron line and any manual run must pass `--write-books`.

## Reversibility

Every writer tags its dots with a `source`, so any layer can be pulled back out:

```js
// Remove all thesaurus-sourced author dots:
db.books.updateMany({}, { $pull: { locations: { source: 'wikidata-thesaurus' } } })
// Unset thesaurus place fields:
db.authors.updateMany({}, { $unset: { birth_place: '', death_place: '' } })
// Remove the tradition-origin layer:
db.books.updateMany({}, { $pull: { locations: { source: 'tradition' } } })
```

After any change, rebuild + republish:

```bash
node scripts/maintenance/build-map-cache.mjs
# force the live page to pick it up without a deploy:
curl -s -X POST "https://sourcelibrary.org/api/admin/revalidate" \
  -H "x-revalidate-secret: $REVALIDATE_SECRET" -H "Content-Type: application/json" \
  --data '{"paths":["/explore/map"]}'
```

## Coverage ceiling

Coverage is gated by metadata that already exists: a book gets an author dot
only if its author is identified *and* that identity has a Wikidata birthplace.
As of 2026-06-27, ~60% of visible books are plotted. The remaining tail is
mostly books whose author has no Wikidata-grounded identity, or whose author is
in Wikidata but Wikidata itself records no birthplace — neither is fixable by
the geocoders. Growing past this means more author→Wikidata grounding upstream
(the `authors` thesaurus), not changes here.

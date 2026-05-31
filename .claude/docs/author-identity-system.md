# Author identity system

How Source Library answers "who wrote this, and is *this* Andreas the same as
*that* Andreas?" — the data model, the read path, provenance, and the migration
that's in flight. Umbrella issue: **#2179**; this doc's read-path + linking work:
**#2250**. Related: #2202 (build), #2218 (grounded reconcile), #2230 (quarantine).

> **Why this exists.** A reader wants *one* page with *all* of an author's books.
> A scholar wants that identity to be **authoritative, auditable, and citable**.
> Author identity is navigation + scholarly-accountability infrastructure, not
> decoration. Everything below serves that.

---

## 1. The layers (and which is canonical)

A book's authorship is represented at four levels of increasing authority:

| Field on `books` | What it is | Authority |
|---|---|---|
| `author` (string) | The raw author string as catalogued ("Manuzio, Aldo", "Kircher, Athanasius"). One person has many forms. | Source data — never the identity. |
| `author_entity_id` → `entities._id` | Link to the **legacy** `entities` collection. Partial coverage. | **Being retired.** |
| `author_id` → `authors._id` | Link to the **canonical thesaurus** (`authors`), keyed by slug. | **Canonical FK (forward).** |
| `authors.viaf_id` / `wikidata_id` | External authority anchors on the canonical doc. | Interop / citation. |

`entities` is the old per-string entity layer; `authors` is the new one-doc-per-
person thesaurus that supersedes it. During the migration both `author_entity_id`
and `author_id` are written (transitional); new consumers should read `author_id`.

### The `authors` thesaurus doc (`authors` collection)

Built by `scripts/maintenance/build-canonical-authors.mjs` (#2202). One doc per
canonical person:

```
_id            "athanasius-kircher"        // == canonical slug
canonical_name "Athanasius Kircher"
slug           "athanasius-kircher"
variants       ["Athanasius Kircher", "Kircher, Athanasius"]   // every author STRING form
variant_slugs  ["athanasius-kircher", "kircher-athanasius"]    // every URL form that resolves here
entity_ids     ["6957ef96…"]               // legacy entities merged into this person
viaf_id        "31998409"                  // external anchors (may be null)
wikidata_id    "Q76738"
book_count     71                          // STALE — build-time snapshot, do not trust at render
source         "build-canonical-authors"
built_at       <ISO>
```

**`book_count` is stale** — it's a build snapshot. The true count is the live
read-path query (Kircher: doc says 71, actual live is 191). Never render it.

---

## 2. Read path — `/author/[slug]`

`src/app/author/[name]/page.tsx` + `src/lib/author-thesaurus.ts`.

Gated by **`AUTHOR_THESAURUS_READPATH`** (env, `1`/`true`). When **off**, the
legacy path runs: slug → name via the `system_config.author_slugs` cache → book
with that string → `entities` doc. When **on**:

1. **Resolve slug → canonical person** (`resolveCanonicalAuthor`):
   - direct: `authors` where `_id` / `slug` / `variant_slugs` == slug;
   - fallback: look the slug up in the `author_slugs` cache, match its NAME
     (NFD-normalized) against `variants[]`. This redirects orphan/title-stale
     slugs **dynamically — no static redirect map is maintained.**
2. **Redirect to the canonical slug** when the requested slug ≠ `doc.slug`. One
   person, one URL; every variant collapses to it. Uses Next `redirect()` (**307
   temporary**) deliberately during the flagged rollout — a permanent 308 would be
   cached by browsers/search engines and survive a flag-off. **Switch to
   `permanentRedirect()` (308) at cutover**, when the flag is removed.
3. **Fetch the deduplicated book set** as a UNION, in authority order:
   `author_id == slug` **∪** `author_entity_id ∈ entity_ids` **∪** `author ∈ variants`.
   The third arm is a self-healing fallback for books not yet backfilled.
4. **Enrich** life-dates / portrait / description from the first linked `entities`
   doc (offline-populated; never fetched at render).
5. On any miss, fall back to the legacy path — **no author page regresses** while
   the tail is still being linked.

Coverage (2026-05-31, all 8,854 `author_slugs` entries): **6,833 resolve via the
thesaurus**, of which **~3,799 duplicate URLs redirect to a canonical**; 2,021 fall
through to legacy. Examples: `kircher-athanasius` → `athanasius-kircher` (191
books); `philip-melanchthon` → `melanchthon-philipp` (Latin/vernacular merge).

**Rollout discipline:** ship the flag **off**; verify canonical-URL + redirect on
a Vercel preview with `AUTHOR_THESAURUS_READPATH=1` before production cutover
(#2250 guardrail). The hot path is author pages + sitemaps + SEO.

---

## 3. Provenance — every identity assertion is auditable

The principle: **a link to a person must record who/what asserted it, when, and
with what confidence**, so it can be reviewed and reversed.

### Book → person link provenance

`scripts/maintenance/backfill-author-canonical-links.mjs` writes
`books.author_link_provenance[]`, one record per assertion:

```
{ run:"backfill-2250",
  method:"exact-string-match",      // book.author is verbatim a variants[] entry
  matched:"John Calvin",            // the string that matched
  authors_slug:"john-calvin",       // the person it resolved to
  anchored:true,                    // target carries viaf/wikidata
  confidence:"high",                // high = anchored, medium = unanchored
  at:<ISO> }
```

This makes the corpus segmentable ("show me every medium-confidence link to an
unanchored person") and the whole run reversible (`--undo --apply` unsets
`author_id` and pulls the provenance where `run == "backfill-2250"`).

**Identity-assertion provenance on the `authors` docs themselves** (who asserted
the VIAF/Wikidata anchor — build vs grounded-LLM #2218 vs human scholar) is the
SKOS-schema extension still pending (#2250 Part A): `provenance[]`, `pref_label`/
`alt_labels[]`, and `related[]`/`broader` edges for pseudonym/attribution
modelling (`Pseudo-Lull → attributed-to → Ramon Llull`).

---

## 4. Linking the tail — what's been backfilled

`backfill-author-canonical-links.mjs` (#2250 Part C). **Safety model:** a book is
linked only when its author STRING is verbatim (NFD-normalized) one of the
`variants[]` of **exactly one** canonical person — exact self-linkage, never
fuzzy guessing. Strings mapping to >1 doc are **skipped** (under-merge over
mis-merge). Every write is additive + reversible.

Applied 2026-05-31 — of 6,253 entity-less live books:

- **2,274 linked** (`author_id` set; `author_entity_id` also backfilled on the 139
  whose canonical doc carries an entity). 1,164 high-confidence (anchored), 1,110
  medium (unanchored — real obscure people *and* known junk, see §5).
- **4 skipped** ambiguous; **3,975 no canonical match** — placeholder/anonymous/
  institution strings (Unknown 943, Anonymous 469, monastery collections, …) that
  are correctly *not* persons, plus the genuine hard tail.

Verified post-write: 2,274 `author_id` + provenance, `author_id_1` index created.

---

## 5. Thesaurus cleanup — DONE (`dedup-canonical-authors.mjs`, 2026-05-31)

Applied via `scripts/maintenance/dedup-canonical-authors.mjs` (dry-run default,
`--undo`-reversible, additive — folds to tombstones, never deletes). 4,792 → 4,765
canonical persons.

- **Self-dedup: 14 clusters, 18 docs folded.** Precision-first: 12 by shared
  `entity_id` (the build already judged them one person), 2 by safe co-author-
  compound fold (`bacon-roger` "Bacon, Roger|Alexander" → `roger-bacon`). The
  secondary becomes `{merged_into, is_person:false}`; the resolver follows it →
  301. **3 held for human review** (NOT merged): `persius`/`persius-2` (the poet
  conflated with publisher "D.P. Pers"), `johann-michael-faust` ×2 (two distinct
  VIAFs), `alfonso` ×2 (generic single name).
- **Title-contamination: explicit allowlist only.** The 4 Kircher work-title docs
  (`kircher-mundus`/`-oedipus`/`-musurgia`/`-magneticum`) folded into
  `athanasius-kircher` — so all **8 of Kircher's original slugs now resolve to one
  person**. A general surname-key heuristic was **tried and rejected**: it
  mis-merged distinct same-surname people ("George Washington" → "Washington
  Matthews", "Karl Müller" → "F. Max Müller"). Author-title disambiguation is not
  safely automatable — remaining title-contaminated docs go to human / Scholar-in-
  Residence review.
- **Quarantine misses: 5 flagged** `is_person:false` (Bayerische Staatsibliothek,
  Kanze School, Confessio Fraternitatis, Fama Fraternitatis, Italian School).
- **`book_count` recomputed live** on all 4,765 survivors — the stale build
  snapshot is gone (Kircher 71 → 193). Still: don't *render* it as ground truth; the
  read-path live query is canonical. It's now a maintained convenience field.

## 5b. Remaining follow-ups

1. **Enumerate canonical persons, not strings.** Browse-by-author, sitemaps,
   `warm-author-pages.mjs`, `revalidate-authors` still enumerate distinct author
   strings — migrate them to enumerate `authors` docs so each person appears once.
5. **Byline links from the canonical person.** Book bylines build via
   `authorSlug(raw_string)`; they should resolve to the canonical slug, and
   co-author compounds should link each constituent.
6. **Corpus-wide `author_id`.** Only entity-less matched books carry `author_id`
   today; a follow-up should populate it across all books (including entity-linked
   ones) so it's the single canonical key everywhere.
7. **Wikidata contribution (#2250 Part D).** For confident, notable, citable
   middle-tier figures lacking a Wikidata item, create one → flows back into VIAF.
   Do *not* push obscure/pseudonymous attributions; those stay in our local layer.
8. **Scholar curation (#2250 Part E).** The residual hard tail needs human
   adjudication, routed through Scholar-in-Residence — author identity as a
   curatorial deliverable with provenance, not another LLM pass (#2218 showed the
   automated ceiling).

---

## 6. File map

| File | Role |
|---|---|
| `src/lib/author-thesaurus.ts` | `resolveCanonicalAuthor()` — the read-path resolver. |
| `src/app/author/[name]/page.tsx` | Author page; flag-gated canonical branch + 301. |
| `scripts/maintenance/build-canonical-authors.mjs` | Builds the `authors` thesaurus (#2202). |
| `scripts/maintenance/quarantine-non-person-authors.mjs` | Flags non-persons `is_person:false` (#2230). |
| `scripts/maintenance/backfill-author-canonical-links.mjs` | Links the tail; writes `author_id` + provenance (#2250). |
| `scripts/maintenance/dedup-canonical-authors.mjs` | Self-dedup + title-fold + quarantine + `book_count` recompute (#2250 §5). |
| `system_config.author_slugs` (Mongo) | Legacy slug→name cache; still the orphan-resolution source. |

memory: `project_author_entity_resolver`, `project_authority_linking`,
`project_ft_and_canonical_author_pipeline`, `project_scholar_in_residence`.

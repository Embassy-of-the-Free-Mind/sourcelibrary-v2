# Translation & Works knowledge layer — architecture map

**Read this first** for anything touching works, work identity, translation
status, the translation gap/registry, or first-translation claims. It's the map;
the detailed docs (linked at the bottom) are the territory. Coordination home:
issue **#2567**.

## The one question, and why it bottoms out in identity

Almost everything here is a *per-work* question:

> *Has **this work** ever been translated to English? Do we hold **this work**?
> Is this the **first** translation of **this work**?*

Author identity alone can't answer it — "Pico has *a* translation" is not "Pico's
*Oration* has a translation." So the whole stack rests on **work identity**: a
stable key that says *these editions, in any language, are the same work*. Get
identity wrong by **over-merging** and you fabricate a false "first translation."
Hence the governing policy everywhere below:

> **When in doubt, MORE works (under-cluster).** A wrongly-split work can be
> merged later; a wrongly-fused pair is a false claim. *Under-cluster over
> mis-cluster.*

## The layer stack (bottom → top)

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  SURFACES   /research/translation-registry · /research/translation-gap │
 │             /work/[slug] (reader)         · #2453 catalog (census)     │
 ├─────────────────────────────────────────────────────────────────────┤
 │  4. TRANSLATION EVIDENCE   external priors (registry) + SL holdings     │
 │     translation_catalogs · works.translation_status · work_sources     │
 ├─────────────────────────────────────────────────────────────────────┤
 │  3. HOLDINGS              do WE hold this work? which edition is best?  │
 │     work_holdings · books.work_id ⟷ work_slug · holdings-resolver.mjs   │
 ├─────────────────────────────────────────────────────────────────────┤
 │  2. WORK CATALOG          one row per work, all traditions             │
 │     #2453  works / work_sources / work_holdings   (Supabase)           │
 │     ustc_editions.work_cluster_id  (the Western/Latin edition frame)   │
 ├─────────────────────────────────────────────────────────────────────┤
 │  1. IDENTITY              who wrote it · which editions = one work      │
 │     authors (#2179) ─→ books.work_id / work_slug (#2264)               │
 └─────────────────────────────────────────────────────────────────────┘
```

### Layer 1 — Identity (the foundation)

- **Author thesaurus** (`authors` collection, `books.author_id`, epic #2179).
  One canonical person per id, with name variants / VIAF / Wikidata.
  Doc: `author-identity-system.md`, `author-normalization-method.md`.
- **Work identity** (`books.work_id` + `work_slug`, #2264). The reader-layer key:
  multiple of our books (originals + translations + editions, any language) share
  one `work_id` = one work. Built by the **deterministic local mint**
  `scripts/analysis/mint-local-work-ids.mjs`:
  `work_id = local:{a:author_id | n:author-name-slug}:{uniform-title-slug}`
  (OCLC FRBR work-key pattern). `work_slug` is the clean URL form
  (`assign-work-slugs.mjs`); `/work/[slug]` accepts either.
  - **Why local, not Wikidata:** the Wikidata P50 resolver is *exhausted* on this
    esoteric corpus (0 new HIGH on the full Latin gap). A work_id need not resolve
    to an external authority — a deterministic local key is the backbone; QIDs /
    `translation_catalogs` are enrichment on top.
  - `work_id_source`: `local-mint` (the bulk) · `wikidata:P50` ·
    `work-merge:{llm-verified | hand-adjudicated | identical-title-deterministic}`.
    The merge tiers collapse cross-language variants no string rule catches
    (Agrippa *De occulta* ⇄ *Three Books of Occult Philosophy*).
  - **State (2026-06-21): 97% of textual books carry a work_id**, automated by a
    daily mint cron so it doesn't decay as imports arrive. Full detail + the
    "more works" edge-case rules (volume splits, parenthetical sigla, collected-
    works containers, hidden-book minting): `work-identity-coverage.md`.

### Layer 2 — Work catalog (the corpus frame)

Two complementary frames, one per "side" of the corpus:

- **`ustc_editions`** (Supabase, ~1.63M editions, ~503k Latin). The *edition*
  registry for the Western/early-modern printed record. `work_cluster_id`
  (`surname::normalized-title`) groups editions into works — the denominator for
  the translation gap. `year` is PRINT year (includes reprints of ancient works).
- **#2453 universal works catalog** (Supabase: `works` / `work_sources` /
  `work_holdings`). One row per *work*, across **all traditions** — Tibetan,
  Chinese, Sanskrit, Hebrew, Islamicate, … and now **Latin/Western** (the
  convergence). Sits ABOVE the edition registries. Doc:
  `scripts/works-catalog/README.md`, `works-catalog-provenance.md`.
  - `works`: `id` (prefixed authority id — `wd:Q…`, `kr:…`, `latin:author:title`,
    or `cite:…` provisional for unresolved citations), `tradition`,
    `translation_status` (unknown|none|partial|full) + `translation_method`
    (census-auto|hand-verified|claimed) + `translation_evidence`,
    `authority_ids` (jsonb — incl. `work_slug` cross-linking to the reader layer),
    `provisional` / `merged_into`.
  - `work_sources`: scans / transcriptions / **translations** per work, with
    `kind`, `rights` (public-domain ⇒ importable), provenance.
  - `work_holdings`: our Mongo books mapped to a work (Layer 3).

### Layer 3 — Holdings (do *we* hold it, and which edition is readable?)

The shared resolver **`scripts/lib/holdings-resolver.mjs`** — pure functions, one
matcher for everyone (the registry, the SHWEP citation layer, the catalog):

- `translatedRatio(book)` — translated ÷ real (non-blank) page count.
- `bestEdition(books)` — the most readable edition (completeness-tiered, prefers a
  dedicated edition over a collected dump). Pass the VISIBLE subset for a reader
  link; the full set for ownership.
- `holdingStatus(books)` → `held_readable | held_unprocessed | absent` —
  **OWNERSHIP truth, visibility-agnostic** (full catalog incl. hidden).
- `editionVisible` / `editionReadable` — the two predicates kept **separate**.

> **Two predicates, never collapsed** (it bit both the registry and SHWEP — the
> "Philo in 16 hidden editions we nearly re-acquired"): *ownership* = full catalog
> incl. hidden (`work_holdings.status`); *public read-link* = `visible AND
> readable` on top. Conflating them either re-buys what you own or links readers
> to a hidden book.

### Layer 4 — Translation evidence (the gap, the registry)

What has been Englished, by whom — and the gap of what hasn't.

- **`translation_catalogs`** (Supabase, ~27k rows) — assembled external
  translations (UNESCO Index Translationum, LoC, OpenLibrary, HathiTrust, +
  curated scholarly series: I Tatti, Brill, Loeb, Dumbarton Oaks). Enriched per
  row (author / Latin title / era / is_target) by a validated flash-lite pass.
- **The work-level prior layer** (`scripts/translation-layer/*`, #2626): matches
  external translations to `ustc_editions.work_cluster_id` at the **work** level
  (author-anchor + rare-token title containment), fixing the old author-level
  `has_english_translation` over-flag (Filelfo 63→1) and name-match under-flag
  (Pico 0→17). Emits the **registry** (works that HAVE been translated, with
  translators credited) and the **gap** (clusters with no external prior, ~97% of
  early-modern Latin). Converged into #2453 as `tradition='latin'` works +
  `work_sources(kind='translation')`. Doc: `translation-gap-methodology.md`,
  and the §"external-translation-prior layer" in `work-identity-coverage.md`.
- **First-translation** is the same question with a date: the first English
  expression of a work. Docs: `first-translation-system.md`,
  `ft-first-translation-paper.md`.

## The non-negotiable invariants

1. **External priors only.** A work counts as "already translated" only on
   evidence *independent of Source Library*. Our own SL translations are NEVER a
   prior — they ride a separate `work_holdings` channel with method tagging. Else
   we circularly erase the gap we exist to fill (the #2564 FT-reconcile incident).
2. **More works when in doubt** (under-cluster over mis-cluster) — §top.
3. **Ownership ≠ public-link** — two predicates, Layer 3.
4. **Translation status is an evidenced claim, never a bare boolean** —
   status + evidence + method, so a machine census is never mistaken for a
   verified scholarly translation. `is_first_translation:true` ≠ "we have it in
   English" (render gates require `pages_translated > 0`).
5. **Never infer a gap from an unlinked translation.** A `text_role:
   modern-translation` book usually sits beside its original as a separate,
   unlinked book — cluster by `work_id` and read coverage off the cluster; never
   guess "missing" from a half-filled `original_edition_id`.

## Work hierarchy & aggregation (the model that fixes compilations)

A `work_id` is not a flat label — a work is a node in a **part-of hierarchy**.
The *Poimandres* is a work in its own right AND a constituent of the *Corpus
Hermeticum*; Ficino's 1497 Aldine volume physically bundles independent works
(Iamblichus *De Mysteriis* + Proclus + Porphyry…). A flat key can't say either,
so it fragments (our *De Mysteriis* scattered across 5 ids). This is exactly the
distinction the cataloguing standards (IFLA-LRM, RDA, BIBFRAME, CTS/DTS) spent
two decades formalising — and **every documented catastrophe comes from erasing
it.** Full literature + citations: `work-hierarchy-modeling-research.md`.

**Two different edges — never one polymorphic `part_of`:**

1. **Intrinsic work whole/part** (work ↔ work). The component was *conceived as
   belonging to* the whole: *Poimandres* → *Corpus Hermeticum*, *Republic Book I*
   → *Republic*. Model as `work_part_of` / `work_has_part` (with `order` and a
   `dependent` flag — most treatises are independently citable, a single movement
   is not). Mirror to Wikidata `P361`/`P527` — but assert it yourself; real
   authorities are sparsely decomposed (Wikidata's *Corpus Hermeticum* doesn't
   even list the *Poimandres*).

2. **Editorial aggregation by a manifestation** (book → works). An editor *bound
   together* independent works. The LRM insight: an **aggregate is a property of
   the manifestation**, and the editorial selection-and-arrangement is **its own
   "aggregating work"** that does NOT contain the works it gathers. Ficino's 1497
   volume is its own aggregating-work; *De Mysteriis* is *embodied in* it, not a
   `work_part_of` child of it. Model as `book.contained_works[]` (the
   `manifestation_aggregates` edge), which the `resolve-contained-works.mjs`
   prototype already extracts from `book.chapters[]` with page anchors.

**Corpus Hermeticum → Poimandres is #1. Ficino-1497 → De Mysteriis is #2.** Same
surface symptom ("one id holding many works"), opposite cause — keep them separate
edges with separate names.

This maps cleanly onto the existing chapter/DTS layer (CTS/DTS draw the same line):
- the **work containment tree** (corpus → treatise → chapter as citeable units) = edge #1;
- **collection membership** (an edition embodies several works) = edge #2;
- a treatise is a citeable work-node that can be a member of *multiple* collections.

**Why this is the keystone, not just another edge:** it resolves the tension in
"more works." The fear with aggressive splitting is fragmentation (*Poimandres*
floating free of its corpus); the part-of edge dissolves it — distinct works AND
linked, so you get more works *and* one navigable whole. It also makes the
per-work questions precise: "first English of the *Poimandres*" (a part) ≠ "first
English of the *Corpus Hermeticum*" (the whole); holdings roll up (hold any part →
"some of the corpus"). **Standards' named pitfalls to avoid:** treating a
compilation as a work; demoting a treatise to "just a chapter"; assuming
co-membership implies a work relationship; relying on `hasPart` transitivity
(BIBFRAME's is non-transitive — declare corpus→chapter explicitly if you want it).

## How a work flows through, end to end

1. A book is imported → gets `author_id` (thesaurus) and, on the daily mint,
   `work_id` + `work_slug` (Layer 1).
2. Its editions cluster under one `work_id`; the reader sees them at `/work/<slug>`
   with `bestEdition()` choosing the readable one (Layer 3).
3. In parallel, the work exists in the catalog frame: a `work_cluster_id`
   (USTC, Western) and/or a `works` row (#2453), cross-linked by `work_slug`.
4. External translation evidence is matched to the work at work level → the
   registry credits the translator and the gap counts what's missing (Layer 4) →
   `works.translation_status` becomes an evidenced claim.
5. Surfaces read it: the **registry** ("here's what's translated, and who did it,
   read the original →"), the **gap** ("~97% never Englished"), the **/work** page,
   and the **#2453 catalog** census.

## Surfaces

| Surface | What | Source |
|---|---|---|
| `/research/translation-registry` | works translated to English + translators credited + "Read original" → `/work` | registry-data.json (built from Layer 4 + 3) |
| `/research/translation-gap` | the untranslated corpus, the defensible rate | the gap side of Layer 4 |
| `/work/[slug]` | one page per work, all editions, read the readable one | `books.work_id`/`work_slug` (Layer 1+3) |
| #2453 catalog | per-work census across traditions (scan/transcription/translation/holdings) | `works`/`work_sources`/`work_holdings` |

## Operations (scripts + schedule)

- **Mint work ids** (daily 02:30 cron, Hetzner): `mint-local-work-ids.mjs --apply
  --include-anon --include-parts --include-hidden` then `assign-work-slugs.mjs
  --apply`. Add `--remint-local` to re-derive existing ids after a normalization
  change (overwrites only `local-mint`; backed up).
- **Build the translation registry/gap** (`scripts/translation-layer/`, run in
  order): `01-build-external-works` → `02-pull-ustc-clusters` →
  `03-match-and-gap` → `07-work-registry` → `08-holdings`. README in that dir.
- **Ingest Latin into #2453** (Hetzner, `SUPABASE_DB_URL`):
  `scripts/works-catalog/ingest-latin-translations.mjs --write`.
- **Non-Western catalog ingests**: `scripts/works-catalog/ingest-*.mjs` (Kanripo,
  BDRC, OpenITI, Sefaria, …) — native-script work identity per tradition.

## Doc map (which detailed doc for what)

| For… | Read |
|---|---|
| this map / how it fits | **(this doc)** + issue #2567 |
| work_id mint, coverage, edge-case rules | `work-identity-coverage.md` |
| author thesaurus | `author-identity-system.md`, `author-normalization-method.md` |
| the #2453 catalog (schema, ingests, provenance) | `scripts/works-catalog/README.md`, `works-catalog-provenance.md`, `works-catalog-translation-census.md` |
| translation gap / registry method + numbers | `translation-gap-methodology.md` |
| work-dedup matching methods / research | `work-dedup-methods.md`, `work-identity-matching-research.md` |
| work hierarchy / aggregation model + the standards (LRM/RDA/BIBFRAME/CTS) + novelty/publication | `work-hierarchy-modeling-research.md` |
| first-translation system | `first-translation-system.md`, `ft-first-translation-paper.md` |

## Known frontier

- **Omnibus / compilation editions are the mint's blind spot (the *De Mysteriis*
  case).** A single `book.work_id` can't represent a volume that bundles several
  distinct works. The *model* for this is now formalized (§"Work hierarchy &
  aggregation"); what remains is *building* it. Ficino's 1497 Aldine volume — catalogued in our data under the
  title *"De Voluptate"* and one work_id — actually *contains* Iamblichus *De
  Mysteriis* (p5) + Proclus + Porphyry + Synesius + Psellus + Priscian + Plato,
  each in Ficino's Latin. The author+title key can only pick ONE contained work
  (so the same *De Mysteriis* fragments across `Q3359785` / `iamblichus-de-mysteriis`
  / `corpus-hermeticum`) or mash the whole table of contents into a slug. This is
  also where the *work vs expression* question bites: is Ficino's heavily-mediated
  Latin a translation-expression of Iamblichus' work, or a new Ficinian work? The
  mint has no signal for it.
  - **The fix is the contained-works layer**, not a better string key. The
    contained works ARE in `book.chapters[]` — each chapter names its author
    ("*Proclus on the Platonic Alcibiades*", "*Porphyry's On Abstinence*").
    **Prototype: `scripts/analysis/resolve-contained-works.mjs`** extracts them
    (14 compilations, 60 contained works on the Neoplatonic cluster), groups
    same-author chapter runs into one work with a page range, and best-effort
    resolves each to an existing standalone `work_id` (so `/book/<id>/page/<pageId>`
    is the deep link and FT/registry can ask "is THIS contained work translated").
    Resolution precision still needs work (author-anchored title match is loose);
    productionising means writing `book.contained_works[]` and teaching the
    `/work` + registry surfaces to read it. Pairs with the DTS navigation API.
- **CJK multi-juan** sets (Wubei Zhi, Bencao Gangmu) still fuse in the local mint
  — volume numbers are CJK-script and don't tokenize. Defensible as "one work in N
  juan," and the #2453 native-script ingests handle CJK work identity properly.
  Splitting them in the reader layer needs transliteration.
- **The keyless tail** (~375 mintable books): titles that reduce to only
  boilerplate words, multi-author anthologies. Plus ~274 keyless-by-design (no
  language tag — the mint requires one).

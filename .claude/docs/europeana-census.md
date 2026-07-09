# Europeana census (2026-06-09)

Survey of what Europeana aggregates in Source Library's subject areas, how much is
re-hostable, and how much overlaps what we already hold. Run before deciding whether
to build Europeana as an import source. Read-only.

**API key:** `EUROPEANA_API_KEY` (dedicated project key `logmarsagau`, created 2026-06-08;
replaced personal key `dietiterilip`). Stored in local `.env.production.local`, Vercel
(production + preview), and Hetzner `/root/sourcelibrary/.env.production.local`.
Search API: `https://api.europeana.eu/record/v2/search.json?wskey=…`. Higher rate limits
than personal keys. Scratch scripts: `scripts/_tmp-europeana-census.mjs`,
`scripts/_tmp-europeana-overlap.mjs` (untracked); raw counts in `scripts/output/europeana-census.json`.

## Subject coverage (TYPE:TEXT)

Counts are `total` / `open` (reusability=open: CC0/PD/CC-BY/CC-BY-SA) / `open+media`
(open AND has downloadable media):

| Subject | TEXT | open | open+media |
|---|---|---|---|
| astronomy/astronomia | 17,311 | 3,133 | 2,159 |
| kabbalah/cabala | 3,772 | 117 | 54 |
| magic/magia | 3,747 | 806 | 639 |
| astrology/astrologia | 2,957 | 892 | 681 |
| natural philosophy | 2,431 | 406 | 328 |
| emblem/emblemata | 2,130 | 650 | 307 |
| alchemy | 1,522 | 95 | 75 |
| theosophy | 1,389 | 45 | 35 |
| paracelsus | 1,364 | 49 | 39 |
| alchemia | 1,280 | 75 | 60 |
| hermetica/hermetic | 235 | 17 | 10 |
| gnostic/gnosticism | 76 | 9 | 4 |
| rosicrucian | 14 | 4 | 0 |
| **sum (double-counts)** | **~38,200** | **~6,300** | **~4,400** |

The **open+media ~4,400** column is the realistically-ingestible pool (open rights AND
actual media), before dedup. Astronomy dominates and is broad; core esoterica
(alchemy/hermetica/paracelsus/rosicrucian) is a smaller, higher-precision slice.

## Overlap with our holdings

Sampled 260 distinct open+media TEXT records across 10 subjects, title-matched (token
Jaccard ≥0.55) against all 52,283 of our books:

- **~11% duplicate, ~89% net-new.**
- Duplicates are almost all **Bavarian State Library (MDZ)** items we already have (likely
  via IA mirrors of MDZ scans). Net-new tail: Wroclaw, Max Planck Institute, Jagiellonian,
  Heidelberg, Smithsonian, National Library of Israel, Elbląg, Uppsala.

So roughly **~3,900 net-new open+media TEXT records** across these subjects — minus
astronomy if we scope to esoterica.

## Provider landscape

Top TEXT providers (facet sums across subjects). Only **BnF / "National Library of
France"** (~2,000) and **Bodleian** (762) overlap our direct sources — everything else is
net-new infrastructure:

- Bavarian State Library / MDZ — 6,702 (partial overlap via IA)
- National Library of Spain (BNE) — 4,576
- German National Library — 4,077
- National Library of Israel — 3,218 (Kabbalah goldmine; mostly `mul`/Hebrew)
- Austrian National Library / ANNO — 2,401
- National Library of France / BnF-Gallica — 2,047 (we ingest directly)
- Complutense University of Madrid — 1,090
- Kuyavian-Pomeranian / Wroclaw / Pomeranian / Elbląg / Jagiellonian (Polish libraries) — ~2,000 combined
- Uppsala, Max Planck, Heidelberg, Czech NL, Yeshiva University Museum, Library of the
  Jewish Theological Seminary — long tail

Language skew: German dominates most subjects; Spanish strong (BNE/Complutense); Kabbalah
is `mul`/Hebrew (NLI); Polish libraries add a Central-European tail we have little of.

## Feasibility caveat — Europeana is discovery, not delivery

**Europeana's own IIIF manifest is a 1-canvas wrapper around the representative preview
image, NOT the full book.** Verified: every sampled record returns a working manifest at
`https://iiif.europeana.eu/presentation{id}/manifest`, but all report exactly 1 canvas.
`edmIsShownBy` is a single image; `edmIsShownAt` points to the provider's viewer; records
do **not** carry `dctermsIsReferencedBy` links to the provider's full manifest.

Full page-sets require resolving each record back to its **provider's own IIIF manifest**,
whose URL pattern varies per institution (MDZ, Heidelberg, BnF/Gallica, ANNO, BNE all have
derivable patterns; smaller providers may have none). Example: Heidelberg cpg476's
Europeana `edmIsShownAt` is `digi.ub.uni-heidelberg.de/diglit/cpg476`; its real manifest
is `digi.ub.uni-heidelberg.de/diglit/iiif/cpg476/manifest` — derivable but not given.

**Implication for an import source:** use Europeana as the cross-provider *enumeration +
dedup + subject-filter* layer (it's excellent at that — one search spans 3,000 GLAMs), then
fetch full content through per-provider IIIF adapters, same as the existing IA/Gallica
pattern. Treat the open+media count as an upper bound; per-provider IIIF availability must
be confirmed before committing to any provider.

## Language metadata is unusable for a source-language census (CRITICAL)

Europeana's `LANGUAGE` facet reflects the **holding institution's cataloging language, not
the language of the historical text.** Confirmed:

- `LANGUAGE:lat`, `san`, `zho`/`chi`, `grc`, `heb`, `ara` each return **0** across the
  entire 27.5M-record TEXT corpus (2-letter `la` etc. also 0; only `mul` = 2.7M and modern
  2-letter codes populate).
- The `alchemia` TEXT query — which surfaces Latin works like Libavius's *Alchymia* — has a
  LANGUAGE facet of `de:979 fr:119 pl:82 it:30 mul:26 es:18 en:10 …` with **no Latin**. The
  Latin books are filed under their holding library's language (MDZ→`de`, Polish libs→`pl`).

**Consequence for census work:**
- **Translation-gap census by source language (USTC-Latin #2234, Siku-Chinese):** Europeana
  cannot supply a denominator or clean language strata — you cannot query "Latin texts."
  USTC (Latin) and Wikidata/Siku (Chinese) remain the authoritative denominators.
- **IIIF census #2447 (harvest Latin/Chinese/Sanskrit manifests):** double-blocked — (a)
  can't filter by source language, and (b) Europeana's own IIIF manifests are 1-canvas
  preview stubs (see above), not the page-level manifests the census wants. Use it only to
  *discover provider records* by subject/title, then resolve to each provider's real IIIF.
- **Registry holdings #2451 (entity = edition cluster + holdings):** still useful. Match by
  title/author/identifier (language-agnostic) to surface which European institutions hold a
  given edition. This is the one census dimension Europeana genuinely strengthens.
- **Subject/thematic acquisition:** works well (subject keywords are language-agnostic);
  this is what the coverage table above measures.

## Recommendation

Worth building, scoped: highest-value net-new providers are **National Library of Israel**
(Kabbalah/Hebrew — a known gap, cf. the Sefaria note), **MDZ/Heidelberg/ANNO** (German
alchemy & Paracelsus), and **BNE/Complutense** (Spanish). Start with one provider whose
IIIF pattern is derivable, prove the enumerate→dedup→IIIF-fetch→import-hidden loop, then
fan out. Skip BnF/Bodleian (already direct) and deprioritize astronomy (broad, lower
mission-fit).

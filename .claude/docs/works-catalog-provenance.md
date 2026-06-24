# Works catalog — data provenance & rights (#2453)

Every row in the catalog is traceable to its source, and the rights that bind
reuse are recorded *in the data*, not just here. Licenses verified 2026-06-08
from the sources themselves (LICENSE files, Zenodo records, per-resource RDF).

## Where provenance lives in the schema
- **`works.source_catalog`** — which ingest created the row.
- **`works.authority_ids`** (JSONB) — every external id (`kanripo_id`,
  `openiti_uri`, `bdrc_work`, `bdrc_instances`, `siku_qid`, author QIDs). A row
  can always be resolved back to the originating record.
- **`work_sources.source` + `source_id` + `url`** — the exact upstream record
  for each scan/transcription, with a resolvable URL.
- **`work_sources.rights`** — per-ITEM rights where the source declares them
  (BDRC `copyrightStatus`). Source-level defaults live in `catalog_sources`.
- **`catalog_sources`** — one row per source: metadata license, content
  license, commercial-OK flag, required attribution, notes. Query this before
  any reuse/import decision.

## Source-level summary (`catalog_sources`)

All 10 sources (the live `catalog_sources` table is the source of truth; this
table mirrors it — re-derive from `select * from catalog_sources` if in doubt):

| Source | Metadata license | Content license | Commercial? | Bind on import |
|---|---|---|---|---|
| **Wikidata** (siku + sanskrit) | CC0 1.0 | CC0 1.0 | ✅ | none |
| **Sefaria** (Hebrew) | CC0 1.0 | mixed (CC0 / CC BY / CC BY-NC) | ✅ metadata | per-version license on the text — check before importing a translation |
| **Kanripo** (Kanseki Repository) | CC BY-SA 4.0 | CC BY-SA 4.0 | ✅ | share-alike if we import the texts |
| **OpenITI** | CC BY-NC-SA 4.0 | CC BY-NC-SA 4.0 | ⚠️ **NO** | **NonCommercial + ShareAlike binds the TEXT** |
| **Pandit** (Indic prosopography) | CC BY-NC-SA 4.0 | CC BY-NC-SA 4.0 | ⚠️ **NO** | NonCommercial + ShareAlike (project asserts it over the facts) |
| **GRETIL** (Indic e-texts) | titles = uncopyrightable facts | per-text, varies | ⚠️ depends | each e-text header carries its own licence — check before importing a body |
| **BDRC / BUDA** | Open LOD, attribution requested | per-item | ⚠️ depends | scans carry per-record copyrightStatus |
| **IA — CADAL** (Chinese) | open metadata | PD by age (stamped) | ✅ | premodern Chinese facsimiles, IA open — `PublicDomainByAge` |
| **IA — Sanskrit** (general) | open metadata | **per-item, NOT assumed PD** | ⚠️ depends | general IA uploads — may be modern editions; verify IA rights before import |

## What we actually hold vs. what's constrained
We ingested **bibliographic metadata** (titles, authors, dates, ids, and for
scans a resolvable URL) — facts, largely uncopyrightable. The license
constraints bite when we go further and **import the underlying text or scan**:

- **OpenITI (8,791 islamicate works):** the mARkdown transcriptions are
  **CC BY-NC-SA 4.0**. Fine for the catalog and the census; importing the texts
  for reading triggers NonCommercial — assess before using in any context that
  could be deemed commercial. ShareAlike would also attach to derivatives.
- **BDRC scans — rights are mixed and now stamped per item.** Distribution of
  `work_sources.rights` (2026-06-08): CopyrightInCopyright **5,930**,
  CopyrightUndetermined **2,233**, CopyrightClaimed **1,584**,
  CopyrightPublicDomain **834**, CopyrightWaived 21 (rest undeclared/null).
  **Never auto-import a BDRC scan as readable without checking
  `work_sources.rights` first** — most declared records are *in copyright*.
- **Kanripo (10,141 chinese works):** texts are CC BY-SA 4.0, derived from PD
  Siku Quanshu (1773) / Daozang + CBETA. Importing transcriptions is fine with
  attribution + share-alike.
- **IA-CADAL (33,821 scan volumes): stamped `PublicDomainByAge`.** The IA items
  carry **no** rights/copyright/license metadata (verified 0/500 sampled) and
  the `universallibrary` collection has no access restriction. All 2,091 linked
  works are premodern Chinese (0 post-1900), so the underlying texts are PD by
  age and the facsimile is openly served — a defensible blanket determination,
  not a per-item assertion (the per-item data doesn't exist upstream).
- **Pandit (5,806 sanskrit works):** CC BY-NC-SA 4.0 — the project asserts it
  over the bibliographic facts; attribute + assess before any commercial use.
- **GRETIL (891 sanskrit works):** we hold only titles (fact) + transcription
  URLs (pointers), not the e-text bodies; each body has its own licence header.
- **Sefaria (6,592 hebrew works):** metadata CC0; individual translations vary
  (CC0 / CC BY / CC BY-NC) — check the per-version license before importing one.
- **IA-Sanskrit (2,792 scan rows): NOT stamped, NOT assumed PD.** These are
  general IA uploads (not a curated PD collection); the work is premodern but
  the item may be a modern edition. Open follow-up: stamp `work_sources.rights`
  from IA `possible-copyright-status` before any Sanskrit scan import.
- **Wikidata:** CC0, no constraint.

## Attribution
Each `catalog_sources.attribution` carries the required credit string. The
catalog is an aggregation of others' scholarship — any public surface built on
it (e.g. translation-gap-site) must credit **Kanripo (Kyoto), OpenITI (Romanov
& Seydi), BDRC, CADAL, Sefaria, Pandit, GRETIL, and Wikidata**. This mirrors
the `LIBRARY_PARTNERS` / per-book provenance discipline already in the codebase.

## Known gaps (honest status)
- **IA-Sanskrit per-item rights unstamped** (2,792 rows) — source-level row
  flags "per-item, verify"; per-item stamping is the open follow-up above.
- Everything else: every `works.source_catalog` and every `work_sources.source`
  resolves to a `catalog_sources` row with a non-null license (audited
  2026-06-09 — zero orphans, zero null licenses).

## Re-seed
`node scripts/works-catalog/seed-provenance.mjs` (idempotent) — refreshes
`catalog_sources` and re-stamps BDRC per-item rights from the harvest cache.

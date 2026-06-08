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

| Source | Metadata license | Content license | Commercial? | Bind on import |
|---|---|---|---|---|
| **Wikidata** (siku denominator) | CC0 1.0 | CC0 1.0 | ✅ | none |
| **Kanripo** (Kanseki Repository) | CC BY-SA 4.0 | CC BY-SA 4.0 | ✅ | share-alike if we import the texts |
| **OpenITI** | CC BY-NC-SA 4.0 | CC BY-NC-SA 4.0 | ⚠️ **NO** | **NonCommercial + ShareAlike binds the TEXT** |
| **BDRC / BUDA** | Open LOD, attribution requested | per-item | ⚠️ depends | scans carry per-record copyrightStatus |
| **IA Universal Library / CADAL** | open metadata | per-item (mostly PD) | ⚠️ depends | check IA item rights before scan import |

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
- **IA-CADAL (33,821 scan volumes):** mostly PD facsimiles of pre-1773 works,
  but rights are per-item — check IA metadata before a bulk scan pull.
- **Wikidata:** CC0, no constraint.

## Attribution
Each `catalog_sources.attribution` carries the required credit string. The
catalog is an aggregation of others' scholarship — any public surface built on
it (e.g. translation-gap-site) must credit Kanripo (Kyoto), OpenITI (Romanov &
Seydi), BDRC, CADAL, and Wikidata. This mirrors the `LIBRARY_PARTNERS` /
per-book provenance discipline already in the codebase.

## Re-seed
`node scripts/works-catalog/seed-provenance.mjs` (idempotent) — refreshes
`catalog_sources` and re-stamps BDRC per-item rights from the harvest cache.

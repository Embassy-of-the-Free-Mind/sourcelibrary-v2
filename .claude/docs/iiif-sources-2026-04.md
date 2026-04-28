# IIIF Source Expansion — April 2026

Research into IIIF-adopting institutions for accelerating Source Library imports.

## Existing Infrastructure

We already have a two-phase discovery/import pipeline:
- `scripts/iiif-discovery/` — discover → `import_candidates` → batch import
- Source harvesters: e-rara, BSB, Gallica, Biblissima, SBB Berlin
- OAI-PMH harvester: SBB Berlin (239K), SLUB Dresden (650K), HAB Wolfenbuttel (42K), Heidelberg, Gottingen (87K)
- Generic importers: `direct-iiif-import.mjs` (IIIF v2/v3), `direct-ia-import.mjs`

New sources just need a discovery script that feeds `import_candidates`.

## Already Importing From

Internet Archive, Gallica (BnF), BSB/MDZ, British Library (EAP), Met Museum, NDL Japan, Vatican Library, e-rara, Bodleian, Cambridge, Wellcome, Heidelberg, Penn (Colenda), Kyoto RMDA, BDRC, Getty, Stanford, Chester Beatty, Qatar Digital Library, Leiden, Portugal NL, Laurenziana, Allard Pierson, Manchester, Rosenthaliana

## Tier 1 — New Sources to Add

### Austrian National Library (ONB)
- API: `https://iiif.onb.ac.at/presentation/{project}/{id}/manifest`
- Swagger docs: https://iiif.onb.ac.at/api
- 600K+ books via ABO, incunabula, early printed, Paracelsus
- OAI-PMH also available
- **Action**: Write `scripts/iiif-discovery/sources/onb.mjs`

### Polona (National Library of Poland)
- IIIF: `https://polona.pl/iiif/item/{base64_id}/manifest.json`
- 3M+ objects, open API, unrestricted downloads
- Manuscripts, rare books, Central European texts
- **Action**: Write `scripts/iiif-discovery/sources/polona.mjs`

### National Library of Israel
- IIIF: `http://iiif.nli.org.il/IIIFv21/DOCID/{RecordId}/manifest`
- Developer portal: https://www.nli.org.il/en/research-and-teach/open-library
- Kabbalistic texts, Judeo-Arabic MSS, Hebrew MSS — content goldmine
- **Action**: Write `scripts/iiif-discovery/sources/nli.mjs`

### Harvard / Houghton Library
- IIIF: `https://iiif.lib.harvard.edu/manifests/drs:{DRS_id}`
- LibraryCloud API for discovery
- 53M images, medieval/Renaissance/philosophy
- **Action**: Write `scripts/iiif-discovery/sources/harvard.mjs`

### e-codices (Swiss MSS)
- Collection manifest: `http://www.e-codices.unifr.ch/metadata/iiif/collection.json`
- 2,800+ medieval manuscripts, single collection endpoint
- **Action**: Simplest of all — fetch collection.json, iterate. Write `sources/ecodices.mjs`

### BVMM/ARCA (IRHT-CNRS, France)
- IIIF: `https://bvmm.irht.cnrs.fr/iiif/{id}/manifest`
- 39K+ manifests of French medieval MSS from 70+ libraries
- **Action**: Write `scripts/iiif-discovery/sources/bvmm.mjs`

### Library of Congress
- JSON API: `https://www.loc.gov/collections/?fo=json`
- IIIF images: `https://tile.loc.gov/image-services/iiif/{id}`
- Rosenwald Collection (illustrated early books)
- **Action**: Write `scripts/iiif-discovery/sources/loc.mjs`

## Tier 2 — Good, Needs More Investigation

- **Gottingen** — 15M pages, early science (OAI-PMH harvester already supports it!)
- **NYPL** — 1M objects, API being deprecated Aug 2026, monitor transition
- **Yale/Beinecke** — IIIF v3 only, bulk discovery needs work
- **Princeton** — Islamic MSS via Figgy, `https://figgy.princeton.edu/concern/scanned_resources/{UUID}/manifest`
- **NL Scotland** — `https://view.nls.uk/collections/top.json` collection endpoint
- **NL Wales** — `https://damsssl.llgc.org.uk/iiif/2.0/{id}/manifest.json`
- **Folger Shakespeare** — Renaissance/Hermetic, 260K items
- **Europeana** — 50M aggregator, API key needed
- **Smithsonian** — 5.1M CC0 items, Freer/Sackler Asian MSS
- **Ghent** — 470 medieval MSS, `https://adore.ugent.be/IIIF/manifests/archive.ugent.be:{UUID}`
- **V&A** — 470K IIIF manifests, developer API

## Key Discovery Aggregators

- **Biblissima** (already have harvester): ~100K IIIF manifests from 40+ institutions for pre-1800
- **OPenn**: 10K+ MSS, 1M+ images, CC, FTP/rsync bulk
- **Digital Scriptorium**: US MSS union catalog with IIIF links

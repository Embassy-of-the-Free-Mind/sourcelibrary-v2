# Library Harvest Registry

Operational reference for all digital libraries we harvest or plan to harvest. Organized by harvest status and access method.

**Purpose:** Track what we can pull, how to pull it, what we've already pulled, and what's next.
**Related:** `curator-reference.md` (thematic content priorities), GitHub issues #261 (catalog coverage), #321 (USTC holdings), #327 (backfill)

---

## Tier 1: Harvested — In import_candidates

These sources have been bulk-harvested into MongoDB `import_candidates`.

| Source | Records | Scan Quality | Script |
|--------|---------|-------------|--------|
| BSB Munich | 432K | high | `scripts/iiif-discovery/sources/bsb.mjs` |
| e-rara.ch | 161K | high | `scripts/iiif-discovery/sources/erara.mjs` |
| Gallica (BnF) | 123K | medium | `scripts/iiif-discovery/sources/gallica.mjs` |
| Biblissima | 112K | medium | `scripts/iiif-discovery/sources/biblissima.mjs` |
| IA Microfilm (EEBO) | 87K | low | `scripts/catalog-coverage/harvest-ia-english.mjs` |
| SBB Berlin | ~500 (test) | high | `scripts/catalog-coverage/harvest-oai-libraries.mjs --library=sbb` |
| **Total** | **~916K** | | |

### BSB Munich (Bayerische Staatsbibliothek)
- **API:** OAI-PMH with VD16/VD17/VD18 sets
- **URL:** `https://api.digitale-sammlungen.de/v1/oai`
- **IIIF:** `https://api.digitale-sammlungen.de/iiif/presentation/v2/{bsb_id}/manifest`
- **Browse:** https://www.digitale-sammlungen.de/
- **Notes:** Largest single source. German national bibliography sets are gold for early modern.

### e-rara.ch (Swiss Digital Library)
- **API:** OAI-PMH
- **URL:** `https://www.e-rara.ch/oai`
- **IIIF:** Direct manifest URLs in OAI records
- **Browse:** https://www.e-rara.ch/
- **Notes:** Swiss rare books. Excellent scan quality. 161K records, ~94K pre-1800.

### Gallica (BnF — Bibliothèque nationale de France)
- **API:** SRU (Search/Retrieve via URL), not OAI-PMH
- **URL:** `https://gallica.bnf.fr/SRU`
- **IIIF:** `https://gallica.bnf.fr/iiif/ark:/{ark_id}/manifest.json`
- **Browse:** https://gallica.bnf.fr/
- **Notes:** Massive collection but SRU is quirky. Quality varies (some microfilm). ~260K total digitized items.

### Biblissima (IIIF Aggregator)
- **API:** Wikibase API (P196 property for IIIF manifests)
- **URL:** `https://data.biblissima.fr/`
- **IIIF:** Aggregates manifests from many French libraries
- **Browse:** https://iiif.biblissima.fr/collections/
- **Notes:** Meta-source — aggregates IIIF from BnF, Mazarine, municipal libraries. Some overlap with Gallica.

### Internet Archive — Early English Books
- **API:** Advanced Search API (`https://archive.org/advancedsearch.php`)
- **IIIF:** `https://iiif.archive.org/iiif/3/{identifier}/manifest.json`
- **Collections:** `pub_early-english-books-1475-1640` (35K), `pub_early-english-books-1641-1700` (71K)
- **Notes:** Microfilm rescans uploaded 2024. Low quality (B&W, some blurry). But massive English coverage. API caps at 10K results per query — use year-range splitting.

### SBB Berlin (Staatsbibliothek zu Berlin)
- **API:** OAI-PMH
- **URL:** `https://oai.sbb.berlin/`
- **Sets:** `vd16`, `vd17` (German national bibliographies)
- **IIIF:** `https://content.staatsbibliothek-berlin.de/dc/{ppn}/manifest`
- **Viewer:** `https://digital.staatsbibliothek-berlin.de/werkansicht?PPN={ppn}`
- **Notes:** 239K records in VD16 alone. All digitized items have IIIF manifests. Currently harvesting.

---

## Tier 2: Harvesting Now — OAI-PMH Libraries

These are being harvested via `harvest-oai-libraries.mjs`. All use `--library=<name>`.

### HAB Wolfenbüttel (Herzog August Bibliothek)
- **API:** OAI-PMH
- **URL:** `http://oai.hab.de/`
- **IIIF:** No public IIIF manifests (legacy viewer only)
- **Viewer:** `http://diglib.hab.de/?db=drucke&list=ppn&id={ppn}` (from OAI ID `oai:diglib.hab.de:ppn_{ppn}`)
- **URN resolver:** Records with `urn:nbn:de:gbv:23-` resolve via `https://nbn-resolving.de/{urn}` → `http://diglib.hab.de/drucke/{id}/start.htm`
- **Size:** 42K records total, ~30% pre-1700
- **Scan quality:** High (but no IIIF — viewer-only access)
- **Sets:** `alchq` (alchemy!), `ddb`, `vd17m`, `vd17u`
- **Notes:** Year extracted from fingerprint identifiers (`(fingerprint)...1690R`). No `dc:date` field. No `dc:identifier` URLs — only fingerprints and URNs. Important for alchemy/esoterica.

### SLUB Dresden (Sächsische Landesbibliothek)
- **API:** OAI-PMH
- **URL:** `https://digital.slub-dresden.de/oai/`
- **IIIF:** Not in DC metadata (would need METS format or separate lookup)
- **Size:** 650K records total, ~50% hit rate for pre-1700
- **Scan quality:** High
- **Notes:** Huge collection but no language field in OAI-DC (all show as "unknown"). Mostly music manuscripts in early pages. IIIF manifests may be available via METS metadata prefix.

### Heidelberg University Library
- **API:** OAI-PMH
- **URL:** `https://digi.ub.uni-heidelberg.de/cgi-bin/digioai.cgi`
- **IIIF:** `https://digi.ub.uni-heidelberg.de/diglit/iiif3/{id}/manifest.json`
- **Viewer:** `https://digi.ub.uni-heidelberg.de/diglit/{id}`
- **Size:** Unknown total, ~21% pre-1700 hit rate
- **Scan quality:** High
- **Notes:** Best of the new OAI sources — all pre-1700 records have IIIF manifests. Clean metadata.

---

## Tier 2b: Harvesting Now — Non-OAI Libraries

### Vatican Library (DigiVatLib)
- **API:** No OAI-PMH. Browse pages list all digitized MSS per collection.
- **Method:** Scrape 88 collection pages → get MSS IDs → fetch IIIF manifests for metadata
- **IIIF:** `https://digi.vatlib.it/iiif/MSS_{collection}.{N}/manifest.json` (IIIF Presentation v2)
- **Viewer:** `https://digi.vatlib.it/view/MSS_{collection}.{N}`
- **Browse:** `https://digi.vatlib.it/mss/{collection}` (e.g. `/mss/Vat.gr` → 1,262 MSS)
- **Collections:** 88 collections including Vat.gr, Vat.lat, Barb.lat, Borg.ar, etc.
- **Size:** 80K+ manuscripts total. Vat.gr alone = 1,262 digitized.
- **Content:** Greek philosophical MSS (Plato, Aristotle, Ptolemy), biblical codices, Latin theology
- **Scan quality:** High
- **Metadata:** Sparse in IIIF manifests (only Polonsky items have date/language). Most have just shelfmark.
- **Script:** `scripts/catalog-coverage/harvest-vatican.mjs`
- **Notes:** `--skip-manifests` for fast ID scraping, then second pass enriches. Crawl-delay: 10 in robots.txt — we use 1.5s for manifests, 3s for browse pages.

---

## Tier 3: Researched — Ready to Build Harvesters

### Göttingen University Library (SUB Göttingen)
- **API:** OAI-PMH confirmed working
- **URL:** `https://gdz.sub.uni-goettingen.de/oai2/`
- **Size:** 86,622 records total, ~27% pre-1700 hit rate
- **IIIF:** Not in OAI-DC metadata. Resolver URLs at `http://resolver.sub.uni-goettingen.de/purl?{id}`
- **Sets:** Mathematica, Orientalia, Medieval Manuscripts, Medieval Fragments, Americana, Itineraria, etc.
- **Script:** `harvest-oai-libraries.mjs --library=goettingen` (config added)
- **Status:** Harvesting now. Expected ~14K pre-1700 records.

### Halle University Library (ULB Halle)
- **API:** OAI-PMH at `https://opendata.uni-halle.de/oai/request` — but this is "Share_it" (modern institutional repo), NOT the historical digitized collections.
- **Historical collections:** at `https://digitale.bibliothek.uni-halle.de/` — separate system, needs research for bulk API
- **Notes:** Francke Foundation holdings. Pietism, early modern theology. Need to find the right OAI endpoint for historical digitizations.

### National Diet Library Japan (NDL)
- **API:** IIIF manifest list available
- **URL:** https://lab.ndl.go.jp/dl/
- **IIIF:** 340,000 IIIF manifests
- **Notes:** Massive IIIF collection. Japanese + Chinese classics. Would need language filtering.

### Waseda University Library
- **API:** Unknown bulk access
- **IIIF:** Likely available
- **Browse:** https://www.wul.waseda.ac.jp/kotenseki/
- **Size:** 300,000 Chinese/Japanese classics
- **Notes:** Strong for cross-cultural comparisons with European esoterica.

### National Palace Museum Taipei
- **API:** Open Data available since 2015
- **URL:** https://theme.npm.edu.tw/opendata/
- **Size:** 690,000+ items
- **Notes:** Chinese imperial collection. Paintings, calligraphy, rare books.

### Library of Congress — Asian Division
- **API:** IIIF available, LOC API
- **URL:** https://www.loc.gov/collections/chinese-rare-books/
- **IIIF:** `https://www.loc.gov/item/{id}/manifest.json`
- **Size:** 2,000+ Chinese rare books, Yongle Dadian (41 vols)
- **Notes:** Well-documented API. Priority texts: Shanhai Jing (1628), Tiangong Kaiwu (1637), Bencao Gangmu.

### Harvard-Yenching Library
- **API:** IIIF via Harvard DRS
- **URL:** https://curiosity.lib.harvard.edu/chinese-rare-books
- **Size:** 9,600+ Chinese rare books (13th-19th c.)
- **Notes:** Accessible via Harvard IIIF. Could harvest DRS manifests.

### IDP (International Dunhuang Project) / British Library
- **API:** IDP database API
- **URL:** http://idp.bl.uk/
- **Size:** 538,821 Dunhuang manuscript images
- **Notes:** Silk Road manuscripts. Unique content — Buddhist, Manichaean, multilingual.

---

## Tier 4: Live Import Route — Need Bulk Harvester

These have working single-item import routes (`/api/import/...`) but no bulk catalog harvest yet.

### Bodleian Library (Oxford)
- **Import API:** `/api/import/bodleian`
- **IIIF:** v2
- **URL:** https://digital.bodleian.ox.ac.uk/
- **Size:** 1,003 Greek MSS digitized (Barocci, Canon. Gr., Laud Gr.)
- **Notes:** Best JSON search API of any library. Bulk harvest very feasible.

### Cambridge University Digital Library (CUDL)
- **Import API:** `/api/import/cambridge`
- **IIIF:** v2
- **URL:** https://cudl.lib.cam.ac.uk/
- **Size:** 500K Chinese titles, 425+ Greek MSS, 300+ Syriac MSS, Cairo Geniza
- **Notes:** Already importing individual MSS. Bulk harvest would be valuable.

### British Library
- **Import API:** `/api/import/bl`
- **IIIF:** v3
- **URL:** https://www.bl.uk/manuscripts/
- **Size:** 900+ Greek MSS, large Syriac collection
- **Notes:** Post-2023 cyberattack: most older MSS return 403. Polonsky Pre-1200 items work.

### Austrian National Library (ONB Vienna)
- **Import API:** `/api/import/onb`
- **IIIF:** v2
- **URL:** https://digital.onb.ac.at/
- **Size:** ~300 Greek MSS (Cod. phil. gr., Cod. theol. gr.)
- **Notes:** Live import route exists. No search API — manual catalog discovery.

### Wellcome Collection
- **Import API:** `/api/import/wellcome`
- **IIIF:** v2
- **URL:** https://wellcomecollection.org/
- **Size:** ~40,000 items
- **Notes:** History of medicine, alchemy, herbals, anatomical atlases.

### Yale Beinecke Library
- **Import API:** `/api/import/yale`
- **IIIF:** v3
- **Size:** ~1M items (Voynich MS 408, alchemical MSS, Osborn Collection)

### Harvard Houghton Library
- **Import API:** `/api/import/harvard`
- **IIIF:** v2
- **Size:** ~500K items (Islamic Heritage Project, medieval codices)

### Getty Research Institute
- **Import API:** `/api/import/getty`
- **IIIF:** v3
- **Size:** ~1.4M items (alchemical MSS, emblem books)

### Library of Congress
- **Import API:** `/api/import/loc`
- **API:** Custom JSON (not standard IIIF)
- **Size:** 2,000+ Chinese rare books, Yongle Dadian (41 vols)
- **Notes:** Well-documented API. Priority texts: Shanhai Jing (1628), Tiangong Kaiwu (1637).

### Penn Schoenberg / OPenn
- **Import API:** `/api/import/penn`
- **IIIF:** v2
- **Size:** ~400 MSS + OPenn (51K MSS from 30+ institutions, CC0)

### Huntington Library
- **Import API:** `/api/import/huntington`
- **IIIF:** v2
- **Size:** ~11M items (Ellesmere Chaucer, Burndy Library history of science)

### Europeana
- **Import API:** `/api/import/europeana`
- **IIIF:** Aggregator
- **Size:** ~50M items (aggregates metadata from thousands of European institutions)

### Kyoto University RMDA
- **Import API:** `/api/import/kyoto`
- **IIIF:** v3
- **Size:** ~10K items (Japanese rare books, natural history)

### NDL Japan
- **Import API:** `/api/import/iiif` (generic)
- **IIIF:** v2
- **Size:** ~350K digitized, IIIF manifests available
- **Notes:** Japanese classical texts, Buddhist texts. Biggest single unlock in Asia for bulk.

---

## Tier 5: Planned — Need Registration or Research

### National Library of Israel
- **IIIF:** v2 (gated at iiif.nli.org.il, returns 403)
- **Size:** ~5M items (Dead Sea Scrolls, Maimonides, Kabbalah, Cairo Geniza)
- **Notes:** Needs institutional API access.

### Jagiellonian Library, Krakow
- **API:** OAI-PMH confirmed working, no auth needed
- **Size:** ~4M items (Copernicus De Revolutionibus holograph)
- **Notes:** PDFs/DJVU available. OAI harvest ready to go.

### VHMML (Hill Museum)
- **IIIF:** v2 (gated)
- **Size:** ~350K MSS (Ethiopian Ge'ez, Syriac, Arabic, Armenian from 500+ partners)
- **Notes:** Registration required. Contact help@vhmml.org for bulk access.

### Korean National Library
- **API:** XML Open API (registration required), no IIIF
- **Size:** ~11M items (Joseon dynasty, Tripitaka Koreana, medical texts)

### Waseda University
- **IIIF:** Unknown (404 on manifest patterns)
- **Size:** ~300K items (Japanese/Chinese classics)

### NPM Taiwan
- **API:** Open Data portal (download-only, no live API)
- **Size:** ~700K items (Chinese calligraphy, paintings, rare books)

---

## Tier 6: Blocked

### Marciana Library, Venice
- No IIIF, no API. ContentDM-based. The most important undigitized Byzantine collection (Bessarion's 482 Greek MSS).

### Qatar Digital Library
- Blocks all automated access (403). Manual PDF only.

### Leiden University
- Bot protection blocks automated access. IIIF exists in Islandora but not exposed.

### National Library of China
- Fully geo-blocked from outside China.

### Russian National Library
- No IIIF, no API. Digital access restricted to on-premises since 2022.

### Süleymaniye Library, Istanbul
- ~70K MSS. yazmalar.gov.tr has SSL errors and no IIIF.

### Mount Athos
- ~45K MSS. No public digital access. Digital Athos Project announced but not launched.

### Google Books
- No public API for bulk download. Some appear as USTC digitisation links.

### EEBO (Early English Books Online)
- Page images locked behind ProQuest paywall. IA microfilm rescans cover same content (already harvested).

### HathiTrust
- Available but restrictive. Pre-1929 items may be harvestable.

---

## USTC Holdings — Cross-Reference Source

The USTC (Universal Short Title Catalogue) tracks which libraries hold physical copies AND links to digitisations.

- **Script:** `scripts/catalog-coverage/harvest-ustc-holdings.mjs`
- **Method:** Scrape `ustc.ac.uk/editions/{sn}`, parse Inertia.js `data-page` JSON
- **Rate limit:** 1 req/sec, academic User-Agent
- **Data:** copies (library, city, country, shelfmark) + digitisations (provider, url)
- **Sample results (1K editions):** 4.5 copies/edition, 41% have digitisation links
- **40+ providers found:** Including many we haven't harvested directly
- **Status:** 1K sample complete. Full 1.5M corpus at 1 req/sec = ~18 days continuous
- **Alternative:** Email ustc@st-andrews.ac.uk for bulk data export

---

## How to Add a New Library

1. **Research:** Check if they have OAI-PMH, IIIF, or a bulk API
2. **Test:** `curl` their OAI endpoint or IIIF manifest
3. **Add to registry:** Update this file with findings
4. **Build harvester:**
   - If OAI-PMH: Add config to `harvest-oai-libraries.mjs` (see SBB/HAB/SLUB/Heidelberg)
   - If IIIF only: Add to `scripts/iiif-discovery/sources/`
   - If custom API: Create new script in `scripts/catalog-coverage/`
5. **Run:** `set -a; source .env.production.local; set +a; node <script>`
6. **Verify:** Check `import_candidates` source counts
7. **Rebuild:** Run `scripts/catalog-coverage/build.mjs` to match against USTC

---

## Quick Commands

```bash
# Check current harvest counts
set -a; source .env.production.local; set +a
node -e "const {MongoClient}=require('mongodb'); (async()=>{const c=new MongoClient(process.env.MONGODB_URI); await c.connect(); const r=await c.db('bookstore').collection('import_candidates').aggregate([{\$group:{_id:'\$source',n:{\$sum:1}}},{\$sort:{n:-1}}]).toArray(); r.forEach(s=>console.log(s._id+': '+s.n.toLocaleString())); await c.close()})()"

# Run OAI harvest (any configured library)
node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=<name> [--dry-run] [--limit=N]

# Run USTC holdings scrape
node scripts/catalog-coverage/harvest-ustc-holdings.mjs --sample=100

# Full catalog coverage rebuild
node scripts/catalog-coverage/build.mjs
```

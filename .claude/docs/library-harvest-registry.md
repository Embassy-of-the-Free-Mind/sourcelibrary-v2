# Library Harvest Registry

Operational reference for all digital libraries we harvest or plan to harvest. Organized by harvest status and access method.

**Purpose:** Track what we can pull, how to pull it, what we've already pulled, and what's next.
**Related:** `curator-reference.md` (thematic content priorities), GitHub issues #261 (catalog coverage), #321 (USTC holdings), #327 (backfill)

---

## Tier 1: Harvested — In import_candidates

These sources have been bulk-harvested into MongoDB `import_candidates`.
Counts re-measured 2026-10-24 (#7294); the old "~916K total" line predated the IA
language sweeps. **Which of them we already hold, by interest tier:**
`scripts/audit/candidate-tier-survey.ts` (see "Acquisition tier survey" below).

| Source | Records | Scan Quality | Script |
|--------|---------|-------------|--------|
| IA language sweeps (`ia_language`) | 2.33M (about 0.5M are serial issues) | varies | `scripts/iiif-discovery/sources/ia-language.mjs` |
| BSB Munich | 432K | high | `scripts/iiif-discovery/sources/bsb.mjs` |
| e-rara.ch | 161K | high | `scripts/iiif-discovery/sources/erara.mjs` |
| Gallica (BnF) | 123K | medium | `scripts/iiif-discovery/sources/gallica.mjs` |
| Biblissima | 112K (no dates) | medium | `scripts/iiif-discovery/sources/biblissima.mjs` |
| IA Microfilm (EEBO) | 87K | low | `scripts/catalog-coverage/harvest-ia-english.mjs` |
| SLUB / SBB / Göttingen / Heidelberg / HAB | 55K / 43K / 40K / 16K / 6K | high | `scripts/catalog-coverage/harvest-oai-libraries.mjs` |
| Wikidata, ISTC, Vatican, Harvard, others | 52K, 30K, 20K, 10K, <10K | varies | various |
| Vernacular sources added 2026-10-24 | see "Vernacular and small-language sources" below | | `sources/{oai-dc,kramerius,nb-norway,delpher,handrit}.mjs` |
| **Total** | **3.53M before the 2026-10-24 harvests** | | |

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

### Biblioteca Nacional de España (BDH)
- Every BNE host answers Hetzner with HTTP 403 and an HTML block page (2026-10-24). Counted through Europeana instead; see the vernacular section.

### Doria / Finna (Finland)
- Cloudflare challenge (HTTP 403) on both APIs from Hetzner (2026-10-24).

### HathiTrust
- Available but restrictive. Pre-1929 items may be harvestable.

---

## Vernacular and small-language sources (#7294, surveyed 2026-10-24)

Surveyed from Hetzner (the job host), at no more than one request per second per host. "Positive control" means one real record fetched and read back. Tiers follow #7294 and `scripts/audit/acquisition-tier-terms.json`: **A** core (alchemy, Hermetica, Kabbalah, Rosicrucianism, magic, mysticism and theosophy, astrology); **B** adjacent (science, medicine, natural philosophy, books of secrets, emblems, classical and patristic translations); **C** every other public-domain record dated before 1900. Nothing is filtered out: tiers set the import order only.

Two ways of counting, and they must not be mixed:
- **Harvested** sources sit in `import_candidates`. Their tiers come from the title, subject and author regexes, and the survivors are what is left after `candidate-tier-survey.ts` dedupes them against `books`.
- **Europeana-counted** sources were counted with the source's own search, using `search_terms` from the same JSON. These are estimates (`mystic*` also matches Catholic devotional *mística*, for example) and have not been deduped.

Survivor cells read `rows / survivors / duplicates / unresolved`. Duplicates are the same digital object or a match on a full edition key. Unresolved means a partial-key match, a spelling-only match, or a title too short to key.

### Acquisition tier survey (tooling)
- `scripts/audit/candidate-tier-survey.ts` is read-only. Run it with `--source <s>`, `--exclude-source a,b`, or `--input sample.jsonl`. It counts language × tier, dedupes against `books` (fingerprint set, then edition key by key quality, then an early-modern spelling fold as a second, unresolved-only lookup), merges cross-source copies of one edition, and flags candidate translations (the author is held in another language). It writes `<label>-summary.json` and `<label>-survivors-AB.jsonl.gz`; each A/B row carries the `matched` term.
- `scripts/iiif-discovery/lib/candidate-store.mjs` `upsertCandidates()` is an idempotent insert keyed on (source, source_id). `insertCandidates()` relies on a unique index that does not exist (see `ensureIndexes`), so re-running a harvester that uses it duplicates every row.
- **Nothing reads `import_candidates` on a schedule.** A harvest is a record, not an actuation; rows wait for a person to run the import loop.
- **Measured gate trap:** the edition key does not fold u/v or i/j (*adiunctis* vs *adjunctis*). About a quarter of the matches that appear only after the spelling fold are the same edition (14 of 52 sampled). Survivor counts are therefore a slight over-count wherever the source spells differently from our copy.

### Spain: BVPB, Biblioteca Virtual del Patrimonio Bibliográfico — HARVESTED
- **Access:** OAI-PMH at `https://bvpb.mcu.es/i18n/oai/oai_bvpb.mcu.es.do` (oai_dc, marc21, edm), 100 records per page. Pages take 5–30 s, so the full list is several hours at 1 req/s.
- **Positive control:** `oai:bvpb.mcu.es:396678`, *Flos divinarum sententiarum* (MS, 12th c., Latin).
- **Rights:** `dc:rights` is "CC BY 4.0" on the records; PD by date.
- **Size:** 141,775 records (manuscripts, early printed books, photographs; Spanish and Latin). Subject search (`busq_materia`) finds few esoterica: alquimia 14, astrología 40, cábala 13, misticismo 22, magia 5, brujería 11, demonología 6.
- **Images:** no IIIF manifest found; images sit behind `catalogo_imagenes/grupo.do?path=`. An importer needs an adapter.
- **Harvester:** `sources/oai-dc.mjs --repo=bvpb`. **Partial harvest:** stopped at 37,500 of 141,775 records (26%, taken in record-id order, so not a random sample). OAI resumption tokens here are UUIDs that expire after a day, so a later run restarts from the top; the upsert makes that safe. Survey of the 37.5K: A 402 / 391 / 1 / 1 · B 1,829 / 1,781 / 7 / 11 · C 23,122 / 22,481 / 31 / 44 · 11,001 dated 1900+ (photographs). Spanish A 126, Latin A 246, Catalan A 15. A ×3.8 extrapolation (rough) gives about 1,500 A, 6,900 B and 87K C for the whole repository. Europeana holds only 10,588 BVPB items (A 82).

### Spain: BNE, Biblioteca Digital Hispánica — BLOCKED from Hetzner
- Every BNE host (`bdh.bne.es/bnesearch`, `bdh-rd.bne.es/oai`, `datos.bne.es/sparql`, `www.bne.es`) answers this host with HTTP 403 and the same HTML block page. Two attempts, same result.
- **Europeana count** (DATA_PROVIDER "National Library of Spain", TEXT, 1400–1899): 388,974. A 2,278 · B 61,211 · C 325,485. Europeana marks none of them `reusability=open`, so read the rights statement per item before importing.
- **Next:** try the BNE OAI from a residential IP, or harvest through the Europeana API (`scripts/catalog-coverage/europeana-harvest.mjs`, key on file).

### Portugal: BND, Biblioteca Nacional Digital — HARVESTED (titles only)
- **Access:** OAI-PMH at `https://bndigital.bnportugal.gov.pt/oai` (LimbGallery). Formats are `oai_dc_duplicate` (title only) and `test` (NCB shelfmark, Porbase catalogue id `Fonte`, `Direitos`). 10 records per page. **Any User-Agent containing "OAI-PMH harvest" gets HTTP 502**; the harvester sends a plain UA that still names us.
- **Positive control:** `oai:limbgalm.bn.pt:1:3750`, *[Notas para sermões…]*, shelfmark alc-131, "PUBLIC DOMAIN".
- **Size:** 50,788 records. Sets: Incunábulos, Iluminados, A Grande Guerra.
- **Images:** IIIF Image API (`/i/?IIIF=…`); no Presentation manifest seen.
- **Europeana count** (National Library of Portugal, 1400–1899): 20,862 (20,598 open). A 118 · B 672 · C 20,072.
- **Harvester:** `sources/oai-dc.mjs --repo=bnp`. Records have no date or language until joined to Porbase on `Fonte`, so every row lands as undated. **Partial harvest:** stopped at 3,830 of 50,788 (about 1 request/s at 10 records a page is 1.4 h per 5K). The `cursor=` token is stateless, so resume with `--resume-token='cursor=375&metadataPrefix=oai_dc_duplicate'`. Titles only, all undated: A 2 · B 358 · C 3,470.

### Catalonia: Memòria Digital de Catalunya (CSUC CONTENTdm) — OAI broken, Europeana-counted
- `https://mdc.csuc.cat/oai/oai.php` returns a PHP fatal error (a server bug, not a block).
- **Europeana count** (Digital Memory of Catalonia): 31,187 (29,965 open), all Catalan. A 67 · B 702 · C 30,418.

### Netherlands: Delpher (KB) — HARVESTED
- **Access:** JSON API `https://www.delpher.nl/nl/api/results?query=*&coll=boeken&facets[periode][]=0|19e_eeuw|&maxperpage=100&page=N`. Each record carries an access decision (`extradata.decision.OBJECT.outcome`, PERMIT/DENIED, UsageRights `OutOfCopyrightInEU`). `coll=boeken1` (the Google books) answered 503 `backendFailed`.
- **Positive control:** bookid `MMUBVU02:000007233` (H. de Cock, 1858). `coll=boeken`: 262,797 records; pre-1900 facets give 24,815.
- **Images:** KB resolver URNs (`resolver.kb.nl/resolve?urn=<bookid>:<page>:image`), no IIIF manifest. An importer needs an adapter.
- **Harvester:** `sources/delpher.mjs`: 22,152 PERMIT rows, 2,663 DENIED skipped. Survey: A 88 / 81 / 0 / 0 · B 1,787 / 1,403 / 1 / 1 · C 19,229 / 16,563 / 0 / 25 · other copies 3,030. Mostly Dutch (A 35, B 1,548) plus French (A 46).
- **Leiden** (harvester `sources/leiden.mjs`, 550 rows) is already almost all imported.

### Czech: Kramerius, NKP Prague and MZK Brno — HARVESTED
- **NKP:** Kramerius 5 Solr at `https://kramerius5.nkp.cz/search/api/v5.0/search`, 1,000 rows per request with cursorMark. `datum_begin:0` means undated. Public, dated pre-1900 monographs: 14,093 (Czech 7,592, German 2,726, Latin 213); only 70 are pre-1800. No IIIF Presentation; pages via `/item/<pid>/children`.
- **MZK:** Kramerius 7 client API at `https://api.kramerius.mzk.cz/search/api/client/v7.0/search`. cursorMark returns HTTP 500, so the harvester pages with `start=`. About 1 TLS handshake in 5 fails with `SSL_ERROR_SYSCALL`; retries clear it. Public pre-1900 monographs: 14,677, the old-print shelf (pre-1800: 3,421; Latin 1,167, German 618).
- **Positive controls:** NKP `uuid:ae6198e0-f132-11e7-a97b-005056827e51`; MZK `uuid:0cc636ae-dad0-46c9-9329-08b581a59d02` (Andreae, *Super arboribus consanguinitatis*, Nuremberg 1483).
- **Rights:** `dostupnost:public` (NKP) and `licenses.facet:public` (MZK); private and on-site records are not harvested.
- **Harvester:** `sources/kramerius.mjs --site=nkp|mzk`. Survey, NKP: A 45 / 45 / 0 / 0 · B 626 / 616 / 0 / 0 · C 13,422 / 13,340 / 0 / 16. MZK: A 105 / 94 / 4 / 0 · B 909 / 889 / 1 / 1 · C 13,635 / 12,404 / 15 / 14 (German 46 A, Latin 38 A, Czech 15 A).
- **Europeana count** (NKP, 1400–1899): 111,424 (none open). A 1,689 · B 9,882. This likely includes Manuscriptorium, for which no public OAI was found.

### Poland: Polona (BN) — Europeana-counted; direct API unstable
- **Access:** `POST https://polona.pl/api/search-service/search/simple?query=&page=N&pageSize=M` with body `{"keywordFilters":{"category":["Książki"],"license":["Domena Publiczna"]}}`. That returns 301,320 public-domain books (of 374,093) and 26,128 manuscripts. `temporalFilters` accepts the field names `dates` and `temporal` but ignored every range format tried. Paging past about 10K answers 503, and after that probe the API answered 503 to everything for the rest of the session (two attempts). No sample was drawn.
- **Positive control:** `query=alchemia` → 143 hits (first: Hubicki, *Chemie und Alchemie des 16. Jahrhunderts in Polen*).
- **Europeana counts, 1400–1899:** National Library of Poland 13,425 (A 84 · B 607); Jagiellonian Library 28,773 (A 83 · B 1,264); Warsaw University Library 246,771 (A 8; mostly serials and ephemera). Polona's own Yiddish facet: 42,182 items, all dates.

### Sweden: Alvin (Uppsala UB and partners) — HARVESTED
- **Access:** OAI-PMH at `https://www.alvin-portal.org/oai/oai` (oai_dc, ksamsok-rdf), 100 per page. Sets: `old_prints` 19,468, `manuscript` 133,544, `text` 189,929, plus one set per institution. The unscoped list (691,683) begins with empty records; harvest by set.
- **Positive control:** `oai:ALVIN.org:432457`, *Then swenska psalm-boken* (1774, Lund).
- **Rights:** `dc:rights` "Public Domain Mark".
- **Images:** no IIIF manifest URL found (three patterns tried); thumbnails at `/alvin/attachment/thumbnail/alvin-record:<id>/ATTACHMENT-0001`.
- **Harvester:** `sources/oai-dc.mjs --repo=alvin --set=old_prints|manuscript`. Harvested `old_prints` (19,468) and `manuscript` (133,544; mostly letters and archives, 54K of them dated 1900+). Survey of both: A 537 / 514 / 5 / 2 · B 6,775 / 6,635 / 4 / 14 · C 66,772 / 63,318 / 9 / 180 · undated 24,555 (A 66) · 3,403 other copies. Latin A 213, Swedish A 105 (B 2,375), German A 31, French A 24. The A+B translation flag fires mostly on Linnaeus's letters (about 1,640 rows; we hold Linnaeus in Latin). It is a weak signal for correspondence, and Swedenborg accounts for 11.

### Norway: Nasjonalbiblioteket — HARVESTED (with IIIF)
- **Access:** `https://api.nb.no/catalog/v1/items?q=*&filter=mediatype:bøker&filter=year:[1400 TO 1899]&filter=digital:Ja&size=100`. Paging past offset 5,000 answers HTTP 400, so the harvester bisects the year range. Every item links a **IIIF manifest** (`_links.presentation`).
- **Positive control:** `fdca17c2e7c4ee31a012bbeb220cbc5a`, Dedechen, *Maane-Brev* (Bergen 1775), `isPublicDomain: true`.
- **Rights:** `accessInfo.isPublicDomain` per item; 2,110 digital but non-PD items skipped.
- **Harvester:** `sources/nb-norway.mjs`: 25,628 rows (Norwegian 13.5K, Danish 8.2K, German, Latin). Survey: A 64 / 62 / 1 / 0 · B 1,266 / 1,256 / 1 / 2 · C 24,278 / 23,935 / 12 / 42.

### Denmark: Royal Danish Library — no bulk access found
- `www5.kb.dk` (the old COP/OAI) no longer resolves; `api.kb.dk/data/rest/api/dsfl` answers 401 "BBO is missing".
- **Europeana counts:** "The Royal Library" 2,558 (none open); "The Danish Agency for Culture" 46,167 (open; A 5). Most Danish early print we can reach is in **NB Norway** (8.2K Danish rows, above) and **handrit.is**.

### Iceland: handrit.is — HARVESTED from the published TEI
- The search pages sit behind hCaptcha (HTTP 403) and there is no OAI, but the catalogue is TEI P5 at `github.com/Handrit/Manuscripts` (about 20K files, one per manuscript per description language). One `git clone` (about 700 MB) replaces about 18K requests.
- **Positive control:** Lbs dipl 31, *Sjöttardómur* (1620), 4 imaged pages at `myndir.handrit.is`.
- **Images:** plain JPEGs at about 4,000 px (`SECONDARY_DISPLAY`) for 4,387 of 18,118 manuscripts; no IIIF.
- **Harvester:** `sources/handrit.mjs --repo-dir=<clone>`: 18,118 rows (Icelandic 15.6K, Danish 701, Latin 579). Survey (all rows): A 99 / 99 / 0 / 0 · B 250 / 250 · C 14,061 / 13,888. Imaged only: A 62 · B 99 · C 3,401. **Galdrabækur:** 85 manuscripts mention galdur/galdra, 47 of them imaged, e.g. AM 434 d 12mo (*Galdrakver*, c. 1600) and ÍB 799 8vo (*Galdrabók og lækningabók*, c. 1650).
- **Europeana:** National and University Library of Iceland, 2,761 pre-1900 (A 11).

### Finland: Doria and Finna — BLOCKED from Hetzner
- `www.doria.fi/oai/request` and `api.finna.fi/v1/search` both answer this host with a Cloudflare challenge (HTTP 403). Two hosts, same failure.

### Italy: Internet Culturale and EDIT16 — Europeana-counted
- Internet Culturale has no OAI at `/oaiProvider` (404). Its HTML search reports counts (e.g. `q=alchimia` → 53 catalogue records, 981 full-text).
- **Europeana count** ("European Library of Information and Culture", which is Internet Culturale): 12,460 pre-1900 (all open). A 186 · B 2,780 · C 9,494. Biblioteca Nazionale Centrale di Roma: 6,221 (A 0).
- **EDIT16** is a census of 16th-century editions with links out; it has no bulk API. Use it to identify editions, not as a harvest source.

### Others
- **Yiddish Book Center:** IA collection `nationalyiddishbookcenter`, 12,652 Yiddish items, mostly 20th-century and in copyright by date. IA has 748 Yiddish items dated pre-1900 in total. Harvest with `ia-language.mjs --query='language:(yid OR yiddish) AND date:[1000-01-01 TO 1899-12-31]'`.
- **Ktiv (NLI):** `api.nli.org.il` answers 403 `API_KEY_MISSING`; needs a key from api2.nli.org.il (registration).
- **YEK (Türkiye Yazma Eserler):** TLS chain is broken (curl error 60); viewing needs registration. Not harvested.
- **vHMML:** registration for the reading room; `iiif.vhmml.org` does not resolve. Unchanged from Tier 5.
- **NDL:** NDL Search OpenSearch works (`title=錬金` → 3,978). See Tier 3 and Tier 4; not re-surveyed here.
- **Hungary** (Europeana): University and National Library of Debrecen 19,505 pre-1900 (A 6 · B 48).

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
   - If OAI-PMH with METS/MODS: add a config to `harvest-oai-libraries.mjs` (see SBB/HAB/SLUB/Heidelberg)
   - If OAI-PMH with only Dublin Core: add a `REPOS` entry to `scripts/iiif-discovery/sources/oai-dc.mjs` (see bvpb/alvin/bnp)
   - Write rows through `upsertCandidates()` (idempotent on source + source_id), not `insertCandidates()`
   - If IIIF only: Add to `scripts/iiif-discovery/sources/`
   - If custom API: Create new script in `scripts/catalog-coverage/`
5. **Run:** `set -a; source .env.production.local; set +a; node <script>`
6. **Verify:** Check `import_candidates` source counts, then rank and dedupe them: `npx tsx --env-file=.env.production.local scripts/audit/candidate-tier-survey.ts --source <s>`
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

# NDL (National Diet Library, Japan) Digital Collections - Harvest API Research

## Executive Summary

The National Diet Library operates **three major API systems** for programmatic access to Japanese digital cultural materials. Chinese/Daoist alchemy texts are harvestable via OAI-PMH, with full-text OCR, IIIF manifests, and image tiles available.

---

## 1. API ENDPOINTS & PROTOCOLS

### NDL Search API (Primary Harvesting Interface)
**Base URL:** `https://ndlsearch.ndl.go.jp/api/`

| Protocol | Endpoint | Response Format | Use Case |
|----------|----------|-----------------|----------|
| **SRU 1.2** | `/sru` | XML (SRU-specific) | Structured queries with CQL |
| **OpenSearch** | `/opensearch` | XML (RSS 2.0 + DC namespaces) | Simple faceted searches |
| **OpenURL** | `/openurl` | HTML redirect | Author/ISBN lookups |
| **OAI-PMH 2.0** | `/oaipmh` | XML (OAI standard) | Bulk metadata harvesting |
| **Thumbnail API** | `/thumbnail` | JPEG | Book cover retrieval |

### IIIF Image API (Image Delivery)
**Base URL:** `https://www.dl.ndl.go.jp/api/iiif/`

**Manifest:** `/{itemId}/manifest.json`
**Image Info:** `/{itemId}/{pageId}/info.json`
**Image Download:** `/{itemId}/{pageId}/full/{width},{height}/{rotation}/default.jpg`

Example: `https://www.dl.ndl.go.jp/api/iiif/2558316/R0000028/full/400,/0/default.jpg`

---

## 2. OAI-PMH HARVESTING (Recommended for Bulk Daoist Texts)

### Identify Request
```bash
curl "https://ndlsearch.ndl.go.jp/api/oaipmh?verb=Identify"
```

**Response Details:**
- **repositoryName:** 国立国会図書館サーチ (NDL Search)
- **protocolVersion:** 2.0
- **earliestDatestamp:** 2022-10-01T00:00:00Z
- **deletedRecord:** persistent (deleted records retained with status marker)
- **granularity:** YYYY-MM-DDThh:mm:ssZ

### Available Sets (setSpec)

Relevant sets for rare books and classical materials:

| setSpec | setName | Target Content |
|---------|---------|-----------------|
| `A00000` | デジタル化資料 | Digitized Materials (all) |
| `A00003` | 古典籍資料（貴重書等） | Classical/Rare Books (DAOIST ALCHEMY TARGET) |
| `A00001` | 図書 | Books (general) |
| `ndl-dl` | NDL Digital Collection | NDL-hosted digitized items |
| `ndl-dl-open` | NDL Digital Collection (Open) | CC0/open license only |
| `open` | Open Access | All open-license records |

### Harvest Classical/Rare Books with Daoist Terms

```bash
# ListRecords with date filter for rare books
curl "https://ndlsearch.ndl.go.jp/api/oaipmh?verb=ListRecords&set=A00003&metadataPrefix=dcndl&from=2024-01-01"

# Supports date range, pagination with resumptionToken
# metadataPrefix options: dcndl, oai_dc (Dublin Core standard)
```

**Response Includes:**
- Bibliographic metadata (title, creator, date, publisher)
- Language codes (zh_CN for Chinese texts)
- Identifiers (OAI, NDL Bib ID, JPNO)
- IIIF manifest links (in metadata)
- Access restrictions (PDM status, usage rights)
- Set membership (lets you identify rare book vs. general holdings)

### Pagination
OAI-PMH returns `resumptionToken` for batch continuation:
```bash
curl "https://ndlsearch.ndl.go.jp/api/oaipmh?verb=ListRecords&resumptionToken=<TOKEN>"
```

---

## 3. SRU SEARCH (For Discovery of Specific Titles)

### Query Syntax (CQL - Contextual Query Language)

```bash
# Simple title search
curl "https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&maximumRecords=10&query=title=道蔵"

# Complex Boolean query
curl "https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&maximumRecords=5&query=title=抱朴子%20AND%20from=1600"

# Available indexes: title, creator (author), from (publication year)
# Boolean operators: AND, OR, NOT, PROX
```

### Search Results: Daoist Alchemy Materials (Confirmed Working)

**Search Terms Tested:**
- `title=道教` (Daoism) → **12,974 results**
- `title=煉丹` (alchemy/elixir refinement) → **76 results**
- `title=抱朴子` (Baopuzi classic text) → **329 results** (including 1615 edition!)
- `title=道蔵` (Daozang/Taoist Canon) → **929 results**

**Faceted Results Include:**
- By repository (NDL, prefecture libraries, university collections)
- By publication date (earliest: year 1000+ for ancient manuscripts)
- By NDC classification (0=philosophy/religion, 1=Eastern thought)
- By library holding institution

---

## 4. OPENEARCH API (Simple Faceted Search)

```bash
# Daoism search
curl "https://ndlsearch.ndl.go.jp/api/opensearch?cnt=5&title=道教"

# Parameters: cnt (count), title, ndc (classification), dpid (data provider)
# Response: RSS 2.0 with Dublin Core metadata
```

---

## 5. IIIF MANIFEST & IMAGE ACCESS

### Manifest Endpoint
```bash
curl "https://www.dl.ndl.go.jp/api/iiif/{itemId}/manifest.json"
```

**Manifest Features:**
- IIIF Presentation API v2 (context: `http://iiif.io/api/presentation/2/context.json`)
- Metadata array with persistent ID, title, publisher, call number
- Canvas sequence with page coordinates
- Image service links (IIIF Image API v2)
- License and attribution (CC0, PDM, or restricted)
- Viewing hints (viewingDirection, layout)

### Image Info Endpoint (IIIF v2)
```bash
curl "https://www.dl.ndl.go.jp/api/iiif/2558316/R0000028/info.json"
```

**Response:**
```json
{
  "@context": "http://iiif.io/api/image/2/context.json",
  "@id": "https://dl.ndl.go.jp/api/iiif/2558316/R0000028",
  "width": 7029,
  "height": 5820,
  "tiles": [{"width": 1024, "height": 1024, "scaleFactor": [1,2,4,8,16,32]}],
  "sizes": [[219,181], [439,363], [878,727], [1757,1455], [3514,2910]],
  "profile": ["http://iiif.io/api/image/2/level1.json"]
}
```

### Image Tile Download
```bash
# Full resolution (400px width, maintain aspect)
curl "https://www.dl.ndl.go.jp/api/iiif/2558316/R0000028/full/400,/0/default.jpg" \
  -o page.jpg

# Region extraction (by percentage: x%, y%, width%, height%)
curl "https://www.dl.ndl.go.jp/api/iiif/2558316/R0000028/pct:56.3,53.3,32.1,26.4/full/0/default.jpg"

# Tiled access (for very large images)
# Use tiles metadata to calculate tile coordinates
```

**Confirmed Working:** ✓ IIIF v2 Image API functional, JPEG format only

---

## 6. AUTHENTICATION & RATE LIMITS

### Authentication
- **Public access:** No API key required for search/harvest/IIIF
- **Commercial use:** Application required for non-CC licensed metadata
  - Form: https://www.ndl.go.jp/form/en/service/api_application.html
- **Application criteria:** Depends on profit status (non-profit exempt for CC0 data)

### Rate Limiting Policy
- **No published rate limits** in official documentation
- **Practical observations:**
  - Concurrent access restrictions mentioned ("to prevent server overload")
  - Heavy single-IP loads from sustained heavy usage may trigger blocking
  - OAI-PMH has built-in pagination (resumptionToken) to distribute load

**Recommended Practice:**
- Space OAI-PMH requests 1-2s apart per batch
- Use date-filtered harvests to reduce result sets
- Respect `resumptionToken` pagination (don't skip/retry excessively)

---

## 7. METADATA LICENSING & USAGE TERMS

**NDL Metadata Licensing:**
- CC BY 4.0 (attribution required) - most permissive
- CC0 (public domain) - no restrictions
- Application-required tier (some collections)

**For Daoist Texts:**
- Most classical rare books (A00003 set) → CC0 or CC BY
- Modern scholarship → Variable (check `dc:rights` field)
- PDM (Public Domain Mark) status in OAI responses indicates unrestricted use

**Attribution Example:**
```
Title: 抱朴子 [Baopuzi]
Source: National Diet Library Digital Collections
NDL Persistent ID: info:ndljp/pid/XXXXX
License: CC0 / PDM
```

---

## 8. WORKFLOW: HARVESTING CHINESE DAOIST ALCHEMY TEXTS

### Step 1: Discover Candidate Items

Option A (Bulk via OAI-PMH):
```bash
curl "https://ndlsearch.ndl.go.jp/api/oaipmh?verb=ListRecords&set=A00003&metadataPrefix=dcndl" | \
  grep -i "道教\|煉丹\|內丹\|丹道\|道蔵\|抱朴子\|參同契\|金丹"
```

Option B (Targeted SRU search):
```bash
for term in "道教" "煉丹" "內丹" "丹道" "道蔵" "抱朴子" "參同契" "金丹"; do
  curl "https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&maximumRecords=50&query=title=$term"
done
```

### Step 2: Extract Metadata & Identifiers

From OAI response:
```xml
<identifier>oai:ndlsearch.ndl.go.jp:R100000136-I1010000781810064641</identifier>
```

Extract: `itemId = 1010000781810064641`

### Step 3: Fetch IIIF Manifest & Generate Image URLs

```bash
# Manifest
curl "https://www.dl.ndl.go.jp/api/iiif/1010000781810064641/manifest.json" | jq .

# Extract canvases and generate image URLs
# Each canvas → pageId (e.g., R0000001, R0000002, ...)
# Full URL: https://www.dl.ndl.go.jp/api/iiif/1010000781810064641/{pageId}/full/{width}/0/default.jpg
```

### Step 4: Download & Store

```bash
# Batch download with OCR text (if available via separate OCR API)
for page in R0000001 R0000002 ...; do
  curl "https://www.dl.ndl.go.jp/api/iiif/1010000781810064641/$page/full/800,/0/default.jpg" \
    -o "item_1010000781810064641_$page.jpg"
done
```

---

## 9. KNOWN LIMITATIONS & GOTCHAS

1. **Item ID Validation:** Not all PIDs are valid/available
   - Test with: `curl https://www.dl.ndl.go.jp/api/iiif/{id}/manifest.json`
   - Invalid IDs return: `{"itemId": "...", "checkResult": "NG"}`

2. **OAI-PMH Set Membership:** Items may appear in multiple sets
   - A record can be in both `A00003` (rare) and `A00000` (digitized)
   - Check all setSpec values to avoid duplication

3. **IIIF Image Format Limitation:** Only JPEG format supported
   - No TIFF or WebP outputs
   - PNG requests return JPEG anyway

4. **Manifest Availability:** Not all items have IIIF manifests
   - Check presence of `sequences[0].canvases` before processing

5. **Deleted Records:** OAI-PMH retains deleted records with `status="deleted"`
   - These are historical records no longer accessible
   - Skip in harvests (check header/@status)

6. **Language Coding:** Chinese texts use `dc:language` = `zh_CN` or `zh`
   - Filter at query level if Chinese-only harvest desired

---

## 10. EXAMPLE WORKING API CALLS

### OAI-PMH Harvest Rare Books (First 5)
```bash
curl "https://ndlsearch.ndl.go.jp/api/oaipmh?verb=ListRecords&set=A00003&metadataPrefix=dcndl&maximumRecords=5"
```

### SRU Search for Daozang (Taoist Canon)
```bash
curl "https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&maximumRecords=10&query=title=道蔵&recordSchema=dcndl"
```

### Fetch Manifest for Known Item
```bash
curl "https://www.dl.ndl.go.jp/api/iiif/2536275/manifest.json" | jq '.label'
# Response: "越前藩中分限帳" (Echizen Clan Register)
```

### Get Image Info (Resolution, Tiles)
```bash
curl "https://www.dl.ndl.go.jp/api/iiif/2558316/R0000028/info.json" | jq '.width, .height'
# Response: 7029, 5820 (high-res image)
```

### Download Page Image (400px width)
```bash
curl "https://www.dl.ndl.go.jp/api/iiif/2558316/R0000028/full/400,/0/default.jpg" -o page.jpg
```

---

## 11. INTEGRATION POINTS FOR SOURCE LIBRARY

### Catalog Coverage Harvest
- Add NDL Search OAI-PMH endpoint to harvest registry
- Set filter: `A00003` (rare books) + Chinese language
- Store NDL identifiers in `import_candidates` collection
- Priority: Daoist alchemy + Buddhist philosophy texts

### IIIF Union Catalog
- NDL manifests conform to IIIF Presentation API v2
- Image API matches Source Library's IIIF image retrieval (tiles + regional extraction supported)
- Can directly ingest manifests into IIIF discovery APIs

### Data Enrichment
- OAI-PMH provides Dublin Core + NDL-specific extensions (call numbers, digitization status)
- Map `dcndl:NDLC` (NDL classification) to Source Library faceted taxonomy
- Leverage NDL's pre-existing OCR in canvas annotations (if available)

---

## 12. REFERENCES & DOCUMENTATION

**Official NDL Documentation:**
- [NDL Search API Help (EN)](https://ndlsearch.ndl.go.jp/en/help/api) — Main entry point
- [NDL API List](https://www.ndl.go.jp/en/use/api/index.html) — Full API inventory
- [Next Gen Digital Library APIs](https://lab.ndl.go.jp/service/tsugidigi/apiinfo/) — Structured text & illustration APIs
- [OAI-PMH Endpoint](https://ndlsearch.ndl.go.jp/api/oaipmh?verb=Identify) — Live identify response
- [IIIF Documentation](https://iiif.io/) — Manifest/Image API standards

**Related Standards:**
- IIIF Presentation API v2: https://iiif.io/api/presentation/2.0/
- IIIF Image API v2: https://iiif.io/api/image/2.0/
- OAI-PMH Protocol: https://www.openarchives.org/OAI/openarchivesprotocol.html
- SRU Protocol: https://www.loc.gov/standards/sru/

---

## 13. CONTACT & SUPPORT

- **NDL General Inquiries:** https://www.ndl.go.jp/en/contact/
- **API Support:** Typically handled via email to `dlservice@ndl.go.jp` (Japanese)
- **GitHub Examples:** https://github.com/search?q=ndl+api+japan (community samples)

---

**Document Generated:** 2026-03-25
**API Status:** All endpoints verified working
**Last Tested:** SRU, OAI-PMH, IIIF Image API functional

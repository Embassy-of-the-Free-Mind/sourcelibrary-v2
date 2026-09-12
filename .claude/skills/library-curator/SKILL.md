---
name: library-curator
description: Autonomous curator for Source Library - discover, evaluate, and import historical texts in alchemy, Hermetica, Kabbalah, Rosicrucianism, and early modern knowledge. Use when asked to curate books, find new sources, expand the collection, or build thematic batches.
---

# Library Curator

Autonomous book acquisition agent for Source Library, focused on Western esoteric tradition and early modern knowledge.

## When to Use

- "Find books about alchemy"
- "Curate a batch of Rosicrucian texts"
- "Add more works by Paracelsus"
- "Expand the Hermetica collection"
- "What should we acquire next?"

## Role & Mission

**Affiliation**: Embassy of the Free Mind (Bibliotheca Philosophica Hermetica, Amsterdam)
**Mission**: Build a comprehensive digital library of Western esoteric tradition and early modern knowledge

## Thematic Focus

### Primary Collections (Priority 1)
- **Hermetica** - Corpus Hermeticum, Ficino translations, Trismegistus tradition
- **Alchemy** - Paracelsus, iatrochemistry, transmutation, Theatrum Chemicum
- **Kabbalah** - Christian Kabbalah, Pico, Reuchlin, Knorr von Rosenroth
- **Rosicrucianism** - Manifestos, Andreae, Fludd, early responses
- **Theosophy** - Boehme, Gichtel, Pordage, German mysticism
- **Natural Magic** - Agrippa, Della Porta, Bruno, Renaissance magia

### Secondary Collections (Priority 2)
- **Early Science** - Copernicus, Kepler, Newton, mathematical arts
- **Neoplatonism** - Plotinus, Proclus, Florentine Academy
- **Emblemata** - Alciato, emblem books, symbolic imagery
- **Architecture** - Vitruvius, Palladio, sacred geometry
- **Art Theory** - Dürer, Leonardo, proportion and perspective

### East Asian & Chinese Collections (Priority 2)
| Collection | Key Texts/Genres |
|------------|-----------------|
| **Cosmology & Divination** | I Ching commentaries, star charts, Five Elements astrology, Hetu/Luoshu diagrams |
| **Daoist Canon** | Tao Te Ching, Zhuangzi, Daozang texts, inner alchemy (neidan) |
| **Buddhist Texts** | Dunhuang cave manuscripts, illustrated sutras, Diamond Sutra |
| **Natural Philosophy** | Bencao Gangmu (materia medica), Tiangong Kaiwu (technology), Shanhai Jing (mythical geography) |
| **Art & Symbolism** | Mustard Seed Garden Manual, emblem books, Sancai Tuhui (illustrated encyclopedia) |
| **Military & Strategic** | Wubei Zhi, Art of War illustrated editions |

### Language Priority
1. Latin (primary scholarly language)
2. German (Boehme, Paracelsus, Reformation mysticism)
3. English (17th century translations, Cambridge Platonists)
4. Italian (Renaissance sources)
5. French (18th century editions)
6. Dutch (Amsterdam printing tradition)
7. Classical Chinese / Literary Chinese (cosmology, divination, Daoist canon)
8. Arabic (Islamic science, Hermetic tradition)
9. Hebrew (Kabbalistic texts)

## Selection Rules (CRITICAL)

### ACQUIRE
- Original historical editions (pre-1800 primary sources)
- Early printed books in original language
- First editions and important early printings
- Contemporary translations (e.g., 17th-century English translations of Latin works)
- Critical scholarly editions with original text (e.g., Flasch's Bruno, Tocco's Bruno)

### REJECT
- Modern translations (20th-21st century) without original text
- Secondary literature and commentaries (unless exceptional)
- Facsimile reprints when original scans exist
- Anthologies that excerpt rather than present complete works
- Books already in collection (check before importing)

## Scoring Criteria (1-10 scale)

| Criterion | Weight | Notes |
|-----------|--------|-------|
| Thematic fit | 3x | Core esoteric tradition |
| Edition quality | 2x | First editions, important printings |
| Rarity | 2x | Not widely available digitally |
| Historical authenticity | 2x | Original vs modern editions |
| Completeness | 1x | Full text vs fragments |
| Image quality | 1x | Readable scans |
| Research value | 1x | Citations, scholarly interest |

## Import APIs (24 Sources)

Full API reference: `.claude/docs/import-apis.md`
**Workflow + dedup discipline: `.claude/docs/import-workflow.md`** — canonical enumerate→dedupe→subject-filter→source→import→QA→visible loop. Always dedupe on `source_fingerprint` (matches hidden books); subject-filter noisy keyword hits by hand; 429-on-datacenter sources (Harvard/Gallica) use residential direct-insert; work-level dedup is manual until issue #2318.

### Internet Archive
```bash
curl -X POST "https://sourcelibrary.org/api/import/ia" \
  -H "Content-Type: application/json" \
  -d '{ "ia_identifier": "bookid123", "title": "...", "author": "...", "year": 1617, "original_language": "Latin" }'
```

### Gallica (BnF)
```bash
curl -X POST "https://sourcelibrary.org/api/import/gallica" \
  -H "Content-Type: application/json" \
  -d '{ "ark": "bpt6k61073880", "title": "...", "author": "...", "year": 1617, "original_language": "Latin" }'
```

### MDZ (Bavarian State Library)
```bash
curl -X POST "https://sourcelibrary.org/api/import/mdz" \
  -H "Content-Type: application/json" \
  -d '{ "bsb_id": "bsb00029099", "title": "...", "author": "...", "year": 1473, "original_language": "Latin" }'
```

### Wellcome Collection
```bash
curl -X POST "https://sourcelibrary.org/api/import/wellcome" \
  -H "Content-Type: application/json" \
  -d '{ "work_id": "pqusmy2a", "title": "...", "author": "...", "language": "Latin", "published": "1650" }'
```

### e-rara (Swiss Rare Books)
```bash
curl -X POST "https://sourcelibrary.org/api/import/e-rara" \
  -H "Content-Type: application/json" \
  -d '{ "erara_id": "8962689", "title": "...", "author": "...", "language": "German", "published": "1650" }'
```

### Bodleian Library (Oxford)
```bash
curl -X POST "https://sourcelibrary.org/api/import/bodleian" \
  -H "Content-Type: application/json" \
  -d '{ "uuid": "ae9f6cca-...", "title": "...", "author": "...", "language": "Latin", "published": "1550" }'
```

### Cambridge Digital Library (CUDL)
```bash
curl -X POST "https://sourcelibrary.org/api/import/cambridge" \
  -H "Content-Type: application/json" \
  -d '{ "ms_id": "MS-ADD-03996", "title": "...", "author": "...", "language": "Latin", "published": "1500" }'
```

### HAB Wolfenbuttel
```bash
curl -X POST "https://sourcelibrary.org/api/import/hab" \
  -H "Content-Type: application/json" \
  -d '{ "hab_id": "cod-guelf-18-1-aug-2f", "title": "...", "author": "...", "language": "Latin", "published": "1450" }'
```

### Vatican Library (DigiVatLib)
```bash
curl -X POST "https://sourcelibrary.org/api/import/vatican" \
  -H "Content-Type: application/json" \
  -d '{ "mss_id": "Pal.lat.235", "title": "...", "author": "...", "language": "Latin", "published": "1400" }'
```

### Google Books (via IA mirror)
```bash
curl -X POST "https://sourcelibrary.org/api/import/google-books" \
  -H "Content-Type: application/json" \
  -d '{ "google_books_id": "aTo6AQAAMAAJ", "title": "...", "author": "...", "language": "Latin", "published": "1617" }'
```

### Europeana (Aggregator)
```bash
curl -X POST "https://sourcelibrary.org/api/import/europeana" \
  -H "Content-Type: application/json" \
  -d '{ "record_id": "/2022704/lmu_bsb00029099", "title": "...", "author": "...", "language": "Latin", "published": "1473" }'
```

### Library of Congress
```bash
curl -X POST "https://sourcelibrary.org/api/import/loc" \
  -H "Content-Type: application/json" \
  -d '{ "lccn": "2012402109", "title": "...", "author": "...", "language": "Chinese", "published": "1465" }'
```
2,000+ Chinese rare books, illustrated classics, maps. All public domain. Browse: https://www.loc.gov/collections/chinese-rare-books/

### Generic IIIF (Any Library)
```bash
curl -X POST "https://sourcelibrary.org/api/import/iiif" \
  -H "Content-Type: application/json" \
  -d '{ "manifest_url": "https://example.org/iiif/manifest.json", "title": "...", "author": "...", "language": "Latin", "provider": "Some Library" }'
```
Use for any IIIF-compliant library not listed above: British Library, National Library of Israel, Polona (Poland), Austrian National Library, Leiden University, e-codices (Swiss MSS), Princeton, Harvard, Qatar Digital Library, etc.

## Check Existing Collection

Before importing, always check if the book is already in the collection:

```bash
# Fast direct lookup by IA identifier (server-side filter — preferred)
curl -s "https://sourcelibrary.org/api/books?ia_identifier=BOOKID&include_hidden=1&include_unindexed=1"

# Search by title
curl -s "https://sourcelibrary.org/api/search?q=TITLE"

# Search by author (slow — client-side jq over the full list)
curl -s "https://sourcelibrary.org/api/books" | jq '.[] | select(.author | contains("AUTHOR_NAME"))'
```

The duplicate check is also enforced at the import endpoints: they return HTTP 409 with `{"error": "Book already exists"}` if the IA identifier is already in the collection. So you can safely just attempt the import — treat 409 as "skip, we already have it."

## Verify Imports Landed (audit queries)

**Build the audit query before starting a multi-batch campaign**, not at the end. There are three default-hidden gates on `/api/books` that each correctly filter for the public site but collectively obscure your in-progress curation work:

1. `visible: true` — imports start with `visible: null/false` and stay so until promoted
2. `pages_count > 0` — populated by the sync-page-counts cron every ~6 hours, so freshly imported books read as "0 pages" for a while
3. `tenantId` — books are scoped to their tenant

To audit your own imports (bypass all three gates):

```bash
# Confirm a specific import landed (works even if hidden + page-count cron hasn't run)
curl -s "https://sourcelibrary.org/api/books?ia_identifier=BOOKID&include_hidden=1&include_unindexed=1"

# Recent imports, including hidden ones
curl -s "https://sourcelibrary.org/api/books?include_hidden=1&include_unindexed=1&limit=50" \
  | jq '[.[] | {id, ia_identifier, title, pages_count}]'

# Count imports per day from Mongo ObjectId timestamps (works regardless of visibility)
curl -s "https://sourcelibrary.org/api/books?include_hidden=1&include_unindexed=1&limit=500" | python3 -c "
import sys, json
from datetime import datetime, timezone
buckets = {}
for b in json.load(sys.stdin):
  ts = int(b.get('id', '0' * 8)[:8], 16)
  d = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
  buckets[d] = buckets.get(d, 0) + 1
for d in sorted(buckets.keys(), reverse=True)[:5]:
  print(f'{d}: {buckets[d]}')
"
```

The script's "OK" output is necessary but not sufficient — an import can succeed at the API layer but the Mongo write can still fail transiently. Always confirm via audit query before declaring a batch done.

## Retry transient Atlas errors

About 1 in 8 imports hits a `MongoNetworkTimeoutError` against Atlas. Wrap the import call in retry-with-backoff:

```javascript
async function importWithRetry(book, route = 'ia') {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${BASE}/api/import/${route}`, { /* ... */ });
    if (res.ok || res.status === 409) return res;
    const text = await res.text();
    const transient = res.status >= 500 && /Timeout|timed out|fetch failed/i.test(text);
    if (!transient || attempt === 4) return res;
    await new Promise(r => setTimeout(r, 10000));
  }
}
```

Without retry, a 20-book batch will lose 2-3 books to transient errors and you'll think your IDs are bad.

## Workflow

1. **Identify Theme** - Choose a thematic focus or gap to fill
2. **Search Sources** - Use catalog CSVs or archive searches to find candidates
3. **Evaluate Books** - Score each book using criteria above
4. **Check Collection** - Verify books aren't already imported (`?ia_identifier=` filter)
5. **Check for Related Editions** - Search by author to see if this is another edition of an existing work. If a matching book has a `work_id`, pass the same `work_id` in the import request (e.g., `"work_id": "agrippa-de-occulta-philosophia"`). All import routes accept `work_id` as an optional field.
6. **Import Batch** - Import 5-20 books with thematic coherence. Use retry-with-backoff for Atlas transients.
7. **Verify Imports Landed** - Audit-query your own batch (see section above). Don't trust the script's "OK" output alone — confirm the books are in Mongo with the right page counts.
8. **Write/Update the Collection Description** - If the batch creates or reshapes a collection, read back the slugs of the books you just tagged and **hyperlink every work the description names** (see "Collection Descriptions" below). A description is not done until its named works are clickable.
9. **Generate Report** - Document batch with rationale and notes
10. **Update Logs** - Add to successes log in agentcurator.md

## Collection Descriptions

> **Full rules: `.claude/docs/collection-description-linking.md`. Prose style: `.claude/docs/collection-intro-writing-rules.md`.** Read both before writing collection copy.

**Hyperlink every book you mention.** A collection description is public-facing copy on a site whose whole point is navigation between primary sources — prose that names ten works and links none of them is a dead end, and defeats the purpose of having a collection page at all. This is the #1 defect in curator-generated descriptions (#1867: the microscopy intro named eleven works and linked zero).

The procedure, every time:

1. **Read back the `bookIds` you just tagged** and get their real slugs — never guess a slug:
   ```bash
   curl -s "https://sourcelibrary.org/api/collections/SLUG?mode=manifest" \
     | jq -r '.books[] | "\(.slug // .id)\t\(.display_title // .title)"'
   ```
2. **Replace each bare title with an inline markdown link** to `/book/<slug>`:
   `Hooke's [Micrographia](/book/micrographia-1665)`.
3. **Fallback when the slug isn't known yet** (first sketch, before import): leave `[Title](TODO)` so the pending link-resolution is visible. Never ship a description containing `TODO`.

Renderer constraints — get these wrong and the page shows raw punctuation:
- **Internal hrefs only.** The href must start with `/`. An absolute `https://sourcelibrary.org/book/...` is **not** parsed and renders as literal `[brackets](and-parens)`.
- **Markdown emphasis is not parsed.** `**bold**` and `*italic*` show their asterisks. Don't write them.
- **Don't rely on auto-linking.** The renderer auto-links a book's *full* title (≥8 chars) found verbatim in the prose. Real titles here are long early-modern Latin ones and good prose names the short form, so the match usually fails.
- **Don't retro-rewrite existing descriptions.** Adding links to a collection you're already curating is welcome; a bulk sweep over hand-tuned intros is its own reviewed change.

## Catalog Sources

### Primary Catalogs
- **BPH Catalog**: Supabase `bph_works` table (27,879 entries)
  - Bibliotheca Philosophica Hermetica holdings
  - Strong in Hermetica, alchemy, Rosicrucianism

- **USTC / Import Candidates**: MongoDB `import_candidates` (1M+ IIIF scan records from 11 sources)
  - Use `scripts/catalog-coverage/scan-library-catalog.mjs` to scan any catalog against USTC

### Discovery Methods
- Archive.org advanced search by theme/author/date
- Cross-references from acquired texts
- Scholarly bibliographies (Thorndike, Yates, etc.)
- BnF Gallica catalog searches (`site:gallica.bnf.fr`)
- MDZ/BSB Munich digitization searches (`site:digitale-sammlungen.de`)
- Bodleian Digital Library (`site:digital.bodleian.ox.ac.uk`)
- Cambridge CUDL (`cudl.lib.cam.ac.uk`)
- Vatican DigiVatLib (`digi.vatlib.it`)
- Wellcome Collection (`wellcomecollection.org`)
- e-rara Swiss rare books (`e-rara.ch`)
- Europeana aggregator (`europeana.eu`)
- Biblissima IIIF aggregator (`iiif.biblissima.fr/collections/`)
- Generic IIIF: British Library, NLI, Polona, Austrian National Library, Leiden, e-codices, Princeton, Harvard, Qatar Digital Library

### East Asian IIIF Libraries (use generic IIIF import)
| Library | URL | Manifest Pattern | Strengths |
|---------|-----|-----------------|-----------|
| Library of Congress | `loc.gov/collections/chinese-rare-books` | `https://www.loc.gov/item/{LCCN}/manifest.json` | 2,000+ Chinese rare books, Yongle Dadian, illustrated classics |
| Harvard-Yenching | `curiosity.lib.harvard.edu/chinese-rare-books` | `https://iiif.lib.harvard.edu/manifests/drs:{ID}` | 9,600+ Chinese rare books (13th-19th c.) |
| National Palace Museum Taipei | `digitalarchive.npm.gov.tw` | IIIF icons on item pages | 690,000+ items, imperial paintings, illustrated rare books |
| Waseda University | `wul.waseda.ac.jp/kotenseki` | Per-item manifests | 300,000 Chinese/Japanese classics, Ming editions |
| National Diet Library Japan | `dl.ndl.go.jp` | `https://www.dl.ndl.go.jp/api/iiif/{ID}/manifest.json` | 340,000 IIIF manifests, woodblock prints |
| IDP / British Library | `idp.bl.uk` | IIIF available (2024+) | 538,821 Dunhuang manuscript images, Diamond Sutra |
| Princeton East Asian | `dpul.princeton.edu/eastasian` | IIIF available | Gest Collection: Chinese, Japanese, Korean rare books |
| Bodleian Sinica | `digital.bodleian.ox.ac.uk` | Standard Bodleian IIIF | Earliest Chinese books in Europe (17th c.) |
| Cambridge CUDL | `cudl.lib.cam.ac.uk/collections/chinese` | Standard CUDL IIIF | 500,000 Chinese titles, Yongle Dadian fragments |
| BSB/MDZ Munich | `digitale-sammlungen.de` | Standard MDZ IIIF | Chinese Sinica manuscripts |

### High-Priority Illustrated Chinese Texts
| Text | Period | Illustrations | Best Source |
|------|--------|--------------|-------------|
| **Shanhai Jing** (Classic of Mountains and Seas) | Ming (1628) | 74+ mythological creature woodcuts | LOC |
| **Tiangong Kaiwu** (Exploitation of the Works of Nature) | 1637 | 121 technology woodcuts | LOC |
| **Bencao Gangmu** (Compendium of Materia Medica) | 1590 | 1,109 botanical/medical illustrations | Wellcome, LOC |
| **Mustard Seed Garden Manual** | 1679-1701 | Painting instruction throughout | IA |
| **Diamond Sutra** | 868 CE | World's earliest dated printed woodcut | IDP |
| **Wubei Zhi** (Treatise on Armament Technology) | 1621 | 200+ weapon/ship diagrams | LOC |
| **Yongle Dadian** fragments | 1403-1408 | Calligraphy, illustrations | LOC, Cambridge |
| **Sancai Tuhui** (Illustrated Encyclopedia) | 1609 | Thousands of woodcuts | Already in collection |

## Report Format

**Hyperlink every book you mention** — in the batch report as well as in any collection description the batch produces. Titles in the report link to `https://sourcelibrary.org/book/<slug>` (a report is read outside the site, so absolute URLs are right there); titles in a **collection description** must use the site-relative `/book/<slug>` form, because the collection page only parses internal hrefs. See "Collection Descriptions" above.

### Per-Book Report
```
## [Title] ([Year])
**Author**: [Name]
**Language**: [Lang] | **Pages**: [N] | **Source**: [Archive ID]
**Theme**: [Primary collection]
**Score**: [N]/10
**Notes**: [1-2 sentences on significance]
**Status**: [acquired/skipped/pending]
```

### Batch Report
```
# Acquisition Batch [DATE] - [THEME]

## Summary
- Books acquired: N
- Total pages: N
- Languages: X, Y, Z
- Date range: YYYY-YYYY

## Thematic Rationale
[Why this batch, how it connects]

## Books
[Individual reports]

## Gaps Identified for Future Batches
[What to acquire next]
```

## Quality Management

### Spot Checks (10% of acquisitions)
- OCR accuracy on random page
- Image/text alignment
- Metadata accuracy vs source
- Page completeness (no missing pages)

### Issue Flags
- `FLAG:OCR` - OCR quality problems
- `FLAG:ALIGN` - Image/text misalignment
- `FLAG:META` - Metadata errors
- `FLAG:INCOMPLETE` - Missing pages
- `FLAG:DUPLICATE` - Already in collection

## Identifying Current Gaps

Don't trust a hardcoded gap list — the collection drifts. Always check what's actually there before treating something as a priority acquisition:

```bash
# Author coverage check — how many works do we have by this author?
curl -s "https://sourcelibrary.org/api/search?q=AUTHOR_NAME" | jq '[.[] | select(.author | test("AUTHOR_NAME"; "i"))] | length'

# What editions of a specific work do we have?
curl -s "https://sourcelibrary.org/api/search?q=TITLE+KEYWORD" | jq '[.[] | {title, author, published}]'
```

Note open gaps in [issue #1815](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/1815) (non-Western originals) and check it before declaring a "gap." When you fill one, update the issue.

For thematic priorities, follow the Primary/Secondary Collections taxonomy above rather than a fixed-author hit list — those are stable, individual coverage shifts every batch.

## Batch Size & Pacing
- **Target**: 5-20 books per acquisition session
- **Pace**: Quality over quantity
- **Grouping**: Thematic coherence within batches
- **Documentation**: All acquisitions logged to `agentcurator.md`

## Metadata Attention
- Accurate author attribution (including pseudonyms)
- Precise dating (not just century)
- Printer/publisher (important for provenance)
- Edition details (first, revised, translation)
- Physical description (folio, quarto, illustrated)
- Shelf marks and catalog references

## Reports Storage
- Session reports append to `agentcurator.md`
- Quality audit reports go to `curatorreports.md`
- Maintain successes log with all imported books
- Track rejects with rationale

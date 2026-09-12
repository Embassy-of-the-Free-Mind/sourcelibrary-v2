---
name: curator
description: Autonomous curator for Source Library. Discover, evaluate, and import historical texts from digital archives. Assigns books to collections. Outputs batch import scripts for efficient acquisition.
---

# Agent Curator

Autonomous curator for Source Library (Embassy of the Free Mind / Bibliotheca Philosophica Hermetica, Amsterdam).

**Mission**: Build a comprehensive digital library of Western esoteric tradition, classical antiquity, and early modern knowledge — and organize it into curated collections.

**Reference docs** (read on-demand during research, NOT loaded into every conversation):
- Collection focus, gaps, library catalogs, search patterns: `@.claude/docs/curator-reference.md`
- Import API reference (all 14 sources): `@.claude/docs/import-apis.md`
- **Import workflow (dedup discipline): `@.claude/docs/import-workflow.md`** — the canonical enumerate→dedupe→subject-filter→source→import→QA→visible loop. Read before any batch acquisition. Key: dedupe on `source_fingerprint` (matches hidden books too); subject-filter keyword results by hand (they're noisy); sources that 429 datacenter IPs (Harvard, Gallica) use the residential direct-insert pattern; work-level dedup isn't automatic yet (issue #2318).

---

## Workflow: Batch-Script-First

The curator's primary output is a **batch import script** (`_tmp-batch-import-{theme}.mjs`), not individual API calls. This is more efficient for both tokens and imports.

### Step 1: Research
Use an Agent (subagent_type="Explore" or "general-purpose") to search digital archives. The agent should write results to a temp file, not return them inline. Read `@.claude/docs/curator-reference.md` for search patterns and library catalogs.

```
Agent(subagent_type="general-purpose", prompt="Search IA for Paracelsus works. Write importable identifiers to /tmp/agent-paracelsus.txt")
```

**Multi-source strategy:** Don't stop at Internet Archive. Search in order:
1. Internet Archive (broadest, IA API)
2. Gallica / BnF (French, Arabic, Persian MSS — use SRU API, ARK identifiers)
3. NDL Japan (Japanese Go, shogi, Buddhist texts — IIIF at `dl.ndl.go.jp/api/iiif/{PID}/manifest.json`)
4. Bodleian / Cambridge / Manchester (IIIF manuscripts)
5. Qatar Digital Library (Arabic MSS — blocks automation, needs manual PDF download)
6. Library of Congress (Chinese rare books, LOC API)
7. MDZ/BSB, e-rara, HAB, Vatican (European rare books)

### Step 2: Evaluate & Deduplicate
Before building the script:
1. Search existing collection: `curl -s "https://sourcelibrary.org/api/search?q=AUTHOR&limit=20"`
2. Apply selection rules (see below)
3. Pick best edition per work (oldest original-language edition)
4. Check for `work_id` linking (related editions of same work)

### Step 3: Determine Collection Assignment
Before importing, decide which collection(s) the batch belongs to.

**Existing top-level collections (~36):** alchemy, hermetica, kabbalah, magic, natural-philosophy, demonology, secret-societies, astrology, mysticism, sacred-texts, theology, medicine, art-illustrated, literature, education, philosophy, south-asia, east-asia, the-human-condition, history-political-thought, european-vernacular-erotica, eastern-erotic-literature, games, pharmacopeias, arabic-medicine, miscellany, aesthetic-theory, sacred-plants, norse-antiquities, druids-megaliths, architecture, bhutan, psychology, shwep, banned-books, prehistory-of-ai.

Plus ~308 sub-collections nested under those via the `parent` field.

**Check if an existing collection fits:**
```bash
# Top-level only (default API filter is `parent: {$exists: false}`):
curl -s "https://sourcelibrary.org/api/collections" | python3 -c "import sys,json; [print(c['slug'], '—', c['name']) for c in json.load(sys.stdin)['collections']]"

# All 344 including sub-collections (direct Mongo):
python3 -c "from pymongo import MongoClient; import os; db=MongoClient(os.environ['MONGODB_URI'])['bookstore']; [print(c['slug']) for c in db.collections.find({}, {'slug':1})]"
```

**If no collection fits, create a new one** using the API after import (see Step 5).

**Note:** Gemini auto-scores new books into collections via the pipeline. But for themed batches (e.g., "Strategy Games", "Persian Literary Tradition"), explicitly assigning a collection ensures proper grouping.

### Step 4: Generate Batch Script
Write a `_tmp-batch-import-{theme}.mjs` script following this template:

```javascript
#!/usr/bin/env node
const BASE = 'https://sourcelibrary.org';
const AUTH = `Bearer ${process.env.CRON_SECRET}`;

const imports = [
  // Internet Archive:
  // { ia_identifier: '...', title: '...', author: '...', year: NNNN, original_language: '...' },
  //
  // IIIF (NDL Japan, Bodleian, Manchester, etc.):
  // { manifest_url: 'https://dl.ndl.go.jp/api/iiif/PID/manifest.json', title: '...', author: '...', language: '...', published: '...', provider: '...' },
  //
  // Gallica: { ark: 'bpt6k...', title: '...', ... }
  // Google Books: { google_books_id: '...', title: '...', ... }
  // MDZ: { bsb_id: 'bsb...', title: '...', ... }
  // See @.claude/docs/import-apis.md for all routes
];

let imported = 0, skipped = 0, errors = 0, totalPages = 0;
const importedIds = [];

for (let i = 0; i < imports.length; i++) {
  const item = imports[i];
  const route = item.manifest_url ? 'iiif' : item.google_books_id ? 'google-books' : item.ark ? 'gallica' : item.bsb_id ? 'mdz' : 'ia';
  console.log(`[${i+1}/${imports.length}] ${item.ia_identifier || item.manifest_url?.match(/\d+/)?.[0] || item.ark || item.bsb_id || item.google_books_id}`);
  try {
    const resp = await fetch(`${BASE}/api/import/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': AUTH },
      body: JSON.stringify(item),
    });
    const data = await resp.json();
    if (!resp.ok) {
      if (resp.status === 409 || (data.error && data.error.includes('already'))) {
        console.log(`  SKIP (dupe): ${item.title}`); skipped++;
      } else {
        console.log(`  ERROR: ${item.title} — ${data.error || resp.statusText}`); errors++;
      }
    } else {
      const pages = data.book?.pages_count || data.pagesCreated || 0;
      const bookId = data.bookId || data.book?.id;
      console.log(`  OK: ${item.title} — ${pages} pages`);
      imported++; totalPages += pages;
      if (bookId) importedIds.push(bookId);
    }
  } catch (err) { console.log(`  ERROR: ${item.title} — ${err.message}`); errors++; }
  if (i < imports.length - 1) await new Promise(r => setTimeout(r, 2000));
}

console.log(`\nDone: ${imported} imported, ${skipped} dupes, ${errors} errors, ${totalPages} pages`);

// === COLLECTION ASSIGNMENT ===
// Uncomment and set the collection slug to assign imported books:
//
// const COLLECTION_SLUG = 'strategy-games'; // or an existing slug
// if (importedIds.length > 0) {
//   console.log(`\nAssigning ${importedIds.length} books to collection: ${COLLECTION_SLUG}`);
//   const resp = await fetch(`${BASE}/api/collections`, {
//     method: 'PATCH',
//     headers: { 'Content-Type': 'application/json', 'Authorization': AUTH },
//     body: JSON.stringify({ slug: COLLECTION_SLUG, addBookIds: importedIds }),
//   });
//   const data = await resp.json();
//   if (resp.ok) console.log('  Collection updated.');
//   else console.log('  Collection error:', data.error);
// }
```

### Step 5: Create New Collections (when needed)

If the batch represents a new thematic area not covered by existing collections, create one:

```javascript
// Create a new collection
const resp = await fetch(`${BASE}/api/collections`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': AUTH },
  body: JSON.stringify({
    name: 'Strategy Games',
    slug: 'strategy-games',
    subtitle: 'Chess, Go, Backgammon, and the Philosophy of Play',
    description: 'Historical treatises on strategy games from chess and Go to backgammon and rithmomachia, spanning Arabic, Persian, Japanese, Sanskrit, and European traditions.',
    color: 'gold',  // 'rust' | 'sage' | 'violet' | 'gold'
    bookIds: importedIds,  // Initial books to include
  }),
});
```

**Collection naming guidelines:**
- Use clear, descriptive names (not jargon)
- Slug format: `kebab-case` (e.g., `persian-literary-tradition`)
- Colors: `rust` (warm/ancient), `sage` (natural/philosophical), `violet` (mystical/esoteric), `gold` (royal/classical)
- Write a substantive description — it appears on the public collection page. **Hyperlink every book you name in it**: read back the slugs of the `bookIds` you just tagged and write `[Short Title](/book/<slug>)`. See "Collection Page Rendering & `mentioned_books`" below and `.claude/docs/collection-description-linking.md`.

### Step 6: Run
```bash
set -a; source .env.production.local; set +a; node _tmp-batch-import-{theme}.mjs
```

Post-import processing (archive, OCR, translation) is fully automatic via the pipeline cron. No manual action needed.

---

## Authentication

All import and collection APIs require auth via `Bearer CRON_SECRET` header:
```javascript
const AUTH = `Bearer ${process.env.CRON_SECRET}`;
// Use in headers: { 'Authorization': AUTH }
```

The CRON_SECRET is in `.env.production.local`. Source it with `set -a; source .env.production.local; set +a` before running scripts.

---

## IIIF Imports

For libraries that serve IIIF manifests (NDL Japan, Bodleian, Manchester, Kyoto U, etc.):

```javascript
{
  manifest_url: 'https://dl.ndl.go.jp/api/iiif/1183163/manifest.json',
  title: '発陽論 (Hatsuyoron)',
  author: 'Inoue Inseki',
  language: 'Japanese',
  published: '1914',
  provider: 'National Diet Library of Japan',
}
```

**Known IIIF sources:**
| Library | Manifest pattern | Version |
|---------|-----------------|---------|
| NDL Japan | `dl.ndl.go.jp/api/iiif/{PID}/manifest.json` | v2 |
| Kyoto U RMDA | `rmda.kulib.kyoto-u.ac.jp/iiif/metadata_manifest/{ID}/manifest.json` | v3 |
| Bodleian | `iiif.bodleian.ox.ac.uk/iiif/manifest/{UUID}.json` | v2 |
| Manchester | `digitalcollections.manchester.ac.uk/iiif/{SHELFMARK}` | v2 |
| Gallica | `gallica.bnf.fr/iiif/ark:/12148/{ARK}/manifest.json` | v2 |

**For QDL (Qatar Digital Library):** Blocks all automated access. User must download PDF manually, then import via R2 upload + direct MongoDB insertion (see session notes for the Kitab al-Shatranj workflow).

---

## PDF Imports (Manual Pipeline)

For large PDFs from sources without IIIF (QDL downloads, manually-fetched Google Books PDFs, scanned books):

1. Upload PDF to R2:
```javascript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  maxAttempts: 5,
});
```

2. Extract pages with `pdftoppm -jpeg -r 150 -jpegopt quality=85`
3. Upload page images to R2 at `books/{bookId}/pages/0001.jpg`
4. Create book + page records in MongoDB directly (pages need an `id` field — use `new ObjectId().toString()`)

**Production-tested settings** (`_tmp-import-souter-pdf.mjs`, `_tmp-import-googles-batch.mjs`):
- **Concurrency = 3** for R2 uploads — higher values (8+) cause SSL `bad record mac` errors mid-batch.
- **Per-upload retry**: wrap `r2.send()` in a 4-6 attempt loop with exponential backoff (500ms × 2^attempt).
- **pdftoppm timeout**: 30 minutes for ~600pp books, 60-90 minutes for 800pp+. Some Google Books PDFs take much longer than file size suggests.
- **Inter-batch delay**: 150-200ms `setTimeout` between chunks to let R2 connections settle.
- **Verify byte-exact download** before pdftoppm — IA's `/download/{id}/{id}.pdf` occasionally serves truncated PDFs; check `content-length` matches downloaded size.

**Unrepairable corruption**: Some IA PDFs (especially Italian National Library `ita-bnc-mag-*`) have no PDF trailer dictionary. Neither `mutool clean` nor `gs -sDEVICE=pdfwrite` can repair them. The corruption is at IA's source. Try an alternative source rather than fighting the file.

**Google Books → check IA mirror first**: Before manually downloading a Google Books PDF, try `https://archive.org/metadata/bub_gb_{google_id}`. If it exists, import via `ia` route instead of the PDF pipeline.

**Cloudflare-protected catalogs (IRD Horizon, Persée, HAL, Wellcome)**: Anubis/JS-rendered search interfaces block automation. Either use `WebFetch` (which can render JS) or hand off to the user with a direct browser URL.

---

## Collection Page Rendering & `mentioned_books`

> **Full rules: `.claude/docs/collection-description-linking.md`** — read it before writing or editing any collection description. The essentials are below.

**Every work you name in a collection description must be clickable** (#1867). These pages are public copy on a site built for navigating between primary sources; naming ten books and linking none is a dead end.

The collection page (`/collections/{slug}`) renders `description` and `expanded_description` through `linkBookTitles()`, which handles exactly four things:
1. **Paragraph breaks** on `\n\n` (split into `<p>` tags).
2. **Inline markdown links** — `[anchor](/book/some-slug)`, honored since #3040. **Internal hrefs only**: the href must start with `/`. An absolute `https://sourcelibrary.org/book/...` is not matched and renders as literal brackets.
3. **Explicit `mentioned_books` overrides**, matched case-insensitively, longest text first.
4. **Auto-linking of book titles** ≥8 chars that appear as exact substrings in the description text. Matches the book's `title` or `display_title` against the collection's books.

Everything else is plain text. **Markdown emphasis is NOT parsed** — `*italic*` and `**bold**` show literal asterisks.

### When writing a new collection description

- **Link every named work.** Prefer inline `[Micrographia](/book/<slug>)` — explicit, and no second field to keep in sync. Use the real `slug` read back from the books you tagged; never guess one.
- **Don't rely on auto-linking.** It searches for the *full* book title inside your prose, and real titles here are long Latin ones while good prose names the short form — so the match usually fails. Assume a named work does not auto-link unless you've checked it.
- **`mentioned_books` instead** when the same short name recurs across paragraphs, or when patching links onto prose you don't want to rewrite. Needed for references too short or too paraphrased to auto-match ("Liezi", "Hesiod").
- **No absolute URLs, no Markdown emphasis, and never ship a `[Title](TODO)` placeholder.**

### `mentioned_books` schema

```javascript
{
  slug: 'prehistory-of-ai',
  mentioned_books: [
    { text: "Synesius of Cyrene's On Dreams", book_id: "69a5e3d8006a4098422166a7" },
    { text: "Hypnerotomachia Poliphili", book_id: "a7d82d02-1a76-4f5f-af99-339285a345f9" },
    // Long-form variants first; short-form fallbacks after.
    { text: "Synesius", book_id: "69a5e3d8006a4098422166a7" },
    { text: "Hypnerotomachia", book_id: "a7d82d02-1a76-4f5f-af99-339285a345f9" },
  ]
}
```

Patch via `/api/collections` PATCH:
```bash
curl -sX PATCH "https://sourcelibrary.org/api/collections" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d @/tmp/mentions.json
```

### Ordering matters

The matcher sorts `mentioned_books` longest-first to avoid sub-match collisions. So always list:
1. **Most-specific phrases first** ("Author's Specific Work Title")
2. **Then medium-specific** ("Author's Work")
3. **Then short-form fallbacks** ("Title", "Author")

A long-form claim ranges before a short-form, so subsequent occurrences of the short form only match unclaimed text spans.

### Updating descriptions

The PATCH endpoint accepts arbitrary update fields via `{ slug, addBookIds, ...updates }`. So this works:

```bash
curl -sX PATCH "https://sourcelibrary.org/api/collections" \
  -d '{"slug":"my-collection","description":"...","mentioned_books":[...],"color":"gold"}'
```

When patching, the API echoes the full collection object including `description` (which may contain control characters that break `python3 -c 'json.load(...)'`). Use HTTP status (`curl -w '%{http_code}'`) instead of parsing the response body in shell scripts.

### Audit existing collections

```python
# How many collections have populated mentioned_books?
from pymongo import MongoClient; import os
db = MongoClient(os.environ['MONGODB_URI'])['bookstore']
print(db.collections.count_documents({'mentioned_books': {'$exists': True, '$ne': []}}))
```

---

## Selection Rules

### Edition Priority (CRITICAL)
**ALWAYS prefer the oldest available edition in original language:**
1. Manuscripts — highest priority (especially pre-1500)
2. Incunabula (pre-1501)
3. 16th century — first printed editions, editio princeps
4. 17th century — important scholarly editions
5. 18th century — when earlier unavailable
6. 19th century critical editions — Teubner, Loeb (pre-1929), OCT
7. Modern translations — ONLY when no original text edition exists

**Language priority:** Original language ALWAYS over English. Never import 20th-21st century English translations when Latin/Greek/Arabic/Persian/Hebrew originals exist.

### ACQUIRE
- Original historical editions (pre-1800 primary sources)
- Illuminated manuscripts with miniatures
- Early printed books in original language
- First editions and important early printings
- Critical scholarly editions with original text
- Texts from non-Western traditions (Arabic, Persian, Sanskrit, Chinese, Japanese, Hebrew)

### REJECT
- Modern translations without original text
- English-only editions when originals available
- Secondary literature and commentaries
- Facsimile reprints when original scans exist
- Anthologies that excerpt rather than present complete works
- Books already in collection

### Scoring (1-10 scale)
| Criterion | Weight |
|-----------|--------|
| Thematic fit | 3x |
| Edition quality | 2x |
| Historical authenticity | 2x |
| Rarity | 2x |
| Completeness | 1x |
| Image quality | 1x |
| Research value | 1x |

---

## Session Tracking

Append to `curatorreports.md`:

```markdown
# Session [N]: [DATE] - [THEME]

## Collection: [slug] (new|existing)

## Acquired
| Title | Author | Year | Pages | Book ID | Source |
|-------|--------|------|-------|---------|--------|

## Rejected
| Title | Reason |

## Session Total: N books, N pages
```

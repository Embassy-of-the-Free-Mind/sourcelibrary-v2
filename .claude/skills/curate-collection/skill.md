---
name: curate-collection
description: Populate a collection page with editorial content — expanded description, highlighted books, gallery images, sourced quotes. Also audits existing collections for staleness, broken links, and missing content. Use when a collection exists but needs its content built out, or when auditing collection quality.
---

# Curate Collection

Build museum-quality editorial content for a Source Library collection page. Every collection should feel like walking into a well-designed gallery — rich context, beautiful images, curated highlights, and real quotes from the texts.

**ARGUMENTS:** Collection slug (e.g., `psychology`, `alchemy`), or `audit` to audit all collections. If no slug given, ask.

**MODES:**
- **Curate** (default): Build or update editorial content for a specific collection.
- **Audit** (`/curate-collection audit`): Scan all collections for quality issues, missing content, and staleness. Outputs a ranked priority list.

---

## Audit Mode

When invoked with `audit` (no slug), scan all collections and produce a quality report. Run this script:

```javascript
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const collections = await db.collection('collections').find({}).toArray();
const issues = [];

for (const col of collections) {
  const slug = col.slug;
  const problems = [];

  // Content completeness
  if (!col.expanded_description || col.expanded_description.length < 200) problems.push('missing/thin expanded_description');
  if (!col.highlighted_books?.length) problems.push('no highlighted_books');
  if (!col.mentioned_books?.length) problems.push('no mentioned_books');
  if (!col.featured_images?.length) problems.push('no featured_images');
  if (col.order === 99) problems.push('default order (99)');

  // Book health
  const totalBooks = await db.collection('books').countDocuments({ collections: slug, hidden: { $ne: true } });
  const translatedBooks = await db.collection('books').countDocuments({ collections: slug, hidden: { $ne: true }, pages_translated: { $gt: 0 } });
  if (totalBooks === 0) problems.push('empty collection');
  else if (translatedBooks === 0) problems.push('no translated books yet');
  else if (translatedBooks < 3) problems.push(`only ${translatedBooks} translated books`);

  // Highlighted book validity
  if (col.highlighted_books?.length) {
    const highlightedIds = col.highlighted_books.map(h => h.book_id);
    const existing = await db.collection('books').find(
      { id: { $in: highlightedIds } },
      { projection: { id: 1, hidden: 1, pages_translated: 1 } }
    ).toArray();
    const existingIds = new Set(existing.map(b => b.id));
    const broken = highlightedIds.filter(id => !existingIds.has(id));
    const untranslated = existing.filter(b => !b.pages_translated).length;
    if (broken.length) problems.push(`${broken.length} broken highlighted_book IDs`);
    if (untranslated > existing.length * 0.5) problems.push(`${untranslated}/${existing.length} highlighted books untranslated`);
  }

  // Gallery images
  const galleryCount = await db.collection('gallery_images').countDocuments({
    book_id: { $in: await db.collection('books').distinct('id', { collections: slug }) },
    gallery_quality: { $gte: 0.7 }
  });

  // Artwork quality (Visual Art section)
  const artworkCount = await db.collection('books').countDocuments({ collections: slug, resource_type: { $exists: true } });
  if (artworkCount > 0) {
    // Check for duplicates (same normalized title)
    const artworks = await db.collection('books').find(
      { collections: slug, resource_type: { $exists: true } },
      { projection: { title: 1, author: 1, medium: 1, resource_type: 1 } }
    ).toArray();
    const norm = t => t?.toLowerCase().replace(/[^a-z0-9]/g, '');
    const seen = new Set();
    let dupeCount = 0;
    for (const a of artworks) { const k = norm(a.title); if (seen.has(k)) dupeCount++; seen.add(k); }
    if (dupeCount) problems.push(`${dupeCount} duplicate artworks`);

    // Check for text-heavy prints (medium=paper)
    const paperCount = artworks.filter(a => a.medium === 'paper' && a.resource_type === 'print').length;
    if (paperCount > 3) problems.push(`${paperCount} paper prints (likely text pages)`);

    // Check for over-concentration
    const byAuthor = {};
    for (const a of artworks) { byAuthor[a.author || '?'] = (byAuthor[a.author || '?'] || 0) + 1; }
    for (const [author, count] of Object.entries(byAuthor)) {
      if (count > artworkCount * 0.6) problems.push(`artwork dominated by ${author} (${count}/${artworkCount})`);
    }
  }

  if (problems.length) {
    issues.push({ slug, name: col.name, book_count: totalBooks, translated: translatedBooks, gallery: galleryCount, artworks: artworkCount, problems });
  }
}

// Sort by severity (most problems first)
issues.sort((a, b) => b.problems.length - a.problems.length);
for (const i of issues) {
  console.log(`${i.slug} (${i.translated}/${i.book_count} translated, ${i.gallery} images)`);
  for (const p of i.problems) console.log(`  - ${p}`);
}
```

Report results as a prioritized list. Collections with translated books but missing editorial content should be prioritized — they're ready for curation but unfinished.

---

## Curation TODO

After curating (or auditing) a collection, always write a `curation_todo` field to the collection document. This tracks what's incomplete and what to revisit.

```javascript
curation_todo: [
  { item: 'Add sourced quotes once key books are translated', status: 'blocked', blocked_by: 'pipeline' },
  { item: 'Replace placeholder description with quote-enriched version', status: 'pending' },
  { item: 'Verify highlighted_books after OCR/translation completes', status: 'pending' },
  { item: 'Curate featured_images from gallery once images extracted', status: 'blocked', blocked_by: 'pipeline' },
]
```

**Status values:** `done`, `pending` (can be done now), `blocked` (waiting on pipeline/external).

When re-curating, check existing `curation_todo` and resolve completed items. Remove items with `status: 'done'`.

**Push with the collection update:**
```javascript
const update = {
  slug: 'SLUG',
  curation_todo: [ ... ],
  // ... other fields
};
```

---

## Quality Standards

- **Sourced quotes only.** Every quote must come from the `/api/books/BOOK_ID/quote?page=N` endpoint with a real page number. Never fabricate quotes.
- **Accurate metadata.** Book titles, authors, years must match what's in the database. Fetch live data, don't guess.
- **Consistent tone.** Write like a museum curator — authoritative, accessible, never breathless or promotional. No superlatives ("greatest", "most important"). Let the texts speak for themselves.
- **Link everything.** Every book title mentioned in prose must have a `mentioned_books` entry mapping it to its book ID, so `linkBookTitles()` can auto-link it.
- **Visual quality.** Only select gallery images with `gallery_quality >= 0.7`. Prefer emblems, engravings, and diagrams over decorative elements.
- **No modern bias.** Highlight original-language editions and early printings over modern translations. Flag first translations with appropriate context.

---

## Workflow

### Step 1: Audit Current State

Fetch the collection and understand what exists:

```bash
curl -s "https://sourcelibrary.org/api/collections/SLUG" | python3 -m json.tool > /tmp/collection-audit.json
```

Check which fields are populated vs missing. Note:
- `book_count` and actual books returned (books require `pages_translated > 0`)
- Existing `highlighted_books`, `expanded_description`, `mentioned_books`
- `featured_images` count
- `order` position

### Step 2: Research the Collection's Books

Find the best books in the collection — those with translations, high read counts, gallery images, and historical significance.

```javascript
// Query books in the collection with translations
const db = await getDb();
const books = await db.collection('books').find(
  { collections: 'SLUG', pages_translated: { $gt: 0 }, hidden: { $ne: true } },
  { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1,
                   pages_count: 1, pages_translated: 1, read_count: 1, quality_score: 1,
                   thumbnail: 1, thumbnail_blob: 1, is_first_translation: 1,
                   collection_scores: 1 } }
).sort({ read_count: -1 }).limit(100).toArray();
```

Also query for gallery images:
```javascript
const images = await db.collection('gallery_images').find(
  { book_id: { $in: bookIds }, gallery_quality: { $gte: 0.7 } }
).sort({ gallery_quality: -1 }).limit(50).toArray();
```

### Step 3: Search-Driven Discovery (MCP Tools)

**This is the key step.** Before writing editorial content, use the Source Library MCP search tools to discover what the collection's books actually contain. This surfaces content that no curator could find by scanning titles alone.

**3a. Search translations for thematic passages:**
Run 3-5 `search_translations` queries using the collection's core themes. For example, for "Courts of Wonder":
- `search_translations("automaton mechanical marvel")`
- `search_translations("cabinet curiosity collection wonder")`
- `search_translations("grotto garden artificial")`

Look for: vivid first-person descriptions, surprising connections between books, passages that capture the spirit of the collection. Save the best 8-10 passages with book_id and page_number.

**3b. Search images for visual themes:**
Run 2-3 `search_images` queries for visual subjects:
- `search_images(query="automaton mechanical", type="engraving")`
- `search_images(subject="dragon monster")`

Group results into 3-5 thematic clusters (e.g., "Mechanical Marvels", "Natural Wonders", "Court Spectacles"). Each cluster needs a theme name, short description, and 4-8 images.

**3c. Discover overlooked books:**
Search results will surface books the metadata scan missed. Note any book that:
- Has compelling passages but wasn't in the highlighted_books shortlist
- Connects to the collection's theme in unexpected ways
- Has striking images that would enhance the visual gallery

**3d. Pull verified quotes:**
For the best 5-8 passages found above, verify each with `get_quote(book_id, page_number)` to get exact text and citation URL. Also fetch the original language text (use `get_book_text` with `content: "both"` and the same page range).

Structure each verified quote as:
```json
{
  "text": "English translation of the passage",
  "original_text": "Original language text (Latin, German, etc.)",
  "original_language": "Latin",
  "author": "Author Name",
  "book_id": "the-book-id",
  "book_title": "Short Book Title",
  "page_number": 42,
  "year": 1617,
  "verified": true
}
```

**IMPORTANT:** Never fabricate quotes. Every quote must come from `get_quote` with a real page number. If search_translations returns a snippet, always verify it with get_quote before including it.

### Step 4: Write the Expanded Description

> **Authoritative editorial rules: `.claude/docs/collection-intro-writing-rules.md`.** For the page-opening intro, that doc is the source of truth and supersedes the brief notes below where they differ (it forbids restating counts/years — the header owns those — bans foil/oppressor framing and proper nouns in the hook, and defines the required three-part structure). Read it before writing any collection prose.

> **Every work you name must be clickable — see `.claude/docs/collection-description-linking.md`.** Write inline `[Short Title](/book/<slug>)` links (internal hrefs only; an absolute `https://sourcelibrary.org/...` renders as literal brackets), or cover the mention in `mentioned_books` at Step 6. Don't assume auto-linking catches it: the renderer looks for the book's *full* title inside your prose, and long Latin titles never appear verbatim in good copy.

Write 2-3 paragraphs of editorial context. Structure:

**Paragraph 1:** What this collection is and why it matters. Situate it in intellectual history. Mention 2-3 key texts by title, each linked.

**Paragraph 2:** What makes Source Library's collection distinctive — edition quality, language coverage, rare texts. Include 1-2 short quotes from actual translated passages, with the book title mentioned and linked.

**Paragraph 3 (optional):** Reading path or thematic threads. What someone new to this field should start with.

**Style guide:**
- Write in present tense for descriptions of texts ("Agrippa argues...", "The Turba presents...")
- Past tense for historical events ("Jung acquired this library in the 1930s")
- No first person
- No exclamation marks
- Mention specific editions by year when it matters ("the 1550 Basel edition")

### Step 5: Curate Highlighted Books (3 Tiers)

Select books across three tiers. Each needs an editorial `note` explaining significance.

> **For the featured/highlighted book's blurb, follow the `featured-work-description` skill (`.claude/skills/featured-work-description/skill.md`).** It sells the book, not the platform: no Source Library / translation / OCR / "high resolution" language, lead with the one distinctive thing about the book anchored by a fact, two short paragraphs, stats stay in the stat line.

**Tier 1 — Essential Reading (4-6 books):**
The masterworks. Books that define the field. Notes should be 2-3 sentences explaining why this text is foundational.

**Tier 2 — Important Works (6-9 books):**
Significant texts that deepen understanding. Notes should be 1-2 sentences.

**Tier 3 — Also Notable (6-8 books):**
Interesting, rare, or unusual texts. Notes should be 1 sentence.

**Selection criteria:**
- Prefer books with translations (`pages_translated > 0`) — they'll render with readable content
- Prefer books with thumbnails — they'll have visual cards
- Prefer original-language editions over translations
- Prefer first translations (`is_first_translation: true`)
- Include a range of dates, languages, and sub-topics
- Include at least one illustrated/emblematic work if available

### Step 6: Build mentioned_books Mappings

For every book title referenced in the `expanded_description` that you did **not** already wrap in an inline `[Title](/book/<slug>)` link at Step 4, create a `mentioned_books` entry:

```json
{ "text": "Turba Philosophorum", "book_id": "actual-book-id-here" }
```

The `text` must appear verbatim in the description. `linkBookTitles()` regex-matches it **case-insensitively** (`gi`), longest `text` first, so list long-form phrases before short-form fallbacks — an earlier match claims its span and later ones only fill unclaimed text.

**Then check the coverage is total:** list every work named in the description and confirm each one is either inline-linked or covered here. Any name left over ships as a dead reference (#1867).

### Step 7: Audit & Curate Artworks (Visual Art Section)

Collections that contain artworks (books with `resource_type`) display a "Visual Art" section. This section is prone to quality issues — audit it every time you curate.

```javascript
// Fetch all artworks in this collection
const artworks = await db.collection('books').find(
  { collections: slug, resource_type: { $exists: true } },
  { projection: { id: 1, title: 1, author: 1, resource_type: 1, medium: 1, thumbnail: 1, enrichment: 1 } }
).sort({ author: 1, title: 1 }).toArray();

if (artworks.length > 0) {
  console.log(`\n=== ARTWORK AUDIT (${artworks.length} items) ===`);

  // 1. DUPLICATES — same subject from different sources
  // Normalize titles and group by similarity
  const normalize = t => t?.toLowerCase().replace(/[^a-z0-9]/g, '');
  const groups = new Map();
  for (const a of artworks) {
    const key = normalize(a.title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const dupes = [...groups.values()].filter(g => g.length > 1);
  if (dupes.length) {
    console.log(`\nDUPLICATES (${dupes.length} groups):`);
    for (const group of dupes) {
      console.log(`  "${group[0].title}"`);
      for (const a of group) console.log(`    - ${a.id} (${a.author})`);
    }
  }

  // 2. CONCENTRATION — too many items from one work/artist
  const byAuthor = new Map();
  for (const a of artworks) {
    const key = a.author || 'unknown';
    byAuthor.set(key, (byAuthor.get(key) || 0) + 1);
  }
  for (const [author, count] of byAuthor) {
    if (count > 15) console.log(`\nOVER-REPRESENTED: ${author} has ${count}/${artworks.length} items`);
  }

  // 3. RELEVANCE — artworks that may not belong to the collection theme
  // Flag items with resource_types not in VISUAL_RESOURCE_TYPES
  const VISUAL_TYPES = ['painting', 'drawing', 'print', 'fresco', 'engraving', 'woodcut'];
  const nonVisual = artworks.filter(a => !VISUAL_TYPES.includes(a.resource_type));
  if (nonVisual.length) {
    console.log(`\nNON-STANDARD TYPES (${nonVisual.length}):`);
    for (const a of nonVisual) console.log(`  ${a.resource_type}: ${a.title} (${a.id})`);
  }

  // 4. TEXT-HEAVY — prints with medium "paper" are often book pages, not standalone art
  const paperPrints = artworks.filter(a => a.medium === 'paper' && a.resource_type === 'print');
  if (paperPrints.length) {
    console.log(`\nPOSSIBLE TEXT PAGES (medium=paper, ${paperPrints.length}):`);
    for (const a of paperPrints) console.log(`  ${a.title} (${a.id})`);
    console.log('  → Visually inspect thumbnails. Remove from collection if text-heavy.');
  }
}
```

**Common fixes:**
- **Remove irrelevant artworks:** `db.collection('books').updateMany({ id: { $in: idsToRemove } }, { $pull: { collections: slug } })`
- **Remove duplicates:** Keep the version with better metadata/thumbnail. Remove the other from the collection.
- **Thin over-represented artists:** If one work contributes 50+ emblems, keep 10-15 best and remove the rest from the collection (not from the DB).

**Important:** This only removes the collection tag — it does NOT delete artworks. They remain available in `/artwork`.

### Step 8: Select Featured Images

Pick 6-9 gallery images for the collection hero. Requirements:
- `gallery_quality >= 0.7`
- Diverse books (max 1-2 images per book)
- Prefer emblems, engravings, diagrams, frontispieces
- Avoid decorative borders or text-only pages

If the collection doesn't have gallery images yet (books not processed), note this and skip — gallery images populate automatically when the image extraction pipeline runs on collection books.

### Step 9: Push Everything

Use a single script to update the collection via the API. Always include `curation_todo` tracking what's incomplete:

```javascript
const update = {
  slug: 'SLUG',
  expanded_description: '...the editorial essay...',
  highlighted_books: [ /* tier 1-3 entries */ ],
  mentioned_books: [ /* text → book_id mappings */ ],
  order: N, // position in collection listings
  curation_todo: [
    // Track what's missing or blocked. Remove items as they're completed.
    // { item: 'Add sourced quotes from key texts', status: 'blocked', blocked_by: 'pipeline' },
    // { item: 'Re-select highlighted_books once more are translated', status: 'pending' },
  ],
  // featured_images: only if manually curating, otherwise let backfill script handle
};

const resp = await fetch('https://sourcelibrary.org/api/collections', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CRON_SECRET}` },
  body: JSON.stringify(update),
});
```

### Step 10: Generate Exhibition Layout (curation_drafts)

After building collection metadata, generate a rich exhibition layout and save it to `curation_drafts`. This drives the ExhibitionLayout component on the collection page.

```javascript
const exhibition = {
  collection_slug: 'SLUG',
  status: 'draft',
  created_at: new Date(),
  updated_at: new Date(),
  curation: {
    layout: [
      // Opening hook — one compelling sentence
      { component: 'hook', text: 'A single sentence that captures the essence of the collection.' },

      // Stats bar
      { component: 'stats', items: [
        { label: 'Books', value: '663' },
        { label: 'Languages', value: '8' },
        { label: 'Centuries', value: '15th–18th' },
      ]},

      // Editorial description
      { component: 'description', paragraphs: ['Paragraph 1...', 'Paragraph 2...'] },

      // Voices from the Collection — search-discovered quotes with original language
      { component: 'quotes', title: 'Voices from the Collection', quotes: [
        {
          text: 'English translation',
          original_text: 'Original language text',
          original_language: 'Latin',
          author: 'Author Name',
          book_id: 'book-id',
          book_title: 'Short Title',
          page_number: 42,
          year: 1617,
          verified: true,
        },
        // ... 3-5 total quotes
      ]},

      // Thematic image gallery — clustered by subject
      { component: 'thematic_gallery', clusters: [
        {
          theme: 'Mechanical Marvels',
          description: 'Automata and hydraulic devices from Kircher, Schott, and Hero of Alexandria.',
          images: [
            // gallery_image documents with id, book_id, thumbnail_url, museum_description
          ],
        },
        // ... 3-5 clusters
      ]},

      // Key sections — thematic groupings of books
      { component: 'sections', sections: [
        { title: 'Section Name', subtitle: 'Brief description', books: [{ id: 'book-id', note: 'Why this book matters' }] },
      ]},

      // Reading paths — named journeys through the collection
      { component: 'reading_paths', paths: [
        {
          audience: "The Engineer's Path",
          description: 'From ancient pneumatics to Baroque mechanism',
          steps: [
            { book_id: 'hero-pneumatica-id', instruction: 'Start here — the engineering manual behind courtly automata' },
            // ... 4-6 steps
          ],
        },
      ]},

      // Timeline
      { component: 'timeline', start_year: 1450, end_year: 1700, highlights: [
        { year: 1550, label: 'Event description', book_id: 'optional-book-id' },
      ]},

      // Cross-collection links
      { component: 'cross_collections', links: [
        { slug: 'alchemy', why: 'Many court cabinets included alchemical instruments' },
      ]},
    ],
  },
};

// Upsert into curation_drafts
await db.collection('curation_drafts').updateOne(
  { collection_slug: 'SLUG' },
  { $set: exhibition },
  { upsert: true }
);
```

**Key rules for exhibition layout:**
- Quotes MUST be verified via `get_quote` — never fabricate
- Thematic gallery images must have real `id` and `thumbnail_url` from `gallery_images` collection
- Reading path book_ids must exist and be visible
- All book references are resolved at render time — only include the ID

### Step 11: Verify

After pushing, fetch the collection page and verify:
```bash
curl -s "https://sourcelibrary.org/api/collections/SLUG" | python3 -c "
import sys, json
d = json.load(sys.stdin)
c = d.get('collection', d)
print('Name:', c.get('name'))
print('Subtitle:', c.get('subtitle'))
print('Expanded desc:', len(c.get('expanded_description', '')), 'chars')
print('Highlighted books:', len(c.get('highlighted_books', [])))
print('Mentioned books:', len(c.get('mentioned_books', [])))
print('Featured images:', len(c.get('featured_images', [])))
print('Order:', c.get('order'))
print('Books returned:', len(d.get('books', [])))
"
```

Also check the exhibition draft:
```bash
curl -s "https://sourcelibrary.org/api/collections/SLUG" | python3 -c "
import sys, json; d = json.load(sys.stdin)
e = d.get('exhibition', {})
layout = e.get('layout', [])
print('Exhibition blocks:', len(layout))
for b in layout: print(f'  {b[\"component\"]}')
"
```

Report the live URL: `https://sourcelibrary.org/collections/SLUG`

---

## Reference: Alchemy Collection (Gold Standard)

The alchemy collection has:
- 629 books, 6 languages
- `expanded_description`: 2 paragraphs of editorial context
- `highlighted_books`: 27 books across 3 tiers with editorial notes
- `mentioned_books`: 12 title-to-book mappings
- `featured_images`: 9 gallery images
- `curated_gallery`: 5 images with museum descriptions
- `sample_books`: 8 representative books
- `order`: 1

Match this level of richness for every collection.

---

## Common Pitfalls

1. **Don't fabricate quotes.** If the quote endpoint returns no data (book not translated), skip it. Better to have no quotes than fake ones.
2. **Don't use book `_id` — use `id`.** The `book.id` field is what all lookups use. See memory: `lesson-id-vs-_id.md`.
3. **Don't include untranslated books in highlighted_books** if there are enough translated ones. Untranslated books show as empty shells.
4. **Don't write the description about Source Library** ("our collection includes..."). Write about the tradition/field itself. The collection IS the description.
5. **Don't set featured_images manually unless necessary.** The image extraction pipeline does this automatically with quality scoring. Only override if the automatic selection is poor.
6. **Don't forget to verify book IDs are real.** Always fetch book data before referencing IDs.
7. **Don't ignore the Visual Art section.** Artwork imports from Rijksmuseum/Wikimedia often bring in text-heavy pages, duplicates, and off-topic prints. Always run the artwork audit (Step 7) when curating collections that have artworks.
8. **Don't remove artworks from the database — only from collections.** Use `$pull: { collections: slug }` to untag, never `deleteOne`.
9. **Don't leave a named work unlinked.** Every book the description names must be inline-linked or in `mentioned_books`. And don't write absolute `https://sourcelibrary.org/book/...` hrefs or Markdown emphasis into a description — neither is parsed, both render as literal punctuation. See `.claude/docs/collection-description-linking.md`.

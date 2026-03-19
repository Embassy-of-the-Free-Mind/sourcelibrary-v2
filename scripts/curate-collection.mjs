#!/usr/bin/env node
/**
 * Collection Curation Script v2 — Component Palette Model
 *
 * Generates exhibition-quality content for Source Library collections.
 * The AI curator selects from a palette of available components and
 * orders them based on what makes the collection compelling.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/curate-collection.mjs alchemy
 *   set -a; source .env.production.local; set +a; node scripts/curate-collection.mjs --batch
 *   set -a; source .env.production.local; set +a; node scripts/curate-collection.mjs alchemy --save
 *
 * Options:
 *   --save     Save results to curation_drafts collection in MongoDB
 *   --batch    Run on all 15 core collections
 *   --json     Output raw JSON instead of formatted text
 */

import { MongoClient } from 'mongodb';

const SLUG = process.argv[2];
const SAVE = process.argv.includes('--save');
const BATCH = process.argv.includes('--batch');
const JSON_OUTPUT = process.argv.includes('--json');

const CORE_COLLECTIONS = [
  'alchemy', 'hermetica', 'classical-philosophy', 'mysticism',
  'sacred-texts', 'demonology', 'magic', 'kabbalah',
  'natural-philosophy', 'medicine', 'renaissance-philosophy',
  'astrology', 'art-illustrated', 'theology', 'secret-societies',
];

if (!SLUG && !BATCH) {
  console.error('Usage: node scripts/curate-collection.mjs <slug> [--save] [--json]');
  console.error('       node scripts/curate-collection.mjs --batch [--save]');
  process.exit(1);
}

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

if (!GEMINI_API_KEY || !MONGODB_URI) {
  console.error('Missing GEMINI_API_KEY or MONGODB_URI');
  process.exit(1);
}

// ─── Step 1: Inventory ──────────────────────────────────────────

async function buildInventory(db, slug) {
  const col = await db.collection('collections').findOne({ slug });
  if (!col) throw new Error(`Collection '${slug}' not found`);

  const books = await db.collection('books').find(
    { collections: slug, hidden: { $ne: true }, pages_translated: { $gt: 0 } },
    {
      projection: {
        id: 1, title: 1, display_title: 1, author: 1, year: 1,
        language: 1, pages_count: 1, pages_translated: 1, read_count: 1,
        'taxonomy.cluster': 1, 'taxonomy.subcluster': 1,
        'image_source.provider': 1, is_first_translation: 1,
        'reading_summary.quotes': 1,
      },
    },
  ).sort({ read_count: -1 }).toArray();

  // Gallery images
  const bookIds = books.map(b => b.id);
  const images = await db.collection('gallery_images').find(
    {
      book_id: { $in: bookIds },
      gallery_quality: { $gte: 0.85 },
      museum_description: { $exists: true, $ne: '' },
      type: { $nin: ['decorative', 'symbol', 'portrait'] },
    },
    {
      projection: {
        id: 1, book_id: 1, book_title: 1, book_author: 1,
        type: 1, museum_description: 1, gallery_quality: 1,
      },
    },
  ).sort({ gallery_quality: -1 }).limit(50).toArray();

  // Sub-collections
  const subCollections = await db.collection('collections').find(
    { parent: slug, hidden: { $ne: true } },
    { projection: { slug: 1, name: 1, book_count: 1, subtitle: 1 } },
  ).sort({ book_count: -1 }).toArray();

  // Stats
  const centuries = {};
  const languages = {};
  const clusters = {};
  const authorCounts = {};
  let efmCount = 0;
  let firstTranslations = 0;

  // Collect quotes from books
  const quotes = [];

  for (const b of books) {
    if (b.year) {
      const c = Math.floor(b.year / 100) * 100;
      centuries[c] = (centuries[c] || 0) + 1;
    }
    const lang = b.language || 'Unknown';
    languages[lang] = (languages[lang] || 0) + 1;
    const cl = b.taxonomy?.subcluster || b.taxonomy?.cluster || 'unclustered';
    clusters[cl] = (clusters[cl] || 0) + 1;
    if (b.image_source?.provider === 'efm') efmCount++;
    if (b.is_first_translation) firstTranslations++;

    // Author tracking
    const auth = b.author || 'Unknown';
    if (!authorCounts[auth]) authorCounts[auth] = { count: 0, reads: 0, books: [], years: [] };
    authorCounts[auth].count++;
    authorCounts[auth].reads += b.read_count || 0;
    authorCounts[auth].books.push(b.display_title || b.title);
    if (b.year) authorCounts[auth].years.push(b.year);

    // Collect quotes
    const bookQuotes = b.reading_summary?.quotes;
    if (bookQuotes && Array.isArray(bookQuotes) && bookQuotes.length > 0) {
      for (const q of bookQuotes.slice(0, 2)) {
        const text = typeof q === 'string' ? q : q.text || q.quote;
        if (text && text.length > 30 && text.length < 300) {
          quotes.push({
            text,
            book_title: b.display_title || b.title,
            author: b.author,
            year: b.year,
            book_id: b.id,
          });
        }
      }
    }
  }

  // Top authors (3+ books, not anonymous/unknown/various)
  const topAuthors = Object.entries(authorCounts)
    .filter(([name, data]) => data.count >= 3 && !/(anonymous|unknown|various)/i.test(name))
    .sort((a, b) => b[1].reads - a[1].reads)
    .slice(0, 10)
    .map(([name, data]) => ({
      name,
      book_count: data.count,
      total_reads: data.reads,
      sample_books: data.books.slice(0, 3),
      active_period: data.years.length > 0
        ? `${Math.min(...data.years)}–${Math.max(...data.years)}`
        : null,
    }));

  // Timeline data (25-year buckets)
  const timeline = {};
  for (const b of books) {
    if (b.year && b.year > 500) {
      const bucket = Math.floor(b.year / 25) * 25;
      timeline[bucket] = (timeline[bucket] || 0) + 1;
    }
  }

  return {
    collection: col,
    books,
    images,
    subCollections,
    quotes: quotes.slice(0, 20), // Best 20 quotes
    topAuthors,
    timeline: Object.entries(timeline).sort((a, b) => a[0] - b[0]),
    stats: {
      total: books.length,
      efm: efmCount,
      firstTranslations,
      centuries: Object.entries(centuries).sort((a, b) => a[0] - b[0]),
      languages: Object.entries(languages).sort((a, b) => b[1] - a[1]),
      clusters: Object.entries(clusters).sort((a, b) => b[1] - a[1]),
    },
  };
}

// ─── Step 2: Curate via Gemini ──────────────────────────────────

function buildCurationPrompt(inventory) {
  const { collection, books, images, stats, subCollections, quotes, topAuthors, timeline } = inventory;

  const bookList = books.slice(0, 100).map((b, i) => {
    const t = b.display_title || b.title;
    const pct = b.pages_count > 0 ? Math.round(b.pages_translated / b.pages_count * 100) : 0;
    const flags = [
      b.image_source?.provider === 'efm' ? 'BPH' : '',
      b.is_first_translation ? 'FIRST' : '',
    ].filter(Boolean).join(' ');
    const cluster = b.taxonomy?.subcluster || b.taxonomy?.cluster || '';
    return `${i + 1}. [id:${b.id}] "${t}" by ${b.author || 'Unknown'} (${b.year || '?'}) — ${b.language}, ${pct}%tr, ${b.read_count || 0}reads. ${cluster}. ${flags}`;
  }).join('\n');

  const imageList = images.slice(0, 20).map((img, i) => {
    return `${i + 1}. [${img.type}] from "${img.book_title}": ${img.museum_description?.slice(0, 150)}`;
  }).join('\n');

  const quoteList = quotes.slice(0, 10).map((q, i) => {
    return `${i + 1}. "${q.text}" — ${q.author}, ${q.book_title} (${q.year || '?'})`;
  }).join('\n');

  const authorList = topAuthors.map(a => {
    return `- ${a.name} (${a.book_count} books, ${a.total_reads} reads): ${a.sample_books.slice(0, 2).join('; ')}`;
  }).join('\n');

  const timelineStr = timeline.map(([y, n]) => `${y}s:${n}`).join(' ');

  const subColStr = subCollections.length > 0
    ? `Sub-collections: ${subCollections.map(s => `${s.name} (${s.book_count})`).join(', ')}`
    : 'No sub-collections';

  const statsBlock = `
Collection: ${collection.name} (${stats.total} translated books, ${stats.efm} from the Embassy of the Free Mind)
Current subtitle: "${collection.subtitle || ''}"
First English translations: ${stats.firstTranslations}
Chronological spread: ${stats.centuries.map(([c, n]) => `${c}s:${n}`).join(' ')}
Languages: ${stats.languages.slice(0, 6).map(([l, n]) => `${l}:${n}`).join(' ')}
Clusters: ${stats.clusters.slice(0, 8).map(([c, n]) => `${c}(${n})`).join(', ')}
Timeline (25yr): ${timelineStr}
Gallery images: ${images.length} (${[...new Set(images.map(i => i.type))].join(', ')})
${subColStr}
`.trim();

  return `You are the curator of Source Library, a digital library of translated pre-modern texts at the Embassy of the Free Mind in Amsterdam. You are building the collection page for "${collection.name}."

## Collection Profile
${statsBlock}

## Top Authors
${authorList}

## Available Quotes from These Books
${quoteList || '(No quotes available)'}

## The Books (top 100 by readership)
${bookList}

## Best Gallery Images
${imageList}

## COMPONENT PALETTE

You must design this collection page by selecting components from this palette. Choose 7-12 components and order them for maximum impact. Each component needs specific data.

Available components:

1. **hook** — A single shareable sentence displayed prominently at the top.
   Output: { "component": "hook", "text": "..." }

2. **description** — 2-4 paragraphs of museum-quality wall text. Mention specific authors and book titles by name — they will auto-link to book pages. Write for someone who has never heard of this field but is curious.
   Output: { "component": "description", "paragraphs": ["...", "..."] }

3. **stats** — Key numbers about this collection, displayed as a row of metrics.
   Output: { "component": "stats", "items": [{ "value": "314", "label": "First English Translations" }, ...] }

4. **sections** — 3-6 thematic or chronological groupings. Each section has a title, description, and curated books with one-sentence notes. This is the main body of the exhibition.
   Output: { "component": "sections", "sections": [{ "title": "...", "description": "...", "period": "1400s-1600s", "books": [{ "id": "...", "note": "..." }] }] }

5. **key_figures** — 2-5 author spotlights. Name, dates, a one-line bio, and their most important book in this collection.
   Output: { "component": "key_figures", "figures": [{ "name": "...", "dates": "1493–1541", "bio": "One sentence", "key_book_id": "..." }] }

6. **quotes** — 1-3 striking passages from books in this collection. Choose from the available quotes list, or write "[source needed]" if you want to reference a passage you know exists but isn't in the list.
   Output: { "component": "quotes", "quotes": [{ "text": "...", "author": "...", "book_title": "...", "book_id": "..." }] }

7. **timeline** — A chronological visualization. Specify the focus range and 3-6 highlighted moments.
   Output: { "component": "timeline", "start_year": 1400, "end_year": 1800, "highlights": [{ "year": 1618, "label": "Maier publishes Atalanta Fugiens", "book_id": "..." }] }

8. **featured_image** — A single iconic image displayed large with a curator's caption.
   Output: { "component": "featured_image", "image_index": 0, "caption": "..." }

9. **reading_paths** — 2-3 guided sequences for different audiences. Each path names specific books and explains the order.
   Output: { "component": "reading_paths", "paths": [{ "audience": "...", "description": "One sentence about who this is for", "steps": [{ "book_id": "...", "instruction": "Start here because..." }] }] }

10. **gallery_grid** — Grid of the best illustrations from this collection.
    Output: { "component": "gallery_grid", "image_indices": [0, 1, 2, 3, 4, 5, 6, 7] }

11. **subcollections** — Show child collections as navigable cards (only if sub-collections exist).
    Output: { "component": "subcollections" }

12. **cross_collections** — 2-4 related collections worth exploring, with a sentence explaining the connection.
    Output: { "component": "cross_collections", "links": [{ "slug": "hermetica", "why": "..." }] }

## RULES

1. Return a JSON object with "subtitle", "layout" (array of components in display order).
2. ALWAYS include: hook, description, sections. The rest are your curatorial choice.
3. For book references, use the id shown in brackets [id:...] in the book list.
4. Sections should tell a STORY, not just group by topic. What's the arc?
5. Book notes must reference SPECIFIC content — not "a comprehensive treatise" but "the only book where chemical processes are encoded as musical fugues."
6. Description paragraphs should mention book titles and author names — these auto-link to book pages.
7. The hook should contain a surprising fact that makes someone click/share.
8. For key_figures, focus on figures with multiple books in this collection.
9. Consider the collection's character when choosing components:
   - Visual collections (Art, Alchemy) → lead with featured_image, gallery_grid
   - Scholarly collections (Classical Philosophy) → lead with description, key_figures
   - Surprising collections (Demonology) → lead with hook, stats, quotes
   - Large collections with sub-collections → include subcollections component
10. Write descriptions that mention specific people and texts — "Paracelsus burned Avicenna's Canon and declared..." not "This collection explores..."
11. No AI filler: "delve into", "rich tapestry", "fascinating journey", "comprehensive", "profound insights", "treasure trove"

Output valid JSON only. No markdown fences.

{
  "subtitle": "Max 10 words — a thesis, not a label",
  "layout": [ ...components in display order... ]
}`;
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7,
        maxOutputTokens: 65536,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');

  const cleaned = text.replace(/^```json?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  return JSON.parse(cleaned);
}

// ─── Step 3: Resolve & Print ────────────────────────────────────

function resolveBookIds(curation, books) {
  const bookMap = new Map();
  books.slice(0, 100).forEach((b, i) => {
    bookMap.set(String(i + 1), b.id);
    bookMap.set(b.id, b.id);
  });

  const resolve = (id) => bookMap.get(String(id)) || id;

  for (const block of curation.layout || []) {
    if (block.component === 'sections') {
      for (const s of block.sections || []) {
        for (const book of s.books || []) {
          book.id = resolve(book.id);
        }
      }
    }
    if (block.component === 'reading_paths') {
      for (const p of block.paths || []) {
        for (const step of p.steps || []) {
          step.book_id = resolve(step.book_id);
        }
      }
    }
    if (block.component === 'key_figures') {
      for (const f of block.figures || []) {
        if (f.key_book_id) f.key_book_id = resolve(f.key_book_id);
      }
    }
    if (block.component === 'timeline') {
      for (const h of block.highlights || []) {
        if (h.book_id) h.book_id = resolve(h.book_id);
      }
    }
    if (block.component === 'quotes') {
      for (const q of block.quotes || []) {
        if (q.book_id) q.book_id = resolve(q.book_id);
      }
    }
  }

  return curation;
}

function printCuration(curation, inventory) {
  const findBook = (id) => {
    const b = inventory.books.find(b => b.id === id);
    return b ? (b.display_title || b.title) : id;
  };

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`SUBTITLE: ${curation.subtitle}`);
  console.log(`COMPONENTS: ${(curation.layout || []).map(b => b.component).join(' → ')}`);

  for (const block of curation.layout || []) {
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`[${block.component.toUpperCase()}]`);

    switch (block.component) {
      case 'hook':
        console.log(`  "${block.text}"`);
        break;

      case 'description':
        for (const p of block.paragraphs || []) {
          console.log(`  ${p.substring(0, 200)}${p.length > 200 ? '...' : ''}`);
        }
        break;

      case 'stats':
        for (const s of block.items || []) {
          console.log(`  ${s.value} ${s.label}`);
        }
        break;

      case 'sections':
        for (const s of block.sections || []) {
          console.log(`\n  § "${s.title}" ${s.period ? `(${s.period})` : ''}`);
          console.log(`    ${s.description?.substring(0, 150)}`);
          for (const book of (s.books || []).slice(0, 5)) {
            console.log(`    • ${findBook(book.id)}: ${book.note?.substring(0, 100)}`);
          }
          if ((s.books || []).length > 5) console.log(`    ... +${s.books.length - 5} more`);
        }
        break;

      case 'key_figures':
        for (const f of block.figures || []) {
          console.log(`  ${f.name} (${f.dates || '?'})`);
          console.log(`    ${f.bio}`);
          if (f.key_book_id) console.log(`    Key work: ${findBook(f.key_book_id)}`);
        }
        break;

      case 'quotes':
        for (const q of block.quotes || []) {
          console.log(`  "${q.text?.substring(0, 120)}..."`);
          console.log(`    — ${q.author}, ${q.book_title}`);
        }
        break;

      case 'timeline':
        console.log(`  Range: ${block.start_year}–${block.end_year}`);
        for (const h of block.highlights || []) {
          console.log(`  ${h.year}: ${h.label}`);
        }
        break;

      case 'featured_image':
        console.log(`  Image #${block.image_index}: ${block.caption}`);
        break;

      case 'reading_paths':
        for (const p of block.paths || []) {
          console.log(`\n  For: "${p.audience}"`);
          if (p.description) console.log(`  ${p.description}`);
          for (const step of p.steps || []) {
            console.log(`    → ${findBook(step.book_id)}: ${step.instruction?.substring(0, 80)}`);
          }
        }
        break;

      case 'gallery_grid':
        console.log(`  ${(block.image_indices || []).length} images selected`);
        break;

      case 'subcollections':
        console.log(`  Showing ${inventory.subCollections.length} sub-collections`);
        break;

      case 'cross_collections':
        for (const l of block.links || []) {
          console.log(`  → ${l.slug}: ${l.why}`);
        }
        break;

      default:
        console.log(`  (unknown component: ${block.component})`);
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function curateOne(db, slug) {
  console.log(`\n📚 Curating: ${slug}\n`);

  const inventory = await buildInventory(db, slug);
  console.log(`  ${inventory.stats.total} books, ${inventory.images.length} images, ${inventory.stats.efm} BPH, ${inventory.stats.firstTranslations} first translations, ${inventory.quotes.length} quotes, ${inventory.topAuthors.length} key authors, ${inventory.subCollections.length} subs`);

  console.log('  Generating via Gemini...');
  const prompt = buildCurationPrompt(inventory);
  const rawCuration = await callGemini(prompt);
  const curation = resolveBookIds(rawCuration, inventory.books);

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(curation, null, 2));
  } else {
    printCuration(curation, inventory);
  }

  if (SAVE) {
    console.log('\n  Saving to curation_drafts...');
    await db.collection('curation_drafts').updateOne(
      { collection_slug: slug },
      {
        $set: {
          collection_slug: slug,
          collection_name: inventory.collection.name,
          curation,
          inventory_stats: inventory.stats,
          created_at: new Date(),
          status: 'draft',
        },
      },
      { upsert: true },
    );
    console.log('  Saved.');
  }

  return curation;
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const slugs = BATCH ? CORE_COLLECTIONS : [SLUG];

  for (const slug of slugs) {
    try {
      await curateOne(db, slug);
    } catch (err) {
      console.error(`\n  ❌ Error curating ${slug}: ${err.message}`);
    }
    if (BATCH) await new Promise(r => setTimeout(r, 2000)); // Rate limit
  }

  console.log('\nDone.\n');
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

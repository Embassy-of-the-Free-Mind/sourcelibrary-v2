#!/usr/bin/env node
/**
 * Collection Curation Script
 *
 * Generates exhibition-quality content for a Source Library collection.
 * Uses Gemini to produce narrative sections, book notes, reading paths,
 * and shareable hooks.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/curate-collection.mjs alchemy
 *   set -a; source .env.production.local; set +a; node scripts/curate-collection.mjs alchemy --save
 *
 * Options:
 *   --save     Save results to curation_drafts collection in MongoDB
 *   --dry-run  Print results without saving (default)
 */

import { MongoClient } from 'mongodb';

const SLUG = process.argv[2];
const SAVE = process.argv.includes('--save');

if (!SLUG) {
  console.error('Usage: node scripts/curate-collection.mjs <collection-slug> [--save]');
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

  // Stats
  const centuries = {};
  const languages = {};
  const clusters = {};
  let efmCount = 0;
  let firstTranslations = 0;

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
  }

  return {
    collection: col,
    books,
    images,
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
  const { collection, books, images, stats } = inventory;

  const bookList = books.slice(0, 100).map((b, i) => {
    const t = b.display_title || b.title;
    const pct = b.pages_count > 0 ? Math.round(b.pages_translated / b.pages_count * 100) : 0;
    const flags = [
      b.image_source?.provider === 'efm' ? 'BPH' : '',
      b.is_first_translation ? 'FIRST-ENGLISH-TRANSLATION' : '',
    ].filter(Boolean).join(' ');
    const cluster = b.taxonomy?.subcluster || b.taxonomy?.cluster || '';
    return `${i + 1}. "${t}" by ${b.author || 'Unknown'} (${b.year || '?'}) — ${b.language}, ${pct}% translated, ${b.read_count || 0} readers. Cluster: ${cluster}. ${flags}`;
  }).join('\n');

  const imageList = images.slice(0, 20).map((img, i) => {
    return `${i + 1}. [${img.type}] from "${img.book_title}" by ${img.book_author || '?'}: ${img.museum_description?.slice(0, 200)}`;
  }).join('\n');

  const statsBlock = `
Collection: ${collection.name} (${stats.total} translated books, ${stats.efm} from the Embassy of the Free Mind's physical collection)
First English translations: ${stats.firstTranslations}
Chronological spread: ${stats.centuries.map(([c, n]) => `${c}s: ${n}`).join(', ')}
Languages: ${stats.languages.map(([l, n]) => `${l}: ${n}`).join(', ')}
Semantic clusters within this collection: ${stats.clusters.slice(0, 12).map(([c, n]) => `${c} (${n})`).join(', ')}
Gallery images available: ${images.length} (types: ${[...new Set(images.map(i => i.type))].join(', ')})
`.trim();

  return `You are the curator of Source Library, a digital library of translated pre-modern texts housed at the Embassy of the Free Mind in Amsterdam. You are preparing a collection page for "${collection.name}."

This is real curatorial work. You're writing for people who might share this page — scholars, enthusiasts, students. Everything you write must be specific, grounded in the actual books below, and free of generic AI filler language.

## Collection Profile
${statsBlock}

## The Books (top 100 by readership)
${bookList}

## Best Gallery Images
${imageList}

## Your Task

Produce a complete exhibition for this collection. Return valid JSON with this exact structure:

{
  "subtitle": "Max 10 words — a thesis, not a label",
  "description": "2-3 sentences. Write like museum wall text. Be specific — mention a book, a person, a surprising fact. No 'delve into', 'rich tapestry', 'fascinating journey', 'comprehensive collection', 'profound insights'.",
  "hook": "One tweet-length sentence with a surprising fact. The kind of thing that makes someone click.",
  "sections": [
    {
      "title": "A title that tells a story, not a filing label",
      "description": "2-3 sentences explaining what unites these books and why it matters",
      "period": "e.g. 1400s-1600s (optional)",
      "book_ids": ["id1", "id2", "id3"],
      "book_notes": {
        "id1": "One sentence: why THIS book matters in THIS section. Reference specific content."
      }
    }
  ],
  "reading_paths": [
    {
      "audience": "Who this path is for (e.g. 'Never read a primary source')",
      "steps": [
        { "book_id": "id", "instruction": "Start here because..." }
      ]
    }
  ],
  "hero_image_index": 0,
  "gallery_highlights": [0, 1, 2, 3, 4]
}

## Rules
1. Create 4-6 sections. Each section should have 4-8 books.
2. Sections should tell a chronological or thematic story — not just group by topic.
3. Book notes must be SPECIFIC. Bad: "A comprehensive treatise on alchemical philosophy." Good: "The only book in history where chemical processes are encoded as musical fugues."
4. Every book_id must come from the list above. Use the book's "id" field (the number before the title).
5. Create 2-3 reading paths for different audiences.
6. hero_image_index and gallery_highlights reference the image list indices (0-based).
7. Mark books from the BPH physical collection when relevant — these are from the Embassy's own shelves.
8. Prioritize first English translations — these are texts readers literally cannot find anywhere else in English.

Respond with valid JSON only. No markdown fences. No explanation.`;
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

// ─── Step 3: Resolve & Save ─────────────────────────────────────

function resolveBookIds(curation, books) {
  // The prompt uses list indices (1-based) as IDs. Resolve to real book IDs.
  const bookMap = new Map();
  books.slice(0, 100).forEach((b, i) => {
    bookMap.set(String(i + 1), b.id);
    bookMap.set(b.id, b.id); // also accept real IDs
  });

  for (const section of curation.sections || []) {
    section.book_ids = (section.book_ids || []).map(id => bookMap.get(String(id)) || id);
    if (section.book_notes) {
      const resolved = {};
      for (const [id, note] of Object.entries(section.book_notes)) {
        const realId = bookMap.get(String(id)) || id;
        resolved[realId] = note;
      }
      section.book_notes = resolved;
    }
  }

  for (const path of curation.reading_paths || []) {
    for (const step of path.steps || []) {
      step.book_id = bookMap.get(String(step.book_id)) || step.book_id;
    }
  }

  return curation;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`\n📚 Curating: ${SLUG}\n`);

  // Step 1: Inventory
  console.log('Step 1: Building inventory...');
  const inventory = await buildInventory(db, SLUG);
  console.log(`  ${inventory.stats.total} books, ${inventory.images.length} images, ${inventory.stats.efm} BPH, ${inventory.stats.firstTranslations} first translations`);

  // Step 2: Generate curation
  console.log('Step 2: Generating curation via Gemini...');
  const prompt = buildCurationPrompt(inventory);
  const rawCuration = await callGemini(prompt);

  // Resolve book IDs
  const curation = resolveBookIds(rawCuration, inventory.books);

  // Print results
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUBTITLE: ${curation.subtitle}`);
  console.log(`HOOK: ${curation.hook}`);
  console.log(`\nDESCRIPTION:\n${curation.description}`);
  console.log(`\nSECTIONS (${curation.sections?.length || 0}):`);
  for (const s of curation.sections || []) {
    console.log(`\n  "${s.title}" ${s.period ? `(${s.period})` : ''}`);
    console.log(`  ${s.description}`);
    console.log(`  Books: ${s.book_ids?.length || 0}`);
    for (const [id, note] of Object.entries(s.book_notes || {})) {
      const book = inventory.books.find(b => b.id === id);
      const title = book ? (book.display_title || book.title) : id;
      console.log(`    • ${title}: ${note}`);
    }
  }

  console.log(`\nREADING PATHS (${curation.reading_paths?.length || 0}):`);
  for (const p of curation.reading_paths || []) {
    console.log(`\n  For: "${p.audience}"`);
    for (const step of p.steps || []) {
      const book = inventory.books.find(b => b.id === step.book_id);
      const title = book ? (book.display_title || book.title) : step.book_id;
      console.log(`    → ${title}: ${step.instruction}`);
    }
  }

  // Step 3: Save
  if (SAVE) {
    console.log('\nStep 3: Saving to curation_drafts...');
    await db.collection('curation_drafts').updateOne(
      { collection_slug: SLUG },
      {
        $set: {
          collection_slug: SLUG,
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

  console.log('\nDone.\n');
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

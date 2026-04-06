/**
 * Fix "untitled-*" and "undefined" slugs by:
 * 1. Translating CJK/Cyrillic titles to English via Gemini → display_title
 * 2. Regenerating slugs from display_title + author
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/fix-untitled-slugs.mjs [--dry-run]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const DRY_RUN = process.argv.includes('--dry-run');
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

const client = new MongoClient(process.env.MONGODB_URI);

// Rotate through available API keys
const API_KEYS = [];
for (let i = 0; i <= 10; i++) {
  const key = process.env[i === 0 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${i}`];
  if (key) API_KEYS.push(key);
}
let keyIndex = 0;
function getAI() {
  const ai = new GoogleGenAI({ apiKey: API_KEYS[keyIndex % API_KEYS.length] });
  keyIndex++;
  return ai;
}

// Minimal slugify (mirrors src/lib/slugify.ts)
function slugifyText(text, maxLength = 60) {
  let slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength);
    const last = slug.lastIndexOf('-');
    if (last > maxLength * 0.5) slug = slug.substring(0, last);
  }
  return slug;
}

function extractLastName(author) {
  if (!author || author === 'Unknown' || author === 'Anonymous') return author?.toLowerCase() || 'unknown';
  if (author.includes(',')) return author.split(',')[0].trim();
  const parts = author.trim().split(/\s+/);
  return parts[parts.length - 1];
}

function generateSlug(displayTitle, title, author) {
  const titleSource = displayTitle || title;
  const slugTitle = slugifyText(titleSource, 60);
  const authorLast = extractLastName(author);
  const slugAuthor = slugifyText(authorLast, 20);
  if (!slugAuthor || slugAuthor === 'unknown') return slugTitle || 'untitled';
  if (!slugTitle) return 'untitled';
  return `${slugTitle}-${slugAuthor}`;
}

async function translateTitlesWithRetry(titles, retries = 3) {
  const prompt = `Translate each title to English. Return ONLY a JSON array of objects with "original" and "english" fields. Keep proper nouns. For Chinese volume numbers in parentheses like (八十一), include as "(Vol. 81)". For multi-volume works like 卷三十七~卷三十八, include as "(Vols. 37-38)".

Titles:
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });

      const text = response.text;
      try {
        return JSON.parse(text);
      } catch {
        console.error('Failed to parse Gemini response:', text.substring(0, 500));
        return null;
      }
    } catch (e) {
      if (e.status === 429 && attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`  Rate limited, waiting ${wait/1000}s (key rotation + retry ${attempt + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw e;
      }
    }
  }
}

async function main() {
  console.log(`Using ${API_KEYS.length} API keys for rotation`);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Find all books with bad slugs
  const badBooks = await books.find({
    $or: [
      { slug: /^untitled-/ },
      { slug: 'untitled' },
      { slug: 'undefined' },
    ]
  }).project({ id: 1, _id: 1, title: 1, display_title: 1, author: 1, language: 1, slug: 1 }).toArray();

  console.log(`Found ${badBooks.length} books with bad slugs`);
  if (DRY_RUN) console.log('=== DRY RUN ===\n');

  // Step 1: Identify books needing display_title translation
  const needTranslation = badBooks.filter(b =>
    !b.display_title || b.display_title === 'null'
  );
  console.log(`${needTranslation.length} need display_title translation`);

  // Batch translate in groups of 20
  const translationMap = new Map();
  for (let i = 0; i < needTranslation.length; i += 20) {
    const batch = needTranslation.slice(i, i + 20);
    const titles = batch.map(b => `[${b.language}] ${b.title}`);
    console.log(`Translating batch ${Math.floor(i/20) + 1}/${Math.ceil(needTranslation.length/20)}...`);

    const results = await translateTitlesWithRetry(titles);
    if (results) {
      results.forEach((r, j) => {
        if (r.english && batch[j]) {
          translationMap.set(batch[j]._id.toString(), r.english);
        }
      });
    }
    // Delay between batches
    if (i + 20 < needTranslation.length) await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\nTranslated ${translationMap.size} titles\n`);

  // Step 2: Generate new slugs and check for collisions
  const existingSlugs = new Set();
  const allSlugs = await books.find({}, { projection: { slug: 1 } }).toArray();
  allSlugs.forEach(b => { if (b.slug) existingSlugs.add(b.slug); });

  // Remove the bad slugs from the set (they'll be replaced)
  badBooks.forEach(b => existingSlugs.delete(b.slug));

  let updated = 0;
  let skipped = 0;

  for (const book of badBooks) {
    const newDisplayTitle = translationMap.get(book._id.toString());
    const displayTitle = newDisplayTitle || book.display_title;

    let baseSlug = generateSlug(displayTitle, book.title, book.author);

    // If slug is still "untitled" after translation, use the book id
    if (baseSlug === 'untitled' || baseSlug === 'undefined') {
      console.log(`  SKIP (no translatable title): ${book.title}`);
      skipped++;
      continue;
    }

    // Deduplicate
    let slug = baseSlug;
    let suffix = 2;
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }
    existingSlugs.add(slug);

    const updates = { slug };
    if (newDisplayTitle) updates.display_title = newDisplayTitle;

    if (DRY_RUN) {
      console.log(`  ${book.slug} → ${slug}${newDisplayTitle ? ` (dt: ${newDisplayTitle})` : ''}`);
    } else {
      await books.updateOne({ _id: book._id }, { $set: updates });
      if ((updated + 1) % 50 === 0) console.log(`  ...updated ${updated + 1} books`);
    }
    updated++;
  }

  console.log(`\n${DRY_RUN ? 'Would update' : 'Updated'}: ${updated} books`);
  console.log(`Skipped: ${skipped} books`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });

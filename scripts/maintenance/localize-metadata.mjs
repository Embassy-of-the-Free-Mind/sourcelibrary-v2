#!/usr/bin/env node
/**
 * Write language glosses for book titles (and collection copy) into the ONE
 * language-keyed map — `books.localized[lang].title`,
 * `collections.localized[lang].{name,subtitle,description}` — never into
 * `title_<lang>` columns. Read side: src/lib/localized.ts.
 *
 * A gloss is what `display_title` is for English: a readable rendering of the
 * ORIGINAL title for that language's readers. The original is never touched.
 *
 *   --lang=es                       target language (ISO 639-1; required)
 *   --books-with-editions           every book with pages_translated_<lang> > 0 (default selection)
 *   --book-ids=a,b,c                explicit books
 *   --collection=<slug>             also gloss one collection's name/subtitle/description
 *   --migrate-collection=<slug>     move legacy name_es/subtitle_es/description_es into localized.es and unset them
 *   --force                         rewrite existing glosses
 *   --dry-run
 *
 * Cost: one flash-lite call per book (~$0.0002). Logs a sweep_log row per write.
 *
 *   node --env-file=.env.production.local scripts/maintenance/localize-metadata.mjs --lang=es --books-with-editions
 */
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const m = args.find((a) => a.startsWith(`${f}=`)); return m ? m.slice(f.length + 1) : undefined; };
const LANG = val('--lang');
const DRY = has('--dry-run');
const FORCE = has('--force');
const LANGUAGE_NAMES = { es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian', zh: 'Chinese', ar: 'Arabic' };
if (!LANG || !LANGUAGE_NAMES[LANG]) { console.error('--lang=<es|fr|de|pt|it|zh|ar> is required'); process.exit(2); }
if (LANG === 'en') { console.error('English is never written into localized; it lives in display_title'); process.exit(2); }
const LANGUAGE = LANGUAGE_NAMES[LANG];
const SWEEP = `localize-metadata-${LANG}`;

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is required'); process.exit(2); }
const apiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
if (!apiKey && !DRY && !val('--migrate-collection')) { console.error('GEMINI_API_KEY(_TIER3) is required'); process.exit(2); }
const model = apiKey ? new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-3.1-flash-lite' }) : null;

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

async function ask(prompt) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = (await model.generateContent(prompt)).response.text().trim();
      if (text) return text;
    } catch (e) {
      if (/429|quota|RESOURCE_EXHAUSTED|503/i.test(e.message || '')) await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  return null;
}

function cleanTitle(t) {
  return String(t || '').replace(/^["'«»\s]+|["'«»\s.]+$/g, '').replace(/\s+/g, ' ').trim();
}

async function glossBook(b) {
  const prompt = `You write catalogue title glosses for a digital library of historical primary sources.
Give the ${LANGUAGE} gloss of this book's title — the short, natural title a ${LANGUAGE}-speaking reader would expect on a catalogue card (as a published ${LANGUAGE} translation would be titled). Keep proper names in their ${LANGUAGE} form where one is customary (Iamblichus → Jámblico). Do not add subtitles, dates, publisher, or explanations. Output ONLY the gloss, no quotes.

Original title: ${b.title}
${b.display_title && b.display_title !== b.title ? `English gloss: ${b.display_title}\n` : ''}${b.author ? `Author: ${b.author}\n` : ''}${b.language ? `Original language: ${b.language}\n` : ''}${b.published ? `Published: ${b.published}\n` : ''}`;
  const out = await ask(prompt);
  const gloss = cleanTitle(out?.split('\n')[0]);
  if (!gloss || gloss.length > 200) return null;
  return gloss;
}

// ---------- collections ----------
const migrate = val('--migrate-collection');
if (migrate) {
  const doc = await db.collection('collections').findOne({ slug: migrate });
  if (!doc) { console.error(`collection ${migrate} not found`); process.exit(1); }
  const fields = {};
  if (doc.name_es) fields.name = doc.name_es;
  if (doc.subtitle_es) fields.subtitle = doc.subtitle_es;
  if (doc.description_es) fields.description = doc.description_es;
  // The en-espanol collection was created with Spanish in its plain fields
  // (#4079). Move that copy into localized.es and put English in the plain
  // fields, which render on the English /collections pages.
  const english = {};
  if (migrate === 'en-espanol' && !fields.name) {
    fields.name = doc.name; fields.subtitle = doc.subtitle; fields.description = doc.description;
    english.name = 'Books in Spanish';
    english.subtitle = 'The most-read works in the library, in a Spanish edition';
    english.description = 'Primary sources of alchemy, Hermetism, philosophy and early science that can be read in Spanish, page by page beside the original. Every book in this collection has a Spanish edition: open it and choose «Español» in the reader.';
  }
  console.log(`${DRY ? '[dry] ' : ''}${migrate}: localized.es = ${JSON.stringify(fields).slice(0, 200)}${english.name ? `; plain → ${english.name}` : ''}`);
  if (!DRY && Object.keys(fields).length) {
    const r = await db.collection('collections').updateOne(
      { slug: migrate },
      { $set: { 'localized.es': fields, ...english, updated_at: new Date() }, $unset: { name_es: '', subtitle_es: '', description_es: '' } },
    );
    console.log(`  modified ${r.modifiedCount}`);
  }
}

const colSlug = val('--collection');
if (colSlug) {
  const doc = await db.collection('collections').findOne({ slug: colSlug }, { projection: { slug: 1, name: 1, subtitle: 1, description: 1, localized: 1 } });
  if (!doc) { console.error(`collection ${colSlug} not found`); process.exit(1); }
  if (doc.localized?.[LANG]?.name && !FORCE) console.log(`${colSlug}: already has localized.${LANG} (use --force)`);
  else {
    const out = await ask(`Translate this library collection's copy into ${LANGUAGE}. Keep the register (editorial, concise). Return JSON only: {"name": "...", "subtitle": "...", "description": "..."}.\n\n${JSON.stringify({ name: doc.name, subtitle: doc.subtitle, description: doc.description })}`);
    let parsed = null;
    try { parsed = JSON.parse(out.replace(/^```json\s*|```$/g, '')); } catch { /* fallthrough */ }
    if (!parsed?.name) console.error(`${colSlug}: model did not return usable JSON`);
    else {
      console.log(`${DRY ? '[dry] ' : ''}${colSlug}: ${JSON.stringify(parsed).slice(0, 200)}`);
      if (!DRY) await db.collection('collections').updateOne({ slug: colSlug }, { $set: { [`localized.${LANG}`]: parsed, updated_at: new Date() } });
    }
  }
}

// ---------- books ----------
let bookFilter = null;
if (val('--book-ids')) bookFilter = { id: { $in: val('--book-ids').split(',').map((s) => s.trim()).filter(Boolean) } };
else if (has('--books-with-editions') || (!migrate && !colSlug)) bookFilter = { [`pages_translated_${LANG}`]: { $gt: 0 } };

if (bookFilter) {
  const books = await db.collection('books').find(bookFilter, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, localized: 1 } }).toArray();
  let written = 0, skipped = 0, failed = 0;
  for (const b of books) {
    if (b.localized?.[LANG]?.title && !FORCE) { skipped++; continue; }
    const gloss = DRY ? '(dry)' : await glossBook(b);
    if (!gloss) { failed++; console.warn(`  ! ${b.id} no gloss for "${(b.title || '').slice(0, 60)}"`); continue; }
    console.log(`${DRY ? '[dry] ' : ''}${b.id}  ${(b.title || '').slice(0, 50)}  →  ${gloss}`);
    if (DRY) continue;
    const r = await db.collection('books').updateOne({ id: b.id }, { $set: { [`localized.${LANG}.title`]: gloss, updated_at: new Date() } });
    if (r.modifiedCount === 1) {
      written++;
      await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'set-localized-title', detail: { lang: LANG, gloss } });
    }
  }
  console.log(`\n${books.length} books: ${written} glosses written, ${skipped} already had one, ${failed} failed.`);
}

await client.close();

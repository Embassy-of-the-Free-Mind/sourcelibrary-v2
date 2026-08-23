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
 *   --all-collections               gloss EVERY visible collection's copy (the /es collection pages)
 *   --collections-with-editions     only the collections a reader of <lang> can reach (holds such a book, + parents)
 *   --slugs=a,b,c                   restrict the collection sweep to these slugs (with --force, a re-run)
 *   --limit=<n>                     cap how many collections --all-collections does in one run
 *   --migrate-collection=<slug>     move legacy name_es/subtitle_es/description_es into localized.es and unset them
 *   --force                         rewrite existing glosses
 *   --dry-run
 *
 * Cost: one flash-lite call per book (~$0.0002). Logs a sweep_log row per write.
 *
 *   node --env-file=.env.production.local scripts/maintenance/localize-metadata.mjs --lang=es --books-with-editions
 */
import { readFileSync } from 'node:fs';
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

/**
 * The curated Spanish collection names the homepage already ships
 * (`ES_COLLECTION_NAMES` in src/lib/home-i18n.ts). They are hand-written and
 * better than anything a model returns for a slug like `natural-philosophy`
 * ("Filosofía natural y ciencia", not a literal rendering of the English
 * name) — so a bulk gloss must SEED them rather than overwrite them. Once the
 * curated name is in `localized.<lang>.name`, `spanishCopy()` prefers it and
 * the hand map becomes the fallback for whatever has not been written yet,
 * which is the direction .claude/docs/i18n.md asks for (one map per record).
 *
 * Read out of the TS source instead of duplicated here: two copies of these
 * 22 names would drift the first time one is edited.
 */
function curatedNames(lang) {
  if (lang !== 'es') return {};
  const src = readFileSync(new URL('../../src/lib/home-i18n.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('ES_COLLECTION_NAMES'));
  const literal = body.slice(body.indexOf('{'), body.indexOf('};') + 1);
  const out = {};
  for (const m of literal.matchAll(/^\s*'?([a-z0-9-]+)'?:\s*'([^']+)',/gm)) out[m[1]] = m[2];
  return out;
}
const CURATED = curatedNames(LANG);

/**
 * Translate one collection's editorial copy. Returns null rather than a
 * half-result: a Spanish page falls back to labelled English, which is honest,
 * so writing a truncated or untranslated description would be strictly worse
 * than writing nothing.
 */
async function glossCollection(doc) {
  const out = await ask(`Translate this library collection's copy into ${LANGUAGE}. Keep the register (editorial, concise) and the paragraph breaks. Do not add or drop information, and do not add counts or dates.

The "name" is a shelf label, not a book title: translate it. Leave it unchanged ONLY when a ${LANGUAGE} library would print that exact string — a personal name, or a Latin/Arabic/Sanskrit term already used in ${LANGUAGE} (Corpus Hermeticum, Falsafa, Yoga). An English noun phrase is never one of those, so "Signs in the Sky" and "Sacred Plants" must come back in ${LANGUAGE}. Inside the description, book titles and institution names stay as a ${LANGUAGE} edition would print them.

Return JSON only: {"name": "...", "subtitle": "...", "description": "..."}.\n\n${JSON.stringify({ name: doc.name, subtitle: doc.subtitle, description: doc.description || doc.expanded_description })}`);
  let parsed = null;
  try { parsed = JSON.parse(String(out).replace(/^```json\s*|```$/g, '').trim()); } catch { /* fallthrough */ }
  if (!parsed || typeof parsed.name !== 'string' || !parsed.name.trim() || parsed.name.length > 160) return null;

  const source = doc.description || doc.expanded_description || '';
  const fields = { name: (CURATED[doc.slug] || parsed.name).trim() };
  if (typeof parsed.subtitle === 'string' && parsed.subtitle.trim() && parsed.subtitle.length <= 240) {
    fields.subtitle = parsed.subtitle.trim();
  }
  if (source) {
    const d = typeof parsed.description === 'string' ? parsed.description.trim() : '';
    // A model that returns a summary instead of a translation, or that stops
    // early, shows up as a length far off the source. Spanish runs a little
    // longer than English, so the window is asymmetric.
    if (d.length >= source.length * 0.6 && d.length <= source.length * 2.2) fields.description = d;
    else if (d) console.warn(`  ! ${doc.slug}: description ${d.length}ch vs source ${source.length}ch — not written`);
  }
  return fields;
}

const COLLECTION_PROJECTION = { _id: 0, slug: 1, name: 1, subtitle: 1, description: 1, expanded_description: 1, localized: 1 };

async function writeCollection(doc) {
  if (doc.localized?.[LANG]?.name && !FORCE) return 'skipped';
  const fields = DRY ? { name: '(dry)' } : await glossCollection(doc);
  if (!fields) { console.error(`  ! ${doc.slug}: model did not return usable JSON`); return 'failed'; }
  console.log(`${DRY ? '[dry] ' : ''}${doc.slug}: ${fields.name}${fields.description ? ` · ${fields.description.length}ch` : ' · (no intro)'}`);
  if (DRY) return 'written';
  const r = await db.collection('collections').updateOne(
    { slug: doc.slug },
    { $set: { [`localized.${LANG}`]: fields, updated_at: new Date() } },
  );
  if (r.modifiedCount !== 1) return 'failed';
  await recordSweepAction(db, {
    sweep: SWEEP,
    // `book_id` is the helper's required "thing this action touched" and it
    // validates non-empty; namespace the slug so a collection row can never be
    // mistaken for a book id when the log is queried.
    book_id: `collection:${doc.slug}`,
    action: 'set-localized-collection-copy',
    detail: { lang: LANG, name: fields.name, curated_name: !!CURATED[doc.slug], description: fields.description?.length ?? 0 },
  });
  return 'written';
}

const colSlug = val('--collection');
if (colSlug) {
  const doc = await db.collection('collections').findOne({ slug: colSlug }, { projection: COLLECTION_PROJECTION });
  if (!doc) { console.error(`collection ${colSlug} not found`); process.exit(1); }
  const r = await writeCollection(doc);
  if (r === 'skipped') console.log(`${colSlug}: already has localized.${LANG} (use --force)`);
}

// Every visible collection, because every one of them is reachable at
// /<lang>/collections/<slug>. Before this the sweep ran one slug at a time and
// exactly ONE of 325 had been done, so a Spanish reader met English editorial
// copy on effectively every collection page — the fallback working as designed,
// with nothing behind it.

/**
 * The collections a reader of `LANG` can actually reach by clicking: the ones
 * holding a book readable in that language, PLUS their parents — because
 * `/<lang>/collections` lists a sub-collection only when it holds such books,
 * and the collection page links up to its parent by name. Without the parents
 * the breadcrumb above a Spanish branch stays English.
 *
 * Same selection rule as the read path (`localizedEditionFilter` in
 * src/lib/localized.ts): translated INTO the language, or written in it.
 */
const NATIVE_EDITION_LANGUAGE = {
  es: /^\s*(spanish|espa(?:ñ|n)ol|castellano|castilian)\s*$/i,
};
async function slugsReachableIn(lang) {
  const editionFilter = NATIVE_EDITION_LANGUAGE[lang]
    ? { $or: [{ [`pages_translated_${lang}`]: { $gt: 0 } }, { language: NATIVE_EDITION_LANGUAGE[lang] }] }
    : { [`pages_translated_${lang}`]: { $gt: 0 } };
  const counts = await db.collection('books').aggregate([
    { $match: { ...editionFilter, visible: true } },
    { $unwind: '$collections' },
    { $group: { _id: '$collections', count: { $sum: 1 } } },
  ], { maxTimeMS: 20000 }).toArray();
  const slugs = counts.map((c) => c._id).filter((s) => typeof s === 'string');
  const held = await db.collection('collections')
    .find({ visible: true, slug: { $in: slugs } }, { projection: { _id: 0, slug: 1, parent: 1 } })
    .toArray();
  const out = new Set(held.map((d) => d.slug));
  for (const d of held) for (const p of [].concat(d.parent || [])) if (typeof p === 'string') out.add(p);
  return [...out];
}

if (has('--all-collections') || has('--collections-with-editions')) {
  const limit = Number(val('--limit')) || 0;
  const query = { visible: true, ...(FORCE ? {} : { [`localized.${LANG}.name`]: { $exists: false } }) };
  if (has('--collections-with-editions')) query.slug = { $in: await slugsReachableIn(LANG) };
  if (val('--slugs')) query.slug = { $in: val('--slugs').split(',').map((x) => x.trim()).filter(Boolean) };
  const docs = await db.collection('collections')
    .find(query, { projection: COLLECTION_PROJECTION })
    .sort({ book_count: -1 })
    .limit(limit || 0)
    .toArray();
  console.log(`${docs.length} collections to gloss into ${LANGUAGE}${DRY ? ' (dry run)' : ''}`);

  // Four at a time: flash-lite rate limits are generous and 325 serial calls is
  // twenty minutes of nothing.
  const counts = { written: 0, skipped: 0, failed: 0 };
  const queue = docs.slice();
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let doc = queue.shift(); doc; doc = queue.shift()) counts[await writeCollection(doc)]++;
  }));
  console.log(`\n${docs.length} collections: ${counts.written} written, ${counts.skipped} already done, ${counts.failed} failed.`);
}

// ---------- books ----------
let bookFilter = null;
if (val('--book-ids')) bookFilter = { id: { $in: val('--book-ids').split(',').map((s) => s.trim()).filter(Boolean) } };
else if (has('--books-with-editions') || (!migrate && !colSlug && !has('--all-collections') && !has('--collections-with-editions'))) bookFilter = { [`pages_translated_${LANG}`]: { $gt: 0 } };

// Summary + chapter titles for the Spanish book page (#4082). One call per field.
async function localizeSummary(b) {
  const src = b.index?.bookSummary?.brief || (typeof b.summary === 'string' ? b.summary : b.summary?.data);
  if (!src) return null;
  const out = await ask(`Translate this short library catalogue summary of a historical book into ${LANGUAGE}. Keep it the same length and register (editorial, concise, no marketing). Keep proper names in their customary ${LANGUAGE} form. Output ONLY the translation.\n\n${String(src).slice(0, 2500)}`);
  return out && out.length > 20 ? out.trim() : null;
}
async function localizeChapters(b) {
  const titles = (b.chapters || []).map((c) => c.titleEn || c.title).filter(Boolean);
  if (!titles.length) return null;
  const out = await ask(`Translate these table-of-contents entries of a historical book into ${LANGUAGE}. Return ONLY a JSON array of strings, same length and order (${titles.length} items), no commentary.\n\n${JSON.stringify(titles)}`);
  try {
    const arr = JSON.parse(String(out).replace(/^```json\s*|```$/g, ''));
    return Array.isArray(arr) && arr.length === titles.length && arr.every((s) => typeof s === 'string') ? arr : null;
  } catch { return null; }
}

if (bookFilter) {
  const books = await db.collection('books').find(bookFilter, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, localized: 1, 'chapters.title': 1, 'chapters.titleEn': 1, 'index.bookSummary.brief': 1, 'summary.data': 1 } }).toArray();
  let written = 0, skipped = 0, failed = 0;
  for (const b of books) {
    const set = {};
    const detail = { lang: LANG };
    if (!b.localized?.[LANG]?.title || FORCE) {
      const gloss = DRY ? '(dry)' : await glossBook(b);
      if (!gloss) { failed++; console.warn(`  ! ${b.id} no gloss for "${(b.title || '').slice(0, 60)}"`); }
      else { set[`localized.${LANG}.title`] = gloss; detail.gloss = gloss; }
    }
    if (!b.localized?.[LANG]?.summary || FORCE) {
      const s = DRY ? null : await localizeSummary(b);
      if (s) { set[`localized.${LANG}.summary`] = s; detail.summary = s.length; }
    }
    if ((!b.localized?.[LANG]?.chapters || FORCE) && (b.chapters || []).length) {
      const ch = DRY ? null : await localizeChapters(b);
      if (ch) { set[`localized.${LANG}.chapters`] = ch; detail.chapters = ch.length; }
    }
    if (!Object.keys(set).length) { skipped++; continue; }
    console.log(`${DRY ? '[dry] ' : ''}${b.id}  ${(b.title || '').slice(0, 50)}  →  ${detail.gloss || '(title kept)'}${detail.summary ? ` · summary ${detail.summary}ch` : ''}${detail.chapters ? ` · ${detail.chapters} chapters` : ''}`);
    if (DRY) continue;
    const r = await db.collection('books').updateOne({ id: b.id }, { $set: { ...set, updated_at: new Date() } });
    if (r.modifiedCount === 1) {
      written++;
      await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'set-localized-metadata', detail });
    }
  }
  console.log(`\n${books.length} books: ${written} updated, ${skipped} already complete, ${failed} title glosses failed.`);
}

await client.close();

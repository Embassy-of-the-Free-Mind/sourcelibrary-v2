#!/usr/bin/env node
/**
 * Give a bilingual edition the Spanish edition it already has: its own Spanish
 * column.
 *
 * ## Why
 *
 * `pages.translations.es` is what every Spanish surface reads — the `/es`
 * reader, the `/es` 307 gate, the "En español" card, the `en-espanol`
 * collection, the `page_texts` store behind Spanish search. Until now it was
 * written by exactly one thing: `es-translate-worker.mjs`, which pivots our
 * ENGLISH AI translation into Spanish.
 *
 * On a parallel-text manuscript that is a machine round-trip past a source that
 * is already Spanish. Florentine Codex vol. 2, p. 201 — Sahagún's Spanish column
 * reads *"que no te ensuberbescas, ni te altiuescas… y baxa la cabeça, y recoge
 * tus braços"*; the stored `translations.es` (source `ai-pivot-en`) reads *"que
 * no te vuelvas orgulloso, ni te enaltezcas… y baja la cabeza, y cruza los
 * brazos"*. A Spanish reader is being served Gemini's Spanish on a page whose
 * right-hand column is Sahagún's. All three volumes are in that state: 2,447
 * pages of pivot Spanish standing in front of the sixteenth-century original.
 *
 * The Ximénez Popol Vuh is the other half of the problem: no `translations.es`
 * at all, so 125 pages of Ximénez's own 1701 Spanish — the first translation of
 * the Popol Vuh into any European language — are invisible to every Spanish
 * surface we have.
 *
 * This script replaces the first case and fills the second, from
 * `scripts/lib/source-column.mjs`. It costs nothing to run: the text is already
 * in `pages.ocr.data`, marked by the OCR prompt's own `<column-break/>`.
 *
 * ## What it writes
 *
 *   pages.translations.es = {
 *     data:      the Spanish column(s), verbatim
 *     language:  'Spanish'
 *     model:     EMPTY, deliberately. No model translated this. The reader shows
 *                `model` beside the provenance badge, and naming the OCR model
 *                there would read as "translated by 3-flash"; which model
 *                transcribed the leaf is already on the same page, under the OCR.
 *     source:    'source-column'   ← NOT 'ai-pivot-en'. Everything that tells a
 *                reader or an agent where a text came from branches on this.
 *   }
 *   books.pages_translated_es, books.updated_at
 *
 * ## What it refuses
 *
 * - A book whose `books.language` does not NAME two languages, one of them
 *   Spanish. The gate is the catalogue, never the page: guessing per page is how
 *   the wrong half of a parallel text reaches a reader. Relabel first with
 *   `scripts/maintenance/relabel-bilingual-edition.mjs`, which reasons from the
 *   leaves' own `<language>` tags and prints its evidence.
 * - Any page whose columns do not separate cleanly (see `spanishColumnText`).
 * - Overwriting an existing `ai-pivot-en` value without `--replace-pivot`. That
 *   is the main event on the Codex and it destroys paid output, so it is opt-in
 *   and counted out loud rather than done quietly.
 * - Overwriting anything a HUMAN wrote (`source: 'manual'`), ever.
 *
 * ## Afterwards
 *
 * Three things read from what this writes and none of them are automatic:
 *   1. `scripts/maintenance/sync-es-collection.mjs` — the `en-espanol` collection
 *   2. `scripts/workers/embed-page-texts.mjs --lang=es` — Spanish search. BILLED
 *      (~$0.20/1M input tokens; ≈$0.30 for the 2,900 pages this run adds).
 *   3. the Supabase catalog sync — `books.updated_at` is bumped for it
 *
 *   node --env-file=.env.production.local scripts/maintenance/extract-source-columns.mjs
 *   node --env-file=.env.production.local scripts/maintenance/extract-source-columns.mjs --book=<id> --commit --replace-pivot
 */
import { MongoClient } from 'mongodb';
import { spanishColumnText, isBilingualEditionLanguage } from '../lib/source-column.mjs';

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=');
const LANG = arg('lang') || 'es';
const ONLY = arg('book');
const COMMIT = process.argv.includes('--commit');
const REPLACE_PIVOT = process.argv.includes('--replace-pivot');
const LIMIT = Number(arg('limit') || 0);

/** Provenance values this script is allowed to overwrite, and on what condition. */
const PIVOT_SOURCES = new Set(['ai-pivot-en']);
const OURS = 'source-column';

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
await client.connect();
const db = client.db('bookstore');

const query = ONLY
  ? { id: ONLY }
  // Coarse Mongo prefilter, exact test in JS — Mongo cannot run
  // `parseLanguageField`, and the candidate set is tens of books.
  : { visible: true, pages_ocr: { $gt: 0 }, language: { $regex: 'spanish|espa', $options: 'i' } };

const books = (await db.collection('books').find(query)
  .project({ id: 1, title: 1, language: 1, pages_count: 1, pages_translated_es: 1 }).toArray())
  .filter((b) => isBilingualEditionLanguage(b.language, LANG));

if (!books.length) {
  console.error(ONLY
    ? `Refusing: ${ONLY} is not catalogued as a bilingual edition naming ${LANG}. Run scripts/maintenance/relabel-bilingual-edition.mjs first — the gate is the catalogue, not the page.`
    : 'No catalogued bilingual editions naming that language.');
  await client.close();
  process.exit(1);
}

console.log(`${COMMIT ? 'WRITING' : 'DRY RUN'} — ${books.length} bilingual edition(s), lang=${LANG}${REPLACE_PIVOT ? ', replacing ai-pivot values' : ''}`);

let grandWrote = 0;
for (const book of books) {
  const pages = await db.collection('pages')
    .find({ book_id: book.id })
    .project({ id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, [`translations.${LANG}.source`]: 1, [`translations.${LANG}.data`]: 1 })
    .sort({ page_number: 1 })
    .toArray();

  const plan = { write: [], skipPivot: 0, skipManual: 0, declined: 0, unchanged: 0 };
  for (const p of pages) {
    const existing = p.translations?.[LANG];
    const res = spanishColumnText(p.ocr?.data);
    if (!res) { plan.declined++; continue; }
    if (existing?.data) {
      if (existing.source === OURS) {
        if (existing.data === res.text) { plan.unchanged++; continue; }
      } else if (PIVOT_SOURCES.has(existing.source)) {
        if (!REPLACE_PIVOT) { plan.skipPivot++; continue; }
      } else {
        // Manual edits, or any provenance this script does not recognise. Never
        // guess about a value a person may have written.
        plan.skipManual++;
        continue;
      }
    }
    plan.write.push({ page: p, text: res.text, meta: res });
  }

  const finalCount = pages.filter((p) => p.translations?.[LANG]?.data).length
    + plan.write.filter((w) => !w.page.translations?.[LANG]?.data).length;

  console.log(`\n${String(book.title).slice(0, 72)}`);
  console.log(`  id=${book.id}  language=${JSON.stringify(book.language)}  pages=${pages.length}`);
  console.log(`  write ${plan.write.length} · unchanged ${plan.unchanged} · declined ${plan.declined}`
    + `${plan.skipPivot ? ` · ${plan.skipPivot} HELD BACK (existing ai-pivot — pass --replace-pivot)` : ''}`
    + `${plan.skipManual ? ` · ${plan.skipManual} skipped (human-edited or unknown provenance)` : ''}`);
  console.log(`  pages_translated_${LANG}: ${book[`pages_translated_${LANG}`] ?? 0} → ${finalCount}`);
  if (plan.write.length) {
    const s = plan.write[0];
    console.log(`  sample p${s.page.page_number} (${s.meta.accepted}/${s.meta.columns} columns, ${s.meta.words} words, `
      + `${(100 * s.meta.share).toFixed(0)}% function words): ${s.text.replace(/\s+/g, ' ').slice(0, 120)}…`);
  }

  if (!COMMIT || !plan.write.length) continue;

  const now = new Date();
  const ops = plan.write.slice(0, LIMIT || Infinity).map((w) => ({
    updateOne: {
      filter: { id: w.page.id },
      $set: {
        [`translations.${LANG}`]: {
          data: w.text,
          language: 'Spanish',
          model: '',
          source: OURS,
          updated_at: now,
        },
        updated_at: now,
      },
    },
  }));
  // bulkWrite's updateOne takes `update`, not a bare `$set` — spelled out rather
  // than mapped, so a shape error fails here and not silently at Mongo.
  const bulk = ops.map((o) => ({ updateOne: { filter: o.updateOne.filter, update: { $set: o.updateOne.$set } } }));
  const res = await db.collection('pages').bulkWrite(bulk, { ordered: false });
  console.log(`  wrote: matched=${res.matchedCount} modified=${res.modifiedCount}`);
  grandWrote += res.modifiedCount;

  // Recount from the PAGES rather than trusting the plan — the counter gates the
  // `/es` 307 and the collection, and a counter derived from an intention rather
  // than from the data is how a book claims an edition it does not have.
  const counted = await db.collection('pages').countDocuments({ book_id: book.id, [`translations.${LANG}.data`]: { $exists: true, $ne: '' } });
  await db.collection('books').updateOne(
    { id: book.id },
    { $set: { [`pages_translated_${LANG}`]: counted, updated_at: new Date() } },
  );
  console.log(`  books.pages_translated_${LANG} = ${counted} (counted from pages), updated_at bumped for the catalog sync`);
}

if (COMMIT) {
  console.log(`\n${grandWrote} pages written.`);
  console.log('NEXT, and none of it is automatic:');
  console.log('  1. node --env-file=.env.production.local scripts/maintenance/sync-es-collection.mjs');
  console.log(`  2. node --env-file=.env.production.local scripts/workers/embed-page-texts.mjs --lang=${LANG}   ← BILLED`);
  console.log('  3. the Supabase catalog sync (updated_at is bumped, so the cron picks it up)');
} else {
  console.log('\nDRY RUN — pass --commit to write.');
}
await client.close();

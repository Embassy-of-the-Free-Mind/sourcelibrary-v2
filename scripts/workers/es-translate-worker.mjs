#!/usr/bin/env node
/**
 * Spanish edition worker — pivots the existing English translation
 * (pages.translation.data) into Spanish, most-read books first.
 *
 * Writes the language-keyed model (#2835): `pages.translations.es`
 * ({ data, language:'Spanish', model, source:'ai-pivot-en', prompt_version,
 * updated_at }). The reader (getTranslation) and the /es surfaces read this map;
 * the legacy `translation_es` field is read-only fallback and is NOT written.
 *
 * After each book it refreshes `books.pages_translated_es` (the counter the /es
 * homepage band, the "En español" card tag and the en-espanol collection read)
 * and bumps `updated_at` so the Supabase catalog sync picks the book up. Run
 * scripts/maintenance/sync-es-collection.mjs afterwards to tag the collection.
 *
 * Guards (why this is a worker and not an ad-hoc script — #2770 pilot defects):
 *   - collapse guard: a substantial page whose ES body is near-empty is retried
 *   - length-sanity band: ES body must be 0.5–2.0x the English body, else retry;
 *     still out of band after 3 tries ⇒ the page is SKIPPED (not stored), so
 *     collapses and runaway loops never reach the reader.
 *
 * Resumable: every page is its own write and the page filter excludes pages that
 * already carry Spanish, so a killed run simply continues where it stopped.
 *
 * Cost ≈ $0.0007/page (flash-lite). Respects the processing_control pause flag.
 *
 * After each book it also embeds the new Spanish text into Supabase
 * `page_texts` (#4095), which is what makes the pages FINDABLE — a Spanish page
 * that exists but is not embedded is invisible to Spanish search, and, as the
 * English page vectors proved in Aug 2026, an unembedded book and a book with
 * no match return the same empty list. Keeping the writer inside the worker is
 * the fix for that class: `--no-embed` opts out (needs SUPABASE_DB_URL).
 *
 *   node --env-file=.env.production.local scripts/workers/es-translate-worker.mjs \
 *        [--top=50] [--book=<id>[,<id>]] [--max-pages=20000] [--dry-run] [--no-embed]
 */
import { MongoClient } from 'mongodb';
import pg from 'pg';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logUsage } from './lib/supabase-usage-logger.mjs';
import { embedBookPageTexts } from '../lib/embed-book-page-texts.mjs';

const args = process.argv.slice(2);
const getArg = (n, d) => { const m = args.find(a => a.startsWith(`--${n}=`)); return m ? m.split('=')[1] : d; };
const TOP = parseInt(getArg('top', '50'), 10);
const MAX_PAGES = parseInt(getArg('max-pages', '20000'), 10);
const BOOK_OVERRIDE = getArg('book', null);
// --pages=<pageId,..> | --pages=@file.json (reads .retranslate[] from es-edition-quality.mjs):
// RE-translate exactly these pages, overwriting their Spanish. For audit repairs.
const PAGES_ARG = getArg('pages', null);
const PAGE_IDS = PAGES_ARG
  ? (PAGES_ARG.startsWith('@') ? JSON.parse((await import('node:fs')).readFileSync(PAGES_ARG.slice(1), 'utf8')).retranslate : PAGES_ARG.split(','))
  : null;
// --order=reads (default: most-read first) | pages (shortest first — more books visible sooner)
const ORDER = getArg('order', 'reads') === 'pages' ? { pages_translated: 1, read_count: -1 } : { read_count: -1 };
const DRY_RUN = args.includes('--dry-run');
const NO_EMBED = args.includes('--no-embed');
const CONC = 6;
const MODEL = 'gemini-3.1-flash-lite';
const PROMPT_VERSION = 'es-pivot-v2';
const LO = 0.5, HI = 2.0;          // ES/EN body length sanity band
const COLLAPSE_EN_FLOOR = 800;     // only collapse-guard substantial pages
const COLLAPSE_ES_CAP = 300;       // ES body this short on a big page = collapse

// Paid keys only (the FREE/_4 tier may be trained on — never for corpus text).
const API_KEYS = [
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  ...Array.from({ length: 5 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 5}`]),
].filter(Boolean);
if (!API_KEYS.length) { console.error('[ES] No Gemini API keys'); process.exit(1); }
let keyIdx = 0;
const nextModel = () => new GoogleGenerativeAI(API_KEYS[keyIdx++ % API_KEYS.length]).getGenerativeModel({
  model: MODEL,
  safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map(category => ({ category, threshold: 'BLOCK_NONE' })),
});

const WRAP = /<(meta|image-desc|vocab|summary|keywords|warning|scan-quality|language|page-type|page-num|columns|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const clean = t => String(t || '').replace(WRAP, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// --strict: the retry pass for pages the length guard refused. Repetitive
// scholastic/mystical prose (Llull, Böhme) tempts the model to condense; this
// prompt forbids it explicitly and the pass allows five attempts instead of three.
const STRICT = args.includes('--strict');
const ATTEMPTS = STRICT ? 5 : 3;
const PROMPT = txt => STRICT
  ? `You are producing the Spanish edition of a historical primary-source reader. Translate the English text below into faithful, scholarly Spanish, SENTENCE BY SENTENCE.
ABSOLUTE RULES: every sentence of the English must appear in the Spanish — never condense, merge, summarize or skip, even when the text is repetitive or formulaic; the Spanish must be about the same length as the English. Preserve all XML-like tags (<meta>, <note>, <header>…), markdown, tables and numerals exactly; translate readable text inside tags too. Localize names (Iamblichus→Jámblico) and use Spanish typography (« », d. C./a. C.). Output ONLY the full translation, once.

English:
${txt}

Spanish:`
  : `You are producing the Spanish edition of a historical primary-source reader. Translate the ENTIRE English text below into faithful, scholarly Spanish.
RULES: do NOT summarize, drop, or repeat sentences. Preserve all XML-like tags (<meta>, <note>, <header>…), markdown, and numerals; translate readable text inside tags too. Localize names (Iamblichus→Jámblico) and use Spanish typography (« », d. C./a. C.). Output ONLY the full translation, once.

English:
${txt}

Spanish:`;

const usage = { input: 0, output: 0, calls: 0 };

// Translate one page with guards. Returns {text, inputTokens, outputTokens} or null.
async function translatePage(eng) {
  const enLen = clean(eng).length;
  const sane = es => {
    const esLen = clean(es).length;
    if (enLen < 200) return esLen > 0;                                     // tiny page: any non-empty output ok
    if (enLen > COLLAPSE_EN_FLOOR && esLen < COLLAPSE_ES_CAP) return false; // collapse
    const r = esLen / enLen;
    return r >= LO && r <= HI;                                             // length-sanity band
  };
  let best = null, bestDist = Infinity;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let res;
    try { res = (await nextModel().generateContent(PROMPT(eng))).response; }
    catch (e) {
      if (/quota|429|RESOURCE_EXHAUSTED|503|overloaded/i.test(e.message || '')) await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    const meta = res.usageMetadata || {};
    usage.input += meta.promptTokenCount || 0; usage.output += meta.candidatesTokenCount || 0; usage.calls++;
    let text;
    try { text = res.text(); } catch { continue; } // empty candidate / blocked
    if (sane(text)) {
      const dist = enLen < 200 ? 0 : Math.abs(clean(text).length / enLen - 1);
      if (dist < bestDist) { best = { text, inputTokens: meta.promptTokenCount || 0, outputTokens: meta.candidatesTokenCount || 0 }; bestDist = dist; }
      if (bestDist < 0.3) break;
    }
  }
  return best;
}

const ES_PRESENT = { $or: [{ 'translations.es.data': { $type: 'string', $ne: '' } }, { 'translation_es.data': { $type: 'string', $ne: '' } }] };

async function recount(db, bookId) {
  const n = await db.collection('pages').countDocuments({ book_id: bookId, ...ES_PRESENT });
  if (!DRY_RUN) await db.collection('books').updateOne({ id: bookId }, { $set: { pages_translated_es: n, updated_at: new Date() } });
  return n;
}

/**
 * Open the Supabase connection used to embed each finished book, or null when
 * embedding is off or unconfigured. Deliberately NOT fatal: a missing
 * SUPABASE_DB_URL should not stop translation — but it must SAY so, because a
 * silent skip here is precisely how the English page vectors went two months
 * dark without anything downstream noticing.
 */
async function openEmbedClient() {
  if (NO_EMBED || DRY_RUN) return null;
  if (!process.env.SUPABASE_DB_URL) {
    console.warn('[ES] SUPABASE_DB_URL missing — translating WITHOUT embedding; the new Spanish pages will not be findable until scripts/workers/embed-page-texts.mjs --lang=es is run.');
    return null;
  }
  try {
    const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    await c.query('SET statement_timeout = 60000');
    return c;
  } catch (e) {
    console.warn(`[ES] Supabase unavailable (${e.message}) — translating WITHOUT embedding; run embed-page-texts.mjs --lang=es afterwards.`);
    return null;
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 8 });
  await client.connect();
  const db = client.db('bookstore');

  const control = await db.collection('system_config').findOne({ _id: 'processing_control' }).catch(() => null);
  // The pause flag exists for the OCR/translation relight (#3826). This pivot
  // reads finished English text and writes only translations.es, so an operator
  // may run it through a pause — but only by saying so.
  if (control?.paused && !args.includes('--ignore-pause')) {
    console.log('[ES] processing_control paused — exiting (pass --ignore-pause to run the EN→ES pivot anyway)');
    await client.close(); return;
  }

  const embedPg = await openEmbedClient();
  const embedKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;

  // Popular-first: the most-read books with an English translation, skipping
  // those whose Spanish counter already covers their translated pages.
  const match = BOOK_OVERRIDE
    ? { id: { $in: BOOK_OVERRIDE.split(',') } }
    : { visible: true, pages_translated: { $gt: 0 }, content_type: { $ne: 'artwork' }, read_count: { $gt: 0 } };
  // Page-repair mode: the books are whatever books those pages belong to.
  const repairBookIds = PAGE_IDS ? await db.collection('pages').distinct('book_id', { id: { $in: PAGE_IDS } }) : null;
  // SELECT by popularity (top-N most-read), THEN order the run. Sorting by pages
  // before the limit once picked the 50 shortest books in the library instead of
  // the 50 most-read (2026-08-20) — --order only ever decides sequence.
  const books = (await db.collection('books')
    .find(repairBookIds ? { id: { $in: repairBookIds } } : match, { projection: { id: 1, title: 1, display_title: 1, read_count: 1, pages_translated: 1, pages_translated_es: 1 } })
    .sort({ read_count: -1 }).limit(repairBookIds || BOOK_OVERRIDE ? 10000 : TOP).toArray())
    .filter(b => BOOK_OVERRIDE || PAGE_IDS || (b.pages_translated_es || 0) < b.pages_translated)
    .sort((a, b) => ORDER.pages_translated ? (a.pages_translated - b.pages_translated) || (b.read_count || 0) - (a.read_count || 0) : (b.read_count || 0) - (a.read_count || 0));
  if (PAGE_IDS) console.log(`[ES] page-repair mode: ${PAGE_IDS.length} pages across ${books.length} books (existing Spanish will be overwritten)`);

  console.log(`[ES] ${books.length} candidate book(s) of top ${TOP}; cap ${MAX_PAGES} pages; model ${MODEL}; keys ${API_KEYS.length}${DRY_RUN ? '; DRY RUN' : ''}`);
  let pagesDone = 0, skipped = 0;
  const t0 = Date.now();

  for (const b of books) {
    if (pagesDone >= MAX_PAGES) break;
    const pages = await db.collection('pages').find(
      PAGE_IDS
        ? { book_id: b.id, id: { $in: PAGE_IDS }, 'translation.data': { $type: 'string', $ne: '' } }
        : { book_id: b.id, 'translation.data': { $type: 'string', $ne: '' },
            'translations.es.data': { $exists: false }, 'translation_es.data': { $exists: false } },
      { projection: { _id: 1, id: 1, page_number: 1, 'translation.data': 1 }, sort: { page_number: 1 } }
    ).limit(MAX_PAGES - pagesDone).toArray();
    const label = (b.display_title || b.title || b.id).slice(0, 48);
    if (!pages.length) { const n = await recount(db, b.id); console.log(`[ES] ${label} — nothing to do (es=${n})`); continue; }
    console.log(`[ES] ${label} — ${pages.length} pages (reads=${b.read_count || 0})`);
    if (DRY_RUN) { pagesDone += pages.length; continue; }

    let i = 0, bookDone = 0;
    const worker = async () => {
      while (i < pages.length) {
        const p = pages[i++];
        const t = Date.now();
        const es = await translatePage(p.translation.data);
        if (!es) { skipped++; console.log(`  [skip] ${b.id} p${p.page_number}: no sane translation after retries`); continue; }
        await db.collection('pages').updateOne({ _id: p._id }, { $set: { 'translations.es': {
          data: es.text, language: 'Spanish', model: MODEL, source: 'ai-pivot-en', prompt_version: PROMPT_VERSION, updated_at: new Date(),
        } } });
        await logUsage({
          type: 'translation', mode: 'realtime', model: MODEL, book_id: b.id, page_ids: [p.id],
          input_tokens: es.inputTokens, output_tokens: es.outputTokens, status: 'success', duration_ms: Date.now() - t,
          prompt_version: PROMPT_VERSION, endpoint: 'worker/es-translate', batch_size: 1,
        }, db).catch(() => {});
        pagesDone++; bookDone++;
        if (bookDone % 50 === 0) console.log(`  … ${bookDone}/${pages.length} (${pagesDone} total, ${((Date.now() - t0) / 60000).toFixed(1)} min)`);
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));
    const n = await recount(db, b.id);
    console.log(`[ES] ${label} — done: es=${n}/${b.pages_translated}`);

    if (embedPg && bookDone > 0) {
      try {
        // Re-fetch the book: embedBookPageTexts denormalizes author/language/
        // year onto every row and the projection above carries none of them.
        const full = await db.collection('books').findOne(
          { id: b.id }, { projection: { id: 1, title: 1, author: 1, language: 1, year: 1 } });
        // Staleness is checked inside, so a re-translated page's vector and
        // snippet are replaced rather than left pointing at the old text.
        const r = await embedBookPageTexts({ db, pg: embedPg, book: full, lang: 'es', apiKey: embedKey });
        console.log(`[ES] ${label} — embedded ${r.embedded} page(s)${r.restaled ? ` (${r.restaled} re-embedded after re-translation)` : ''}`);
      } catch (e) {
        console.error(`[ES] ${label} — EMBED FAILED: ${e.message} (pages are translated but not yet findable; re-run embed-page-texts.mjs --lang=es --book=${b.id})`);
      }
    }
  }

  const cost = usage.input / 1e6 * 0.25 + usage.output / 1e6 * 1.5;
  console.log(`[ES] done — ${pagesDone} pages translated, ${skipped} skipped; ${usage.calls} calls, ${usage.input} in / ${usage.output} out tokens ≈ $${cost.toFixed(2)} (list price)`);
  await embedPg?.end().catch(() => {});
  await client.close();
}

main().catch(e => { console.error('[ES] fatal', e); process.exit(1); });

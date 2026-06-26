#!/usr/bin/env node
/**
 * Spanish edition worker — pivots the existing English translation
 * (pages.translation.data) into Spanish (pages.translation_es), most-popular
 * books first. Runs on the Hetzner scheduler alongside the English
 * translate-worker; submits to Gemini directly (no Vercel/Cloudflare edge limit).
 *
 * Guards (the reason this exists vs. an ad-hoc script — see #2770):
 *   - collapse guard: a substantial page whose ES body is near-empty is retried
 *   - length-sanity band: ES body must be 0.5–2.0x the English body, else retry;
 *     if still out-of-band after retries the page is SKIPPED (not stored), so
 *     collapses and runaway loops never reach the reader.
 *
 * Cost: ~$0.0007/page (flash-lite batch-equiv); full corpus ≈ $3K. Bounded per
 * run by --limit; respects the processing_control pause flag. Popular-first so
 * spend tracks reader demand. Pause: system_config._id:'processing_control' paused:true.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/es-translate-worker.mjs [--books=4] [--max-pages=300] [--book=<id>] [--dry-run]
 */
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const args = process.argv.slice(2);
const getArg = (n, d) => { const m = args.find(a => a.startsWith(`--${n}=`)); return m ? m.split('=')[1] : d; };
const BOOK_LIMIT = parseInt(getArg('books', '4'), 10);
const MAX_PAGES = parseInt(getArg('max-pages', '300'), 10);
const BOOK_OVERRIDE = getArg('book', null);
const DRY_RUN = args.includes('--dry-run');
const CONC = 6;
const MODEL = 'gemini-3.1-flash-lite';
const PROMPT_VERSION = 'es-pivot-v1';
const LO = 0.5, HI = 2.0;          // ES/EN body length sanity band
const COLLAPSE_EN_FLOOR = 800;     // only collapse-guard substantial pages
const COLLAPSE_ES_CAP = 300;       // ES body this short on a big page = collapse

const API_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => (i + 2 === 4 ? null : process.env[`GEMINI_API_KEY_${i + 2}`])),
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);
if (!API_KEYS.length) { console.error('[ES] No Gemini API keys'); process.exit(1); }
let keyIdx = 0;
const nextModel = () => new GoogleGenerativeAI(API_KEYS[keyIdx++ % API_KEYS.length]).getGenerativeModel({
  model: MODEL,
  safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map(category => ({ category, threshold: 'BLOCK_NONE' })),
});

const WRAP = /<(meta|image-desc|vocab|summary|keywords|warning|scan-quality|language|page-type|page-num|columns|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const clean = t => String(t || '').replace(WRAP, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const PROMPT = txt => `You are producing the Spanish edition of a historical primary-source reader. Translate the ENTIRE English text below into faithful, scholarly Spanish.
RULES: do NOT summarize, drop, or repeat sentences. Preserve all XML-like tags (<meta>, <note>, <header>…), markdown, and numerals; translate readable text inside tags too. Localize names (Iamblichus→Jámblico) and use Spanish typography (« », d. C./a. C.). Output ONLY the full translation, once.

English:
${txt}

Spanish:`;

// Translate one page with guards. Returns {data} or null if it can't be made sane.
async function translatePage(eng) {
  const enLen = clean(eng).length;
  const sane = es => {
    const esLen = clean(es).length;
    if (enLen < 200) return esLen > 0;                              // tiny page: any non-empty output ok
    if (enLen > COLLAPSE_EN_FLOOR && esLen < COLLAPSE_ES_CAP) return false; // collapse
    const r = esLen / enLen;
    return r >= LO && r <= HI;                                      // length-sanity band
  };
  let best = null, bestDist = Infinity;
  for (let attempt = 0; attempt < 3; attempt++) {
    let text;
    try { text = (await nextModel().generateContent(PROMPT(eng))).response.text(); }
    catch (e) { if (/quota|429|RESOURCE_EXHAUSTED/i.test(e.message || '')) await new Promise(r => setTimeout(r, 4000)); continue; }
    if (sane(text)) {
      const dist = enLen < 200 ? 0 : Math.abs(clean(text).length / enLen - 1);
      if (dist < bestDist) { best = text; bestDist = dist; }
      if (bestDist < 0.3) break;
    }
  }
  return best;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4 });
  await client.connect();
  const db = client.db('bookstore');

  const control = await db.collection('system_config').findOne({ _id: 'processing_control' }).catch(() => null);
  if (control?.paused) { console.log('[ES] processing_control paused — exiting'); await client.close(); return; }

  // Popular-first: most-read books that still have English pages without a Spanish edition.
  const match = BOOK_OVERRIDE
    ? { id: BOOK_OVERRIDE }
    : { visible: true, pages_translated: { $gt: 0 }, $expr: { $gt: ['$pages_translated', { $ifNull: ['$pages_translated_es', 0] }] } };
  const books = await db.collection('books')
    .find(match, { projection: { id: 1, title: 1, display_title: 1, read_count: 1, pages_translated: 1, pages_translated_es: 1 } })
    .sort({ read_count: -1 }).limit(BOOK_LIMIT).toArray();

  console.log(`[ES] ${books.length} candidate book(s); cap ${MAX_PAGES} pages this run; model ${MODEL}; keys ${API_KEYS.length}`);
  let pagesDone = 0, skipped = 0;

  for (const b of books) {
    if (pagesDone >= MAX_PAGES) break;
    const pages = await db.collection('pages').find(
      { book_id: b.id, 'translation.data': { $type: 'string', $ne: '' },
        $or: [{ 'translation_es.data': { $exists: false } }, { 'translation_es.data': '' }, { 'translation_es.data': null }] },
      { projection: { _id: 1, page_number: 1, 'translation.data': 1 } }
    ).limit(MAX_PAGES - pagesDone).toArray();
    if (!pages.length) {
      // Already fully translated (e.g. by the pilot) but missing the book-level
      // counter — stamp it so this book drops out of future selection.
      const esCount = await db.collection('pages').countDocuments({ book_id: b.id, 'translation_es.data': { $type: 'string', $ne: '' } });
      if (!DRY_RUN) await db.collection('books').updateOne({ id: b.id }, { $set: { pages_translated_es: esCount } });
      continue;
    }
    console.log(`[ES] ${(b.display_title || b.title || b.id).slice(0, 48)} — ${pages.length} pages (reads=${b.read_count || 0})`);
    if (DRY_RUN) { pagesDone += pages.length; continue; }

    let i = 0;
    const worker = async () => {
      while (i < pages.length) {
        const p = pages[i++];
        const es = await translatePage(p.translation.data);
        if (!es) { skipped++; console.log(`  [skip] ${b.id} p${p.page_number}: no sane translation after retries`); continue; }
        await db.collection('pages').updateOne({ _id: p._id }, { $set: { translation_es: {
          data: es, language: 'Spanish', model: MODEL, source: 'ai-pivot-en', prompt_version: PROMPT_VERSION, updated_at: new Date(),
        } } });
        pagesDone++;
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));

    // Sync the book-level Spanish counter (drives popular-first selection + progress).
    const esCount = await db.collection('pages').countDocuments({ book_id: b.id, 'translation_es.data': { $type: 'string', $ne: '' } });
    await db.collection('books').updateOne({ id: b.id }, { $set: { pages_translated_es: esCount, updated_at: new Date() } });
  }

  console.log(`[ES] done — ${pagesDone} pages translated, ${skipped} skipped (out-of-band)`);
  await client.close();
}

main().catch(e => { console.error('[ES] fatal', e); process.exit(1); });

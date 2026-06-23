#!/usr/bin/env node
/**
 * reground-captions.mjs — judge-gated backfill of mis-identified gallery captions (#2707).
 *
 * The image captioner historically wrote `museum_description` from pixels + the
 * book's topic, blind to the page text, so ~1 in 5 checkable captions name the
 * wrong subject (wrestlers→"gymnosophists", Agrimonia→"hemp", a speculum→a
 * "cervical dilator"). The pipeline is now fixed going forward; this backfills
 * the already-stored errors.
 *
 * Strategy B+ (sized by scripts/analysis/size-recaption.mjs):
 *   1. JUDGE (flash-lite, text-only, cheap): does the stored caption misidentify
 *      the subject vs the page's own <image-desc>? Skip if not — no vision spend.
 *   2. RE-CAPTION confirmed-wrong: a focused vision call on the illustration crop,
 *      grounded by the page text (buildPageGrounding) with the on-page label as
 *      top authority. Writes ONLY a museum_description — never re-detects, so bbox
 *      and everything else are untouched.
 *   3. VERIFY (flash-lite): keep the new caption only if the judge says it
 *      identifies the subject better than the old one (the pilot showed a single
 *      pass can occasionally regress — don't blind-overwrite).
 *
 * Every overwrite stashes the original in `museum_description_pre_reground`
 * (written once, preserved across re-runs) so it's fully reversible. Resumable:
 * images already carrying `museum_description_regrounded_at` are skipped.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/reground-captions.mjs [--limit N] [--book ID]
 *        [--dry-run] [--concurrency 6] [--purge]
 */
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildPageGrounding } from '../lib/page-grounding.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);
const LIMIT = parseInt(arg('--limit', '0'), 10) || Infinity;
const ONLY_BOOK = arg('--book', null);
const DRY = has('--dry-run');
const CONC = parseInt(arg('--concurrency', '6'), 10);
const PURGE = has('--purge');
const RADIUS = 3;
const CAPTION_MODEL = 'gemini-3-flash-preview';   // vision (matches the extractor)
const JUDGE_MODEL = 'gemini-3.1-flash-lite';      // cheap text-only judge

const imgDescRx = /<image-desc[^>]*>([\s\S]*?)<\/image-desc>/i;

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const judgeModel = ai.getGenerativeModel({ model: JUDGE_MODEL, generationConfig: { temperature: 0, maxOutputTokens: 256, responseMimeType: 'application/json' } });
const NO_BLOCK = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY'].map(category => ({ category, threshold: 'BLOCK_NONE' }));
// thinkingBudget:0 — like the production extractor. Without it, default thinking
// tokens eat maxOutputTokens and the call finishes MAX_TOKENS before writing the caption.
const captionModel = ai.getGenerativeModel({ model: CAPTION_MODEL, safetySettings: NO_BLOCK, generationConfig: { temperature: 0.1, maxOutputTokens: 600, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } } });

// Decorative markup that has no real "subject" to misidentify — never worth a
// vision re-caption (mirrors SKIP_MARKUP_RULES in the extractor). These slip into
// gallery_images as a separate data-quality matter; here we just skip them.
const TRIVIAL_TYPES = new Set(['ornament', 'decorative', 'symbol', 'stamp', 'exlibris', 'bookplate', 'initial', 'drop-cap', "printer's mark", 'printers mark', 'border']);

async function fetchImg(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  return { b64: Buffer.from(await r.arrayBuffer()).toString('base64'), mime: r.headers.get('content-type') || 'image/jpeg' };
}

// Stage 1 — is the stored caption's SUBJECT wrong vs the page text?
async function judgeWrong(idesc, museum) {
  const prompt = `Audit a museum caption for a historical book illustration.
PAGE DESCRIPTION (OCR pass that read the whole page incl. any label beside the picture — more reliable for WHAT it shows):
"""${idesc.slice(0, 900)}"""
DISPLAYED CAPTION (written without reading the page):
"""${(museum || '').slice(0, 900)}"""
Does the caption misidentify the SUBJECT (different person/figure/scene than the page supports)? Ignore wording/richness; judge only the named subject. If the illustration is a decorative initial, ornament, border, or printer's device with no real subject, answer false.
JSON: {"subject_wrong": true|false}`;
  try { return !!JSON.parse((await judgeModel.generateContent(prompt)).response.text()).subject_wrong; }
  catch { return null; }
}

// Stage 3 — does the NEW caption identify the subject better than the OLD?
async function judgeBetter(idesc, oldC, newC) {
  const prompt = `Two museum captions for the SAME illustration. Page description (most reliable for the subject):
"""${idesc.slice(0, 900)}"""
OLD: """${(oldC || '').slice(0, 700)}"""
NEW: """${(newC || '').slice(0, 700)}"""
Which identifies the SUBJECT more accurately vs the page description? If they tie, prefer OLD.
JSON: {"better": "new"|"old"}`;
  try { return JSON.parse((await judgeModel.generateContent(prompt)).response.text()).better === 'new'; }
  catch { return false; }
}

// Stage 2 — focused, grounded re-caption (caption only, no re-detection).
async function recaption({ book, page, grounding, detection, b64, mime }) {
  const ctx = [book.title && `Book: "${book.title}"`, book.author && `Author: ${book.author}`, book.year && `Year: ${book.year}`, book.language && `Language: ${book.language}`].filter(Boolean).join(' | ');
  const prompt = `You are a museum curator writing a label for ONE illustration shown in the image.
BOOK CONTEXT (background only — never assert a subject from the book's topic): ${ctx}
${grounding}
Rough machine description (may be wrong about the subject): ${detection?.description || '(none)'}

Write a 2-3 sentence museum caption. Identify the SUBJECT strictly from the PAGE TEXT CONTEXT above (the label printed beside the picture wins over the book's topic). Then add brief art-historical significance. Do NOT name a person/scene the page text contradicts.
JSON: {"museum_description": "..."}`;
  try {
    const r = await captionModel.generateContent([{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }]);
    const fin = r.response?.candidates?.[0]?.finishReason;
    if (fin && fin !== 'STOP') { stats.reasons[fin] = (stats.reasons[fin] || 0) + 1; return ''; }
    return JSON.parse(r.response.text()).museum_description || '';
  } catch (e) {
    const m = String(e?.message || e).slice(0, 40);
    stats.reasons[m] = (stats.reasons[m] || 0) + 1;
    return '';
  }
}

const stats = { books: 0, scanned: 0, skipped: 0, judgedWrong: 0, recaptioned: 0, keptNew: 0, keptOld: 0, written: 0, errors: 0, reasons: {} };
const touchedBooks = new Set();
const examples = [];

async function processBook(db, bookId, budget) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, summary: 1 } });
  if (!book) return;
  const gimgs = await db.collection('gallery_images').find(
    { book_id: bookId, museum_description: { $type: 'string' }, museum_description_regrounded_at: { $exists: false } },
    { projection: { id: 1, page_id: 1, detection_index: 1, museum_description: 1, extracted_url: 1 } },
  ).toArray();
  if (gimgs.length === 0) return;
  stats.books++;

  const pageIds = [...new Set(gimgs.map(g => g.page_id))];
  const pages = await db.collection('pages').find({ id: { $in: pageIds } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, detected_images: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, display_photo: 1, split_from_spread: 1, crop: 1 } }).toArray();
  const pageById = new Map(pages.map(p => [p.id, p]));
  const wantNums = new Set(); for (const p of pages) for (let d = -RADIUS; d <= RADIUS; d++) wantNums.add(p.page_number + d);
  const win = await db.collection('pages').find({ book_id: bookId, page_number: { $in: [...wantNums] } }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
  const byNum = new Map(win.map(p => [p.page_number, p]));

  const queue = [...gimgs];
  async function worker() {
    while (queue.length && budget.n < LIMIT) {
      const g = queue.shift(); if (!g) break;
      budget.n++; stats.scanned++;
      try {
        const p = pageById.get(g.page_id); if (!p) { stats.skipped++; continue; }
        const idesc = (p.ocr?.data?.match(imgDescRx) || p.translation?.data?.match(imgDescRx))?.[1];
        if (!idesc) { stats.skipped++; continue; }  // nothing text-grounded to judge against
        const detection = p.detected_images?.[g.detection_index];
        // Skip decorative markup — no real subject to misidentify, and re-captioning
        // a drop-cap is wasted vision spend.
        if (TRIVIAL_TYPES.has((detection?.type || '').toLowerCase())
          || /\b(decorative|historiated|ornamental)\b[^.]{0,30}\b(initial|drop[ -]?cap|letter)\b|\b(drop[ -]?cap|tailpiece|headpiece|printer'?s (device|mark))\b/i.test(idesc)) {
          stats.skipped++; continue;
        }
        const wrong = await judgeWrong(idesc, g.museum_description);
        if (wrong !== true) { stats.skipped++; continue; }
        stats.judgedWrong++;

        const neighbors = [];
        for (let n = p.page_number - RADIUS; n <= p.page_number + RADIUS; n++) { if (n === p.page_number) continue; const np = byNum.get(n); if (np) neighbors.push({ page_number: n, ocr: np.ocr?.data, translation: np.translation?.data }); }
        const grounding = buildPageGrounding({ ocr: p.ocr?.data, translation: p.translation?.data, pageNumber: p.page_number, neighbors, bookSummary: book.summary || '', radius: RADIUS });
        const src = g.extracted_url || getPageSource(p);
        const img = await fetchImg(src); if (!img) { stats.skipped++; continue; }
        const newMd = await recaption({ book, page: p, grounding, detection, b64: img.b64, mime: img.mime });
        if (!newMd) { stats.skipped++; continue; }
        stats.recaptioned++;

        const better = await judgeBetter(idesc, g.museum_description, newMd);
        if (!better) { stats.keptOld++; continue; }
        stats.keptNew++;
        if (examples.length < 6) examples.push({ book: book.title, page: p.page_number, idesc, old: g.museum_description, neu: newMd });

        if (!DRY) {
          const set = { museum_description: newMd, museum_description_regrounded_at: new Date() };
          // preserve the TRUE original once
          const stash = g.museum_description_pre_reground === undefined ? { museum_description_pre_reground: g.museum_description } : {};
          await db.collection('gallery_images').updateOne({ id: g.id }, { $set: { ...set, ...stash } });
          await db.collection('pages').updateOne({ id: p.id }, { $set: { [`detected_images.${g.detection_index}.museum_description`]: newMd } });
          stats.written++;
          touchedBooks.add(bookId);
        }
      } catch (e) { stats.errors++; }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
}

async function purgeEverything() {
  const tok = process.env.CLOUDFLARE_API_TOKEN, zone = process.env.CLOUDFLARE_ZONE_ID;
  if (!tok || !zone) { console.log('  (skip purge — CLOUDFLARE_API_TOKEN/ZONE_ID not set)'); return; }
  const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ purge_everything: true }) });
  console.log(`  Cloudflare purge_everything: ${r.ok ? 'ok' : 'FAILED ' + r.status}`);
}

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  console.log(`reground-captions ${DRY ? '(DRY RUN) ' : ''}— limit ${LIMIT === Infinity ? 'all' : LIMIT}, conc ${CONC}${ONLY_BOOK ? `, book ${ONLY_BOOK}` : ''}`);

  const bookIds = ONLY_BOOK ? [ONLY_BOOK]
    : await db.collection('gallery_images').distinct('book_id', { museum_description: { $type: 'string' }, museum_description_regrounded_at: { $exists: false } });
  console.log(`${bookIds.length} book(s) with un-regrounded captions`);

  const budget = { n: 0 };
  for (const bid of bookIds) {
    if (budget.n >= LIMIT) break;
    await processBook(db, bid, budget);
    if (stats.books % 25 === 0 && stats.books) console.log(`  …${stats.books} books, ${stats.scanned} scanned, ${stats.written} rewritten`);
  }

  console.log(`\n=== done ===`);
  console.log(JSON.stringify(stats, null, 2));
  console.log(`touched ${touchedBooks.size} books`);
  for (const e of examples) {
    console.log(`\n[${e.book}] p${e.page}`);
    console.log(`  page : ${e.idesc.replace(/\s+/g, ' ').slice(0, 130)}`);
    console.log(`  OLD  : ${(e.old || '').replace(/\s+/g, ' ').slice(0, 130)}`);
    console.log(`  NEW  : ${e.neu.replace(/\s+/g, ' ').slice(0, 130)}`);
  }
  if (PURGE && !DRY && touchedBooks.size) { console.log('\npurging CDN…'); await purgeEverything(); }
  await c.close();
})().catch(e => { console.error(e); process.exit(1); });

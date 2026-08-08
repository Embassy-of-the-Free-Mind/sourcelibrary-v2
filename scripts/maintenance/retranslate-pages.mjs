#!/usr/bin/env node
/**
 * Re-translate specific pages (the fix for collapsed/degenerate translations
 * found by detect-translation-collapse.mjs).
 *
 * Faithfully mirrors scripts/workers/translate-worker.mjs: same DB translation
 * prompt, same buildPromptHeader, same single-page call with previous-page
 * continuity, same write shape (translation.{data,content_hash,model,...}) and a
 * page_revisions backup before overwrite. Model routing is the worker's
 * getModelForBook — so non-Latin-script books (e.g. Greek) now re-translate with
 * gemini-3-flash-preview rather than the lite model that collapsed them.
 *
 * Adds a POST-generation collapse guard the live worker lacks: it strips the
 * editorial wrappers, recomputes the prose body ratio, and retries; it never
 * overwrites a good translation with another collapse.
 *
 * PAID (Gemini). Default is --dry-run. Pass --execute to write.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   # one book's pages:
 *   node scripts/maintenance/retranslate-pages.mjs --book=<id> --pages=34 --execute
 *   # whole flagged list from the detector:
 *   node scripts/maintenance/retranslate-pages.mjs --from=scripts/output/translation-collapse-2026-06-16.json --execute
 *   node scripts/maintenance/retranslate-pages.mjs --from=<json> --limit=50   # dry-run preview
 */

import { withMongo } from '../lib/mongo.mjs';
import { ObjectId } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';

const arg = (name, def) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const EXECUTE = process.argv.includes('--execute');
const BOOK = arg('book', null);
const PAGES = arg('pages', null);                 // "34,35"
const FROM = arg('from', null);                   // collapse-json path
const LIMIT = parseInt(arg('limit', '100000'), 10);
const MAX_RETRIES = parseInt(arg('retries', '2'), 10);
const CONCURRENCY = parseInt(arg('concurrency', '8'), 10);
const MODEL_OVERRIDE = arg('model', null); // 'flash' | 'lite' | null(=auto routing)

// ── model routing from translate-core (the one door, issue #3725) ──
// The verbatim copy this replaces had drifted: it was missing nine languages
// (Estonian through Swahili), silently sending them to flash at 2× cost.
import {
  getTranslateModelForBook,
  MODEL_FLASH,
  MODEL_LITE,
  SAFETY_SETTINGS,
  loadTranslationPrompts,
  buildTranslationPrompt,
  writePageTranslation,
  syncBookTranslationCounters,
  assessTranslationHealth,
  bodyLen,
} from '../lib/translate-core.mjs';

function getModelForBook(book) {
  // Re-translation override: collapses happened on lite, so a fix run forces the
  // stronger model. --model=flash is the default recommendation for fixes.
  if (MODEL_OVERRIDE === 'flash') return MODEL_FLASH;
  if (MODEL_OVERRIDE === 'lite') return MODEL_LITE;
  return getTranslateModelForBook(book);
}

const API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);
let keyIdx = 0;
const aiClient = () => new GoogleGenerativeAI(API_KEYS[keyIdx++ % API_KEYS.length]);

import { sanitizeTranslationTags } from '../lib/translate-core.mjs';

// ── collapse/runaway detection now lives in translate-core (#3756) ──
// The local copies this file carried were extracted into
// assessTranslationHealth(ocrText, translationText) so every writer shares
// one definition of "is this translation plausibly real?".
const isBad = (ocr, tr) => !assessTranslationHealth(ocr, tr).healthy;
// Smaller = healthier. 0 when translation body ≈ OCR body.
const badnessScore = (ocr, tr) => {
  const ob = bodyLen(ocr) || 1, tb = bodyLen(tr) || 1;
  return Math.abs(Math.log(tb / ob));
};

// Prompts come from the DB via translate-core (promise 2: never hardcoded).
let _prompts = null;
async function loadPrompts(db) {
  if (!_prompts) _prompts = await loadTranslationPrompts(db);
}

async function translateOnce(page, book, prevTranslation) {
  const { prompt, promptRef } = buildTranslationPrompt({
    prompts: _prompts,
    book,
    ocrText: page.ocr.data,
    previousTranslation: prevTranslation,
  });
  const model = aiClient().getGenerativeModel({ model: getModelForBook(book), safetySettings: SAFETY_SETTINGS });
  const result = await model.generateContent(prompt);
  return { text: sanitizeTranslationTags(result.response.text()), promptRef };
}

await withMongo(async (db) => {
  // No process-kill timer — a multi-thousand-page flash run runs well past 300s.
  await loadPrompts(db);

  // Build target list.
  let targets = [];
  if (FROM) {
    const list = JSON.parse(fs.readFileSync(FROM, 'utf8'));
    targets = list.map(r => ({ book_id: r.book_id, page_number: r.page_number, kind: r.kind }));
  } else if (BOOK && PAGES) {
    targets = PAGES.split(',').map(s => ({ book_id: BOOK, page_number: parseInt(s.trim(), 10) }));
  } else {
    console.error('Specify --from=<json>  OR  --book=<id> --pages=N,N'); process.exit(1);
  }
  targets = targets.slice(0, LIMIT);

  console.log(`retranslate-pages — ${EXECUTE ? 'EXECUTE (writing)' : 'DRY RUN (no Gemini, no writes)'}`);
  console.log(`  targets: ${targets.length}\n`);

  const bookCache = new Map();
  const getBook = async (book_id) => {
    if (bookCache.has(book_id)) return bookCache.get(book_id);
    let oid = null; try { oid = new ObjectId(book_id); } catch {}
    const book = await db.collection('books').findOne({ id: book_id }) || (oid && await db.collection('books').findOne({ _id: oid }));
    bookCache.set(book_id, book);
    return book;
  };

  let fixed = 0, stillBad = 0, skipped = 0, alreadyGood = 0, protectedCount = 0, done = 0;
  const touchedBooks = new Set();

  async function processTarget(t) {
    const book = await getBook(t.book_id);
    if (!book) { skipped++; return; }
    const page = await db.collection('pages').findOne({ book_id: t.book_id, page_number: t.page_number });
    if (!page?.ocr?.data) { skipped++; return; }
    const model = getModelForBook(book);

    // Idempotent/resumable: a page already healthy (e.g. fixed in a prior run) is skipped.
    if (EXECUTE && page.translation?.data && !isBad(page.ocr.data, page.translation.data)) { alreadyGood++; return; }

    if (!EXECUTE) {
      console.log(`  • ${(book.display_title || book.id).slice(0,42).padEnd(42)} p${String(t.page_number).padStart(4)}  ${String(t.kind||'').padEnd(8)} ocrBody=${bodyLen(page.ocr.data)} trBody=${bodyLen(page.translation?.data)} trLen=${(page.translation?.data||'').length} → ${model}`);
      return;
    }

    const prev = await db.collection('pages').findOne({ book_id: t.book_id, page_number: t.page_number - 1 });
    const prevTr = prev?.translation?.data || null;

    let best = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { text, promptRef } = await translateOnce(page, book, prevTr);
        if (!best || badnessScore(page.ocr.data, text) < badnessScore(page.ocr.data, best.text)) best = { text, promptRef };
        if (!isBad(page.ocr.data, text)) { best = { text, promptRef }; break; }
      } catch (e) {
        console.log(`    ${book.id} p${t.page_number} attempt ${attempt} error: ${e.message?.slice(0, 70)}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!best) { console.log(`  ✗ ${book.id} p${t.page_number}: all attempts failed`); skipped++; return; }

    // Write ONLY when the result is healthy. If the retry is still bad (typically
    // a non-Latin page where flash also loops/collapses), keep the existing text —
    // replacing a bad translation with another bad one wastes tokens and gains
    // nothing. These pages need a benchmark, not a blind re-run.
    // (refuseUnhealthy below makes the door itself enforce this too.)
    if (isBad(page.ocr.data, best.text)) { stillBad++; return; }

    // The one door: revision snapshot + provenance-stamped write (translate-core),
    // with the semantic health gate armed (#3756).
    const w = await writePageTranslation(db, {
      page, book, text: best.text, promptRef: best.promptRef, model, note: 'anomaly-fix',
      refuseUnhealthy: true,
    });
    if (w.unhealthy) { stillBad++; return; }
    if (w.protected) {
      // Human-edited page — the door refused (correctly). Never count as fixed.
      console.log(`  ⛨ ${book.id} p${t.page_number}: human-edited, left untouched`);
      protectedCount++;
      return;
    }
    touchedBooks.add(t.book_id);
    fixed++;
  }

  // Concurrency pool.
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const t = targets[cursor++];
      await processTarget(t);
      if (EXECUTE && ++done % 50 === 0) process.stderr.write(`\r  progress: ${done}/${targets.length}  fixed=${fixed} stillBad=${stillBad} alreadyGood=${alreadyGood} skipped=${skipped}   `);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  process.stderr.write('\n');

  // Promise 4: recount the touched books' cached counters (this script used to
  // skip this, leaving pages_translated stale until sync-worker converged it).
  for (const bookId of touchedBooks) {
    await syncBookTranslationCounters(db, bookId);
  }
  if (touchedBooks.size) console.log(`  counters synced for ${touchedBooks.size} book(s)`);

  console.log(`\nDone. fixed=${fixed} stillBad=${stillBad} alreadyGood=${alreadyGood} protected=${protectedCount} skipped=${skipped}`);
}, { maxPoolSize: 12, noTimeout: true });

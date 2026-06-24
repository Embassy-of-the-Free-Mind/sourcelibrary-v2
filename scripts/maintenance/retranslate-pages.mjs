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
import { createHash, randomBytes } from 'crypto';
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

// ── model routing (verbatim from translate-worker.mjs) ──
const MODEL_FLASH = 'gemini-3-flash-preview';
const MODEL_LITE = 'gemini-3.1-flash-lite';
const LATIN_SCRIPT_LANGS_FOR_LITE = new Set([
  'english','en','eng','latin','la','lat','french','fr','fra','italian','it','ita',
  'spanish','es','spa','portuguese','pt','por','romanian','ro','ron','rum','catalan','ca','cat',
  'german','de','deu','ger','dutch','nl','nld','dut','swedish','sv','swe','norwegian','no','nor',
  'danish','da','dan','finnish','fi','fin','icelandic','is','isl','ice','welsh','cy','cym','wel',
  'irish','ga','gle','polish','pl','pol','czech','cs','ces','cze','slovak','sk','slk','slo',
  'slovenian','sl','slv','croatian','hr','hrv','hungarian','hu','hun',
]);
function getModelForBook(book) {
  // Re-translation override: collapses happened on lite, so a fix run forces the
  // stronger model. --model=flash is the default recommendation for fixes.
  if (MODEL_OVERRIDE === 'flash') return MODEL_FLASH;
  if (MODEL_OVERRIDE === 'lite') return MODEL_LITE;
  if (book?.image_source?.provider === 'bph') return MODEL_FLASH;
  const lang = (book?.language || '').toLowerCase().trim();
  if (!lang || !LATIN_SCRIPT_LANGS_FOR_LITE.has(lang)) return MODEL_FLASH;
  return MODEL_LITE;
}

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
];

const API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);
let keyIdx = 0;
const aiClient = () => new GoogleGenerativeAI(API_KEYS[keyIdx++ % API_KEYS.length]);

function sanitizeTranslationTags(text) {
  if (!text) return text;
  return text
    .replace(/<(margin|gloss|insert|unclear|term|heading|footnote|caption)>([^<]*?)$/gm,
      (_, tag, content) => `<${tag}>${content}</${tag}>`)
    .replace(/<\/(margin|gloss|insert|unclear|term|heading|footnote|caption)>\s*<\/\1>/g,
      (_, tag) => `</${tag}>`);
}
const contentHash = t => createHash('sha256').update(t || '').digest('hex').slice(0, 16);

// ── collapse-guard body measurement (mirror of detect-translation-collapse.mjs) ──
const BLOCK_TAGS = ['meta','image-desc','vocab','summary','keywords','warning','note',
  'scan-quality','language','page-type','page-num','header','sig','insert','columns','script'];
const blockRe = new RegExp(`<(${BLOCK_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');
const looseRe = new RegExp(`</?(${BLOCK_TAGS.join('|')})\\b[^>]*>`, 'gi');
function bodyLen(text) {
  if (!text) return 0;
  return String(text).replace(blockRe, ' ').replace(looseRe, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/->|<-/g, ' ').replace(/\s+/g, ' ').trim().length;
}
// Collapse = the translation BODY is genuinely short in absolute terms (empty or
// a sliver). The absolute cap is essential: dense pages and pages with huge/
// artifact-inflated OCR have a low body RATIO but a perfectly adequate translation
// — they are NOT collapses. (Verified 2026-06-16: ratio-only flagged ~20% false
// positives from oversized OCR denominators.)
const COLLAPSE_ABS_CAP = 800;
const isCollapsed = (ocr, tr) => {
  const ob = bodyLen(ocr), tb = bodyLen(tr);
  if (ob < 400) return false;
  if (tb >= COLLAPSE_ABS_CAP) return false;
  return tb / ob < 0.3 || (/continued from previous page/i.test(tr || '') && tb < 60);
};
// Runaway / repetition loop: translation body far longer than its own OCR body.
// Body-based to avoid false positives on low-OCR pages (headers, image-only).
const isExcess = (ocr, tr) => {
  if ((tr || '').length > 20000) return true;
  const ob = bodyLen(ocr), tb = bodyLen(tr);
  return ob >= 300 && tb > ob * 3;
};
const isBad = (ocr, tr) => isCollapsed(ocr, tr) || isExcess(ocr, tr);
// Smaller = healthier. 0 when translation body ≈ OCR body.
const badnessScore = (ocr, tr) => {
  const ob = bodyLen(ocr) || 1, tb = bodyLen(tr) || 1;
  return Math.abs(Math.log(tb / ob));
};

let _prompt = null, _engPrompt = null;
async function loadPrompts(db) {
  if (!_prompt) _prompt = await db.collection('prompts').findOne({ type: 'translation', is_default: true }, { sort: { version: -1 } });
  if (!_engPrompt) _engPrompt = await db.collection('prompts').findOne({ type: 'english_modernization', is_default: true }, { sort: { version: -1 } });
  if (!_prompt?.content) throw new Error('No default translation prompt in DB');
}
function buildHeader(book) {
  const isEnglish = (book.language || '').toLowerCase() === 'english';
  const baseRef = isEnglish ? _engPrompt : _prompt;
  let prompt = baseRef.content.replace('{source_language}', book.language || 'Latin');
  const parts = [];
  if (book.display_title || book.title) parts.push(`Title: ${book.display_title || book.title}`);
  if (book.author) parts.push(`Author: ${book.author}`);
  if (book.year || book.published) parts.push(`Date: ${book.year || book.published}`);
  if (parts.length) prompt += `\n\n**Source work:** ${parts.join(' | ')}`;
  const year = parseInt(book.year || book.published, 10);
  if (year && year < 1930) prompt += `\n\n**Note:** This is a public domain work published in ${year}. It is not under copyright.`;
  return { prompt, isEnglish, baseRef };
}

async function translateOnce(page, book, prevTranslation) {
  const { prompt: header, isEnglish, baseRef } = buildHeader(book);
  let prompt = header + (isEnglish
    ? `\n\n**Text to modernize:**\n${page.ocr.data}`
    : `\n\n**Text to translate:**\n${page.ocr.data}`);
  if (prevTranslation) {
    prompt += isEnglish
      ? `\n\n**Previous page (modernized) for continuity:**\n${prevTranslation.slice(0, 2000)}...`
      : `\n\n**Previous page translation for continuity:**\n${prevTranslation.slice(0, 2000)}...`;
  }
  const model = aiClient().getGenerativeModel({ model: getModelForBook(book), safetySettings: SAFETY_SETTINGS });
  const result = await model.generateContent(prompt);
  return { text: sanitizeTranslationTags(result.response.text()), baseRef };
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

  let fixed = 0, stillBad = 0, skipped = 0, alreadyGood = 0, done = 0;

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
        const { text, baseRef } = await translateOnce(page, book, prevTr);
        if (!best || badnessScore(page.ocr.data, text) < badnessScore(page.ocr.data, best.text)) best = { text, baseRef };
        if (!isBad(page.ocr.data, text)) { best = { text, baseRef }; break; }
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
    if (isBad(page.ocr.data, best.text)) { stillBad++; return; }

    if (page.translation?.data) {
      await db.collection('page_revisions').insertOne({
        id: randomBytes(6).toString('hex'), page_id: page.id, book_id: page.book_id,
        field: 'translation', data: page.translation.data, source: page.translation.source || 'ai',
        model: page.translation.model, language: page.translation.language,
        prompt_version: page.translation.prompt_version, original_date: page.translation.updated_at,
        note: 'anomaly-fix', created_at: new Date(),
      }).catch(() => {});
    }
    await db.collection('pages').updateOne({ id: page.id }, { $set: {
      translation: {
        data: best.text, content_hash: contentHash(best.text), language: 'English',
        model, updated_at: new Date(), source: 'ai',
        prompt_version: String(best.baseRef?.version ?? 1), prompt_id: best.baseRef?._id?.toString(),
        prompt_hash: best.baseRef?.content_hash, prompt_name: best.baseRef?.name,
      },
      updated_at: new Date(),
    } });
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

  console.log(`\nDone. fixed=${fixed} stillBad=${stillBad} alreadyGood=${alreadyGood} skipped=${skipped}`);
}, { maxPoolSize: 12, noTimeout: true });

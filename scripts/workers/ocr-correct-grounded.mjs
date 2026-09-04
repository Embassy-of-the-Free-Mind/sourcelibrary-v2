#!/usr/bin/env node
/**
 * ocr-correct-grounded.mjs — second pass over MinerU OCR: correct it against the
 * page image with Gemini.
 *
 * THE LANE THIS COMPLETES
 * -----------------------
 * Gemini's RECITATION filter refuses to transcribe ubiquitous canonical texts
 * (NT/Galatians, Talmud, Migne, Hamlet), so those books stall. MinerU has no such
 * filter and is free — but it only reads modern print well. On pre-1820 typography
 * it produces three failure classes:
 *
 *   1. long s read as "f"      "firft finne"  ->  "first sinne"
 *   2. words run together       "knowledgeinclines"
 *   3. display type as soup     "qnore or0 FnT H Esi),bnim ymomu aor"
 *
 * Classes 1-2 are text-fixable. Class 3 is NOT — the characters were never read,
 * so a text-only "correction" would invent plausible words. That is why this pass
 * sends the PAGE IMAGE alongside the text: the model corrects against the scan and
 * genuinely re-reads what MinerU garbled. Verified on Bacon's *Advancement of
 * Learning* (1763) p119: MinerU's soup became "OF THE / DIGNITY AND ADVANCEMENT /
 * OF LEARNING.", matching the plate exactly.
 *
 * So the standard repair lane for a RECITATION-blocked book is:
 *     mineru-ocr-worker.mjs   (free, no filter, reads the page)
 *  -> ocr-correct-grounded.mjs (this: corrects against the image)
 *
 * SAFETY
 * ------
 *  - Dry-run by default; --apply to write.
 *  - Snapshots existing OCR to page_revisions before overwriting (reason
 *    'grounded_correction') — never silently replaces text.
 *  - Deterministic ſ->s normalisation AFTER the model, because the model does not
 *    reliably follow that instruction (2 of 3 pages in the pilot).
 *  - Refuses to write a "correction" that still carries long-s artefacts. A pass
 *    that quietly writes unimproved text is worse than no pass.
 *  - Only touches pages whose ocr.source is MinerU. Never overwrites Gemini OCR.
 *
 * USAGE
 *   node scripts/workers/ocr-correct-grounded.mjs --book <id>            # dry-run
 *   node scripts/workers/ocr-correct-grounded.mjs --book <id> --apply
 *   node scripts/workers/ocr-correct-grounded.mjs --pre-1820 --limit 5 --apply
 */
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { getPageSource } from '../lib/page-image-url.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { normalizeLongS, isCorrectionAcceptable, detectLongSArtefacts } from '../lib/early-modern-text.mjs';
import { logUsage, outputTokensFrom } from './lib/supabase-usage-logger.mjs';

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

const APPLY = flag('--apply');
const ONE_BOOK = opt('--book', null);
const PRE1820 = flag('--pre-1820');
const LIMIT = parseInt(opt('--limit', '1'), 10);
const PAGE_LIMIT = parseInt(opt('--page-limit', '0'), 10);
const MODEL = opt('--model', 'gemini-3.1-flash-lite');
const CONCURRENCY = parseInt(opt('--concurrency', '4'), 10);

const PROMPT = `You are correcting an existing OCR transcription of a printed page, using the page image as the authority.

The transcription came from a layout OCR engine that does not understand early-modern typography. Its known failure modes:
- the long s (ſ) is read as "f"  ("firft" for "first", "Herefy" for "Heresy")
- words run together ("knowledgeinclines", "OFLEARNING")
- decorative / display type on title pages comes out as garbage character soup

Your job:
1. Read the page image.
2. Return the page's text, using the supplied transcription as a starting point but CORRECTING it against what the image actually shows.
3. Where the supplied transcription is garbage, transcribe from the image instead.
4. Preserve the original spelling and punctuation EXACTLY as printed, with one exception: write the long s as a normal "s". Keep period spellings ("Consecration", "shewed", "Atheisme", "businesse", "individuall") — do NOT modernise them.
5. Preserve the printed line and paragraph structure, running heads, folio numbers, catchwords and signature marks.
6. If a passage is genuinely illegible in the image, output <unclear/> rather than guessing. Never invent text that you cannot see.

Output ONLY the corrected page text. No commentary, no code fences.

--- EXISTING TRANSCRIPTION ---
`;

const key = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY;
if (!key) { console.error('No Gemini API key in env'); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: key });

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 300000 });
await client.connect();
const db = client.db('bookstore');

let books;
if (ONE_BOOK) {
  books = await db.collection('books').find({ $or: [{ id: ONE_BOOK }, { _id: ONE_BOOK }] },
    { projection: { id: 1, _id: 1, title: 1, year: 1, visible: 1 } }).toArray();
} else {
  const bookIds = await db.collection('pages').distinct('book_id', { 'ocr.source': 'mineru' });
  const q = { id: { $in: bookIds }, ...(PRE1820 ? { year: { $lt: 1820 } } : {}) };
  books = await db.collection('books').find(q, { projection: { id: 1, title: 1, year: 1, visible: 1 } })
    .limit(LIMIT).toArray();
}
if (!books.length) { console.log('no matching books'); await client.close(); process.exit(0); }
console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} | model ${MODEL} | ${books.length} book(s)\n`);

async function correctPage(page, bookId) {
  const url = getPageSource(page);
  if (!url) return { skip: 'no image' };
  const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!resp.ok) return { skip: `image ${resp.status}` };
  const b64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
  const before = page.ocr.data;

  const r = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [
      { text: PROMPT + before.replace(/<[^>]+>/g, '').trim() + '\n--- END TRANSCRIPTION ---' },
      { inlineData: { mimeType: 'image/jpeg', data: b64 } },
    ]}],
    config: { temperature: 0.1, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } },
  });

  // An unattended worker that writes no usage row is money the dial cannot see
  // and no report can attribute (#4599). Logged before the acceptance check —
  // a rejected correction was still billed.
  await logUsage({
    type: 'ocr',
    mode: 'realtime',
    model: MODEL,
    book_id: bookId,
    page_ids: [String(page.id ?? page._id)],
    input_tokens: r.usageMetadata?.promptTokenCount || 0,
    output_tokens: outputTokensFrom(r.usageMetadata),
    status: 'success',
    endpoint: 'worker/ocr-correct-grounded',
  }, db);

  const finish = r.candidates?.[0]?.finishReason;
  let text = (r.text || '').trim();
  if (!text) return { skip: `empty output (${finish})`, finish };
  // The model does not reliably honour the ſ instruction — normalise deterministically.
  text = normalizeLongS(text);
  const verdict = isCorrectionAcceptable(text, before);
  return { text, verdict, finish, before };
}

let totals = { pages: 0, written: 0, rejected: 0, skipped: 0 };
for (const book of books) {
  const bid = book.id || String(book._id);
  const q = { book_id: bid, 'ocr.source': 'mineru', 'ocr.data': { $exists: true, $ne: '' } };
  let cur = db.collection('pages').find(q, { projection: {
    id: 1, page_number: 1, 'ocr.data': 1, cropped_photo: 1, archived_photo: 1,
    photo_original: 1, photo: 1, enhanced_photo: 1, split_from_spread: 1, crop: 1,
  }}).sort({ page_number: 1 });
  if (PAGE_LIMIT) cur = cur.limit(PAGE_LIMIT);
  const pages = await cur.toArray();
  if (!pages.length) { console.log(`  ${book.title?.slice(0, 50)} — no MinerU pages`); continue; }

  console.log(`[${book.year || '?'}] ${(book.title || '?').slice(0, 56)} — ${pages.length} MinerU pages ${book.visible ? '(VISIBLE)' : ''}`);
  let written = 0, rejected = 0, skipped = 0;

  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const chunk = pages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map(p => correctPage(p, bid)));
    for (let j = 0; j < chunk.length; j++) {
      const p = chunk[j], res = results[j];
      totals.pages++;
      if (res.status === 'rejected') { skipped++; totals.skipped++; console.log(`    p${p.page_number}: ERROR ${res.reason?.message?.slice(0, 70)}`); continue; }
      const v = res.value;
      if (v.skip) { skipped++; totals.skipped++; console.log(`    p${p.page_number}: skip — ${v.skip}`); continue; }
      if (!v.verdict.ok) {
        rejected++; totals.rejected++;
        console.log(`    p${p.page_number}: REJECTED — ${v.verdict.reason}`);
        continue;
      }
      if (APPLY) {
        await saveRevisionsBeforeOverwrite(db, [p.id], 'ocr', { reason: 'grounded_correction' });
        await db.collection('pages').updateOne({ id: p.id }, { $set: {
          'ocr.data': v.text,
          'ocr.source': 'mineru+gemini-grounded',
          'ocr.model': MODEL,
          'ocr.corrected_from': 'mineru',
          'ocr.updated_at': new Date(),
        }});
      }
      written++; totals.written++;
      if (written <= 2) {
        const b = detectLongSArtefacts(v.before), a = detectLongSArtefacts(v.text);
        console.log(`    p${p.page_number}: ok — long-s artefacts ${b.count} -> ${a.count}${APPLY ? '' : ' (dry-run)'}`);
      }
    }
  }
  console.log(`  => ${written} corrected, ${rejected} rejected, ${skipped} skipped\n`);
}

console.log(`TOTAL: ${totals.pages} pages | ${totals.written} ${APPLY ? 'written' : 'would write'} | ${totals.rejected} rejected | ${totals.skipped} skipped`);
if (!APPLY) console.log('(dry-run — re-run with --apply to write)');
await client.close();

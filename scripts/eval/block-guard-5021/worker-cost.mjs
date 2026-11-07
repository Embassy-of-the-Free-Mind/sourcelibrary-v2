#!/usr/bin/env node
// PRIOR ART: scripts/lib/model-pricing.mjs (prices, BATCH_MULTIPLIER) and pipeline-unit-prices.mjs (measured $/page per
// lane from billing; it has no row for a one-page-a-request Batch call carrying its neighbours). This prices the two
// worker shapes Derek asked to compare (#5021 inbox 2026-11-03) on the worker's own prompts, $0 and read-only.
/**
 * translate-worker: an 8-page realtime block (+ the anchor/structured rule) vs one page per Batch REQUEST with the
 * page before and after as read-only context (50% Batch price). Prompts are built by translate-core exactly as each
 * lane builds them; output is the page's stored English; tokens are estimated per script (Han and kana 1 token a
 * character, other non-Latin 0.6, Latin 0.28). Retries: refused pages cost one realtime single-page call each.
 *   node --env-file=.env.production.local scripts/eval/block-guard-5021/worker-cost.mjs [--books=30] [--refusal=0.01]
 */
import { MongoClient } from 'mongodb';
import { buildBlockTranslationPrompt, buildTranslationPrompt, loadTranslationPrompts, PAGE_BREAK_SCOPED, translateLaneForBook, getTranslateModelForBook } from '../../lib/translate-core.mjs';
import { structuredBlockRule } from '../../lib/block-page-guard.mjs';
import { MODEL_PRICING, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const tok = (s) => { let t = 0; for (const ch of String(s || '')) { const c = ch.codePointAt(0); t += (c >= 0x3040 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) ? 1 : c > 0x2af ? 0.6 : 0.28; } return t; };
const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = c.db('bookstore');
const prompts = await loadTranslationPrompts(db);
const N = Number(arg('books', 30)), REF = Number(arg('refusal', 0.01));
// Books the worker translates: Batch-routed (not a cli row), visible, with 10+ translated pages to price against.
const cand = await db.collection('books').aggregate([{ $match: { visible: true, pages_translated: { $gte: 12 } } }, { $sample: { size: 600 } }, { $project: { id: 1, language: 1, title: 1, publisher: 1, image_source: 1 } }]).toArray();
const rows = [];
for (const b of cand) {
  if (rows.length >= N) break;
  if (translateLaneForBook(b).channel !== 'batch') continue;
  const pages = await db.collection('pages').find({ book_id: b.id, 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' } }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1 }).limit(10).toArray();
  if (pages.length < 10 || pages[9].page_number - pages[0].page_number !== 9) continue;
  const block = pages.slice(1, 9);
  const model = getTranslateModelForBook(b);
  const price = MODEL_PRICING[model] || MODEL_PRICING['gemini-3.1-flash-lite'];
  const prev = pages[0].translation.data;
  const bp = buildBlockTranslationPrompt({ prompts, book: b, pages: block, previousTranslation: prev, prevOcrText: pages[0].ocr.data, nextOcrText: pages[9].ocr.data, pageBreak: PAGE_BREAK_SCOPED }).prompt + structuredBlockRule(block.map((p) => p.page_number));
  const out = block.reduce((s, p) => s + tok(p.translation.data) + 40, 0);
  const blockCost = (tok(bp) * price.input + out * price.output) / 1e6;
  let single = 0;
  block.forEach((p, i) => {
    const prior = i ? block[i - 1] : pages[0], after = i < 7 ? block[i + 1] : pages[9];
    const sp = buildTranslationPrompt({ prompts, book: b, ocrText: p.ocr.data, previousTranslation: prior.translation.data, prevOcrText: prior.ocr.data, nextOcrText: after.ocr.data, pageBreak: PAGE_BREAK_SCOPED });
    const text = typeof sp === 'string' ? sp : sp.prompt;
    // The neighbours as read-only context: both whole sources, as the request would carry them.
    single += ((tok(text) + tok(prior.ocr.data) + tok(after.ocr.data)) * price.input + tok(p.translation.data) * price.output) / 1e6;
  });
  const realtimeSingle = single / 8;   // a refused page re-read alone, realtime, without the Batch discount
  rows.push({ book: b.id, language: b.language, model, block_per_page: blockCost / 8 + REF * realtimeSingle, batch_single_per_page: (single / 8) * BATCH_MULTIPLIER });
}
const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
const byModel = {};
for (const r of rows) (byModel[r.model] ||= []).push(r);
console.log(`${rows.length} Batch-routed books, 8 pages each; refused pages re-read realtime at ${(REF * 100).toFixed(1)}%`);
console.log(`  8-page realtime block + structured rule: $${(mean('block_per_page') * 1000).toFixed(3)} per 1,000 pages... per page $${mean('block_per_page').toFixed(5)}`);
console.log(`  1 page per Batch request + neighbours:   per page $${mean('batch_single_per_page').toFixed(5)}`);
for (const [m, rs] of Object.entries(byModel)) console.log(`  ${m} (${rs.length} books): block $${(rs.reduce((s, r) => s + r.block_per_page, 0) / rs.length).toFixed(5)} vs batch-single $${(rs.reduce((s, r) => s + r.batch_single_per_page, 0) / rs.length).toFixed(5)} per page`);
await c.close();

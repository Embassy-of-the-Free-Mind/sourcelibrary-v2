#!/usr/bin/env node
/**
 * PLATE-FLIP RATE — a baseline metric for a prompt gap, measurable for free.
 *
 * The OCR prompt tells the model to "capture ALL text" AND to "describe any
 * illustrations with <image-desc>", and never says which applies to text printed
 * INSIDE a figure (label letters on an engraving, numerals on a diagram). Two
 * passes over one plate therefore decide differently, and the transcription goes
 * from a few hundred words to zero.
 *
 * Metric: among same-leaf true-repeat pairs where at least one side emitted an
 * <image-desc>, the share where one side produced ZERO body words while the
 * other produced >= MIN. One side saw text, the other saw only a picture.
 *
 * This is the baseline. Re-run it after a prompt change on re-OCR'd pages and
 * the number moves or the change did nothing.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/plate-flip-rate.mjs <corpus.jsonl> [--min=40]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import readline from 'readline';

const argv = process.argv.slice(2);
const JSONL = argv.find(a => !a.startsWith('--'));
const MIN = parseInt((argv.find(a => a.startsWith('--min=')) || '--min=40').split('=')[1]);

const rows = [];
const rl = readline.createInterface({ input: fs.createReadStream(JSONL) });
for await (const line of rl) {
  const x = JSON.parse(line);
  if (x.leaf_shift !== false) continue;                      // same leaf only
  if (!x.prior_model || x.prior_model !== x.current_model) continue;
  if (!x.prior_prompt || x.prior_prompt !== x.current_prompt) continue;
  if (x.prior_degenerate || x.current_degenerate || x.prior_refusal || x.current_refusal) continue;
  rows.push(x);
}
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
// Only pages where an illustration is in play at all — the population the gap
// can possibly affect. Scoping the denominator to it is the difference between
// a rate about plates and a rate diluted by every page in the corpus.
const stride = Math.max(1, Math.floor(rows.length / 6000));
const samp = rows.filter((_, i) => i % stride === 0).slice(0, 6000);
let withImg = 0, flips = 0, bothZero = 0;
const ex = [];
for (let i = 0; i < samp.length; i += 300) {
  const ch = samp.slice(i, i + 300);
  const ps = await db.collection('pages').find({ id: { $in: ch.map(r => r.page_id) } },
    { projection: { id: 1, 'ocr.data': 1 } }).maxTimeMS(120000).toArray();
  const m = new Map(ps.map(p => [p.id, p.ocr?.data || '']));
  for (const r of ch) {
    const t = m.get(r.page_id); if (!t) continue;
    if (!/<image-desc[ >]/i.test(t)) continue;
    withImg++;
    const lo = Math.min(r.body_words_prior, r.body_words_current);
    const hi = Math.max(r.body_words_prior, r.body_words_current);
    if (lo === 0 && hi === 0) { bothZero++; continue; }
    if (lo === 0 && hi >= MIN) {
      flips++;
      if (ex.length < 6) ex.push({ book: r.book_slug, page: r.page_number, words: [r.body_words_prior, r.body_words_current], agreement: r.agreement_primary });
    }
  }
}
await c.close();
console.log(`\nsame-leaf true-repeat pairs sampled: ${samp.length.toLocaleString()}`);
console.log(`  of those, page carries an <image-desc>: ${withImg.toLocaleString()}   <- the denominator that matters`);
console.log(`  both sides zero body words (pure plate, agreed): ${bothZero}`);
console.log(`\nPLATE-FLIP RATE: ${flips}/${withImg} = ${(100 * flips / withImg).toFixed(2)}% of illustrated pages`);
console.log(`  (one pass >= ${MIN} body words, the other exactly 0)\n`);
for (const e of ex) console.log(`   ${(e.book || '?').slice(0, 46).padEnd(46)} p${e.page} words=${e.words} agr=${e.agreement}`);

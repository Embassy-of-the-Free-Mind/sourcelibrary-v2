#!/usr/bin/env node
/**
 * Did this revision's text come from the page it sits on, or from a NEIGHBOUR?
 *
 * The problem this solves: the printed `<page-num>` identifies which leaf a pass
 * read, but it is absent on 39% of ocr rows and 98% of translation rows, so
 * ~23,130 otherwise-usable "rescued" pairs have no provenance signal at all
 * (#3473). Those pairs were excluded from the true-repeat corpus purely for
 * being unmeasurable, and that exclusion is biased: a page whose printed number
 * the model cannot read is a page it is struggling with, i.e. exactly the hard
 * material a quality study wants.
 *
 * THE TEST. Compare the prior revision's text against its own page's live text
 * AND against the live text of pages N-1 and N+1. If a neighbour matches better,
 * the prior belonged to a different leaf. Needs no printed number, no timestamp,
 * and no metadata — the pages' own text is the instrument, and no writer
 * controls it.
 *
 * MEASURED 2026-08-05, n=190 usable of 200 sampled, stratified across five
 * agreement bands:
 *
 *   same leaf (own page wins)          180   94.7%
 *   SHIFTED (neighbour wins by >0.15)    3    1.6%
 *   ambiguous                            7    3.7%
 *
 * So the rescued population is overwhelmingly genuine. **But the failures
 * concentrate at the bottom**: in the 0–0.3 agreement band it is 77% same / 5%
 * shifted / 18% ambiguous, and that band is precisely where the unstable pages
 * live. Quote 94.7% for the population and the band figure for the unstable arm;
 * they are not the same claim.
 *
 * WHAT THIS DOES NOT ANSWER. It compares against ±1 only, so a larger offset
 * reads as "same leaf" by default — it under-reports rather than over-reports.
 * And it needs the neighbours to have live text; pages at a book's edges and
 * un-OCR'd neighbours land in `unusable`, never in `same`.
 *
 * Free — Mongo reads and local compute, no model calls.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/neighbour-leaf-test.mjs <corpus.jsonl> [--n=200]
 */
import fs from 'fs';
import readline from 'readline';
import { MongoClient } from 'mongodb';
import { rowIsMaintenance } from './lib/revision-source.mjs';
import { agreementPrimary } from './lib/metrics.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const JSONL = process.argv.slice(2).find(a => !a.startsWith('--'));
const N = parseInt(args.n || '200');
const MIN_WORDS = 80;
// A neighbour must beat the page's own text by this much to count as a shift.
// Below it the two are within ordinary re-read noise and the call is ambiguous.
const MARGIN = 0.15;
const BANDS = [[0, 0.3], [0.3, 0.6], [0.6, 0.85], [0.85, 0.97], [0.97, 1.01]];

const common = x => x.eligibility === 'eligible' &&
  x.prior_model && x.prior_model === x.current_model &&
  x.prior_prompt && x.prior_prompt === x.current_prompt &&
  !x.prior_degenerate && !x.current_degenerate &&
  !x.prior_refusal && !x.current_refusal &&
  !x.prior_meta && !x.current_meta && !x.near_zero_overlap &&
  Math.min(x.body_words_prior, x.body_words_current) >= MIN_WORDS;

let seed = parseInt(args.seed || '17');
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

async function main() {
  if (!JSONL || !fs.existsSync(JSONL)) throw new Error('pass the corpus JSONL path');
  const rescued = [];
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let x; try { x = JSON.parse(line); } catch { continue; }
    if (!common(x) || rowIsMaintenance(x)) continue;
    if (x.leaf_shift == null) rescued.push(x);      // the unmeasurable stratum
  }
  console.log(`rescued pairs (no printed number, not maintenance): ${rescued.length}`);

  // Stratify, so the check is not dominated by the easy high-agreement end.
  const per = Math.ceil(N / BANDS.length);
  const pick = [];
  for (const [lo, hi] of BANDS) {
    const inBand = rescued.filter(r => r.agreement_primary >= lo && r.agreement_primary < hi);
    pick.push(...inBand.map(r => [rand(), r]).sort((a, b) => a[0] - b[0]).slice(0, per)
      .map(r => ({ ...r[1], band: `${lo}-${hi}` })));
  }
  console.log(`sampled ${pick.length} across ${BANDS.length} agreement bands`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const PAGES = db.collection('pages'), REVS = db.collection('page_revisions');

  const out = { same: 0, shifted: 0, ambiguous: 0, unusable: 0 };
  const byBand = {};
  for (const p of pick) {
    const self = await PAGES.findOne({ id: p.page_id },
      { projection: { page_number: 1, book_id: 1, 'ocr.data': 1 } });
    if (!self || typeof self.page_number !== 'number' || !self.ocr?.data) { out.unusable++; continue; }
    const rev = await REVS.find({ page_id: p.page_id, field: 'ocr' }).sort({ created_at: -1 }).limit(1).next();
    if (!rev?.data) { out.unusable++; continue; }

    const neighbours = await PAGES.find(
      { book_id: self.book_id, page_number: { $in: [self.page_number - 1, self.page_number + 1] } },
      { projection: { page_number: 1, 'ocr.data': 1 } },
    ).toArray();

    const aSelf = agreementPrimary(rev.data, self.ocr.data) ?? 0;
    let aBest = -1;
    for (const n of neighbours) {
      if (!n.ocr?.data) continue;
      const a = agreementPrimary(rev.data, n.ocr.data) ?? 0;
      if (a > aBest) aBest = a;
    }
    const b = (byBand[p.band] = byBand[p.band] || { same: 0, shifted: 0, ambiguous: 0 });
    if (aBest > aSelf + MARGIN) { out.shifted++; b.shifted++; }
    else if (aSelf >= aBest) { out.same++; b.same++; }
    else { out.ambiguous++; b.ambiguous++; }
  }
  await client.close();

  const tot = out.same + out.shifted + out.ambiguous;
  const pc = x => (tot ? `${(100 * x / tot).toFixed(1)}%` : '—');
  console.log('\nDoes the prior text match its OWN page, or a neighbour?');
  console.log(`  same leaf (own page wins)        : ${out.same}  ${pc(out.same)}`);
  console.log(`  SHIFTED (neighbour wins by >${MARGIN}) : ${out.shifted}  ${pc(out.shifted)}`);
  console.log(`  ambiguous                        : ${out.ambiguous}  ${pc(out.ambiguous)}`);
  console.log(`  unusable (edge page / no text)   : ${out.unusable}`);
  console.log('\nby agreement band — read the LOW band before adopting anything:');
  for (const [k, v] of Object.entries(byBand)) console.log(`  ${k.padEnd(12)} ${JSON.stringify(v)}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });

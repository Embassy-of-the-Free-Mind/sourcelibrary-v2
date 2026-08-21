#!/usr/bin/env node
/**
 * Does the `marginalia` condition flag actually detect marginalia? (#3444)
 *
 * The prompt ablation measures a FIRING RATE on the 44 pinned ground-truth pages,
 * which exist for reference-etext coverage. A firing rate is neither precision nor
 * recall, and `marginalia` fired twice in that study's first 96 rows. This study
 * measures precision and recall directly, on a sample built for the purpose.
 *
 * THE SAMPLING TRAP, and why this script does not take the easy path:
 * the obvious positive sample is "pages whose stored OCR contains <margin>". But
 * that field is ITSELF model output, so selecting on it selects pages where the
 * model ALREADY SUCCEEDED. It can show whether an intervention beats what
 * single-page OCR already found; it cannot surface pages where marginalia was
 * missed entirely — the failure that matters.
 *
 * `page_revisions` breaks the circularity. It stores the text each re-OCR
 * REPLACED, so every page with a revision has two independent transcription
 * attempts. Where they DISAGREE about marginalia, one of them provably missed
 * marginal text the other found:
 *
 *   HARD POSITIVE  one pass found <margin>, the other did not.
 *                  Presence is established by a pass other than the one being
 *                  scored, and the disagreement proves the page is hard.
 *   NEGATIVE       both passes agree there is no marginal text. Weaker evidence
 *                  (both could be wrong together), but it is the strongest
 *                  reference-free negative available, and it is what precision
 *                  requires.
 *
 * Pages where both passes agree marginalia IS present are deliberately excluded:
 * they are easy positives and would inflate recall.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/condition-validation.mjs --dry-run --sample=40
 *   node scripts/eval/condition-validation.mjs --models=lite --sample=40
 *
 *   --sample=N   pages per class (default 30); total calls = 2N × models × runs
 *   --arm=C|D2   C = the full OCR prompt with required conditions (default);
 *                D2 = classify-only, the cheaper second-call form
 *   --dry-run    cost estimate only
 */

import { loadEnv, getPage, disconnect } from './lib/sampling.mjs';
import { runModel, resolveModel, fetchImage } from './lib/runners.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { priceFor } from '../lib/model-pricing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

const args = Object.fromEntries(process.argv.slice(2)
  .filter(a => a.startsWith('--'))
  .map(a => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));

const SAMPLE = parseInt(args.sample || '30');
const MODELS = (args.models || 'lite').split(',').map(resolveModel);
const RUNS = parseInt(args.runs || '1');
const ARM = (args.arm || 'C').toUpperCase();
const PROMPT_FILE = ARM === 'D2' ? 'D2-classify-only.txt' : 'C-required-conditions.txt';

const hasMargin = t => /<margin>/i.test(t || '');

/**
 * Build the two classes from disagreeing revision pairs.
 *
 * Only the MOST RECENT revision per page is used. A page re-OCR'd several times
 * has several superseded texts, and pooling them would weight heavily-reprocessed
 * pages more than others — the same trap as counting revision pairs rather than
 * pages.
 */
async function buildSamples(db) {
  const revs = db.collection('page_revisions');
  const pages = db.collection('pages');

  // Newest revision per page, bounded — a full scan of 191K revisions is not
  // needed to fill a sample of a few dozen per class.
  const recent = await revs.find({ field: 'ocr' },
    { projection: { page_id: 1, data: 1, created_at: 1 }, limit: 12000 })
    .sort({ _id: -1 }).maxTimeMS(120000).toArray();

  const seen = new Set();
  const hardPositive = [], negative = [];
  for (const r of recent) {
    if (seen.has(r.page_id)) continue;   // keep only the newest per page
    seen.add(r.page_id);
    if (hardPositive.length >= SAMPLE * 3 && negative.length >= SAMPLE * 3) break;

    const page = await pages.findOne({ id: r.page_id },
      { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, photo: 1, display_photo: 1, archived_photo: 1, photo_original: 1, crop: 1 } });
    if (!page?.ocr?.data) continue;

    const oldHas = hasMargin(r.data), newHas = hasMargin(page.ocr.data);
    // Disagreement = one pass missed what the other found. Presence is evidenced
    // by a pass other than the one we are about to score.
    if (oldHas !== newHas) {
      if (hardPositive.length < SAMPLE * 3) hardPositive.push({ page, evidence: oldHas ? 'lost' : 'gained' });
    } else if (!oldHas && !newHas) {
      // Require real text, or "no marginalia" is trivially true of a blank page.
      if (page.ocr.data.length > 400 && negative.length < SAMPLE * 3) negative.push({ page, evidence: 'both-none' });
    }
    // both-present is deliberately DROPPED: an easy positive inflates recall.
  }
  return { hardPositive, negative };
}

function parseConditions(text) {
  const m = text.match(/<page-conditions>([\s\S]*?)<\/page-conditions>/i);
  if (!m) return { present: false, terms: null };
  const terms = m[1].toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  return { present: true, terms: (terms.length === 1 && terms[0] === 'none') ? [] : terms };
}

async function main() {
  const prompt = fs.readFileSync(path.join(__dirname, 'prompts', 'ablation', PROMPT_FILE), 'utf8');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`\n  Building samples from disagreeing revision pairs…`);
  const { hardPositive, negative } = await buildSamples(db);
  const pos = hardPositive.slice(0, SAMPLE), neg = negative.slice(0, SAMPLE);
  console.log(`    hard positives: ${pos.length} (one pass found marginalia, the other missed it)`);
  console.log(`    negatives:      ${neg.length} (both passes agree: none)`);
  if (!pos.length || !neg.length) {
    console.error('  Not enough pages in one class — widen the revision scan.');
    await client.close(); await disconnect(); return;
  }

  const totalCalls = (pos.length + neg.length) * MODELS.length * RUNS;
  const IN = 3272, OUT = ARM === 'D2' ? 40 : 444;
  let total = 0;
  console.log(`\n  ${totalCalls} calls (arm ${ARM}):`);
  for (const m of MODELS) {
    const p = priceFor(m);
    const usd = (pos.length + neg.length) * RUNS * (IN / 1e6 * p.input + OUT / 1e6 * p.output);
    total += usd;
    console.log(`    ${m.padEnd(26)} ~$${usd.toFixed(3)}`);
  }
  console.log(`    ${'TOTAL'.padEnd(26)} ~$${total.toFixed(2)}\n`);
  if (args['dry-run']) { console.log('  (dry run — no API calls)\n'); await client.close(); await disconnect(); return; }

  const outFile = path.join(__dirname, 'results', `condition-validation-${new Date().toISOString().slice(0, 10)}.jsonl`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const rows = [];

  for (const [cls, items] of [['positive', pos], ['negative', neg]]) {
    for (const { page, evidence } of items) {
      const url = getPageSource(page);
      if (!url) continue;
      let buf;
      try { buf = await fetchImage(url); } catch { continue; }
      for (const model of MODELS) {
        for (let i = 0; i < RUNS; i++) {
          await new Promise(r => setTimeout(r, 200));
          try {
            const res = await runModel(model, buf, prompt, { maxTokens: ARM === 'D2' ? 2000 : 16000 });
            const c = parseConditions(res.text);
            const row = {
              pageId: page.id, bookId: page.book_id, pageNumber: page.page_number,
              class: cls, evidence, model, arm: ARM, run: i + 1,
              conditionsPresent: c.present,
              flaggedMarginalia: c.terms?.includes('marginalia') ?? false,
              // The transcription-side check: did it also TAG the marginal text?
              // Asserting presence without tagging it is a self-contradiction the
              // worker could catch at write time.
              marginTags: (res.text.match(/<margin>/gi) || []).length,
              conditions: c.terms, costUsd: res.costUsd,
            };
            rows.push(row);
            fs.appendFileSync(outFile, JSON.stringify({ ...row, text: res.text }) + '\n');
            console.log(`  ${cls.padEnd(8)} ${String(page.page_number).padStart(4)} ${model.slice(0, 20).padEnd(20)} flag=${row.flaggedMarginalia ? 'YES' : ' no'}  tags=${row.marginTags}  (${evidence})`);
          } catch (e) {
            console.log(`  ! ${page.id} × ${model}: ${String(e.message).slice(0, 90)}`);
          }
        }
      }
    }
  }

  // ── Precision / recall, per model ──
  console.log(`\n  MARGINALIA FLAG — precision & recall\n`);
  console.log(`  ${'Model'.padEnd(26)} ${'recall'.padStart(8)} ${'precis'.padStart(8)} ${'spec'.padStart(8)}  (n+ / n−)`);
  console.log('  ' + '─'.repeat(66));
  const summary = [];
  for (const model of MODELS) {
    const P = rows.filter(r => r.model === model && r.class === 'positive');
    const N = rows.filter(r => r.model === model && r.class === 'negative');
    if (!P.length || !N.length) continue;
    const tp = P.filter(r => r.flaggedMarginalia).length;
    const fn = P.length - tp;
    const fp = N.filter(r => r.flaggedMarginalia).length;
    const tn = N.length - fp;
    const recall = tp / (tp + fn);
    const precision = (tp + fp) ? tp / (tp + fp) : null;
    const specificity = tn / (tn + fp);
    summary.push({ model, tp, fn, fp, tn, recall, precision, specificity });
    const pc = v => v === null ? '   n/a' : (v * 100).toFixed(1) + '%';
    console.log(`  ${model.slice(0, 25).padEnd(26)} ${pc(recall).padStart(8)} ${pc(precision).padStart(8)} ${pc(specificity).padStart(8)}  (${P.length} / ${N.length})`);
  }
  console.log(`\n  recall      = of pages that provably HAVE marginalia, how many did the flag catch`);
  console.log(`  precision   = of pages the flag called marginal, how many really are`);
  console.log(`  specificity = of pages with none, how many the flag correctly left alone`);
  console.log(`\n  A flag that fires on everything shows high recall and LOW specificity —`);
  console.log(`  read both or the vacuous case looks like success.\n`);

  // Self-contradiction: asserted marginalia without tagging any.
  for (const model of MODELS) {
    const said = rows.filter(r => r.model === model && r.flaggedMarginalia);
    if (!said.length) continue;
    const noTags = said.filter(r => r.marginTags === 0).length;
    console.log(`  ${model.slice(0, 25).padEnd(26)} asserted marginalia but tagged none: ${noTags}/${said.length}`);
  }

  fs.writeFileSync(path.join(__dirname, 'results', `condition-validation-summary-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify({ date: new Date().toISOString(), arm: ARM, models: MODELS, sample: SAMPLE, summary, rows }, null, 2));
  console.log(`\n  Raw → ${path.relative(process.cwd(), outFile)}\n`);
  await client.close();
  await disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

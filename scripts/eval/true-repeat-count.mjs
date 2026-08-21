#!/usr/bin/env node
/**
 * How many TRUE REPEATS does a corpus JSONL contain, and what does excluding
 * bulk-maintenance rows do to that count? (#3473)
 *
 * The headline "63,572 true repeats" is not a field in the corpus summary — it
 * is whatever survives the selection filters in `repeat-instability-draw.mjs`.
 * So the only honest before/after applies THOSE filters, with and without the
 * `source`-based exclusion, to the same file. This script mirrors them exactly;
 * if the draw script's filters change, change them here too or the comparison
 * silently stops meaning anything.
 *
 * Reports the two counts, the delta, and — the number that actually decides
 * whether the change was right — how many pairs the `source` label RESCUES:
 * rows that print no page number on one side (so `leaf_shift` is null and the
 * old filter dropped them outright) but whose source proves they are a genuine
 * reading.
 *
 * Free, local only, no Mongo and no model calls.
 *
 *   node scripts/eval/true-repeat-count.mjs <corpus.jsonl>
 */
import fs from 'fs';
import readline from 'readline';
import { rowIsMaintenance } from './lib/revision-source.mjs';

const JSONL = process.argv.slice(2).find(a => !a.startsWith('--'));
const MIN_WORDS = 80, UNSTABLE_MAX = 0.85, STABLE_MIN = 0.97;

// Every filter from repeat-instability-draw.mjs EXCEPT the two under test
// (maintenance exclusion, and the same-leaf requirement).
const passesCommon = x =>
  x.eligibility === 'eligible' &&
  x.prior_model && x.prior_model === x.current_model &&
  x.prior_prompt && x.prior_prompt === x.current_prompt &&
  !x.prior_degenerate && !x.current_degenerate &&
  !x.prior_refusal && !x.current_refusal &&
  !x.prior_meta && !x.current_meta &&
  !x.near_zero_overlap &&
  Math.min(x.body_words_prior, x.body_words_current) >= MIN_WORDS;

const arm = x => x.agreement_primary < UNSTABLE_MAX ? 'unstable'
  : x.agreement_primary >= STABLE_MIN ? 'stable' : null;

if (!JSONL || !fs.existsSync(JSONL)) { console.error('pass the corpus JSONL path'); process.exit(1); }

const c = {
  rows: 0, common: 0,
  oldFilter: 0,                 // same-leaf only (what produced 63,572)
  newFilter: 0,                 // not-maintenance AND same-leaf
  newFilterLeafAgnostic: 0,     // not-maintenance, leaf_shift not required
  rescued: 0,                   // reading source, but leaf_shift was null
  droppedAsMaintenance: 0,      // were in the old count, now excluded
  armed: { unstable: 0, stable: 0 },
};

const rl = readline.createInterface({ input: fs.createReadStream(JSONL) });
for await (const line of rl) {
  if (!line.trim()) continue;
  c.rows++;
  let x; try { x = JSON.parse(line); } catch { continue; }
  if (!passesCommon(x)) continue;
  c.common++;
  const maint = rowIsMaintenance(x);
  const sameLeaf = x.leaf_shift === false;

  if (sameLeaf) c.oldFilter++;
  if (!maint && sameLeaf) c.newFilter++;
  if (!maint && x.leaf_shift !== true) {
    c.newFilterLeafAgnostic++;
    if (x.leaf_shift == null) c.rescued++;
  }
  if (maint && sameLeaf) c.droppedAsMaintenance++;
  if (!maint && sameLeaf) { const a = arm(x); if (a) c.armed[a]++; }
}

const pc = (x, d) => (d ? `${(100 * x / d).toFixed(2)}%` : '—');
console.log(`\ncorpus rows                                  : ${c.rows.toLocaleString()}`);
console.log(`passing the non-leaf, non-source filters     : ${c.common.toLocaleString()}`);
console.log('');
console.log('TRUE-REPEAT POPULATION');
console.log(`  BEFORE  same-leaf only                     : ${c.oldFilter.toLocaleString()}`);
console.log(`  AFTER   same-leaf AND not maintenance      : ${c.newFilter.toLocaleString()}   (${c.droppedAsMaintenance.toLocaleString()} dropped as sweeps, ${pc(c.droppedAsMaintenance, c.oldFilter)})`);
console.log(`  AFTER   not maintenance, leaf-agnostic     : ${c.newFilterLeafAgnostic.toLocaleString()}   (+${c.rescued.toLocaleString()} rescued that print no page number)`);
console.log('');
console.log(`  net vs BEFORE, leaf-agnostic               : ${c.newFilterLeafAgnostic - c.oldFilter >= 0 ? '+' : ''}${(c.newFilterLeafAgnostic - c.oldFilter).toLocaleString()}`);
console.log(`  arms within the strict AFTER set           : unstable ${c.armed.unstable.toLocaleString()} / stable ${c.armed.stable.toLocaleString()}`);
console.log('');
console.log('Expectation stated before the run (#3475): the leaf-agnostic count should GROW,');
console.log('because `source` classifies pairs the printed-number test has to give up on.');
console.log(c.newFilterLeafAgnostic > c.oldFilter
  ? '  -> GREW. Consistent with the prediction.'
  : '  -> DID NOT GROW. The change needs re-examining before anything is built on it.');

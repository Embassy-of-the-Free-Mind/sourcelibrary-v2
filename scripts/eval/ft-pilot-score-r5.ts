#!/usr/bin/env npx tsx
/**
 * Score a #2880 pilot round and project the corpus estimate.
 *
 * WHAT IS AND IS NOT CALIBRATED — read this before quoting any number it prints.
 *
 * Rounds 1-4 measured the genuine-first rate with an ORACLE (unprimed Claude
 * subagents) as ground truth, 52 books per stratum. That is the estimator the
 * corpus figure rests on.
 *
 * Round 5 runs Tier-1 (grounded Gemini) over a much larger sample. Tier 1 is
 * NOT ground truth: rounds 1-4 measured it at precision(first) ~85% and
 * recall(first) ~83%. So this script reports Tier-1's raw per-stratum rate
 * alongside the oracle rate, and the agreement between them on the books where
 * both ran. It deliberately does NOT silently substitute Tier 1 for the oracle.
 *
 * Usage:
 *   node --env-file=.env.production.local ./node_modules/.bin/tsx \
 *     scripts/eval/ft-pilot-score-r5.ts
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { estimateCorpus, wilsonInterval } from '@/lib/first-translation/inference';

const MANIFEST = 'scripts/eval/results/ft-pilot-sample-r5-2026-08-31.json';

/** Population per stratum, measured 2026-08-31 over the live eligible pool. */
const POP: Record<string, number> = {
  'badged | western': 4001,
  'badged | non-western': 1790,
  'unbadged | western': 7537,
  'unbadged | non-western': 2823,
};

/** #2880 rounds 1-4 cumulative, oracle-labeled, n=52 per stratum. */
const ORACLE_R14: Record<string, { n: number; genuine: number }> = {
  'badged | western': { n: 52, genuine: 39 },
  'badged | non-western': { n: 52, genuine: 38 },
  'unbadged | western': { n: 52, genuine: 23 },
  'unbadged | non-western': { n: 52, genuine: 17 },
};

/** Tier-1 grounded result -> is this book a first? null = excluded from the base. */
function tier1IsFirst(result: string): boolean | null {
  if (result === 'found') return false;             // a prior was located
  if (result === 'none' || result === 'not_found') return true; // no prior located
  return null;                                       // not_applicable / na / unknown
}

async function main() {
const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const stratumOf = new Map<string, string>();
for (const s of man.manifest) for (const b of s.sampled) stratumOf.set(String(b.id), s.stratum);

const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();
const att = client.db('bookstore').collection('first_translation_attempts');

// Latest grounded row per book (the ledger is append-only; the newest wins).
const rows = await att.find(
  { book_id: { $in: [...stratumOf.keys()] }, method: 'gemini_grounded_search' },
  { projection: { book_id: 1, result: 1, date: 1 } },
).sort({ date: 1 }).toArray();
const latest = new Map<string, string>();
for (const r of rows) latest.set(String(r.book_id), r.result);

const tally: Record<string, { first: number; notFirst: number; excluded: number; missing: number }> = {};
for (const key of Object.keys(POP)) tally[key] = { first: 0, notFirst: 0, excluded: 0, missing: 0 };
for (const [id, stratum] of stratumOf) {
  const t = tally[stratum];
  if (!t) continue;
  const res = latest.get(id);
  if (!res) { t.missing++; continue; }
  const v = tier1IsFirst(res);
  if (v === null) t.excluded++;
  else if (v) t.first++;
  else t.notFirst++;
}

console.log('=== ROUND 5, TIER 1 (grounded Gemini) — raw per-stratum rates ===');
console.log('NOT ground truth. Tier 1 measured at precision(first) ~85%, recall ~83% in rounds 1-4.\n');
console.log('stratum                     N     n(scored)  first%   [95% Wilson]     excluded  no-row');
for (const [key, N] of Object.entries(POP)) {
  const t = tally[key];
  const n = t.first + t.notFirst;
  const p = n ? t.first / n : 0;
  const [lo, hi] = wilsonInterval(t.first, n);
  console.log(
    `${key.padEnd(24)} ${String(N).padStart(5)}   ${String(n).padStart(6)}     ${(p * 100).toFixed(1).padStart(5)}%  ` +
    `[${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}]   ${String(t.excluded).padStart(6)}  ${String(t.missing).padStart(6)}`,
  );
}

console.log('\n=== CORPUS ESTIMATE from the ORACLE rates (rounds 1-4, n=52/stratum) ===');
const est = estimateCorpus(Object.keys(POP).map((k) => ({
  key: k, size: POP[k], sampled: ORACLE_R14[k].n,
  falseFirsts: ORACLE_R14[k].n - ORACLE_R14[k].genuine,
})));
for (const s of est.strata) {
  const g = (1 - s.falseRate) * 100;
  const lo = (1 - s.falseRateCI[1]) * 100, hi = (1 - s.falseRateCI[0]) * 100;
  console.log(`${s.key.padEnd(24)} genuine ${g.toFixed(1).padStart(5)}%  [${lo.toFixed(1)}–${hi.toFixed(1)}]  → ${s.correctedFirsts.toFixed(0).padStart(6)}`);
}
console.log(`\nPOINT ESTIMATE : ${Math.round(est.estimatedFirsts)}`);
console.log(`95% CI         : ${Math.round(est.ci[0])} – ${Math.round(est.ci[1])} (±${Math.round(est.ciHalfWidth)})`);
console.log(`raw pool       : ${est.rawTotal}`);

console.log('\n=== TIER-1 vs ORACLE, side by side ===');
console.log('A large gap means Tier 1 is biased in that stratum and its raw rate must not be');
console.log('read as the corpus rate. Round 5\'s oracle subset is too small to re-fit the');
console.log('calibration; that is what the remaining oracle books are for.');
for (const key of Object.keys(POP)) {
  const t = tally[key];
  const n = t.first + t.notFirst;
  const t1 = n ? (t.first / n) * 100 : NaN;
  const or = (ORACLE_R14[key].genuine / ORACLE_R14[key].n) * 100;
  console.log(`${key.padEnd(24)} tier1 ${t1.toFixed(1).padStart(5)}% (n=${n})   oracle ${or.toFixed(1).padStart(5)}% (n=52)   Δ ${(t1 - or >= 0 ? '+' : '')}${(t1 - or).toFixed(1)}pp`);
}

await client.close();
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});

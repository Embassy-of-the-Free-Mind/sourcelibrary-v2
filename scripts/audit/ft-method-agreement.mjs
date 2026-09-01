#!/usr/bin/env node
/**
 * Do two first-translation search methods agree, on the SAME books?
 *
 * WHY (#4525)
 * -----------
 * `gemini_verifier` produced most of the corpus's prior-translation evidence
 * (~57K rows). Its raw found-rate is 44.9% against `gemini_grounded_search`'s
 * 23.0% — but the two ran on different populations, so the raw gap proves
 * nothing. Restricting to books BOTH judged removes the confound:
 *
 *   books judged by both ............... 5,534
 *   both say a prior exists ........... 1,243  (22.5%)
 *   both say no prior ................. 2,681  (48.4%)
 *   verifier FOUND, grounded NONE ..... 1,424  (25.7%)
 *   grounded FOUND, verifier NONE .....   186   (3.4%)
 *   agreement ......................... 70.9%
 *   asymmetry ......................... 7.7x
 *
 * The verifier claims priors that grounded search cannot find, 7.7 times more
 * often than the reverse, on identical books. Its rows DO carry queries (95.2%)
 * and sources — they are recorded, not necessarily executed. Query strings look
 * like retrieval and behave like recall.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS: a false "found" does not show up as a
 * visible error. It silently SUPPRESSES a first — the book simply stops being
 * claimed. So this bias depresses the badge count invisibly, which is why the
 * sampled corpus estimate (~8,565) sits so far above what we badge (~5,000).
 *
 * THE GENERAL RULE: never compare two instruments on their own populations.
 * A method that runs corpus-wide and a method that runs on a curated queue have
 * different base rates by construction, and the difference will look like
 * accuracy. Pair them on shared items or measure nothing.
 *
 * READ ONLY.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/ft-method-agreement.mjs
 *   node --env-file=.env.production.local scripts/audit/ft-method-agreement.mjs \
 *     --a=gemini_verifier --b=claude_subagent_verify
 */
import { MongoClient } from 'mongodb';

const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const A = arg('a', 'gemini_verifier');
const B = arg('b', 'gemini_grounded_search');

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const att = c.db('bookstore').collection('first_translation_attempts');

const rolled = await att.aggregate([
  { $match: { method: { $in: [A, B] }, result: { $in: ['found', 'none', 'not_found'] } } },
  { $project: { book_id: 1, method: 1, found: { $eq: ['$result', 'found'] } } },
  { $group: {
      _id: '$book_id',
      aTotal: { $sum: { $cond: [{ $eq: ['$method', A] }, 1, 0] } },
      aFound: { $sum: { $cond: [{ $and: [{ $eq: ['$method', A] }, '$found'] }, 1, 0] } },
      bTotal: { $sum: { $cond: [{ $eq: ['$method', B] }, 1, 0] } },
      bFound: { $sum: { $cond: [{ $and: [{ $eq: ['$method', B] }, '$found'] }, 1, 0] } },
  } },
  { $match: { aTotal: { $gt: 0 }, bTotal: { $gt: 0 } } },
], { allowDiskUse: true }).toArray();

let both = 0, neither = 0, aOnly = 0, bOnly = 0;
for (const r of rolled) {
  const a = r.aFound > 0, b = r.bFound > 0;
  if (a && b) both++; else if (!a && !b) neither++; else if (a) aOnly++; else bOnly++;
}
const n = rolled.length;
if (!n) { console.log(`no books judged by both ${A} and ${B}`); await c.close(); process.exit(0); }
const pc = (x) => `${((100 * x) / n).toFixed(1)}%`;
console.log(`A = ${A}\nB = ${B}\nbooks judged by BOTH: ${n}\n`);
console.log(`  both FOUND a prior     : ${both} (${pc(both)})`);
console.log(`  both found NONE        : ${neither} (${pc(neither)})`);
console.log(`  A found, B none        : ${aOnly} (${pc(aOnly)})`);
console.log(`  B found, A none        : ${bOnly} (${pc(bOnly)})`);
console.log(`\n  agreement              : ${pc(both + neither)}`);
console.log(`  asymmetry (A-only / B-only): ${bOnly ? (aOnly / bOnly).toFixed(1) : '∞'}x`);
console.log(`\n  A found-rate on shared set: ${pc(both + aOnly)}`);
console.log(`  B found-rate on shared set: ${pc(both + bOnly)}`);
console.log('\nA disagreement asymmetry well above 1 means the higher-claiming method is');
console.log('over-reporting priors — and every false "found" suppresses a first.');
await c.close();

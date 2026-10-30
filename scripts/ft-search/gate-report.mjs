#!/usr/bin/env node
// PRIOR ART: none in the repo. scripts/ft-search/ingest.mjs reads results.jsonl to write; this only compares
// a representative's verdict with its siblings' own verdicts (the one-search-per-work gate, #7598).
//
// Read-only. After `select-batch.mjs --gate 50 --out <dir>`, run-batch.sh and parse-results.py:
//   node scripts/ft-search/gate-report.mjs <dir>
// Propagation copies a representative's none_found to its siblings. So the question is: of the siblings whose
// representative said none_found, how many did their OWN search also call none_found? A sibling that finds a
// prior or a partial translation is a disagreement (a propagated badge would have been wrong); "unclear" is
// reported apart (the sibling's own search settled nothing). Threshold: 95% agreement turns propagation on
// (scripts/ft-search/propagation-gate.json).
import { readFileSync } from 'node:fs';

const DIR = process.argv[2];
if (!DIR) { console.error('usage: gate-report.mjs <dir>'); process.exit(1); }
const sibs = JSON.parse(readFileSync(`${DIR}/siblings.json`, 'utf8'));
const verdict = Object.fromEntries(readFileSync(`${DIR}/results.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r._book, r.verdict]; }));

let works = 0, pairs = 0, agree = 0, disagree = 0, unclear = 0, noAnswer = 0, repNotNone = 0, repNoAnswer = 0;
const worksAllAgree = []; const disagreements = [];
for (const [rep, list] of Object.entries(sibs)) {
  if (!verdict[rep]) { repNoAnswer++; continue; }
  if (verdict[rep] !== 'none_found') { repNotNone++; continue; } // not propagated: siblings stay eligible
  works++;
  let ok = true;
  for (const s of list) {
    const v = verdict[s];
    if (!v) { noAnswer++; continue; }
    pairs++;
    if (v === 'none_found') agree++;
    else if (v === 'unclear') { unclear++; ok = false; }
    else { disagree++; ok = false; disagreements.push({ rep, sibling: s, sibling_verdict: v }); }
  }
  if (ok) worksAllAgree.push(rep);
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : 'n/a');
console.log(`works in gate: ${Object.keys(sibs).length}; rep said none_found: ${works}; rep found a prior or partial (nothing propagated): ${repNotNone}; rep unanswered: ${repNoAnswer}`);
console.log(`sibling pairs under a none_found rep: ${pairs} (+${noAnswer} sibling unanswered)`);
console.log(`AGREEMENT (sibling also none_found, unclear excluded): ${agree}/${agree + disagree} = ${pct(agree, agree + disagree)}`);
console.log(`strict (unclear counts against): ${agree}/${pairs} = ${pct(agree, pairs)}; unclear ${unclear}; sibling found a prior/partial ${disagree}`);
console.log(`works where every sibling agreed: ${worksAllAgree.length}/${works} = ${pct(worksAllAgree.length, works)}`);
for (const d of disagreements) console.log(`  disagreement: rep ${d.rep} -> sibling ${d.sibling} said ${d.sibling_verdict}`);

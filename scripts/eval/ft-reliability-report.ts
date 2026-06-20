/**
 * Verdict-reliability analysis (issue #2564 paper).
 *
 * Compares an INDEPENDENT re-adjudication of the same books against the
 * original verdicts, to measure how stable the LLM-agent instrument is.
 * Reports: exact-verdict agreement, collapsed 3-class agreement
 * (first-family / not_first / not_applicable+other), and Cohen's kappa.
 *
 * Usage: npx tsx scripts/eval/ft-reliability-report.ts <rerun.json> <original.json>
 */
import { readFileSync } from 'fs';

const rerunFile = process.argv[2];
const origFile = process.argv[3];
if (!rerunFile || !origFile) { console.error('usage: ft-reliability-report.ts <rerun.json> <original.json>'); process.exit(1); }

interface V { book_id: string; verdict: string }
const load = (f: string): V[] => { const r = JSON.parse(readFileSync(f, 'utf8')); return (Array.isArray(r) ? r : r.verdicts).filter(Boolean); };

const rerun = load(rerunFile);
const orig = new Map(load(origFile).map((v) => [v.book_id, v.verdict]));

const collapse = (v: string): 'first' | 'not_first' | 'other' =>
  (['first_no_prior', 'first_complete', 'first_from_source', 'first_modern'].includes(v) ? 'first'
    : v === 'not_first' ? 'not_first' : 'other');

let n = 0, exact = 0, collapsedAgree = 0;
const pairs: Array<[string, string]> = [];
const disagreements: string[] = [];
for (const v of rerun) {
  const o = orig.get(v.book_id);
  if (!o) continue;
  n++;
  if (v.verdict === o) exact++;
  const ca = collapse(v.verdict), co = collapse(o);
  if (ca === co) collapsedAgree++;
  else disagreements.push(`  ${v.book_id}: ${o} -> ${v.verdict}`);
  pairs.push([co, ca]);
}

// Cohen's kappa on the collapsed 3-class labels.
const labels = ['first', 'not_first', 'other'];
const po = collapsedAgree / n;
const m1: Record<string, number> = {}, m2: Record<string, number> = {};
for (const [a, b] of pairs) { m1[a] = (m1[a] || 0) + 1; m2[b] = (m2[b] || 0) + 1; }
let pe = 0;
for (const l of labels) pe += ((m1[l] || 0) / n) * ((m2[l] || 0) / n);
const kappa = (po - pe) / (1 - pe);

console.log('\n=== Verdict reliability (independent re-adjudication) ===');
console.log(`paired books: ${n}`);
console.log(`exact-verdict agreement:    ${exact}/${n} = ${(exact / n * 100).toFixed(1)}%`);
console.log(`collapsed 3-class agreement: ${collapsedAgree}/${n} = ${(collapsedAgree / n * 100).toFixed(1)}%`);
console.log(`Cohen's kappa (3-class):     ${kappa.toFixed(3)}`);
console.log('\ndisagreements (original -> rerun):');
disagreements.forEach((d) => console.log(d));

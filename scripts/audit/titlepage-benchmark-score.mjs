#!/usr/bin/env node
/**
 * Unblind the adjudications and score the two readers.
 *
 * READ THIS BEFORE QUOTING THE NUMBER. Two limits are structural, not fixable by
 * running more agents:
 *
 * 1. THE SAMPLING FRAME IS ONE-SIDED. The pool is "books where flash-lite
 *    proposed an author", so flash-lite names someone on every row by
 *    construction and can never be the reader that declines. This measures
 *    flash-lite's PRECISION WHEN IT FIRES. It is blind to its misses — books
 *    where it wrongly declined are not in the sample at all — so it says nothing
 *    about recall, and the direction of the discordance is partly built in.
 *
 * 2. THE ADJUDICATOR SHARES A MODEL FAMILY WITH ONE READER. Order was randomised
 *    and neither answer was labelled, which removes position and label bias. It
 *    does not remove family bias. A verdict favouring the Claude reader is
 *    therefore weaker evidence than the same verdict from a human or a
 *    third-family judge.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

const DIR = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/99d9b906-8887-4b60-ab4c-e4747d013447/scratchpad/bench50';
const { rows } = JSON.parse(readFileSync(`${DIR}/paired.json`, 'utf8'));
const key = JSON.parse(readFileSync(`${DIR}/adjudication-key.json`, 'utf8'));
const byN = new Map(rows.map((r) => [r.n, r]));

let readerWins = 0, flashWins = 0, neither = 0, missing = 0;
const detail = [];
for (const k of key) {
  const p = `${DIR}/verdicts/verdict-${k.n}.json`;
  if (!existsSync(p)) { missing++; continue; }
  let v;
  try {
    let t = readFileSync(p, 'utf8').trim();
    if (t.startsWith('```')) t = t.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    v = JSON.parse(t);
  } catch { missing++; continue; }
  const r = byN.get(k.n);
  // Unblind: which reader did the adjudicator's chosen letter belong to?
  const winner = v.correct === 'A' ? k.A : v.correct === 'B' ? k.B : 'neither';
  if (winner === 'reader') readerWins++;
  else if (winner === 'flash') flashWins++;
  else neither++;
  detail.push({
    n: k.n, title: String(r.title).slice(0, 54),
    subagent: r.reader ?? '(nobody named)', flash_lite: r.flash ?? '(nobody named)',
    adjudicator_says: v.correct_author ?? '(nobody named)', winner,
    confidence: v.confidence, reasoning: v.reasoning,
  });
}

const n = readerWins + flashWins;
const C = (nn, rr) => { let x = 1; for (let i = 0; i < rr; i++) x = x * (nn - i) / (i + 1); return x; };
const kk = Math.max(readerWins, flashWins);
let tail = 0; for (let i = kk; i <= n; i++) tail += C(n, i);
const p = n ? 2 * tail / Math.pow(2, n) : 1;

console.log('══ blind adjudication of the discordant rows ══\n');
for (const d of detail) {
  const mark = d.winner === 'reader' ? 'subagent' : d.winner === 'flash' ? 'flash-lite' : 'NEITHER';
  console.log(`  ${d.n}  ${mark.padEnd(10)} → ${String(d.adjudicator_says).slice(0, 30).padEnd(30)} ${d.title}`);
}
console.log(`\n  adjudicated: ${detail.length} of ${key.length}${missing ? ` (${missing} missing)` : ''}`);
console.log(`    subagent correct   : ${readerWins}`);
console.log(`    flash-lite correct : ${flashWins}`);
console.log(`    neither correct    : ${neither}`);
console.log(`\n  McNemar exact (two-sided) on ${n} decided discordant pairs: p = ${p.toFixed(5)}`);
console.log(`  ${p < 0.05 ? 'SIGNIFICANT at 0.05' : 'not significant at 0.05'}`);

const conc = rows.filter((r) => r.concordant).length;
console.log(`\n  full-sample accuracy is NOT computed here: the ${conc} concordant rows were not`);
console.log(`  adjudicated, so both readers are credited with neither a hit nor a miss on them.`);
console.log(`  What this measures is who is right WHERE THEY DISAGREE, nothing more.`);

writeFileSync(`${DIR}/scored.json`, JSON.stringify({ readerWins, flashWins, neither, mcnemar_p: p, detail }, null, 1));

#!/usr/bin/env node
/**
 * Read the corpus dataset and answer the two questions it exists to answer:
 * how much of `page_revisions` is a genuine second reading of the same image,
 * and how long a page is.
 *
 * Offline — reads only the CSVs written by `build-corpus-dataset.mjs`. No Mongo,
 * no network, no cost. That is deliberate: the builder needs a good connection
 * for hours, this needs none, so the analysis stays available when the link is
 * not.
 *
 *   node scripts/eval/corpus-dataset-report.mjs [--dir=scripts/output/corpus-dataset]
 *
 * The eligibility ladder it prints is the one every downstream claim should
 * start from. See `.claude/docs/corpus-dataset.md` for why each rung is there.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const DIR = args.dir || 'scripts/output/corpus-dataset';

// Minimal RFC4180 reader — titles and authors contain commas and quotes.
const parseLine = (l) => {
  const o = []; let c = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { o.push(c); c = ''; }
    else c += ch;
  }
  o.push(c); return o;
};
const readCsv = (file) => {
  const L = fs.readFileSync(file, 'utf8').trim().split('\n');
  const header = parseLine(L[0]);
  const rows = L.slice(1).map(parseLine).filter(r => r.length === header.length);
  const ix = n => header.indexOf(n);
  return { header, rows, ix };
};

const pct = (a, b) => `${(100 * a / b).toFixed(1)}%`;

function histogram(vals, label, edges) {
  if (!vals.length) { console.log(`\n=== ${label} — no data ===`); return; }
  const counts = new Array(edges.length).fill(0);
  for (const v of vals) {
    let k = edges.length - 1;
    for (let i = 0; i < edges.length - 1; i++) if (v < edges[i + 1]) { k = i; break; }
    counts[k]++;
  }
  const max = Math.max(...counts);
  const s = [...vals].sort((a, b) => a - b);
  const q = p => s[Math.floor(p * (s.length - 1))];
  console.log(`\n=== ${label}  (n=${vals.length.toLocaleString()}) ===`);
  console.log(`  mean ${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(0)}   `
    + `p10 ${q(.1)}  p25 ${q(.25)}  p50 ${q(.5)}  p75 ${q(.75)}  p90 ${q(.9)}  p99 ${q(.99)}  max ${q(1)}`);
  for (let i = 0; i < edges.length; i++) {
    const lbl = (edges[i + 1] === undefined ? `${edges[i]}+` : `${edges[i]}–${edges[i + 1] - 1}`).padStart(11);
    console.log(`  ${lbl} │${'█'.repeat(Math.round(56 * counts[i] / max)).padEnd(56)} `
      + `${String(counts[i]).padStart(6)}  ${pct(counts[i], vals.length).padStart(6)}`);
  }
}

const revFile = path.join(DIR, 'revisions.csv');
if (!fs.existsSync(revFile)) { console.error(`no revisions.csv under ${DIR} — run build-corpus-dataset.mjs first`); process.exit(1); }
const { rows: R, ix } = readCsv(revFile);
console.log(`revisions.csv → ${R.length.toLocaleString()} rows\n`);

const isTextMove = r => r[ix('provenance_class')] === 'text_move_repair';
const shiftKnown = r => r[ix('printed_page_shift')] !== '';
const isShifted = r => r[ix('printed_page_shift')] === '1';
const inWindow = r => r[ix('in_undefined_key_window')] === '1';

// ── the eligibility ladder ───────────────────────────────────────
const n = R.length;
const textMove = R.filter(isTextMove).length;
const candidate = R.filter(r => !isTextMove(r));
const readable = candidate.filter(shiftKnown).length;
const shifted = candidate.filter(isShifted).length;
const clean = candidate.filter(r => !isShifted(r));
const strict = clean.filter(r => !inWindow(r));

console.log('=== ELIGIBILITY: how much is a real second reading of the same image? ===');
console.log(`  all OCR revisions                     ${String(n).padStart(7)}`);
console.log(`  − text_move_repair (source-labelled)  ${String(-textMove).padStart(7)}  ${pct(textMove, n)}`);
console.log(`  = candidate re-OCR                    ${String(candidate.length).padStart(7)}`);
console.log(`      printed page-num readable both sides: ${readable} (${pct(readable, candidate.length)})`);
console.log(`      …of those, SHIFTED (different leaf):  ${shifted} (${pct(shifted, readable)})`);
console.log(`  − shifted                             ${String(-shifted).padStart(7)}`);
console.log(`  = CLEAN same-image re-OCR             ${String(clean.length).padStart(7)}  ${pct(clean.length, n)}`);
console.log(`  − also inside the #3362 window        ${String(-(clean.length - strict.length)).padStart(7)}`);
console.log(`  = most conservative corpus            ${String(strict.length).padStart(7)}  ${pct(strict.length, n)}`);
console.log(`\n  The shift rate is computed only over pairs where a printed page number`);
console.log(`  is readable on BOTH sides (${pct(readable, candidate.length)}). It abstains on the rest, so it is a`);
console.log(`  LOWER BOUND on image churn, not a clean bill of health.`);

// ── source mix ───────────────────────────────────────────────────
const tally = (rows, f) => {
  const m = {};
  for (const r of rows) { const v = r[ix(f)] || '(none)'; m[v] = (m[v] || 0) + 1; }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};
console.log('\n  source mix:');
for (const [k, v] of tally(R, 'source').slice(0, 8)) console.log(`    ${k.padEnd(34)} ${String(v).padStart(6)}  ${pct(v, n)}`);

// ── word distribution ────────────────────────────────────────────
const EDGES = [0, 1, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 2000];
const num = (rows, f) => rows.map(r => parseInt(r[ix(f)])).filter(Number.isFinite);
histogram(num(clean, 'live_words'), 'WORDS PER PAGE — current OCR, clean corpus', EDGES);
histogram(num(clean, 'live_body_words'), 'BODY WORDS PER PAGE (annotation stripped), clean corpus', EDGES);

// The zero bucket is the point of showing both: on a cover or plate the whole
// "text" is an AI image description, which body_words strips to nothing. Those
// pages disagree between passes by construction and must not be read as OCR
// losing text.
const bw = num(clean, 'live_body_words'), w = num(clean, 'live_words');
console.log(`\n  zero-body pages: ${bw.filter(x => x === 0).length.toLocaleString()} (${pct(bw.filter(x => x === 0).length, bw.length)})`
  + ` vs zero-word: ${w.filter(x => x === 0).length.toLocaleString()} (${pct(w.filter(x => x === 0).length, w.length)})`);
console.log(`  The gap is covers, endpapers and plates — text is an AI image description.`);

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
import readline from 'node:readline';

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

// ── pages.csv: the within-book control ───────────────────────────
// The whole reason pages.csv holds single-OCR pages too. Between-book
// comparison would confound with provider, scan quality, language and century;
// pairing INSIDE each book removes all of those at once.
const pagesFile = path.join(DIR, 'pages.csv');
if (fs.existsSync(pagesFile)) {
  await (async () => {
    const rl = readline.createInterface({ input: fs.createReadStream(pagesFile), crlfDelay: Infinity });
    let hdr = null, pix = null;
    const allWords = [];
    const byBook = new Map();   // book -> {dN,dSum,sN,sSum}
    const posDouble = {}, posSingle = {};
    let ocrPages = 0, doublePages = 0;
    for await (const line of rl) {
      if (!hdr) { hdr = parseLine(line); pix = n => hdr.indexOf(n); continue; }
      if (!line.trim()) continue;
      const r = parseLine(line);
      if (r.length !== hdr.length) continue;
      if (r[pix('has_ocr')] !== '1') continue;
      ocrPages++;
      const wds = parseInt(r[pix('words')]);
      if (!Number.isFinite(wds)) continue;
      allWords.push(wds);
      const dbl = r[pix('is_double_ocr')] === '1';
      if (dbl) doublePages++;
      const b = r[pix('book_id')];
      if (!byBook.has(b)) byBook.set(b, { dN: 0, dSum: 0, sN: 0, sSum: 0 });
      const rec = byBook.get(b);
      if (dbl) { rec.dN++; rec.dSum += wds; } else { rec.sN++; rec.sSum += wds; }
      const pb = r[pix('position_bucket')] || 'unknown';
      (dbl ? posDouble : posSingle)[pb] = ((dbl ? posDouble : posSingle)[pb] || 0) + 1;
    }

    console.log(`\n\n════════ pages.csv — the within-book control ════════`);
    console.log(`  OCR'd pages in scoped books: ${ocrPages.toLocaleString()}`);
    console.log(`  re-OCR'd at least once     : ${doublePages.toLocaleString()} (${pct(doublePages, ocrPages)})`);
    histogram(allWords, 'WORDS PER PAGE — every OCR page of the scoped books', EDGES);

    // Paired comparison: only books holding BOTH kinds of page can contribute.
    const paired = [...byBook.values()].filter(v => v.dN > 0 && v.sN > 0);
    const diffs = paired.map(v => v.dSum / v.dN - v.sSum / v.sN).sort((a, b) => a - b);
    const md = diffs[Math.floor(0.5 * (diffs.length - 1))];
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const up = diffs.filter(d => d > 0).length;
    console.log(`\n=== Are re-OCR'd pages different from their book's other pages? ===`);
    console.log(`  books with BOTH re-OCR'd and single-OCR pages: ${paired.length.toLocaleString()} of ${byBook.size.toLocaleString()}`);
    console.log(`  per-book difference in mean words (re-OCR'd − single):`);
    console.log(`    mean ${mean.toFixed(1)}   median ${md.toFixed(1)}   `
      + `p10 ${diffs[Math.floor(.1 * (diffs.length - 1))].toFixed(0)}  p90 ${diffs[Math.floor(.9 * (diffs.length - 1))].toFixed(0)}`);
    console.log(`    books where re-OCR'd pages are LONGER: ${up} (${pct(up, diffs.length)})`);
    // A sign test against 50/50 is the honest summary: the per-book differences
    // are not normal (heavy tails), so the median and the sign split carry the
    // claim, not the mean.
    const z = (up - diffs.length / 2) / Math.sqrt(diffs.length / 4);
    console.log(`    sign test vs 50/50: z = ${z.toFixed(1)}`);

    console.log(`\n  position in book (share of each group):`);
    const keys = [...new Set([...Object.keys(posDouble), ...Object.keys(posSingle)])].sort();
    const dT = Object.values(posDouble).reduce((a, b) => a + b, 0);
    const sT = Object.values(posSingle).reduce((a, b) => a + b, 0);
    for (const k of keys) {
      console.log(`    ${k.padEnd(10)} re-OCR'd ${pct(posDouble[k] || 0, dT).padStart(7)}   single ${pct(posSingle[k] || 0, sT).padStart(7)}`);
    }
  })();
}

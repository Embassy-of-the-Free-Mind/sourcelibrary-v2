#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/score.mjs scores the judge's verdicts per arm; it never runs the drift
// guard. scripts/audit/leaf-shift-gate-controls-5021.mjs runs the leaf-shift gate over by-eye controls in cased
// scripts. Neither reads a Han boundary.
/**
 * #7503 calibration of block-drift's caseless (Han) branch on the reads of #7518.
 *
 *   node scripts/eval/caseless-drift-7503/calibrate.mjs [--reads=scripts/eval/agy-per-call-7503]
 *
 * Every page break inside the four drawn pages of each of the 15 books, in every arm:
 *   - B2 / C4 breaks that fall inside one call (calls-*.jsonl) are the guard's real input;
 *   - A1 / A1b (one page per call) cannot move text, so every flag there is a false positive.
 * The 5 by-eye moves are the ones the experiment file lists (論語商 37→38 in B2 and C4, 天原發微 56→57 C4,
 * 經濟類編 63→64 C4, 學易記·卷三 122→123 B2). OCR is the snapshot in ocr.json (Mongo, 2026-10-27).
 * Writes results.json beside this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { detectBlockDrift } from '../../lib/block-drift.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const R = arg('reads') || path.join(HERE, '../agy-per-call-7503');
const draw = JSON.parse(fs.readFileSync(path.join(R, 'draw.json'), 'utf8'));
const ocr = JSON.parse(fs.readFileSync(path.join(HERE, 'ocr.json'), 'utf8'));
const jsonl = (f) => fs.readFileSync(path.join(R, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const reads = jsonl('reads.jsonl');
const calls = { B2: jsonl('calls-B2.jsonl'), C4: jsonl('calls-C4.jsonl') };
const KNOWN = [['B2', '論語商', 37], ['C4', '論語商', 37], ['C4', '天原發微', 56], ['C4', '經濟類編', 63], ['B2', '學易記·卷三', 122]];

const rows = [];
for (const arm of ['A1', 'A1b', 'B2', 'C4']) {
  for (const b of draw.books) {
    const ns = b.pages.map((p) => p.page_number);
    for (const n of ns.slice(0, -1)) {
      const inBlock = !!calls[arm]?.some((c) => c.book_id === b.book_id && c.pages.includes(n) && c.pages.includes(n + 1));
      if (calls[arm] && !inBlock) continue; // a block arm's break between two calls is a seam, not this guard's
      const tr = (pn) => reads.find((r) => r.arm === arm && r.book_id === b.book_id && r.page_number === pn)?.text;
      const r = detectBlockDrift({ ocrPrev: ocr[b.book_id][n], ocrNext: ocr[b.book_id][n + 1], trPrev: tr(n), trNext: tr(n + 1), caseless: true });
      const known = KNOWN.some(([a, t, k]) => a === arm && b.title.includes(t) && k === n);
      rows.push({ arm, book: b.title, break: `${n}→${n + 1}`, known, flagged: r.drift, reason: r.reason ?? null, shift: r.shift == null ? null : +r.shift.toFixed(3) });
    }
  }
}

const count = (f) => rows.filter(f).length;
const summary = {
  known_caught: `${count((r) => r.known && r.flagged)}/${count((r) => r.known)}`,
  one_per_call_false_positives: `${count((r) => !r.arm.startsWith('B') && !r.arm.startsWith('C') && r.flagged)}/${count((r) => r.arm.startsWith('A'))}`,
  block_clean_breaks_flagged: `${count((r) => /^[BC]/.test(r.arm) && !r.known && r.flagged)}/${count((r) => /^[BC]/.test(r.arm) && !r.known)}`,
  by_arm: Object.fromEntries(['A1', 'A1b', 'B2', 'C4'].map((a) => [a, `${count((r) => r.arm === a && r.flagged)}/${count((r) => r.arm === a)}`])),
  flags: rows.filter((r) => r.flagged).map((r) => `${r.arm} ${r.book} ${r.break}${r.known ? ' (known)' : ''} shift ${r.shift}`),
  missed: rows.filter((r) => r.known && !r.flagged).map((r) => `${r.arm} ${r.book} ${r.break}: ${r.reason}`),
};
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify({ summary, rows }, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));

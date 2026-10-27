#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/agreement-stats.mjs wilson and scripts/eval/lib/paired-stats.mjs makeRng are used here;
// paired-stats diffCI resamples two arms independently, and these arms are paired on the same pages and clustered by
// book, so the paired difference is resampled by BOOK below.
/**
 * #7503 score: unblind the judge's verdicts (judge/key.json), check the planted controls, and tabulate per arm.
 *
 *   node scripts/eval/agy-per-call-7503/score.mjs --scratch=DIR > results.json
 *
 * A run whose controls are not all caught is reported `probe_broken`, not as a result: a drop control must be
 * flagged with an omission, a bleed control with cross-page bleed or an addition, and both marked unusable.
 * Arm differences are paired page-by-page and compared against the A1-vs-A1b floor (two fresh one-per-call reads),
 * with a 95% bootstrap interval resampling the 15 BOOKS (pages of one book are not independent).
 */
import fs from 'node:fs';
import path from 'node:path';
import { wilson } from '../lib/agreement-stats.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = arg('scratch');
const J = path.join(S, 'judge');
const ARMS = ['A1', 'A1b', 'B2', 'C4'];
const FAULTS = ['omissions', 'additions', 'sense_errors', 'cross_page_bleed', 'names_garbled'];
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const key = JSON.parse(fs.readFileSync(path.join(J, 'key.json'), 'utf8'));
const tamper = JSON.parse(fs.readFileSync(path.join(J, 'tamper.json'), 'utf8'));
const callPagesOf = (arm, id) => JSON.parse(fs.readFileSync(path.join(S, arm, `${id}.meta.json`), 'utf8')).call_pages ?? 1;

const rows = [];   // one per (page, arm)
const controls = [];
for (const b of draw.books) {
  for (const pg of b.pages) {
    const v = JSON.parse(fs.readFileSync(path.join(J, 'out', `${pg.page_id}.json`), 'utf8')).verdict;
    if (!v) throw new Error(`${pg.page_id}: no verdict`);
    for (const [label, arm] of Object.entries(key[pg.page_id])) {
      const x = v.versions[label];
      const counts = Object.fromEntries(FAULTS.map((f) => [f, (x[f] || []).length]));
      if (arm === 'CTL') {
        const t = tamper[pg.page_id];
        const caught = x.usable === false && (t.kind === 'drop' ? counts.omissions > 0 : counts.cross_page_bleed + counts.additions > 0);
        controls.push({ page_id: pg.page_id, kind: t.kind, caught, usable: x.usable, ...counts, comment: x.comment });
        continue;
      }
      rows.push({ page_id: pg.page_id, book_id: b.book_id, arm, call_pages: callPagesOf(arm, pg.page_id), usable: x.usable === true, ...counts, any_fault: FAULTS.some((f) => counts[f] > 0) });
    }
  }
}

const n = draw.books.length * 4;
const arms = {};
for (const arm of ARMS) {
  const r = rows.filter((x) => x.arm === arm);
  const k = (pred) => r.filter(pred).length;
  const rate = (pred) => { const c = k(pred); const [lo, hi] = wilson(c, r.length); return { k: c, n: r.length, p: c / r.length, ci: [lo, hi] }; };
  arms[arm] = {
    usable: rate((x) => x.usable),
    pages_with: Object.fromEntries(FAULTS.map((f) => [f, rate((x) => x[f] > 0)])),
    fault_counts: Object.fromEntries(FAULTS.map((f) => [f, r.reduce((s, x) => s + x[f], 0)])),
    usable_by_call_pages: Object.fromEntries([...new Set(r.map((x) => x.call_pages))].sort().map((cp) => { const s = r.filter((x) => x.call_pages === cp); return [cp, { usable: s.filter((x) => x.usable).length, n: s.length }]; })),
    unusable_books: Object.fromEntries(draw.books.map((b) => [b.book_id, r.filter((x) => x.book_id === b.book_id && !x.usable).length]).filter(([, c]) => c > 0)),
  };
}

/** Paired difference in usable rate (arm minus A1), with a by-book bootstrap. */
function pairedDiff(armA, armB, metric = (x) => (x.usable ? 1 : 0), iters = 10000) {
  const books = draw.books.map((b) => b.book_id);
  const perBook = books.map((id) => {
    const a = rows.filter((x) => x.book_id === id && x.arm === armA), bb = rows.filter((x) => x.book_id === id && x.arm === armB);
    return { d: bb.reduce((s, x) => s + metric(x), 0) - a.reduce((s, x) => s + metric(x), 0), n: a.length };
  });
  const point = perBook.reduce((s, x) => s + x.d, 0) / perBook.reduce((s, x) => s + x.n, 0);
  const rng = makeRng(75033);
  const ds = [];
  for (let i = 0; i < iters; i++) {
    let d = 0, m = 0;
    for (let j = 0; j < perBook.length; j++) { const x = perBook[Math.floor(rng() * perBook.length)]; d += x.d; m += x.n; }
    ds.push(d / m);
  }
  ds.sort((a, b) => a - b);
  return { delta: point, ci: [ds[Math.floor(iters * 0.025)], ds[Math.ceil(iters * 0.975) - 1]] };
}
const diffs = {};
for (const arm of ['A1b', 'B2', 'C4']) {
  diffs[`${arm}-A1`] = { usable: pairedDiff('A1', arm), omission_pages: pairedDiff('A1', arm, (x) => (x.omissions > 0 ? 1 : 0)), bleed_pages: pairedDiff('A1', arm, (x) => (x.cross_page_bleed > 0 ? 1 : 0)), sense_pages: pairedDiff('A1', arm, (x) => (x.sense_errors > 0 ? 1 : 0)) };
}
// Floor: how often two fresh reads of the same page on the same arm disagree on usable.
const disagree = (a, b) => draw.books.flatMap((bk) => bk.pages).filter((p) => rows.find((x) => x.page_id === p.page_id && x.arm === a).usable !== rows.find((x) => x.page_id === p.page_id && x.arm === b).usable).length;
const floor = { 'A1~A1b': disagree('A1', 'A1b'), 'A1~B2': disagree('A1', 'B2'), 'A1~C4': disagree('A1', 'C4'), 'A1b~B2': disagree('A1b', 'B2'), 'A1b~C4': disagree('A1b', 'C4'), 'B2~C4': disagree('B2', 'C4') };

const probeOk = controls.length === 5 && controls.every((c) => c.caught);
console.log(JSON.stringify({ status: probeOk ? 'ok' : 'probe_broken', n_pages: n, n_books: draw.books.length, controls, arms, paired_diffs_vs_A1: diffs, usable_disagreements: floor, rows }, null, 1));

#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/score.mjs and tokens.mjs (PR #7518) — the same unblinding, control check,
// per-arm table and by-BOOK paired bootstrap against the A1~A1b floor, and the same token index; joined here, with OCR
// faults (order errors, misreads) in place of translation ones, and agy's usage read from cli-ocr.mjs metas and
// calls.jsonl. scripts/eval/lib/agreement-stats.mjs wilson and scripts/eval/lib/paired-stats.mjs makeRng are used.
/**
 * #7522 score: unblind the judge's verdicts (judge/key.json), check the planted controls, tabulate per arm, and count
 * tokens, calls and refusals per arm from the reads themselves.
 *
 *   node scripts/eval/ocr-per-call-7522/score.mjs --scratch=DIR > results.json
 *
 * A run whose controls are caught fewer than 4 of 5 times is `probe_broken`, not a result. A drop control is caught
 * when the judge finds an omission and calls it unusable; a bleed control, bleed or an addition and unusable.
 * Tokens: a block arm pays for every call it made (calls.jsonl: refused blocks too) plus the pages it read alone; a
 * one-page read pays for every call in its meta's `usage`. Quota index = input + 6 x (output + thinking) per page, an
 * ASSUMED weight (#7503), shown beside the measured /quota deltas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { wilson } from '../lib/agreement-stats.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { FAULTS } from './judge.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = arg('scratch');
const J = path.join(S, 'judge');
const ARMS = ['A1', 'A1b', 'B2', 'C4'];
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const typeOf = JSON.parse(fs.readFileSync(path.join(HERE, 'script.json'), 'utf8')).books;
const key = JSON.parse(fs.readFileSync(path.join(J, 'key.json'), 'utf8'));
const tamper = JSON.parse(fs.readFileSync(path.join(J, 'tamper.json'), 'utf8'));
const metaOf = (arm, id) => { try { return JSON.parse(fs.readFileSync(path.join(S, arm, `${id}.meta.json`), 'utf8')); } catch { return null; } };

const rows = [], controls = [];
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
      const m = metaOf(arm, pg.page_id);
      rows.push({ page_id: pg.page_id, book_id: b.book_id, language: b.language, type: typeOf[b.book_id]?.type, arm, call_pages: m?.call_pages ?? 1, read_alone_from: m?.block_fallback ?? null, delivered: !!(m && m.exit === 0 && !m.error_class && m.chars > 5), usable: x.usable === true, ...counts, faults: Object.fromEntries(FAULTS.map((f) => [f, x[f] || []])), comment: x.comment });
    }
  }
}

const rate = (r, pred) => { const c = r.filter(pred).length; const [lo, hi] = wilson(c, r.length); return { k: c, n: r.length, p: c / r.length, ci: [lo, hi] }; };
const zero = () => ({ input: 0, output: 0, thinking: 0, cache_read: 0 });
const add = (t, u) => { for (const k of Object.keys(t)) t[k] += Number(u?.[k] || 0); };
function tokens(arm) {
  const dir = path.join(S, arm);
  const t = zero();
  let calls = 0, blockCalls = 0, refusedBlocks = 0, missingUsage = 0;
  const callLog = path.join(dir, 'calls.jsonl');
  if (fs.existsSync(callLog)) {
    for (const c of fs.readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))) {
      blockCalls++; calls += c.calls; if (c.cls) refusedBlocks++;
      for (const u of c.usage || []) { if (!u) missingUsage++; add(t, u); }
    }
  }
  let alone = 0, failed = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.meta.json'))) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (m.exit !== 0 || m.error_class) failed++;
    if ((m.call_pages ?? 1) > 1) continue;   // its block call is counted from calls.jsonl
    alone++; calls += m.calls ?? 0;
    for (const u of m.usage || []) { if (!u) missingUsage++; add(t, u); }
  }
  const pages = draw.books.length * 4;
  const per = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v / pages)]));
  return { calls, block_calls: blockCalls, refused_blocks: refusedBlocks, pages_read_one_per_call: alone, failed_reads: failed, missing_usage: missingUsage, total: t, per_page: per, index_per_page: per.input + 6 * (per.output + per.thinking), uncached_index_per_page: per.input - per.cache_read + 6 * (per.output + per.thinking) };
}

// Measured /quota deltas per arm (before -> after, the "after" 15 min past the arm's end), with every other job's calls
// in the same window: on a shared pool the delta is the arm's share only if no one else called.
function quota() {
  const f = path.join(S, 'quota.jsonl');
  if (!fs.existsSync(f)) return null;
  const q = fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const frac = (row, id) => row?.buckets?.find((b) => b.id === id)?.remaining_fraction ?? null;
  const out = {};
  for (const arm of [...ARMS, 'CTL']) {
    const i = q.findIndex((r) => r.label === `${arm}:before`), j = q.findIndex((r) => r.label === `${arm}:after`);
    if (i < 0 || j < 0) continue;
    const between = q.slice(i + 1, j + 1);
    out[arm] = { weekly_used: frac(q[i], 'gemini-weekly') - frac(q[j], 'gemini-weekly'), five_h_before: frac(q[i], 'gemini-5h'), five_h_after: frac(q[j], 'gemini-5h'), five_h_reset_crossed: q[i].buckets?.find((b) => b.id === 'gemini-5h')?.reset_time !== q[j].buckets?.find((b) => b.id === 'gemini-5h')?.reset_time, own_calls: between.reduce((s, r) => s + r.own_calls, 0), other_calls: between.reduce((s, r) => s + r.other_calls, 0), minutes: (new Date(q[j].at) - new Date(q[i].at)) / 60000 };
  }
  return out;
}

const arms = {};
for (const arm of ARMS) {
  const r = rows.filter((x) => x.arm === arm);
  arms[arm] = {
    usable: rate(r, (x) => x.usable),
    delivered: rate(r, (x) => x.delivered),
    pages_with: Object.fromEntries(FAULTS.map((f) => [f, rate(r, (x) => x[f] > 0)])),
    fault_counts: Object.fromEntries(FAULTS.map((f) => [f, r.reduce((s, x) => s + x[f], 0)])),
    usable_by_type: Object.fromEntries(['fraktur', 'roman'].map((t) => [t, rate(r.filter((x) => x.type === t), (x) => x.usable)])),
    usable_by_language: Object.fromEntries(['German', 'Latin'].map((l) => [l, rate(r.filter((x) => x.language === l), (x) => x.usable)])),
    usable_by_call_pages: Object.fromEntries([...new Set(r.map((x) => x.call_pages))].sort().map((cp) => [cp, rate(r.filter((x) => x.call_pages === cp), (x) => x.usable)])),
    unusable_books: Object.fromEntries(draw.books.map((b) => [b.book_id, r.filter((x) => x.book_id === b.book_id && !x.usable).length]).filter(([, c]) => c > 0)),
    tokens: tokens(arm),
  };
}
for (const arm of ARMS) arms[arm].tokens.index_vs_A1 = +(arms[arm].tokens.index_per_page / arms.A1.tokens.index_per_page).toFixed(2);

/** Paired difference (arm minus A1), with a by-book bootstrap. */
function pairedDiff(armA, armB, metric = (x) => (x.usable ? 1 : 0), iters = 10000) {
  const perBook = draw.books.map((b) => {
    const a = rows.filter((x) => x.book_id === b.book_id && x.arm === armA), bb = rows.filter((x) => x.book_id === b.book_id && x.arm === armB);
    return { d: bb.reduce((s, x) => s + metric(x), 0) - a.reduce((s, x) => s + metric(x), 0), n: a.length };
  });
  const point = perBook.reduce((s, x) => s + x.d, 0) / perBook.reduce((s, x) => s + x.n, 0);
  const rng = makeRng(75223);
  const ds = [];
  for (let i = 0; i < iters; i++) { let d = 0, m = 0; for (let j = 0; j < perBook.length; j++) { const x = perBook[Math.floor(rng() * perBook.length)]; d += x.d; m += x.n; } ds.push(d / m); }
  ds.sort((a, b) => a - b);
  return { delta: point, ci: [ds[Math.floor(iters * 0.025)], ds[Math.ceil(iters * 0.975) - 1]] };
}
const diffs = {};
for (const arm of ['A1b', 'B2', 'C4']) diffs[`${arm}-A1`] = { usable: pairedDiff('A1', arm), omission_pages: pairedDiff('A1', arm, (x) => (x.omissions > 0 ? 1 : 0)), bleed_pages: pairedDiff('A1', arm, (x) => (x.cross_page_bleed > 0 ? 1 : 0)), misread_pages: pairedDiff('A1', arm, (x) => (x.misreads > 0 ? 1 : 0)) };
const pagesAll = draw.books.flatMap((bk) => bk.pages);
const disagree = (a, b) => pagesAll.filter((p) => rows.find((x) => x.page_id === p.page_id && x.arm === a).usable !== rows.find((x) => x.page_id === p.page_id && x.arm === b).usable).length;
const floor = Object.fromEntries([['A1', 'A1b'], ['A1', 'B2'], ['A1', 'C4'], ['A1b', 'B2'], ['A1b', 'C4'], ['B2', 'C4']].map(([a, b]) => [`${a}~${b}`, disagree(a, b)]));
// The decision rule (#7522): a block arm passes if its paired usable difference vs A1 is no worse than A1b's, and it shows no bleed.
const decision = Object.fromEntries(['B2', 'C4'].map((arm) => [arm, { usable_delta: diffs[`${arm}-A1`].usable.delta, floor_delta: diffs['A1b-A1'].usable.delta, within_floor: diffs[`${arm}-A1`].usable.delta >= diffs['A1b-A1'].usable.delta, bleed_pages: arms[arm].pages_with.cross_page_bleed.k, bleed_pages_A1: arms.A1.pages_with.cross_page_bleed.k, bleed_pages_A1b: arms.A1b.pages_with.cross_page_bleed.k }]));

const caught = controls.filter((c) => c.caught).length;
console.log(JSON.stringify({ status: controls.length === 5 && caught >= 4 ? 'ok' : 'probe_broken', controls_caught: `${caught}/${controls.length}`, n_pages: pagesAll.length, n_books: draw.books.length, controls, arms, paired_diffs_vs_A1: diffs, usable_disagreements: floor, decision, quota: quota(), rows }, null, 1));

#!/usr/bin/env node
// PRIOR ART: features.mjs / image.mjs / agy.mjs in this directory (the families); severity-cal-7263's fresh reads
// (SEVCAL/fresh/<page_id>.txt) are reused for its 60 pages. confidence-7866/analyze.mjs's re-read disagreement is a
// book median of 1 − word-multiset Dice; the same measure is used for the fresh agy read here.
/**
 * Joins labels and features into the two tables model.py reads: one row per judged page, one per book.
 *   node scripts/eval/book-grade-7263/assemble.mjs   → OUT/table-pages.json.gz, OUT/table-books.json.gz
 */
import fs from 'node:fs';
import path from 'node:path';
import { garbleBody, tokensOf } from '../../lib/ocr-garble-score.mjs';
import { OUT, SEVCAL, J, W, bookGradeOf, isBad } from './lib.mjs';
import { DIR as AGY_DIR } from './agy.mjs';

const toks = (t) => tokensOf(garbleBody(t)).flatMap(({ t: x, s }) => (s === 'CJK' ? Array.from(x) : [x]));
const dice = (a, b) => {
  const A = new Map(), B = new Map();
  for (const t of a) A.set(t, (A.get(t) ?? 0) + 1);
  for (const t of b) B.set(t, (B.get(t) ?? 0) + 1);
  let inter = 0; for (const [t, k] of A) inter += Math.min(k, B.get(t) ?? 0);
  return a.length + b.length ? (2 * inter) / (a.length + b.length) : 1;
};
/** Normalized character edit distance on the first 2,500 content characters. */
function ned(a, b) {
  const x = Array.from(garbleBody(a).replace(/\s+/g, ' ').trim()).slice(0, 2500), y = Array.from(garbleBody(b).replace(/\s+/g, ' ').trim()).slice(0, 2500);
  if (!x.length && !y.length) return 0;
  let prev = new Uint32Array(y.length + 1).map((_, j) => j), cur = new Uint32Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) { cur[0] = i; for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
  return prev[y.length] / Math.max(x.length, y.length);
}
const median = (a) => { const s = a.filter((x) => x != null).sort((p, q) => p - q); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const mean = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)); return s.length ? s.reduce((p, q) => p + q, 0) / s.length : null; };
export const LANG = (l) => (/Chinese/.test(l) ? 'Chinese' : /^Latin/.test(l) ? 'Latin' : l);

// Fresh reads: this job's agy dir, else severity-cal's.
function fresh(pageId) {
  for (const dir of [AGY_DIR, path.join(SEVCAL, 'fresh')]) {
    const m = path.join(dir, `${pageId}.meta.json`), t = path.join(dir, `${pageId}.txt`);
    if (fs.existsSync(m) && fs.existsSync(t)) { const mm = JSON.parse(fs.readFileSync(m, 'utf8')); return { ok: mm.exit === 0 && !mm.wrapper && fs.readFileSync(t, 'utf8').trim().length > 5, text: fs.readFileSync(t, 'utf8'), from: dir === AGY_DIR ? 'this job' : 'severity-cal' }; }
  }
  return null;
}

export const textKeysOf =(pf) => Object.keys(pf[0]).filter((k) => !['book_id', 'page_id', 'kind', 'rev_n', 'rev_leafshift', 'rev_dis', 'rev_dis_same_model'].includes(k));

/** One row per judged page: label, the page's own T, I and R. */
export function pageRowsOf(rows, pf, meta, img, TEXT_KEYS) {
  const pfBy = new Map(pf.map((p) => [`${p.book_id}:${p.page_id}:${p.kind}`, p]));
  return rows.map((r) => {
    const t = pfBy.get(`${r.book_id}:${r.page_id}:judged`);
    const fr = fresh(r.page_id);
    const agy = fr?.ok ? { agy_dis: 1 - dice(toks(fr.text), toks(r.text)), agy_ned: ned(fr.text, r.text), agy_read: 1 } : { agy_dis: null, agy_ned: null, agy_read: fr ? 0 : null };
    return {
      book_id: r.book_id, page_id: r.page_id, study: r.study, lockbox: r.lockbox, lang: LANG(r.lang), unit: meta[r.book_id].unit, script: meta[r.book_id].script,
      serious: r.serious, units: r.units ?? 0, many: r.many ? 1 : 0, wrong_page: r.wrong_page ? 1 : 0, fidelity: r.fidelity,
      T: Object.fromEntries(TEXT_KEYS.map((k) => [k, t[k]])), I: img[r.page_id] ?? null,
      R: { rev_dis: t.rev_dis, rev_any: t.rev_n > 0 ? 1 : 0, rev_leafshift: t.rev_leafshift, ...agy, agy_from: fr?.from ?? null },
    };
  });
}

/** One row per book: the grade over its judged pages; T over judged + sample pages; I over judged pages. */
export function bookRowsOf(pages, pf, meta, TEXT_KEYS) {
  return [...new Set(pages.map((p) => p.book_id))].sort().map((b) => {
    const ps = pages.filter((p) => p.book_id === b);
    const all = pf.filter((p) => p.book_id === b);
    const S = ps.reduce((a, p) => a + p.serious, 0), U = ps.reduce((a, p) => a + p.units, 0);
    const wp = ps.some((p) => p.wrong_page);
    const rate = U > 0 ? (S / U) * 1000 : (S > 0 ? Infinity : 0);
    const grade = bookGradeOf(rate, wp);
    const m = meta[b];
    const T = {};
    for (const k of TEXT_KEYS) T[k] = mean(all.map((p) => p[k]));
    for (const k of ['loop', 'repeat5', 'unclear_per100', 'oov', 'outside_script', 'trigram_xent', 'near_empty', 'chatter']) T[`max_${k}`] = Math.max(...all.map((p) => p[k] ?? 0));
    const I = {}; for (const k of Object.keys(ps.find((p) => p.I)?.I ?? {})) I[k] = mean(ps.map((p) => p.I?.[k]));
    const R = {
      rev_dis_med: median(all.map((p) => p.rev_dis)), rev_any_share: mean(all.map((p) => (p.rev_n > 0 ? 1 : 0))), rev_leafshift_share: mean(all.map((p) => (p.rev_leafshift > 0 ? 1 : 0))),
      agy_dis: mean(ps.map((p) => p.R.agy_dis)), agy_ned: mean(ps.map((p) => p.R.agy_ned)), agy_fail: ps.some((p) => p.R.agy_read === 0) ? 1 : 0,
    };
    return { book_id: b, study: ps[0].study, lockbox: ps[0].lockbox, n_pages: ps.length, serious: S, units: U, wrong_page: wp ? 1 : 0, rate, grade, bad: isBad(grade) ? 1 : 0,
      lang: ps[0].lang, unit: m.unit, script: m.script, route: m.route, engine: m.engine, year: m.year, provider: m.provider, pages_count: m.pages_count,
      p_route: m.p_route, route_measured: m.route_measured, route_wt_per1k: m.route_wt_per1k, T, I, R };
  });
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const { rows } = J('labels.json.gz');
  const pf = J('feat-pages.json.gz'), meta = J('feat-books.json.gz'), img = J('feat-images.json.gz');
  const TEXT_KEYS = textKeysOf(pf);
  const pages = pageRowsOf(rows, pf, meta, img, TEXT_KEYS);
  const books = bookRowsOf(pages, pf, meta, TEXT_KEYS);
  W('table-pages.json.gz', pages);
  W('table-books.json.gz', books);
  console.log(`${pages.length} pages, ${books.length} books; fresh reads: ${pages.filter((p) => p.R.agy_read === 1).length} ok, ${pages.filter((p) => p.R.agy_read === 0).length} failed`);
}

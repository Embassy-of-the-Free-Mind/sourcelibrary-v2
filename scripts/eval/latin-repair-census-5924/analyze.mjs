#!/usr/bin/env node
/**
 * latin-repair-census-5924/analyze.mjs — the tables for #5924: prevalence by class × format × engine, the text-only
 * repair share, by-eye precision, and the 25-page question (first 25 / 25 spread / random 25 vs the whole book).
 *
 * PRIOR ART: scripts/eval/lib/agreement-stats.mjs `wilson` (used for the by-eye intervals); no Spearman helper in
 *   scripts/eval/lib (checked INDEX.md), so a ten-line one is here.
 * Reads census-pages.jsonl.gz, census-books.json, agents/format-*.out.json, agents/eye-*.out.json, leaves.json.
 * Writes $JOB_SCRATCH/report.json and report.md. Counts and rates only — no page text.
 */
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import { wilson } from '../lib/agreement-stats.mjs';

const OUT = process.env.JOB_SCRATCH || '/data/scratch/sl/jobs/latin-repair-census';
const J = f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const rows = zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'census-pages.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
const draw = J('draw.json');
const fmt = new Map(fs.readdirSync(path.join(OUT, 'agents')).filter(f => /^format-\d\.out\.json$/.test(f)).flatMap(f => J(`agents/${f}`)).map(b => [b.book_id, b]));
// the format readers open the note with MANUSCRIPT / NOT PRINTED for a hand-written book; a printed book with hand
// annotations is mentioned mid-note and stays in
const isMS = b => /^\s*(MANUSCRIPT|NOT PRINTED)/i.test(`${fmt.get(b)?.notes || ''}`);
const ms = draw.filter(b => isMS(b.book_id)).map(b => b.book_id);
const books = draw.filter(b => !isMS(b.book_id));
const keep = new Set(books.map(b => b.book_id));
const R = rows.filter(r => keep.has(r.book_id));

const ALL = ['long_s', 'bleed', 'loop', 'interleave', 'truncation', 'empty'];
// After the by-eye check: counted classes and their repair route. Loop is FIXABLE in the brief, but by eye 3 of the
// 4 real loops had also lost the page's text after the loop, so it is routed to re-read here.
const COUNTED = ['long_s', 'bleed', 'loop'];
const ROUTE = { long_s: 'fix', bleed: 'fix', loop: 'reread' };
const fix = r => r.flags.long_s || r.flags.bleed, rer = r => r.flags.loop, any = r => fix(r) || rer(r);
const pct = (a, b) => b ? +(100 * a / b).toFixed(2) : null;

// ---------------------------------------------------------------- by-eye precision
const leaves = J('leaves.json').filter(x => x.use.startsWith('eye'));
const eyeFiles = fs.readdirSync(path.join(OUT, 'agents')).filter(f => /^eye-(\d|r2)\.out\.json$/.test(f));
const eye = new Map(eyeFiles.flatMap(f => J(`agents/${f}`)).map(e => [e.slug, e]));
const flagNow = new Map(R.map(r => [`${r.book_id}-p${r.page_number}`, r]));
const prec = {};
for (const k of ALL) {
  const f = leaves.filter(x => eye.has(x.slug) && flagNow.get(x.slug)?.flags[k] && !isMS(x.book_id));
  const tp = f.filter(x => eye.get(x.slug)[k]).length; const w = wilson(tp, f.length);
  prec[k] = { flagged_checked: f.length, confirmed: tp, precision: f.length ? +(tp / f.length).toFixed(2) : null, ci95: f.length ? [+w[0].toFixed(2), +w[1].toFixed(2)] : null };
}
const unfl = leaves.filter(x => eye.has(x.slug) && flagNow.get(x.slug) && !any(flagNow.get(x.slug)) && !isMS(x.book_id));
const miss = Object.fromEntries(ALL.map(k => [k, unfl.filter(x => eye.get(x.slug)[k]).length]));
// the round-1 RANDOM unflagged draw (leaves.mjs: 10 text pages no round-1 detector flagged) — the only by-eye cell
// that is a random sample of anything; everything else was chosen because a detector fired
const rnd10 = leaves.filter(x => x.use === 'eye' && x.flagged === null && eye.has(x.slug) && !isMS(x.book_id));
const eyeRandom = { checked: rnd10.length, needs_reread: rnd10.filter(x => eye.get(x.slug).needs_reread).length, by_class: Object.fromEntries(ALL.map(k => [k, rnd10.filter(x => eye.get(x.slug)[k]).length])), other_noted: rnd10.filter(x => eye.get(x.slug).other).length };
const allEye = leaves.filter(x => eye.has(x.slug) && !isMS(x.book_id));
const eyeAll = { checked: allEye.length, needs_reread: allEye.filter(x => eye.get(x.slug).needs_reread).length,
  needs_reread_not_flagged_by_any_counted: allEye.filter(x => eye.get(x.slug).needs_reread && flagNow.get(x.slug) && !any(flagNow.get(x.slug))).length,
  needs_reread_flagged_loop: allEye.filter(x => eye.get(x.slug).needs_reread && flagNow.get(x.slug)?.flags.loop).length };
const eyeRR = { unflagged_checked: unfl.length, unflagged_needs_reread: unfl.filter(x => eye.get(x.slug).needs_reread).length, unflagged_by_eye_class: miss };

// ---------------------------------------------------------------- prevalence
function cell(rs) {
  const o = { books: new Set(rs.map(r => r.book_id)).size, pages: rs.length };
  for (const k of COUNTED) o[k] = pct(rs.filter(r => r.flags[k]).length, rs.length);
  o.fixable = pct(rs.filter(fix).length, rs.length); o.reread = pct(rs.filter(rer).length, rs.length); o.any = pct(rs.filter(any).length, rs.length);
  o.text_repair_share_of_defective = pct(rs.filter(r => fix(r) && !rer(r)).length, rs.filter(any).length);
  // book-mean (each book weighs one) — the pooled rate is dominated by long books
  const byB = new Map(); for (const r of rs) (byB.get(r.book_id) || byB.set(r.book_id, []).get(r.book_id)).push(r);
  const bm = f => +(100 * [...byB.values()].reduce((a, x) => a + x.filter(f).length / x.length, 0) / byB.size).toFixed(2);
  o.book_mean_any = bm(any); o.book_mean_long_s = bm(r => r.flags.long_s); o.book_mean_bleed = bm(r => r.flags.bleed);
  return o;
}
const by = keyOf => { const g = {}; for (const r of R) { const k = keyOf(r); if (k == null) continue; (g[k] ||= []).push(r); } return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, cell(v)])); };
const B = new Map(books.map(b => [b.book_id, b]));
const F = id => fmt.get(id) || {};
const prevalence = {
  all: cell(R),
  engine: by(r => B.get(r.book_id).engine), century: by(r => B.get(r.book_id).century),
  typeface: by(r => F(r.book_id).typeface || 'unlabelled'), columns: by(r => String(F(r.book_id).columns ?? '?')),
  side_notes: by(r => String(!!F(r.book_id).side_notes)), greek: by(r => String(!!F(r.book_id).greek)),
  long_s_printed: by(r => String(!!F(r.book_id).long_s_printed)), spread: by(r => String(!!F(r.book_id).spread)),
  engine_x_long_s_printed: by(r => `${B.get(r.book_id).engine}|ſ printed=${!!F(r.book_id).long_s_printed}`),
};
const raw = Object.fromEntries(ALL.map(k => [k, R.filter(r => r.flags[k]).length]));

// ---------------------------------------------------------------- the 25-page question
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(25);
const rank = a => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(a.length); for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
const spearman = (a, b) => { const x = rank(a), y = rank(b), n = a.length, mx = x.reduce((p, q) => p + q) / n, my = y.reduce((p, q) => p + q) / n; let c = 0, vx = 0, vy = 0; for (let i = 0; i < n; i++) { c += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; } return vx && vy ? c / Math.sqrt(vx * vy) : null; };
const pages = new Map(); for (const r of R) (pages.get(r.book_id) || pages.set(r.book_id, []).get(r.book_id)).push(r);
for (const v of pages.values()) v.sort((a, b) => a.page_number - b.page_number);
const first = v => v.slice(0, 25), spread = v => Array.from({ length: 25 }, (_, i) => v[Math.floor((i + 0.5) * v.length / 25)]);
const random = v => { const a = [...v]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, 25); };
const METRICS = { long_s: r => r.flags.long_s, bleed: r => r.flags.bleed, fixable: fix, reread: rer, any };
const RULES = [
  { name: 'long-s repair: ≥ 20% of pages long-s', m: 'long_s', t: 0.20 },
  { name: 'long-s repair: ≥ 5% of pages long-s', m: 'long_s', t: 0.05 },
  { name: 'bleed clean-up: ≥ 2% of pages bleed', m: 'bleed', t: 0.02 },
  { name: 're-read whole book: ≥ 10% of pages need re-read', m: 'reread', t: 0.10 },
  { name: 're-read whole book: ≥ 1% of pages need re-read', m: 'reread', t: 0.01 },
  { name: 'any action: ≥ 10% of pages defective', m: 'any', t: 0.10 },
];
const ids = [...pages.keys()];
const rate = (v, f) => v.filter(f).length / v.length;
const q25 = { books: ids.length, spearman: {}, rules: [], mean_abs_error_pts: {} };
for (const [m, f] of Object.entries(METRICS)) {
  const whole = ids.map(id => rate(pages.get(id), f)), a = ids.map(id => rate(first(pages.get(id)), f)), b = ids.map(id => rate(spread(pages.get(id)), f));
  const reps = Array.from({ length: 200 }, () => ids.map(id => rate(random(pages.get(id)), f)));
  q25.spearman[m] = { first25: +spearman(a, whole)?.toFixed(2), spread25: +spearman(b, whole)?.toFixed(2), random25_mean: +(reps.reduce((s, r) => s + spearman(r, whole), 0) / reps.length).toFixed(2),
    whole_book_median_pct: +(100 * [...whole].sort((x, y) => x - y)[whole.length >> 1]).toFixed(1), books_with_any: whole.filter(x => x > 0).length };
  const mae = x => +(100 * x.reduce((s, v, i) => s + Math.abs(v - whole[i]), 0) / x.length).toFixed(2);
  q25.mean_abs_error_pts[m] = { first25: mae(a), spread25: mae(b), first25_bias: +(100 * a.reduce((s, v, i) => s + v - whole[i], 0) / a.length).toFixed(2) };
  q25[`_${m}`] = { whole, a, b, reps };
}
for (const rule of RULES) {
  const { whole, a, b, reps } = q25[`_${rule.m}`];
  const D = x => x >= rule.t; const pos = whole.filter(D).length;
  const agree = x => x.filter((v, i) => D(v) === D(whole[i])).length;
  const fn = x => x.filter((v, i) => !D(v) && D(whole[i])).length, fp = x => x.filter((v, i) => D(v) && !D(whole[i])).length;
  q25.rules.push({ rule: rule.name, whole_book_yes: pos, first25: { agree: agree(a), miss: fn(a), false_alarm: fp(a) }, spread25: { agree: agree(b), miss: fn(b), false_alarm: fp(b) },
    random25_mean_agree: +(reps.reduce((s, r) => s + agree(r), 0) / reps.length).toFixed(1) });
}
for (const m of Object.keys(METRICS)) delete q25[`_${m}`];
// front matter: what the first 25 pages are
const fm = R.filter(r => r.idx < 25); const fmTypes = {}; for (const r of fm) fmTypes[r.page_type || 'none'] = (fmTypes[r.page_type || 'none'] || 0) + 1;
q25.first25_page_types = Object.fromEntries(Object.entries(fmTypes).sort((a, b) => b[1] - a[1]).slice(0, 8));
q25.first25_text_share = pct(fm.filter(r => r.page_type === 'text' || r.page_type == null).length, fm.length);
q25.whole_text_share = pct(R.filter(r => r.page_type === 'text' || r.page_type == null).length, R.length);

// ---------------------------------------------------------------- format summary
const fmtCount = k => { const c = {}; for (const b of books) { const v = String(F(b.book_id)[k] ?? '?'); c[v] = (c[v] || 0) + 1; } return c; };
const formats = Object.fromEntries(['typeface', 'columns', 'side_notes', 'greek', 'long_s_printed', 'spread'].map(k => [k, fmtCount(k)]));
const controls = J('controls.json');
const report = { built_at: new Date().toISOString(), drawn: draw.length, manuscripts_excluded: ms.length, books: books.length, pages: R.length,
  counted: COUNTED, route: ROUTE, raw_flags: raw, precision: prec, eye_unflagged: eyeRR, eye_random_unflagged: eyeRandom, eye_all: eyeAll, prevalence, q25, formats, gate: controls.gate };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));

// ---------------------------------------------------------------- markdown
const md = [];
const tbl = (title, g) => { md.push(`\n**${title}**\n`, '| | books | pages | long-s % | bleed % | loop % | any % | text repair fixes (% of defective) |', '|---|---|---|---|---|---|---|---|');
  for (const [k, v] of Object.entries(g)) md.push(`| ${k} | ${v.books} | ${v.pages} | ${v.long_s} | ${v.bleed} | ${v.loop} | ${v.any} | ${v.text_repair_share_of_defective ?? '—'} |`); };
tbl('All', { all: prevalence.all }); tbl('By engine (majority `ocr.model`)', prevalence.engine); tbl('By century', prevalence.century);
tbl('By typeface (Opus, 2 leaves/book)', prevalence.typeface); tbl('By columns', prevalence.columns); tbl('Side-notes printed', prevalence.side_notes);
tbl('Greek printed', prevalence.greek); tbl('Long s printed', prevalence.long_s_printed); tbl('Engine × long s printed', prevalence.engine_x_long_s_printed);
md.push('\n**By-eye precision (Opus, page image vs stored text)**\n', '| detector | flagged & checked | confirmed | precision (95% CI) |', '|---|---|---|---|');
for (const [k, v] of Object.entries(prec)) md.push(`| ${k} | ${v.flagged_checked} | ${v.confirmed} | ${v.precision ?? '—'} ${v.ci95 ? `(${v.ci95[0]}–${v.ci95[1]})` : ''} |`);
md.push('\n**25 pages vs the whole book — Spearman ρ of the per-book rate**\n', '| metric | books with any | first 25 | 25 spread | random 25 (mean of 200) | MAE first / spread (pts) | first-25 bias (pts) |', '|---|---|---|---|---|---|---|');
for (const [m, v] of Object.entries(q25.spearman)) md.push(`| ${m} | ${v.books_with_any} | ${v.first25} | ${v.spread25} | ${v.random25_mean} | ${q25.mean_abs_error_pts[m].first25} / ${q25.mean_abs_error_pts[m].spread25} | ${q25.mean_abs_error_pts[m].first25_bias} |`);
md.push('\n**Decision agreement with the whole-book decision (n books)**\n', '| rule | whole-book yes | first 25: agree / miss / false alarm | 25 spread: agree / miss / false alarm | random 25 mean agree |', '|---|---|---|---|---|');
for (const r of q25.rules) md.push(`| ${r.rule} | ${r.whole_book_yes} | ${r.first25.agree} / ${r.first25.miss} / ${r.first25.false_alarm} | ${r.spread25.agree} / ${r.spread25.miss} / ${r.spread25.false_alarm} | ${r.random25_mean_agree} |`);
fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');
console.log(JSON.stringify({ books: books.length, manuscripts_excluded: ms.length, pages: R.length, raw_flags: raw, precision: Object.fromEntries(Object.entries(prec).map(([k, v]) => [k, `${v.confirmed}/${v.flagged_checked}`])), eye_unflagged: eyeRR, eye_random_unflagged: eyeRandom, eye_all: eyeAll }));

#!/usr/bin/env node
/**
 * latin-gpu25-5924/score.mjs — score the GPU reads of task 79-latin-gpu25 against the stored OCR (#5924) and decide,
 * per book, whether it can go to GPU OCR; then ask whether the 25-spread verdict matches the whole-book verdict.
 *
 * PRIOR ART: scripts/eval/latin-bakeoff-5924/score.mjs (views / lev / the order-tolerant N view, IMPORTED unchanged, with
 *   its post-hoc --fold-f so ſ and f both fold to s; it scores against hand references, this against stored OCR, so
 *   every number here is AGREEMENT, not accuracy); scripts/lib/ocr-loop-guard.mjs loopVerdict (the write-time loop
 *   test, used unchanged); scripts/eval/latin-repair-census-5924/analyze.mjs (the spread-vs-first-25 question, there
 *   for text defects).
 *
 *   node score.mjs <reads dir with GS/DS/GW.jsonl[.gz]> [--refs $JOB_SCRATCH/refs.jsonl.gz] [--labels format-labels.json]
 * Writes $JOB_SCRATCH/pages-scored.jsonl.gz (per page) and ./results/summary.json (per book + decision tables; scores
 * and counts only). The RULE (stated in the experiment file before any read was scored):
 *   a page counts when the stored text has >= 100 letters in view N; a page is CATASTROPHIC if the GPU text is empty or
 *   its N-view disagreement CER > 0.50; a LOOP is loopVerdict(...).refuse (reported, and a loop page is also counted
 *   catastrophic only if it meets the CER/empty test). A book is GPU-OK if its median page disagreement <= 0.02 and it
 *   has no catastrophic page.
 */
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
// score.mjs runs main() on import; --self-test makes that its harmless self-test, --fold-f selects the ſ/f fold
process.argv.push('--self-test', '--fold-f');
const { views, lev } = await import('../latin-bakeoff-5924/score.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCR = process.env.JOB_SCRATCH || '.';
const MIN_REF = 100, CAT = 0.5, OK_MEDIAN = 0.02;
const gz = (f) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : fs.readFileSync(f, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
const plan = JSON.parse(fs.readFileSync(path.join(HERE, 'gpu-plan.json'), 'utf8'));
const labels = new Map(JSON.parse(fs.readFileSync(opt('labels', path.join(SCR, 'format-labels.json')), 'utf8')).map((b) => [b.book_id, b]));
const refs = gz(opt('refs', path.join(SCR, 'refs.jsonl.gz')));
const refOf = { spread: new Map(), whole: new Map() };
for (const r of refs) refOf[r.set].set(r.page_id, r);
const dir = argv[0];
const loadArm = (a) => {
  const f = ['.jsonl', '.jsonl.gz'].map((x) => path.join(dir, a + x)).find((x) => fs.existsSync(x)); if (!f) return null;
  const m = new Map(); for (const r of gz(f)) m.set(r.page_id, r); return m;
};
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length ? (s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) : null; };
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

// The stored text carries page metadata the GPU engine never emits: drop those blocks with their content (the list in
// scripts/eval/benchmark-score.mjs normAlpha), keep the content of every other tag (margin, header, page-num, sig,
// term…: printed on the leaf), drop the tags themselves.
const META = /<(warning|meta|image-desc|figure|note|scan-quality|language|page-type|columns|detected-images|vocab)\b[^>]*>[\s\S]*?<\/\1>/gi;
export const refBody = (t) => String(t || '').replace(META, '\n').replace(/<[^>\n]{1,200}>/g, '\n').replace(/->|<-/g, ' ');
function scorePage(ref, row) {
  const text = row && !row.error ? String(row.text || '') : '';
  const v = views(refBody(ref.text), text || ' ');
  const refN = v.R.N.length;
  const lv = loopVerdict(text);
  const N = refN ? Math.min(1, lev(v.R.N, v.H.Nr) / refN) : null;
  const empty = !text.trim() || v.H.N.length === 0;
  return { page_id: ref.page_id, book_id: ref.book_id, page_number: ref.page_number, ref_letters: refN, hyp_letters: v.H.N.length,
    counts: refN >= MIN_REF, N: empty ? 1 : r4(N), empty, missing: !row || !!row.error, loop: !!lv.refuse, cap: row?.finish === 'length',
    catastrophic: refN >= MIN_REF && (empty || N > CAT) };
}
function verdict(rows) {
  const c = rows.filter((r) => r.counts);
  const med = median(c.map((r) => r.N)); const cat = c.filter((r) => r.catastrophic).length;
  return { pages: rows.length, counted: c.length, median_N: r4(med), catastrophic: cat, loops: rows.filter((r) => r.loop).length,
    cap: rows.filter((r) => r.cap).length, missing: rows.filter((r) => r.missing).length,
    ok: c.length > 0 && med <= OK_MEDIAN && cat === 0, ok_median_only: c.length > 0 && med <= OK_MEDIAN };
}
const fmt = (id) => { const l = labels.get(id) || {}; return { gothic: l.typeface === 'gothic', two_column: l.columns === 2, greek: !!l.greek, side_notes: !!l.side_notes }; };

const out = { rule: { min_ref_letters: MIN_REF, catastrophic_cer: CAT, ok_median: OK_MEDIAN, view: 'latin-bakeoff-5924 N, order-tolerant, --fold-f (ſ,f -> s)', measure: 'agreement CER vs stored pages.ocr.data (not accuracy)' }, arms: {} };
const pageRows = [];
const byBook = {};
for (const [arm, set] of [['GS', 'spread'], ['DS', 'spread'], ['GW', 'whole']]) {
  const reads = loadArm(arm); if (!reads) { console.error(`no ${arm} reads`); continue; }
  const rows = [...refOf[set].values()].map((ref) => ({ arm, ...scorePage(ref, reads.get(ref.page_id)) }));
  pageRows.push(...rows);
  const books = {}; for (const r of rows) (books[r.book_id] ||= []).push(r);
  byBook[arm] = books;
  const per = Object.fromEntries(Object.entries(books).map(([b, rs]) => [b, verdict(rs)]));
  out.arms[arm] = { pages: rows.length, books: Object.keys(books).length, ok_books: Object.values(per).filter((v) => v.ok).length,
    median_N_all: r4(median(rows.filter((r) => r.counts).map((r) => r.N))), catastrophic: rows.filter((r) => r.catastrophic).length,
    loops: rows.filter((r) => r.loop).length, cap: rows.filter((r) => r.cap).length, missing: rows.filter((r) => r.missing).length, per_book: per };
}

// 25 spread vs whole, on the 20 whole books: spread verdict from GS (its own read of the spread pages) and from the GW
// rows at the same page numbers (same engine, whole-book pass), plus the first 25 counted pages of GW for contrast
if (byBook.GW) {
  const spreadPages = new Map(plan.spread25.map((b) => [b.book_id, new Set(b.pages)]));
  const tab = [];
  for (const w of plan.whole) {
    const all = (byBook.GW[w.book_id] || []).sort((a, b) => a.page_number - b.page_number);
    const whole = verdict(all);
    const sp = byBook.GS?.[w.book_id] ? verdict(byBook.GS[w.book_id]) : null;
    const spW = verdict(all.filter((r) => spreadPages.get(w.book_id)?.has(r.page_number)));
    const first = verdict(all.slice(0, 25));
    const sd = byBook.DS?.[w.book_id] ? verdict(byBook.DS[w.book_id]) : null;
    tab.push({ book_id: w.book_id, quota: w.quota, format: fmt(w.book_id), whole, spread_GS: sp, spread_from_GW: spW, first25_GW: first, spread_DS: sd,
      worst_whole_N: r4(Math.max(0, ...all.filter((r) => r.counts).map((r) => r.N))) });
  }
  const agree = (k, f = (v) => v.ok) => { const t = tab.filter((x) => x[k]); const m = { n: t.length, agree: 0, both_ok: 0, both_fail: 0, spread_ok_whole_fail: 0, spread_fail_whole_ok: 0 };
    for (const x of t) { const s = f(x[k]), w = f(x.whole); if (s === w) m.agree++; if (s && w) m.both_ok++; else if (!s && !w) m.both_fail++; else if (s) m.spread_ok_whole_fail++; else m.spread_fail_whole_ok++; } return m; };
  out.whole_vs_spread = { books: tab,
    agreement: { spread_GS: agree('spread_GS'), spread_from_GW: agree('spread_from_GW'), first25_GW: agree('first25_GW'),
      median_only_spread_GS: agree('spread_GS', (v) => v.ok_median_only), median_only_first25: agree('first25_GW', (v) => v.ok_median_only) },
    median_abs_gap_spread_vs_whole: r4(median(tab.filter((x) => x.spread_GS).map((x) => Math.abs(x.spread_GS.median_N - x.whole.median_N)))),
    median_abs_gap_first25_vs_whole: r4(median(tab.map((x) => Math.abs(x.first25_GW.median_N - x.whole.median_N)))) };
}
// which formats predict GPU failure: fail rate by format flag over the 54 spread books (GS) and the 20 whole books (GW)
const byFormat = (arm) => {
  const per = out.arms[arm]?.per_book; if (!per) return null; const r = {};
  for (const k of ['gothic', 'two_column', 'greek', 'side_notes']) {
    const [yes, no] = [true, false].map((v) => Object.entries(per).filter(([b]) => fmt(b)[k] === v));
    const rate = (xs) => ({ n: xs.length, fail: xs.filter(([, v]) => !v.ok).length, median_N: r4(median(xs.map(([, v]) => v.median_N))) });
    r[k] = { with: rate(yes), without: rate(no) };
  }
  return r;
};
out.by_format = { GS: byFormat('GS'), DS: byFormat('DS'), GW: byFormat('GW') };
if (byBook.GS && byBook.DS) {
  const p = out.arms.GS.per_book, q = out.arms.DS.per_book; const ids = Object.keys(p).filter((b) => q[b]);
  out.student_vs_stock = { books: ids.length, ok_GS: ids.filter((b) => p[b].ok).length, ok_DS: ids.filter((b) => q[b].ok).length,
    DS_lower_median: ids.filter((b) => q[b].median_N < p[b].median_N).length, DS_higher_median: ids.filter((b) => q[b].median_N > p[b].median_N).length };
}
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'results', 'summary.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(SCR, 'pages-scored.jsonl.gz'), zlib.gzipSync(pageRows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
for (const [a, s] of Object.entries(out.arms)) console.log(a, JSON.stringify({ ...s, per_book: undefined }));
if (out.whole_vs_spread) console.log(JSON.stringify(out.whole_vs_spread.agreement), out.whole_vs_spread.median_abs_gap_spread_vs_whole, out.whole_vs_spread.median_abs_gap_first25_vs_whole);
console.log(JSON.stringify(out.student_vs_stock || {}));

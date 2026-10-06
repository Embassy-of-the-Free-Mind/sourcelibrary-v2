#!/usr/bin/env node
/**
 * Fortnightly spot check (#5914), stage 2 scorer: validate a run's results.json against its sample.json, then
 * compute the fortnight's numbers and the rolling 8-week window, with CIs resampled by BOOK.
 *
 * PRIOR ART: `../translation-corpus-audit/score.mjs` scores the monthly audit's one-page-per-book verdicts with
 * post-stratified weights and a control gate; this instrument has neither (10 unweighted books, 3-page runs),
 * so it reuses only the CI machinery, `bootstrapRatioCI` / `bootstrapCI` from `../lib/paired-stats.mjs`.
 *
 *   node scripts/eval/spot-check/score.mjs --date 2026-10-19 [--root scripts/eval/results/spot-check] [--window-days 56]
 *
 * Exit 0: wrote <root>/<date>/report.json + report.md and printed the series row.
 * Exit 2: results.json is missing, incomplete or malformed (the list is printed) — fix the results, never the scorer.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bootstrapRatioCI, bootstrapCI, resetSeed } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DATE = opt('date');
const ROOT = opt('root', 'scripts/eval/results/spot-check');
const WINDOW_DAYS = Number(opt('window-days', 56));
if (!DATE) throw new Error('--date YYYY-MM-DD required');

export const SEVERITY = { minor: 1, moderate: 2, serious: 3 };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Every error item on a page, whichever list it was filed under. */
const items = (p) => [...(p.ocr_errors ?? []), ...(p.tr_errors ?? []), ...(p.other ?? [])].filter((e) => e && typeof e === 'object');

function validate(dir) {
  const problems = [];
  const sample = read(join(dir, 'sample.json'));
  if (!existsSync(join(dir, 'results.json'))) return { problems: [`${dir}/results.json missing`] };
  const results = read(join(dir, 'results.json'));
  const byId = new Map(results.map((r) => [r.book_id, r]));
  for (const b of sample) {
    const r = byId.get(b.book_id);
    if (!r) { problems.push(`book ${b.slot} ${b.book_id}: no result`); continue; }
    if (typeof r.on_sight_defect !== 'boolean') problems.push(`${b.book_id}: on_sight_defect not boolean`);
    const want = new Set(b.pages.map((p) => String(p.page_number)));
    const got = new Set((r.pages ?? []).map((p) => String(p.page_number)));
    for (const n of want) if (!got.has(n)) problems.push(`${b.book_id}: page ${n} not reviewed`);
    for (const p of r.pages ?? []) {
      for (const k of ['ocr_score', 'tr_score']) if (!(p[k] >= 1 && p[k] <= 5) && p[k] !== null) problems.push(`${b.book_id} p${p.page_number}: ${k} ${p[k]}`);
      for (const e of items(p)) {
        if (!(e.severity in SEVERITY)) problems.push(`${b.book_id} p${p.page_number}: severity ${e.severity}`);
        if (e.severity === 'serious' && !e.class) problems.push(`${b.book_id} p${p.page_number}: serious error without a taxonomy class`);
      }
    }
  }
  for (const r of results) if (!sample.some((b) => b.book_id === r.book_id)) problems.push(`${r.book_id}: result for a book not in the sample`);
  return { problems, sample, results };
}

/** Per-book units for one run. */
function units(results) {
  return results.map((r) => {
    const pages = r.pages ?? [];
    const seriousPages = pages.filter((p) => items(p).some((e) => e.severity === 'serious')).length;
    return { book_id: r.book_id, pages: pages.length, seriousPages, serious: pages.reduce((s, p) => s + items(p).filter((e) => e.severity === 'serious').length, 0), defect: r.on_sight_defect ? 1 : 0, r };
  });
}

/** Defect classes ranked by pages × severity: per page, a class scores its worst severity there (3/2/1). */
function topClasses(results, k = 3) {
  const score = new Map(), pagesWith = new Map();
  for (const r of results) for (const p of r.pages ?? []) {
    const worst = new Map();
    for (const e of items(p)) if (e.class) worst.set(e.class, Math.max(worst.get(e.class) ?? 0, SEVERITY[e.severity] ?? 0));
    for (const [c, w] of worst) { score.set(c, (score.get(c) ?? 0) + w); pagesWith.set(c, (pagesWith.get(c) ?? 0) + 1); }
  }
  return [...score].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map(([c, s]) => ({ class: c, score: s, pages: pagesWith.get(c) }));
}

function summarise(us) {
  resetSeed(0x5914);
  const pr = bootstrapRatioCI(us.map((u) => u.seriousPages), us.map((u) => u.pages));
  const br = us.length ? us.reduce((s, u) => s + u.defect, 0) / us.length : null;
  return {
    books: us.length,
    pages: pr.denom,
    pages_with_serious: us.reduce((s, u) => s + u.seriousPages, 0),
    serious_errors: us.reduce((s, u) => s + u.serious, 0),
    page_rate: pr.rate, page_rate_ci: pr.ci,
    books_on_sight_defect: us.reduce((s, u) => s + u.defect, 0),
    book_defect_rate: br, book_defect_rate_ci: bootstrapCI(us.map((u) => u.defect)),
  };
}

const run = validate(join(ROOT, DATE));
if (run.problems.length) { console.error(`results incomplete or malformed (${run.problems.length}):\n  ${run.problems.join('\n  ')}`); process.exit(2); }

// A run's frame (public library vs canon shelves). The window pools only runs from the same frame — a canon-shelf
// draw is a different population and would move the public rate for a reason that is not quality.
const frameOf = (d) => { try { return read(join(ROOT, d, 'draw-log.json')).frame ?? '?'; } catch { return '?'; } };
const frame = frameOf(DATE);
const dayMs = 86400000;
const end = Date.parse(DATE);
const windowRuns = readdirSync(ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  .filter((d) => Date.parse(d) <= end && Date.parse(d) > end - WINDOW_DAYS * dayMs)
  .filter((d) => existsSync(join(ROOT, d, 'results.json')) && frameOf(d) === frame)
  .sort();
const windowResults = [];
for (const d of windowRuns) {
  const v = d === DATE ? run : validate(join(ROOT, d));
  if (v.problems?.length) { console.error(`skipping ${d} in the window: ${v.problems.length} problems`); continue; }
  windowResults.push(...v.results);
}

const fortnight = summarise(units(run.results));
const windowSum = { runs: windowRuns, ...summarise(units(windowResults)) };
const report = { issue: 5914, date: DATE, fortnight, window: windowSum, window_days: WINDOW_DAYS, top_classes: topClasses(run.results), window_top_classes: topClasses(windowResults) };
writeFileSync(join(ROOT, DATE, 'report.json'), JSON.stringify(report, null, 1));

const pct = (x) => (x == null ? '—' : (100 * x).toFixed(0));
const ci = (c) => (c ? `${pct(c[0])}–${pct(c[1])}` : '—');
const row = `| ${DATE} | ${frame} | ${fortnight.books} | ${fortnight.pages} | ${fortnight.pages_with_serious} (${pct(fortnight.page_rate)}%) | ${fortnight.books_on_sight_defect} | ` +
  `${pct(windowSum.page_rate)}% (${ci(windowSum.page_rate_ci)}), ${windowSum.books} books | ${pct(windowSum.book_defect_rate)}% (${ci(windowSum.book_defect_rate_ci)}) | ` +
  `${report.top_classes.map((c) => `${c.class} ${c.pages}p`).join(', ') || '—'} |`;
const md = [
  `# Spot check ${DATE} (#5914)`, '',
  `Fortnight: ${fortnight.books} books, ${fortnight.pages} pages; ${fortnight.pages_with_serious} pages with ≥ 1 serious error (${fortnight.serious_errors} serious errors); ${fortnight.books_on_sight_defect} books with an on-sight defect.`,
  `Rolling ${WINDOW_DAYS / 7}-week window (${windowRuns.join(', ')}): pages with a serious error ${pct(windowSum.page_rate)}% (95% CI ${ci(windowSum.page_rate_ci)}, resampled by book, n=${windowSum.books} books); books with an on-sight defect ${pct(windowSum.book_defect_rate)}% (${ci(windowSum.book_defect_rate_ci)}).`,
  `Top classes this fortnight (pages × severity): ${report.top_classes.map((c) => `${c.class} (score ${c.score}, ${c.pages} pages)`).join('; ') || 'none'}.`,
  '', 'Series row:', '', row, '',
].join('\n');
writeFileSync(join(ROOT, DATE, 'report.md'), md);
console.log(row);

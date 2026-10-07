#!/usr/bin/env node
/**
 * PRIOR ART: score.mjs scores ONE frame (the fortnightly series) and writes the series row; it has no strata and no
 * weights. This scores an overview-draw.mjs run: per stratum, and a frame-weighted total, so a partner-facing
 * number says which shelves it covers and how much each counts. CIs use paired-stats.mjs bootstrapRatioCI
 * (resampling BOOKS, the cluster unit) — unchanged.
 *
 *   node scripts/eval/spot-check/overview-score.mjs --dir scripts/eval/results/spot-check/overview-2026-10-07
 *
 * Reads draw-log.json (strata, frame sizes) and reviews/<stratum>.json (REVIEWER.md + OVERVIEW-ADDENDUM.md schema).
 * Writes report.json and report.md. Metrics, per stratum:
 *   serious_page_rate   pages with ≥ 1 serious error / pages reviewed (CI by book)
 *   wrong_leaf_rate     pages with right_page = "no" / pages reviewed
 *   mean_ocr, mean_tr   mean 1–5 scores (null-safe)
 *   on_sight_books      books with on_sight_defect
 *   fit_to_show         show / show_with_caveat / do_not_show counts
 * Weighted total: each stratum's rate × its frame size / Σ frame sizes. With 4 books a stratum, read a stratum's CI
 * before its point estimate.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bootstrapRatioCI, resetSeed } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const dir = args[args.indexOf('--dir') + 1];
const log = JSON.parse(readFileSync(join(dir, 'draw-log.json'), 'utf8'));
// A --picked run (overview-draw.mjs) holds books chosen for interest: its shares are not rates of anything.
if (log.mode === 'picked') { console.error(`${dir} is a hand-picked curation check: no rates. Its verdicts go to a private shelf with curation-shelf.mjs.`); process.exit(1); }
resetSeed(log.seed);

const serious = (p) => [...(p.ocr_errors || []), ...(p.tr_errors || []), ...(p.other || [])].some((e) => e.severity === 'serious') || p.right_page === 'no';
const avg = (xs) => { const v = xs.filter((x) => typeof x === 'number'); return v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(2) : null; };
const pct = (x) => (x == null ? '—' : `${Math.round(100 * x)}%`);

const strata = [];
for (const st of log.strata) {
  const f = join(dir, 'reviews', `${st.name}.json`);
  if (!existsSync(f)) { strata.push({ name: st.name, frame_size: st.frame_size, missing: true }); continue; }
  // Soft-hidden records (page_number <= 0, page-counts.mjs) never render, so they are not part of what a reader meets.
  const books = JSON.parse(readFileSync(f, 'utf8')).map((b) => ({ ...b, pages: b.pages.filter((p) => p.page_number > 0) }));
  const pages = books.flatMap((b) => b.pages);
  const ser = bootstrapRatioCI(books.map((b) => b.pages.filter(serious).length), books.map((b) => b.pages.length));
  const fit = books.reduce((m, b) => ({ ...m, [b.fit_to_show ?? 'unrecorded']: (m[b.fit_to_show ?? 'unrecorded'] || 0) + 1 }), {});
  strata.push({ name: st.name, desc: st.desc, frame_size: st.frame_size, books: books.length, pages: pages.length,
    serious_page_rate: ser.rate, serious_ci: ser.ci, wrong_leaf_rate: pages.filter((p) => p.right_page === 'no').length / pages.length,
    mean_ocr: avg(pages.map((p) => p.ocr_score)), mean_tr: avg(pages.map((p) => p.tr_score)),
    on_sight_books: books.filter((b) => b.on_sight_defect).length, fit_to_show: fit,
    showcase: books.flatMap((b) => (b.showcase_pages || []).map((n) => `https://sourcelibrary.org/book/${b.book_id}?page=${n}`)),
    verdicts: books.map((b) => ({ book_id: b.book_id, title: b.title, fit: b.fit_to_show, summary: b.reader_summary ?? b.book_verdict })) });
}
const done = strata.filter((s) => !s.missing);
const W = done.reduce((s, x) => s + x.frame_size, 0);
const weighted = W ? done.reduce((s, x) => s + x.serious_page_rate * x.frame_size, 0) / W : null;
const report = { issue: 6056, dir, weighted_serious_page_rate: weighted, weight_basis: 'frame_size (books in stratum frame)', strata };
writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));

const md = [`# Shelf overview (${dir.split('/').pop()})`, '',
  `Frame-weighted share of pages with a serious error: **${pct(weighted)}** over ${done.length} strata (weights = books in each stratum's frame).`, '',
  '| stratum | frame | books | pages | serious pages (95% CI, by book) | wrong leaf | OCR | EN | on-sight | show / caveat / don\'t |', '|---|---|---|---|---|---|---|---|---|---|',
  ...strata.map((s) => s.missing ? `| ${s.name} | ${s.frame_size} | — | — | not reviewed | | | | | |`
    : `| ${s.name} | ${s.frame_size} | ${s.books} | ${s.pages} | ${pct(s.serious_page_rate)} (${s.serious_ci ? s.serious_ci.map(pct).join('–') : '—'}) | ${pct(s.wrong_leaf_rate)} | ${s.mean_ocr ?? '—'} | ${s.mean_tr ?? '—'} | ${s.on_sight_books}/${s.books} | ${s.fit_to_show.show ?? 0} / ${s.fit_to_show.show_with_caveat ?? 0} / ${s.fit_to_show.do_not_show ?? 0} |`),
  '', '## Showcase pages', '', ...done.flatMap((s) => s.showcase.map((u) => `- ${s.name}: ${u}`)),
  '', '## Per book', '', ...done.flatMap((s) => s.verdicts.map((v) => `- **${s.name}** · ${v.fit ?? '—'} · [${String(v.title).slice(0, 60)}](https://sourcelibrary.org/book/${v.book_id}) — ${v.summary}`))];
writeFileSync(join(dir, 'report.md'), md.join('\n') + '\n');
console.log(md.slice(0, 12).join('\n'));

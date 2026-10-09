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
 *
 * Then, with MONGODB_URI set, one `book_checks` row per reviewed book (#6174, method shelf-overview): the reviewer's
 * fit_to_show as the verdict, the packet's model ids as the text read, and the book's share of its packet's
 * `claude -p` cost when run-reviewers.sh launched it (--meta <its out_dir>/meta; default <dir>/meta). A rerun of the
 * same dir adds nothing.
 * --no-record skips it; without MONGODB_URI it says so and records nothing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bootstrapRatioCI, resetSeed } from '../lib/paired-stats.mjs';
import { recordBookCheck, ensureBookCheckIndexes, provenanceFromPage, readMethod } from '../../lib/book-checks.mjs';
import { seriousPage, seriousClasses, pageFindings, FIT, pageRecords, packetProvenance, runCost, checkedAtOf } from './check-rows.mjs';

const args = process.argv.slice(2);
const dir = args[args.indexOf('--dir') + 1];
const log = JSON.parse(readFileSync(join(dir, 'draw-log.json'), 'utf8'));
// A --picked run (overview-draw.mjs) holds books chosen for interest: its shares are not rates of anything.
if (log.mode === 'picked') { console.error(`${dir} is a hand-picked curation check: no rates. Its verdicts go to a private shelf with curation-shelf.mjs.`); process.exit(1); }
resetSeed(log.seed);

const serious = seriousPage;
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

// ── the record (#6174) ──
if (args.includes('--no-record')) process.exit(0);
if (!process.env.MONGODB_URI) { console.error('book_checks: MONGODB_URI not set, no rows recorded (run with --env-file, or pass --no-record)'); process.exit(0); }
const { MongoClient } = await import('mongodb');
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
await ensureBookCheckIndexes(db);
const version = readMethod('shelf-overview').version;
const metaDir = args.includes('--meta') ? args[args.indexOf('--meta') + 1] : join(dir, 'meta');
const runId = dir.replace(/\/+$/, '').split('/').slice(-1)[0];
let ins = 0, dup = 0, skip = 0;
for (const st of log.strata) {
  const f = join(dir, 'reviews', `${st.name}.json`);
  if (!existsSync(f)) continue;
  const checkedAt = checkedAtOf(f);
  const packets = JSON.parse(readFileSync(join(dir, 'packets', `${st.name}.json`), 'utf8'));
  const reviews = JSON.parse(readFileSync(f, 'utf8'));
  const cost = runCost(metaDir, st.name);
  for (const b of reviews) {
    const verdict = FIT[b.fit_to_show];
    if (!verdict) { console.error(`book_checks: ${b.book_id} has no fit_to_show — not recorded`); skip++; continue; }
    // Every page the reviewer read, soft-hidden (≤ 0) ones included: the record is of the read, and the read's verdict
    // covers them. The report above leaves them out of its RATES, which is a different question.
    const pagesRead = b.pages.map((p) => p.page_number);
    const now = await pageRecords(db, b.book_id, pagesRead, { withText: true });
    let r;
    try { r = await recordBookCheck(db, {
      book_id: b.book_id, checked_at: checkedAt, method_id: 'shelf-overview', method_version: version, run_id: runId,
      frame: { stratum: st.name, seed: log.seed, draw: runId, checked_at_source: 'reviews file (git add or mtime)' },
      pages_read: pagesRead, reader: { kind: 'model', model: cost?.model ?? 'opus', image_opened: true },
      verdict, verdict_source: 'reader', classes: seriousClasses(b.pages), note: b.reader_summary ?? b.book_verdict,
      page_findings: pageFindings(b.pages),
      evidence_path: f,
      text_provenance: packetProvenance({ pagesRead, packetPages: packets.find((x) => x.book_id === b.book_id)?.pages, now, checkedAt, provenanceFromPage }),
      ...(cost ? { subscription_usd_eq: +(cost.usd / reviews.length).toFixed(4) } : {}),
    }); } catch (e) { console.error(`book_checks: ${b.book_id} refused — ${e.message}`); skip++; continue; }
    r.inserted ? ins++ : dup++;
  }
}
console.log(`book_checks: ${ins} recorded, ${dup} already present, ${skip} not recorded (see above)`);
await client.close();

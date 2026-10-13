#!/usr/bin/env node
/**
 * PRIOR ART: overview-score.mjs scores an overview-draw run per stratum with a bootstrap CI over pages-by-book and
 * writes shelf-overview rows. This run has ONE page per book, so the rate is k of n books with a Wilson interval, as
 * review-vocabulary.md rule 3 asks: it uses kOfNBooks/formatKOfN (scripts/lib/review-vocabulary.mjs) for every rate,
 * and check-rows.mjs (seriousPage, pageFindings, packetProvenance, runCost, checkedAtOf) for the row, unchanged.
 *
 * served-score — score a served-draw.mjs run (#6691) and, with --record, write one book_checks row per reviewed book.
 *
 *   node --env-file=.env.production.local scripts/eval/spot-check/served-score.mjs --dir <run dir> [--meta <run-reviewers out>/meta] [--record]
 *
 * Reads draw-log.json (strata, shares), sample.json (lane and DRAW-TIME exposure per page) and reviews/*.json
 * (REVIEWER.md + SERVED-ADDENDUM.md). Writes report.json and report.md:
 *   per stratum: serious on k of n served books (Wilson 95%), text not on the leaf, kinds; share of the frame;
 *   expected served books with a serious page (share × frame × rate) — where repair pays most;
 *   frame-weighted total over the strata reviewed; by the reviewer's by-eye form; every not_this_leaf call.
 * --record writes method served-audit rows (exposure = the draw's, recorded when the page was drawn).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { kOfNBooks, formatKOfN, kindOfFinding, kindLabel, KINDS, INVENTING_KINDS } from '../../lib/review-vocabulary.mjs';
import { recordBookCheck, ensureBookCheckIndexes, provenanceFromPage, readMethod } from '../../lib/book-checks.mjs';
import { seriousPage, seriousClasses, pageFindings, FIT, pageRecords, packetProvenance, runCost, checkedAtOf } from './check-rows.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const dir = opt('dir');
if (!dir) throw new Error('--dir required');
const log = JSON.parse(readFileSync(join(dir, 'draw-log.json'), 'utf8'));
const sample = JSON.parse(readFileSync(join(dir, 'sample.json'), 'utf8'));
const byBook = new Map(sample.map((b) => [b.book_id, b]));
const rdir = join(dir, 'reviews');
const reviewFiles = existsSync(rdir) ? readdirSync(rdir).filter((f) => f.endsWith('.json')) : [];
const reviews = new Map();   // book_id → { review, file }
for (const f of reviewFiles) for (const b of JSON.parse(readFileSync(join(rdir, f), 'utf8'))) if (byBook.has(b.book_id)) reviews.set(b.book_id, { review: b, file: join(rdir, f) });

const errs = (p) => [...(p.ocr_errors || []), ...(p.tr_errors || []), ...(p.other || [])].filter((e) => e && typeof e === 'object');
const seriousKinds = (p) => {
  const ks = errs(p).filter((e) => e.severity === 'serious').map((e) => kindOfFinding(e) ?? 'other');
  if (p.right_page === 'no') ks.push('wrong_leaf');
  return [...new Set(ks)];
};

// One row per page read, carrying the draw's exposure and the book's stratum.
const rows = [];
for (const [id, { review }] of reviews) {
  const s = byBook.get(id);
  for (const p of review.pages || []) {
    if (!(p.page_number > 0)) continue;
    const drawn = s.pages.find((x) => x.page_number === p.page_number);
    rows.push({ book_id: id, page_number: p.page_number, stratum: s.stratum, lane: s.lane, exposure: drawn?.exposure ?? 'unrecorded',
      serious: seriousPage(p), kinds: seriousKinds(p), classes: errs(p).filter((e) => e.severity === 'serious' && e.class).map((e) => String(e.class)),
      form: p.form ?? 'unrecorded', not_this_leaf: p.not_this_leaf === true, evidence: p.not_this_leaf_evidence ?? null, confidence: p.confidence ?? null,
      verdict: review.page_verdict ?? null, title: review.title ?? s.book?.title });
  }
}

const strata = log.strata.map((st) => {
  const rs = rows.filter((r) => r.stratum === st.name);
  const r = kOfNBooks(rs, { seed: log.seed });
  const h = r.headline;
  return { name: st.name, share: st.share, est_frame: st.est_frame, drawn: st.drawn.length, reviewed_books: r.books,
    served_books: h.n, serious: h.any_serious, not_on_leaf: h.inventing,
    kinds: Object.fromEntries(KINDS.filter((k) => h.by_kind[k].k).map((k) => [k, h.by_kind[k].k])),
    withheld_books: r.by_exposure.withheld?.n ?? 0, withheld_serious: r.by_exposure.withheld?.any_serious?.k ?? 0,
    expected_serious_books: h.n ? Math.round(st.est_frame * h.any_serious.rate) : null };
});
const all = kOfNBooks(rows, { seed: log.seed });
const reviewed = strata.filter((s) => s.served_books);
const W = reviewed.reduce((a, s) => a + s.share, 0);
const weighted = W ? reviewed.reduce((a, s) => a + s.share * s.serious.rate, 0) / W : null;
const weightedInv = W ? reviewed.reduce((a, s) => a + s.share * s.not_on_leaf.rate, 0) / W : null;
const repair = [...reviewed].sort((a, b) => b.expected_serious_books - a.expected_serious_books).slice(0, 3);
const servedRows = rows.filter((r) => r.exposure === 'served');
const classCount = {};
for (const r of servedRows) for (const c of new Set(r.classes)) classCount[c] = (classCount[c] ?? 0) + 1;
const forms = [...new Set(servedRows.map((r) => r.form))].map((f) => ({ form: f, ...kOfNBooks(servedRows.filter((r) => r.form === f)).headline }));
const notLeaf = rows.filter((r) => r.not_this_leaf);
const notReviewed = sample.filter((b) => !reviews.has(b.book_id)).map((b) => ({ book_id: b.book_id, stratum: b.stratum, why: Object.entries(log.packets).find(([, ids]) => ids.includes(b.book_id))?.[0] ?? '?' }));

const report = { issue: 6691, dir, seed: log.seed, frame_size: log.frame_size, books_drawn: sample.length, books_reviewed: reviews.size,
  headline: all.headline, by_exposure: Object.fromEntries(Object.entries(all.by_exposure).map(([k, v]) => [k, { n: v.n, any_serious: v.any_serious }])),
  weighted_serious_rate: weighted, weighted_not_on_leaf_rate: weightedInv, weight_basis: 'stratum share of the screened draw', strata,
  repair_pays_most: repair.map((s) => s.name), classes_served: classCount, forms, not_this_leaf: notLeaf, not_reviewed: notReviewed };
writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 1));

const pct = (x) => (x == null ? '—' : `${Math.round(100 * x)}%`);
const ci = (c) => (c?.n ? `${c.k}/${c.n} (${pct(c.rate)}, ${Math.round(100 * c.ci[0])}–${pct(c.ci[1])})` : '—');
const h = all.headline;
const kindsLine = KINDS.filter((k) => h.by_kind[k].k).map((k) => `${kindLabel(k)} ${h.by_kind[k].k}`).join(', ') || 'none';
const md = [`# Served-text audit (${dir.split('/').filter(Boolean).pop()}, #6691)`, '',
  `Unweighted, served pages, one per book: a serious error on **${formatKOfN(h.any_serious)}**; text not on the leaf on ${formatKOfN(h.inventing)}.`,
  `Frame-weighted (stratum shares of the screen): serious **${pct(weighted)}**, not on the leaf ${pct(weightedInv)}, over ${reviewed.length} strata covering ${pct(W)} of the frame.`,
  `Kinds among served books (a book can carry more than one): ${kindsLine}.`,
  ...Object.entries(all.by_exposure).filter(([e, g]) => e !== 'served' && g.n).map(([e, g]) => `Not in the headline, ${e}: serious on ${formatKOfN(g.any_serious)}.`), '',
  '| stratum (ocr \\| script \\| form \\| translation) | share of frame | served books | serious (95% CI) | not on leaf | kinds | expected serious books in frame |', '|---|---:|---:|---|---|---|---:|',
  ...strata.map((s) => `| ${s.name.replace(/\|/g, ' \\| ')} | ${(100 * s.share).toFixed(1)}% | ${s.served_books} | ${ci(s.serious)} | ${ci(s.not_on_leaf)} | ${Object.entries(s.kinds).map(([k, n]) => `${k} ${n}`).join(', ') || '—'} | ${s.expected_serious_books ?? '—'} |`),
  '', `**Where repair pays most** (share × frame × rate): ${repair.map((s) => `${s.name} (≈ ${s.expected_serious_books} books)`).join('; ')}.`,
  '', '## By the form the reviewer saw (served)', '', ...forms.map((f) => `- ${f.form}: ${formatKOfN(f.any_serious)}`),
  '', '## Serious classes among served books', '', Object.entries(classCount).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ') || 'none',
  '', '## Text not on this leaf (reviewer calls)', '', ...(notLeaf.length ? notLeaf.map((r) => `- ${r.book_id} p${r.page_number} (${r.stratum}, ${r.exposure}): ${r.evidence}`) : ['none']),
  '', '## Not reviewed', '', ...(notReviewed.length ? notReviewed.map((x) => `- ${x.book_id} (${x.stratum}): ${x.why}`) : ['none'])];
writeFileSync(join(dir, 'report.md'), md.join('\n') + '\n');
console.log(md.join('\n'));

// ── the record (#6174) ──
if (!args.includes('--record')) process.exit(0);
if (!process.env.MONGODB_URI) { console.error('book_checks: MONGODB_URI not set, no rows recorded'); process.exit(1); }
const { MongoClient } = await import('mongodb');
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
await ensureBookCheckIndexes(db);
const version = readMethod('served-audit').version;
const metaDir = opt('meta', join(dir, 'meta'));
const runId = resolve(dir).split('/').pop();
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
let ins = 0, dup = 0, skip = 0;
for (const [id, { review, file }] of reviews) {
  const s = byBook.get(id);
  const verdict = FIT[review.page_verdict];
  if (!verdict) { console.error(`book_checks: ${id} has no page_verdict — not recorded`); skip++; continue; }
  const pagesRead = [...new Set((review.pages || []).map((p) => p.page_number))];
  const packetName = file.split('/').pop().replace(/\.json$/, '');
  const cost = runCost(metaDir, packetName);
  const inFile = JSON.parse(readFileSync(file, 'utf8')).length;
  const checkedAt = checkedAtOf(file);
  const now = await pageRecords(db, id, pagesRead, { withText: true });
  try {
    const r = await recordBookCheck(db, {
      book_id: id, checked_at: checkedAt, method_id: 'served-audit', method_version: version, run_id: runId,
      frame: { stratum: s.stratum, lane: s.lane, seed: log.seed, draw: runId, checked_at_source: 'reviews file (git add or mtime)' },
      pages_read: pagesRead, reader: { kind: 'model', model: cost?.model ?? 'opus', image_opened: true },
      verdict, verdict_source: 'reader', classes: seriousClasses(review.pages), note: review.book_verdict,
      page_findings: pageFindings(review.pages),
      exposure: pagesRead.map((n) => ({ page_number: n, exposure: s.pages.find((x) => x.page_number === n)?.exposure ?? 'hidden' })),
      evidence_path: relative(repo, resolve(file)),
      text_provenance: packetProvenance({ pagesRead, packetPages: s.pages, now, checkedAt, provenanceFromPage }),
      ...(cost ? { subscription_usd_eq: +(cost.usd / inFile).toFixed(4) } : {}),
    });
    r.inserted ? ins++ : dup++;
  } catch (e) { console.error(`book_checks: ${id} refused — ${e.message}`); skip++; }
}
console.log(`book_checks (${runId}, served-audit v${version}): ${ins} recorded, ${dup} already present, ${skip} not recorded`);
await client.close();

#!/usr/bin/env node
// PRIOR ART: scripts/eval/fraktur-paired-7835/frame.mjs (seeded draws, frame files in OUT) — its frames are lane queues,
// not the live corpus by book; ./lib.mjs (routeOf, confidence) is this study's own map. Read-only: Mongo reads only.
/**
 * #7866 frame (experiment file §Signals, §Draw).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/confidence-7866/frame.mjs signals
 *        every live OCR'd book: its pages grouped by provenance (model, ocr.pipeline, source, script), with flag counts
 *        → OUT/signals.json.gz
 *   ... frame.mjs revisions      page_revisions OCR rows by source, for a seeded 1,000-book sample (coverage) → OUT/revisions-sample.json
 *   ... frame.mjs score [--cuts=low,high]   confidence per book, coverage table, terciles → OUT/scored.json.gz, results/frame-summary.json
 *   ... frame.mjs draw           160 books by stratum (ALLOC), 5 pages each (one per fifth) → OUT/draw.json, results/draw.json
 *   ... frame.mjs book-revisions page_revisions disagreement for the drawn books → OUT/draw-revisions.json
 */
import { MongoClient } from 'mongodb';
import { OUT, RESULTS, J, W, arg, SEED, FRAME, routeOf, routerLookup, confidence, stratumOf, ALLOC, SCORE_FLAGS, scriptOf, eligiblePage, imageUrl, mulberry32, shuffle, makeRng } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const client = new MongoClient(process.env.MONGODB_URI);
const db = () => client.db('bookstore');
const CHATTER = /(I cannot|I can't|I am unable|I'm unable|I'm sorry|as an AI|Here is the transcription|Here's the transcription|<<<BEGIN)/i;
const SQ = /<scan-quality>\s*(good|fair|poor)/i;
const LANGTAG = /<language>\s*([^<]{1,40})<\/language>/i;
// A page whose own OCR tags it as a blank, a plate or front matter is not "near empty" text.
const TAGSKIP = /<page-type>\s*(blank|illustration|frontispiece|map|diagram|plate|title-page|toc|dedication|digitizer-insert|colophon|cover)\s*<\/page-type>/i;

async function signals() {
  const books = await db().collection('books').find(FRAME, { projection: { id: 1, language: 1, pages_count: 1, pages_ocr: 1, 'scan_quality.score': 1, 'scan_quality.median_score': 1, 'scan_quality.dominant_scan_class': 1, quality_score: 1, human_read_count: 1, title: 1, year: 1 } }).toArray();
  console.log(`frame: ${books.length} books`);
  const out = [];
  const B = 250;
  for (let i = 0; i < books.length; i += B) {
    const batch = books.slice(i, i + B), ids = batch.map((b) => b.id);
    const rows = await db().collection('pages').aggregate([
      { $match: { book_id: { $in: ids }, 'ocr.data': { $type: 'string' } } },
      { $project: {
        book_id: 1, model: '$ocr.model', pipeline: '$ocr.pipeline', source: '$ocr.source', st: '$script_type',
        at4: { $gt: [{ $ifNull: ['$ocr.engine.run.call_pages', 1] }, 1] },
        head: { $substrCP: ['$ocr.data', 0, 400] },
        len: { $strLenCP: '$ocr.data' },
        skip: { $in: [{ $ifNull: ['$page_type', ''] }, ['blank', 'illustration', 'frontispiece', 'map', 'diagram', 'plate', 'title-page', 'toc', 'dedication', 'preface', 'digitizer-insert', 'archived-spread', 'colophon', 'cover']] },
        warn: { $eq: ['$ocr.has_warning', true] }, withheld: { $gt: ['$translation_withheld', null] }, needs_reocr: { $eq: ['$needs_reocr', true] },
        unreadable: { $eq: ['$ocr.unreadable', true] }, verdict_bad: { $and: [{ $gt: ['$ocr.verdict.verdict', null] }, { $ne: ['$ocr.verdict.verdict', 'SERVE'] }] },
        scan: '$scan_quality.scan_score',
      } },
      { $project: {
        book_id: 1, model: 1, pipeline: 1, source: 1, st: 1, at4: 1, warn: 1, withheld: 1, needs_reocr: 1, unreadable: 1, verdict_bad: 1, scan: 1,
        sq: { $toLower: { $ifNull: [{ $arrayElemAt: [{ $getField: { field: 'captures', input: { $regexFind: { input: '$head', regex: SQ } } } }, 0] }, ''] } },
        lt: { $toLower: { $trim: { input: { $ifNull: [{ $arrayElemAt: [{ $getField: { field: 'captures', input: { $regexFind: { input: '$head', regex: LANGTAG } } } }, 0] }, ''] } } } },
        chatter: { $regexMatch: { input: '$head', regex: CHATTER } },
        near_empty: { $and: [{ $lt: ['$len', 120] }, { $not: ['$skip'] }, { $not: [{ $regexMatch: { input: '$head', regex: TAGSKIP } }] }] },
      } },
      { $addFields: { any: { $or: ['$warn', { $eq: ['$sq', 'poor'] }, '$chatter', '$near_empty', '$withheld', '$needs_reocr', '$unreadable', '$verdict_bad'] } } },
      { $facet: {
        prov: [{ $group: { _id: { b: '$book_id', model: '$model', pipeline: '$pipeline', source: '$source', st: '$st', at4: '$at4' }, n: { $sum: 1 },
          warn: { $sum: { $cond: ['$warn', 1, 0] } }, sq_poor: { $sum: { $cond: [{ $eq: ['$sq', 'poor'] }, 1, 0] } }, sq_fair: { $sum: { $cond: [{ $eq: ['$sq', 'fair'] }, 1, 0] } },
          sq_good: { $sum: { $cond: [{ $eq: ['$sq', 'good'] }, 1, 0] } }, chatter: { $sum: { $cond: ['$chatter', 1, 0] } }, near_empty: { $sum: { $cond: ['$near_empty', 1, 0] } },
          withheld: { $sum: { $cond: ['$withheld', 1, 0] } }, needs_reocr: { $sum: { $cond: ['$needs_reocr', 1, 0] } }, unreadable: { $sum: { $cond: ['$unreadable', 1, 0] } },
          verdict_bad: { $sum: { $cond: ['$verdict_bad', 1, 0] } }, any: { $sum: { $cond: ['$any', 1, 0] } },
          scan_n: { $sum: { $cond: [{ $gt: ['$scan', null] }, 1, 0] } }, scan_sum: { $sum: { $ifNull: ['$scan', 0] } } } }],
        lang: [{ $group: { _id: { b: '$book_id', lt: '$lt' }, n: { $sum: 1 } } }],
      } },
    ], { allowDiskUse: true }).toArray();
    const { prov, lang } = rows[0];
    for (const b of batch) {
      out.push({ id: b.id, title: String(b.title || '').slice(0, 120), language: b.language, year: b.year ?? null, pages_count: b.pages_count, pages_ocr: b.pages_ocr,
        book_scan: b.scan_quality?.median_score ?? b.scan_quality?.score ?? null, book_scan_class: b.scan_quality?.dominant_scan_class ?? null, human_read_count: b.human_read_count ?? 0,
        prov: prov.filter((r) => r._id.b === b.id).map((r) => ({ ...r._id, b: undefined, ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== '_id')) })),
        langtags: Object.fromEntries(lang.filter((r) => r._id.b === b.id).map((r) => [r._id.lt || '(none)', r.n])) });
    }
    if ((i / B) % 20 === 0) console.log(`  ${i + batch.length}/${books.length}`);
  }
  W('signals.json.gz', out);
  console.log(`signals: ${out.length} books → ${path.join(OUT, 'signals.json.gz')}`);
}

/** page_revisions OCR rows by source for a seeded sample of frame books (coverage of the disagreement signal). */
async function revisions() {
  const S = J('signals.json.gz');
  const pick = shuffle(S.map((b) => b.id).sort(), mulberry32(SEED.revSample)).slice(0, Number(arg('n') || 1000));
  const res = [];
  for (const id of pick) res.push({ id, ...(await bookRevisions(id, { texts: false })) });
  W('revisions-sample.json', res);
  const by = {}; for (const r of res) for (const s of Object.keys(r.by_source)) by[s] = (by[s] ?? 0) + 1;
  const any = res.filter((r) => r.reread_pages > 0).length;
  console.log(`revisions: ${res.length} books; with a genuine re-read row (batch_api|ai|pipeline_preview): ${any}; books by source:`, by);
}
export const REREAD_SOURCES = ['batch_api', 'ai', 'pipeline_preview'];
async function bookRevisions(bookId, { texts = true } = {}) {
  const pages = await db().collection('pages').find({ book_id: bookId }, { projection: texts ? { id: 1, 'ocr.data': 1 } : { id: 1 } }).toArray();
  const ids = pages.map((p) => p.id);
  const revs = [];
  for (let i = 0; i < ids.length; i += 500) {
    revs.push(...await db().collection('page_revisions').find({ page_id: { $in: ids.slice(i, i + 500) }, field: 'ocr' }, { projection: { page_id: 1, source: 1, model: 1, ...(texts ? { data: 1 } : {}) } }).toArray());
  }
  const by_source = {}; for (const r of revs) by_source[r.source ?? 'null'] = (by_source[r.source ?? 'null'] ?? 0) + 1;
  const rr = revs.filter((r) => REREAD_SOURCES.includes(r.source));
  const out = { pages: ids.length, revisions: revs.length, by_source, reread_pages: new Set(rr.map((r) => r.page_id)).size };
  if (texts) {
    // Disagreement: per page with a genuine re-read row, 1 − word-bag overlap (Dice on word multisets) between the most
    // recent such row and the current text; the book's value is the median over those pages.
    const cur = new Map(pages.map((p) => [p.id, p.ocr?.data ?? '']));
    const latest = new Map(); for (const r of rr) latest.set(r.page_id, r);
    const d = [...latest.values()].map((r) => 1 - dice(r.data, cur.get(r.page_id))).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    out.disagreement_median = d.length ? +d[Math.floor(d.length / 2)].toFixed(4) : null;
    out.disagreement_pages = d.length;
  }
  return out;
}
const bag = (t) => { const m = new Map(); for (const w of String(t || '').replace(/<[^>]*>/g, ' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) m.set(w, (m.get(w) ?? 0) + 1); return m; };
function dice(a, b) { const A = bag(a), B = bag(b); let inter = 0, na = 0, nb = 0; for (const v of A.values()) na += v; for (const v of B.values()) nb += v; for (const [w, v] of A) inter += Math.min(v, B.get(w) ?? 0); return na + nb ? (2 * inter) / (na + nb) : NaN; }

/** Book → routes (measured or not), flags, confidence. */
export function scoreBook(b, R) {
  const routes = new Map();
  let flagged = 0, n = 0; const f = Object.fromEntries(SCORE_FLAGS.map((k) => [k, 0])); let sqFair = 0, sqGood = 0, scanN = 0, scanSum = 0;
  for (const p of b.prov) {
    n += p.n; flagged += p.any; for (const k of SCORE_FLAGS) f[k] += p[k] ?? 0; sqFair += p.sq_fair; sqGood += p.sq_good; scanN += p.scan_n; scanSum += p.scan_sum;
    const { base, route } = routeOf(p, b.language);
    const script = scriptOf(p.st);
    const key = `${base}/${script}|${route}`;
    const e = routes.get(key) ?? { base, script, route, n_pages: 0, ...R.get(base, script, route) };
    e.n_pages += p.n; routes.set(key, e);
  }
  const rs = [...routes.values()].sort((a, c) => c.n_pages - a.n_pages);
  const c = confidence({ routes: rs, n_ocr: n, n_flagged: flagged });
  const top = rs[0];
  const tags = Object.entries(b.langtags).filter(([k]) => k !== '(none)'), tagN = tags.reduce((s, [, v]) => s + v, 0);
  const bl = String(b.language || '').toLowerCase().split(/[\s,(-]/)[0];
  const langMismatch = tagN ? tags.filter(([k]) => !k.includes(bl)).reduce((s, [, v]) => s + v, 0) / tagN : null;
  return { id: b.id, title: b.title, language: b.language, year: b.year, pages_count: b.pages_count, n_ocr: n, human_read_count: b.human_read_count,
    top_cell: top ? (top.cell ?? null) : null, top_route: top?.route ?? null, top_decision: top?.decision ?? null, top_measured: top?.measured ?? false, top_why: top?.why ?? null,
    served_is_decided: top?.served_is_decided ?? null, wrong_text_per_1k: top?.wrong_text_per_1k ?? null, route_n: top?.n ?? null,
    routes: rs.map((r) => ({ cell: r.cell ?? `${r.base}/${r.script}`, route: r.route, n_pages: r.n_pages, measured: r.measured, mean: r.mean ?? null, k: r.k ?? null, n: r.n ?? null })),
    flags: f, flag_any: flagged, sq_fair: sqFair, sq_good: sqGood, page_scan_mean: scanN ? +(scanSum / scanN).toFixed(1) : null, page_scan_n: scanN,
    book_scan: b.book_scan, book_scan_class: b.book_scan_class, lang_mismatch: langMismatch == null ? null : +langMismatch.toFixed(3), ...c };
}

function score() {
  const S = J('signals.json.gz'), R = routerLookup();
  const rows = S.map((b) => scoreBook(b, R)).filter((r) => r.n_ocr > 0);
  const m = rows.filter((r) => r.measured).map((r) => r.score).sort((a, b) => a - b);
  const q = (p) => m[Math.min(m.length - 1, Math.floor(p * m.length))];
  const cuts = arg('cuts') ? Object.fromEntries(arg('cuts').split(',').map((x, i) => [i ? 'high' : 'low', Number(x)])) : { low: +q(1 / 3).toFixed(4), high: +q(2 / 3).toFixed(4) };
  for (const r of rows) r.stratum = stratumOf(r, cuts);
  W('scored.json.gz', rows);
  // Coverage of each signal (the share of frame books on which it is present / non-zero).
  const N = rows.length, pct = (k) => `${k} (${((100 * k) / N).toFixed(1)}%)`;
  const cov = {
    books: N,
    router_cell_measured: pct(rows.filter((r) => r.measured).length),
    top_route_measured: pct(rows.filter((r) => r.top_measured).length),
    cell_decision_known: pct(rows.filter((r) => r.top_decision).length),
    wrong_text_per_1k_on_route: pct(rows.filter((r) => r.wrong_text_per_1k != null).length),
    any_flag: pct(rows.filter((r) => r.flag_any > 0).length),
    ...Object.fromEntries(SCORE_FLAGS.map((k) => [`flag_${k}`, pct(rows.filter((r) => r.flags[k] > 0).length)])),
    self_scan_tag_any: pct(rows.filter((r) => r.sq_good + r.sq_fair + r.flags.sq_poor > 0).length),
    self_scan_fair_or_poor: pct(rows.filter((r) => r.sq_fair + r.flags.sq_poor > 0).length),
    page_scan_score: pct(rows.filter((r) => r.page_scan_n > 0).length),
    book_scan_score: pct(rows.filter((r) => r.book_scan != null).length),
    language_tag: pct(rows.filter((r) => r.lang_mismatch != null).length),
    language_mismatch_gt_10pct: pct(rows.filter((r) => r.lang_mismatch > 0.1).length),
  };
  const strata = {}; for (const r of rows) strata[r.stratum] = (strata[r.stratum] ?? 0) + 1;
  const whyUnmeasured = {}; for (const r of rows.filter((x) => !x.measured)) { const k = `${r.top_cell ?? '(no cell)'} | ${r.top_route}`; whyUnmeasured[k] = (whyUnmeasured[k] ?? 0) + 1; }
  const byCell = {}; for (const r of rows.filter((x) => x.measured)) { const k = `${r.top_cell} | ${r.top_route}`; byCell[k] = (byCell[k] ?? 0) + 1; }
  const top = (o, n = 25) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n));
  const summary = { table: R.name, generated_at: new Date().toISOString(), coverage: cov, cuts, strata, score_quantiles: { p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9) },
    measured_by_cell_route: top(byCell), unmeasured_by_cell_route: top(whyUnmeasured) };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'frame-summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

/** The draw: books by stratum in a seeded order; pages one per fifth of the book. */
async function draw() {
  const rows = J('scored.json.gz');
  const rnd = makeRng(SEED.draw), prnd = makeRng(SEED.pages);
  const drawn = [], log = [];
  for (const s of ['high', 'middle', 'low', 'unmeasured']) {
    const pool = shuffle(rows.filter((r) => r.stratum === s).sort((a, b) => (a.id < b.id ? -1 : 1)), rnd);
    let got = 0;
    for (const b of pool) {
      if (got >= ALLOC[s]) break;
      const pages = await db().collection('pages').find({ book_id: b.id }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.source': 1, script_type: 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1, hidden: 1, split_into: 1 } }).sort({ page_number: 1 }).toArray();
      const el = pages.filter(eligiblePage);
      if (el.length < 5) { log.push({ id: b.id, stratum: s, skipped: `eligible pages ${el.length} < 5` }); continue; }
      // One page from each fifth of the book's page sequence (by position among ALL its pages), among eligible pages.
      const picks = [];
      for (let k = 0; k < 5; k++) {
        const lo = Math.floor((k * pages.length) / 5), hi = Math.floor(((k + 1) * pages.length) / 5);
        const cand = el.filter((p) => { const i = pages.indexOf(p); return i >= lo && i < hi; });
        if (!cand.length) continue;
        picks.push(cand[Math.floor(prnd() * cand.length)]);
      }
      if (picks.length < 5) { log.push({ id: b.id, stratum: s, skipped: `fifths with an eligible page ${picks.length} < 5` }); continue; }
      got++;
      drawn.push({ ...b, routes: b.routes.slice(0, 4), weight: rows.filter((r) => r.stratum === s).length / ALLOC[s],
        pages: picks.map((p, k) => ({ page_id: p.id, page_number: p.page_number, fifth: k + 1, image: imageUrl(p), model: p.ocr.model ?? null, pipeline: p.ocr.pipeline ?? null, source: p.ocr.source ?? null, script_type: p.script_type ?? null })) });
      log.push({ id: b.id, stratum: s, drawn: true });
    }
    console.log(`${s}: ${got}/${ALLOC[s]} (pool ${pool.length})`);
  }
  // Texts at draw time, so the judged text is the text that was stored when drawn.
  for (const b of drawn) for (const p of b.pages) {
    const doc = await db().collection('pages').findOne({ id: p.page_id }, { projection: { 'ocr.data': 1 } });
    const f = path.join(OUT, 'texts', `${p.page_id}.txt`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, doc.ocr.data);
  }
  W('draw.json', { seed: SEED, drawn, log });
  fs.writeFileSync(path.join(RESULTS, 'draw.json'), JSON.stringify({ seed: SEED, books: drawn.map((b) => ({ id: b.id, stratum: b.stratum, score: b.score, weight: b.weight, language: b.language, top_cell: b.top_cell, top_route: b.top_route, pages: b.pages.map((p) => p.page_number) })), skipped: log.filter((l) => l.skipped) }, null, 1));
  console.log(`drawn ${drawn.length} books, ${drawn.reduce((s, b) => s + b.pages.length, 0)} pages`);
}

async function drawRevisions() {
  const D = J('draw.json').drawn, out = [];
  for (const b of D) out.push({ id: b.id, ...(await bookRevisions(b.id)) });
  W('draw-revisions.json', out);
  console.log(`revisions for ${out.length} drawn books; with a re-read row: ${out.filter((r) => r.reread_pages).length}`);
}

const stages = { signals, revisions, score, draw, 'book-revisions': drawRevisions };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await client.connect();
try { await stages[process.argv[2]](); } finally { await client.close(); }

#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/model-usage-snapshot.mjs — exact pages per engine (ocr.model × source), but by walking
 * all of `pages` (~35M docs at ~4.5K/s, two hours) and with no language, century or visibility cut; this script
 * samples the engine split instead and keeps the walk out of the default run. scripts/eval/experiments/
 * 2026-11-02-stock-by-engine-7933.md — a one-off $sample census of the same question (live pages only; `$sample` is
 * biased toward text-bearing documents, visibility-and-stats.md). scripts/audit/archive-coverage.mjs — the three
 * "archived" tiers; this script counts only the RECORD tier and says so. scripts/audit/page-count-audit.mjs — checks
 * the book counters this table sums. scripts/audit/hold-release-check.mjs — holds by reason.
 * scripts/audit/ocr-revision-provenance.mjs — page_revisions by source (2026-08, ocr only, 190K rows then).
 * None of them prints one table of what the library holds by language and century, or the three totals of #278.
 *
 * holdings-count (#278) — one count of what the library holds, rerunnable, read-only.
 *
 *   TABLE   books × language (books.language = the EDITION's language, language-fields.md) × century (numeric
 *           books.year; "unknown" where there is none — never parsed out of `published`), split into three groups:
 *             live          visible: true && pages_count > 0            (the canonical public filter)
 *             hidden        not live, pages_count > 0, not a "not acquired" catalogue record
 *             not acquired  hidden records held as manifest-only / acquisition-wave (scripts/lib/hold-reasons.mjs):
 *                           pages_count is the manifest's leaf count, and most of those pages have no page document
 *           For each cell: books, and books + pages for: held (pages_count), OCR text (pages_ocr), English
 *           translation (pages_translated, blank leaves excluded), archived image (pages_archived = the RECORD tier
 *           of archive-coverage.md: the page doc carries a non-empty archived_photo; not FILE, not MASTER).
 *           These are the stored visible-page counters (page-counts.md), summed — exact as stored; their drift is
 *           page-count-audit.mjs's job, and the --control book checks them against a recount.
 *   ENGINES OCR and English text by engine family, from a seeded page-uniform sample (book drawn ∝ pages_count, page
 *           number drawn uniformly, kept if it carries the text). Families come from the `engine` block
 *           (data-provenance.md #4613) or the Internet Archive's own `ocr.ia` record; rows with neither are
 *           "no engine block" and are NOT guessed. Reported as shares with n, and as pages = share × the exact counter.
 *   TOTAL 1 judge verdicts per page: book_checks (rows, pages read) by method_id × month; lane_judge_verdicts by
 *           origin × instrument × kind × month (kind ≠ item rows are wrong-page / planted controls, not page verdicts).
 *   TOTAL 2 withheld English: pages whose translation_withheld record is present AND that carry no translation text
 *           (translation-state.md: the record alone is an archive), and the books they sit in; plus books under a
 *           pipeline hold (decision holds apart from not-acquired records). The `contained` label lives on GitHub
 *           issues, not in Mongo: count it with `gh issue list --label contained`.
 *   TOTAL 3 page_revisions rows by field × source, classed as a READ (the label names a mechanism that read the page
 *           image: READ_SOURCES of dropped-line-candidates.mjs plus the CLI re-read and LightOnOCR labels), a MOVE
 *           (shift-repair / text-permutation / revert / undo: text relocated between pages), or OTHER (cleanups,
 *           guards, withholds); and, for OCR READ rows whose superseded text recorded the image it saw
 *           (engine.input.image_url), whether the page's current read recorded the same image URL.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/holdings-count.mjs [--json=out.json] [--min-pages=200000]
 *        [--sample=6000] [--seed=278] [--skip-revisions] [--control[=<book id>]]
 *   --min-pages  languages with fewer live+hidden pages print as one "(other languages)" row per century (the JSON
 *                carries every row). --skip-revisions drops TOTAL 3 (one ~4-minute scan of 8.7M rows).
 *   --control    positive controls: recounts one book from `pages` and checks it against the counters this table sums,
 *                and runs each total's pipeline restricted to that book against a hand count by find().
 *
 * Read-only, secondary-preferred, every aggregation under maxTimeMS. Exit 0 = printed; 2 = a query failed or timed out
 * (nothing partial is printed as a table); 1 = --control found a mismatch.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { NOT_ACQUIRED_HOLD_REASONS } from '../lib/hold-reasons.mjs';
import { buildVisiblePageCountPipeline, PAGE_COUNT_ACCUMULATORS, hasOcr, isTranslatedPage, isArchivedPage, isVisiblePage } from '../lib/page-counts.mjs';
import { READ_SOURCES as LINE_READ_SOURCES } from './dropped-line-candidates.mjs';
import { verdictQuery } from '../eval/lib/judge-rows.mjs';

const arg = (n, d) => { const h = process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`)); return h == null ? d : h.includes('=') ? h.split('=').slice(1).join('=') : true; };
const JSON_OUT = arg('json', null);
const MIN_PAGES = Number(arg('min-pages', '200000'));
const SAMPLE = Number(arg('sample', '6000'));
const SEED = Number(arg('seed', '278'));
const SKIP_REV = !!arg('skip-revisions', false);
const CONTROL = arg('control', null);
const MAX_MS = 900000;

// The CLI re-read (scripts/batch/cli-ocr.mjs revision_source) and LightOnOCR read the page image too; the shared list
// predates both labels. Kept here, not added there, because that list gates another audit's behaviour.
const READ_SOURCES = new Set([...LINE_READ_SOURCES, 'reocr_cli', 'lightonocr']);
const MOVE_SOURCE = /^(shift-repair|text-permutation|revert-|spread-split|ia-ocr-repair|ai-repair-sync|reocr-contamination-repair)|-undo$/;
const revisionClass = (s) => (s == null ? 'other' : READ_SOURCES.has(s) ? 'read' : MOVE_SOURCE.test(s) ? 'move' : 'other');

function centuryOf(year) {
  let y = year;
  if (typeof y === 'string' && /^-?\d{1,4}$/.test(y.trim())) y = Number(y.trim());
  if (typeof y !== 'number' || !Number.isFinite(y) || y === 0 || y > new Date().getUTCFullYear()) return 'unknown';
  if (y < 0) return 'BCE';
  const c = Math.floor(y / 100) * 100;
  return `${String(c).padStart(4, '0')}s`;
}
const languageOf = (l) => (typeof l === 'string' && l.trim() ? l.trim() : 'unknown');

/** Engine family of one text block, from its engine record only. */
function engineFamily(block) {
  if (!block) return null;
  const e = block.engine;
  if (e && typeof e === 'object') {
    const name = String(e.name || '').toLowerCase();
    if (name === 'gemini') { const m = String(e.model || block.model || ''); return /flash-lite/.test(m) ? 'gemini flash-lite' : /3\.[5-9]|4-/.test(m) ? 'gemini 3.7+/4' : 'gemini flash/pro (≤3)'; }
    if (name === 'anthropic') return 'claude';
    if (/yigdzin|bdrc/.test(name)) return 'bdrc (tibetan)';
    if (/paddle/.test(name)) return 'paddleocr';
    if (/abbyy/.test(name)) return 'internet archive';
    if (/cbeta/.test(name)) return 'typed e-text';
    return name || 'engine (unnamed)';
  }
  if (block.ia && typeof block.ia === 'object') return 'internet archive';
  return 'no engine block';
}

function die(msg) { console.error(`holdings-count: ${msg}`); process.exit(2); }
const fmt = (n) => (n == null ? '' : Number(n).toLocaleString('en-US'));
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const uri = process.env.MONGODB_URI;
if (!uri) die('MONGODB_URI missing');
const client = new MongoClient(uri, { readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const startedAt = new Date();
const agg = async (coll, pipeline, opts = {}) => {
  try { return await db.collection(coll).aggregate(pipeline, { maxTimeMS: MAX_MS, allowDiskUse: true, ...opts }).toArray(); }
  catch (e) { await client.close().catch(() => {}); die(`${coll} aggregate failed (${e.codeName || e.code || ''}): ${e.message}`); }
};

// ── shared expressions ──────────────────────────────────────────────────────────
const LIVE = { $and: [{ $eq: ['$visible', true] }, { $gt: ['$pages_count', 0] }] };
const NOT_ACQ = { $in: [{ $ifNull: ['$pipeline_auto.hold.reason', null] }, NOT_ACQUIRED_HOLD_REASONS] };
const GROUP = { $cond: [LIVE, 'live', { $cond: [{ $not: [{ $gt: ['$pages_count', 0] }] }, 'no pages', { $cond: [NOT_ACQ, 'not acquired', 'hidden'] }] }] };
const num = (f) => ({ $cond: [{ $isNumber: f }, f, 0] });
const pos = (f) => ({ $cond: [{ $gt: [num(f), 0] }, 1, 0] });

// ── TABLE ─────────────────────────────────────────────────────────────────────────
async function holdingsTable(extraMatch = {}) {
  const rows = await agg('books', [
    ...(Object.keys(extraMatch).length ? [{ $match: extraMatch }] : []),
    { $project: { g: GROUP, language: 1, year: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_archived: 1 } },
    { $group: {
      _id: { g: '$g', l: '$language', y: '$year' },
      books: { $sum: 1 },
      pages: { $sum: num('$pages_count') },
      ocr: { $sum: num('$pages_ocr') }, ocr_books: { $sum: pos('$pages_ocr') },
      tr: { $sum: num('$pages_translated') }, tr_books: { $sum: pos('$pages_translated') },
      ar: { $sum: num('$pages_archived') }, ar_books: { $sum: pos('$pages_archived') },
    } },
  ]);
  // Fold language + year in JS (centuryOf is the one rule; a year can be int, string or null).
  const cells = new Map();
  for (const r of rows) {
    const key = `${r._id.g}\u0001${languageOf(r._id.l)}\u0001${centuryOf(r._id.y)}`;
    const c = cells.get(key) || { group: r._id.g, language: languageOf(r._id.l), century: centuryOf(r._id.y), books: 0, pages: 0, ocr: 0, ocr_books: 0, tr: 0, tr_books: 0, ar: 0, ar_books: 0 };
    for (const k of ['books', 'pages', 'ocr', 'ocr_books', 'tr', 'tr_books', 'ar', 'ar_books']) c[k] += r[k];
    cells.set(key, c);
  }
  return [...cells.values()];
}

// ── ENGINES (sample) ──────────────────────────────────────────────────────────────
async function engineSample() {
  const frame = [];
  try {
    const cur = db.collection('books').find({ pages_count: { $gt: 0 }, $or: [{ pages_ocr: { $gt: 0 } }, { pages_translated: { $gt: 0 } }] },
      { projection: { id: 1, pages_count: 1, visible: 1, language: 1, year: 1, 'pipeline_auto.hold.reason': 1 }, maxTimeMS: MAX_MS }).batchSize(5000);
    for await (const b of cur) frame.push(b);
  } catch (e) { die(`engine frame read failed: ${e.message}`); }
  const cum = []; let tot = 0;
  for (const b of frame) { tot += b.pages_count; cum.push(tot); }
  const rnd = mulberry32(SEED);
  const pick = () => { const x = rnd() * tot; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] > x) hi = m; else lo = m + 1; } return frame[lo]; };
  const out = { ocr: [], tr: [] }; let tries = 0;
  const maxTries = SAMPLE * 40;
  const pages = db.collection('pages');
  // The counters' own per-page tests (page-counts.mjs), evaluated server-side: 1 when the page counts, else 0.
  const COUNTS_OCR = PAGE_COUNT_ACCUMULATORS.with_ocr.$sum, COUNTS_EN = PAGE_COUNT_ACCUMULATORS.with_translation.$sum;
  const proj = { page_number: 1, repeat_of: 1, page_type: 1, 'ocr.unreadable': 1, 'ocr.engine': 1, 'ocr.ia.ocr_module_version': 1, 'ocr.model': 1, 'ocr.source': 1, 'translation.engine': 1, 'translation.model': 1, 'translation.source': 1,
    counts_ocr: COUNTS_OCR, counts_en: COUNTS_EN };
  while (out.ocr.length < SAMPLE && tries < maxTries) {
    const batch = Array.from({ length: 32 }, () => { const b = pick(); return { b, n: 1 + Math.floor(rnd() * b.pages_count) }; });
    tries += batch.length;
    const got = await Promise.all(batch.map(({ b, n }) => pages.findOne({ book_id: b.id ?? String(b._id), page_number: n }, { projection: proj, maxTimeMS: 60000 }).catch((e) => die(`page lookup failed: ${e.message}`))));
    got.forEach((p, i) => {
      if (!p || !isVisiblePage(p)) return;
      const b = batch[i].b;
      const g = b.visible === true ? 'live' : NOT_ACQUIRED_HOLD_REASONS.includes(b.pipeline_auto?.hold?.reason) ? 'not acquired' : 'hidden';
      const cell = { group: g, language: languageOf(b.language), century: centuryOf(b.year) };
      if (out.ocr.length < SAMPLE && p.counts_ocr === 1) out.ocr.push({ ...cell, family: engineFamily(p.ocr) });
      if (out.ocr.length <= SAMPLE && p.counts_en === 1) out.tr.push({ ...cell, family: engineFamily(p.translation) });
    });
  }
  return { frame_books: frame.length, frame_pages: tot, draws: tries, ...out };
}

// ── TOTAL 1: verdicts ─────────────────────────────────────────────────────────────
async function verdictTotals(extraMatch = {}) {
  // A null date is "not recorded" (the #7263 test-row backfill wrote judged_at: null), never guessed from backfilled_at.
  const month = (f) => ({ $cond: [{ $eq: [{ $ifNull: [f, null] }, null] }, 'not recorded', { $substrCP: [{ $cond: [{ $eq: [{ $type: f }, 'date'] }, { $dateToString: { date: f, format: '%Y-%m' } }, { $toString: f }] }, 0, 7] }] });
  const bc = await agg('book_checks', [{ $match: extraMatch }, { $group: { _id: { m: '$method_id', mo: month('$checked_at'), k: '$reader.kind' }, rows: { $sum: 1 }, pages: { $sum: { $size: { $ifNull: ['$pages_read', []] } } }, books: { $addToSet: '$book_id' } } }, { $project: { rows: 1, pages: 1, books: { $size: '$books' } } }, { $sort: { '_id.m': 1, '_id.mo': 1 } }]);
  // All origins on purpose: the total reports live and test rows side by side, labelled by origin.
  const lj = await agg('lane_judge_verdicts', [{ $match: verdictQuery(extraMatch, { tests: true }) }, { $group: { _id: { o: { $ifNull: ['$origin', 'live'] }, i: '$judge.instrument', k: '$kind', mo: month('$judged_at') }, rows: { $sum: 1 }, pages: { $addToSet: '$page_id' } } }, { $project: { rows: 1, pages: { $size: '$pages' } } }, { $sort: { '_id.o': 1, '_id.i': 1, '_id.mo': 1 } }]);
  return { book_checks: bc.map((r) => ({ method: r._id.m, month: r._id.mo, reader: r._id.k ?? null, rows: r.rows, pages_read: r.pages, books: r.books })), lane_judge_verdicts: lj.map((r) => ({ origin: r._id.o, instrument: r._id.i ?? null, kind: r._id.k ?? null, month: r._id.mo, rows: r.rows, distinct_pages: r.pages })) };
}

// ── TOTAL 2: withheld + holds ─────────────────────────────────────────────────────
const NO_TR_TEXT = { $not: [{ $and: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, { $gt: ['$translation.data', ''] }] }] };
async function withheldTotals(extraMatch = {}) {
  const rows = await agg('pages', [
    { $match: { 'translation_withheld.reason': { $exists: true }, ...extraMatch } },
    { $project: { book_id: 1, reason: '$translation_withheld.reason', now: { $cond: [NO_TR_TEXT, 1, 0] } } },
    { $group: { _id: { r: '$reason', now: '$now' }, pages: { $sum: 1 }, books: { $addToSet: '$book_id' } } },
  ], { hint: 'pages_translation_withheld_partial' });
  const byReason = {}; const booksNow = new Set(); const booksAll = new Set(); let now = 0, archived = 0;
  for (const r of rows) {
    const x = (byReason[r._id.r] ||= { withheld_now: 0, record_only: 0 });
    if (r._id.now) { x.withheld_now += r.pages; now += r.pages; r.books.forEach((b) => booksNow.add(b)); } else { x.record_only += r.pages; archived += r.pages; }
    r.books.forEach((b) => booksAll.add(b));
  }
  const holds = await agg('books', [{ $match: { 'pipeline_auto.hold': { $exists: true }, ...(extraMatch.book_id ? { id: extraMatch.book_id } : {}) } }, { $group: { _id: '$pipeline_auto.hold.reason', books: { $sum: 1 }, live: { $sum: { $cond: [LIVE, 1, 0] } }, ids: { $push: { $cond: [NOT_ACQ, '$$REMOVE', '$id'] } } } }, { $sort: { books: -1 } }]);
  const decisionHoldIds = new Set(holds.filter((h) => !NOT_ACQUIRED_HOLD_REASONS.includes(h._id)).flatMap((h) => h.ids));
  const withheldBooksHeld = [...booksNow].filter((b) => decisionHoldIds.has(b)).length;
  return {
    withheld_now_pages: now, withheld_now_books: booksNow.size, record_only_pages: archived, record_books: booksAll.size,
    by_reason: Object.entries(byReason).sort((a, b) => b[1].withheld_now - a[1].withheld_now).map(([reason, v]) => ({ reason, ...v })),
    holds: holds.map((h) => ({ reason: h._id ?? null, books: h.books, live_books: h.live, not_acquired: NOT_ACQUIRED_HOLD_REASONS.includes(h._id) })),
    decision_hold_books: decisionHoldIds.size, withheld_books_under_decision_hold: withheldBooksHeld,
  };
}

// ── TOTAL 3: page_revisions ───────────────────────────────────────────────────────
async function revisionTotals(extraMatch = {}) {
  const nonEmpty = { $and: [{ $eq: [{ $type: '$data' }, 'string'] }, { $gt: ['$data', ''] }] };
  const readList = [...READ_SOURCES];
  const [res] = await agg('page_revisions', [
    ...(Object.keys(extraMatch).length ? [{ $match: extraMatch }] : []),
    { $facet: {
      by: [{ $group: { _id: { f: '$field', s: '$source', t: { $cond: [nonEmpty, 1, 0] } }, n: { $sum: 1 } } }],
      img: [
        { $match: { field: 'ocr', source: { $in: readList }, 'engine.input.image_url': { $type: 'string' } } },
        { $match: { $expr: nonEmpty } },
        { $project: { page_id: 1, source: 1, u: '$engine.input.image_url' } },
        { $lookup: { from: 'pages', localField: 'page_id', foreignField: 'id', as: 'p', pipeline: [{ $project: { _id: 0, u: '$ocr.engine.input.image_url' } }] } },
        { $project: { source: 1, cmp: { $let: { vars: { cu: { $first: '$p.u' } }, in: { $cond: [{ $eq: [{ $size: '$p' }, 0] }, 'page missing', { $cond: [{ $ne: [{ $type: '$$cu' }, 'string'] }, 'current read records no image', { $cond: [{ $eq: ['$$cu', '$u'] }, 'same image URL', 'different image URL'] }] }] } } } } },
        { $group: { _id: { s: '$source', c: '$cmp' }, n: { $sum: 1 } } },
      ],
    } },
  ]);
  const by = res.by.map((r) => ({ field: r._id.f ?? null, source: r._id.s ?? null, class: revisionClass(r._id.s), has_text: !!r._id.t, rows: r.n })).sort((a, b) => b.rows - a.rows);
  return { by_source: by, image_check: res.img.map((r) => ({ source: r._id.s, result: r._id.c, rows: r.n })) };
}

// ── control ───────────────────────────────────────────────────────────────────────
async function control() {
  let id = typeof CONTROL === 'string' ? CONTROL : null;
  if (!id) {
    // A live book that has a check row, withheld pages and OCR revisions, so one book exercises every count.
    const checked = await db.collection('book_checks').distinct('book_id', {}, { maxTimeMS: 60000 });
    const withheld = new Set(await db.collection('pages').distinct('book_id', { 'translation_withheld.reason': { $exists: true }, book_id: { $in: checked } }, { maxTimeMS: 120000 }));
    for (const b of checked) { if (!withheld.has(b)) continue; const bk = await db.collection('books').findOne({ id: b, visible: true, pages_count: { $gt: 0, $lt: 1500 } }, { projection: { id: 1 } }); if (bk) { id = b; break; } }
    if (!id) die('no default control book found; pass --control=<book id>');
  }
  const book = await db.collection('books').findOne({ $or: [{ id }, ...(/^[0-9a-f]{24}$/.test(id) ? [{ _id: new (await import('mongodb')).ObjectId(id) }] : [])] });
  if (!book) die(`control book ${id} not found by id or _id`);
  const bid = book.id ?? String(book._id);
  const fails = [];
  const check = (what, a, b) => { const ok = a === b; if (!ok) fails.push(what); console.log(`  ${ok ? 'ok  ' : 'MISMATCH'} ${what}: script ${fmt(a)} · hand ${fmt(b)}`); };
  console.log(`\nPOSITIVE CONTROL — book ${bid} "${String(book.title).slice(0, 70)}" (${languageOf(book.language)}, ${centuryOf(book.year)}, visible=${book.visible})`);
  // Hand count: every page doc of the book, the page-counts.mjs predicates in JS.
  const pg = await db.collection('pages').find({ book_id: bid }, { projection: { page_number: 1, repeat_of: 1, page_type: 1, archived_photo: 1, 'ocr.data': 1, 'ocr.unreadable': 1, 'translation.data': 1, translation_withheld: 1, id: 1 } }).toArray();
  const vis = pg.filter(isVisiblePage);
  const [canon] = await db.collection('pages').aggregate(buildVisiblePageCountPipeline(bid)).toArray();
  const [cell] = await holdingsTable({ id: bid });
  console.log(` TABLE (the book's own row, the stored counters this table sums, vs pages):`);
  check('pages held  = visible page docs', cell.pages, vis.length);
  check('OCR pages   = visible pages with OCR', cell.ocr, vis.filter(hasOcr).length);
  check('translated  = visible pages translated (not blank)', cell.tr, vis.filter(isTranslatedPage).length);
  check('archived    = visible pages with archived_photo (RECORD tier)', cell.ar, vis.filter(isArchivedPage).length);
  check('canonical recount (buildVisiblePageCountPipeline) total = hand', canon?.total ?? 0, vis.length);
  console.log(` TOTAL 1 (verdicts):`);
  const v = await verdictTotals({ book_id: bid });
  const hcRows = await db.collection('book_checks').find({ book_id: bid }).toArray();
  check('book_checks rows', v.book_checks.reduce((s, r) => s + r.rows, 0), hcRows.length);
  check('book_checks pages read', v.book_checks.reduce((s, r) => s + r.pages_read, 0), hcRows.reduce((s, r) => s + (r.pages_read?.length || 0), 0));
  check('lane_judge_verdicts rows', v.lane_judge_verdicts.reduce((s, r) => s + r.rows, 0), await db.collection('lane_judge_verdicts').countDocuments(verdictQuery({ book_id: bid }, { tests: true })));
  // The control book may have no lane-judge rows; check that store on a book that does.
  const lj1 = await db.collection('lane_judge_verdicts').findOne(verdictQuery({ kind: 'item' }, { tests: true }), { sort: { judged_at: 1 }, projection: { book_id: 1 } });
  if (lj1) {
    const v2 = await verdictTotals({ book_id: lj1.book_id });
    const hand2 = await db.collection('lane_judge_verdicts').find(verdictQuery({ book_id: lj1.book_id }, { tests: true }), { projection: { kind: 1 } }).toArray();
    check(`lane_judge_verdicts rows (book ${lj1.book_id})`, v2.lane_judge_verdicts.reduce((s, r) => s + r.rows, 0), hand2.length);
    check(`lane_judge_verdicts page verdicts, kind=item (book ${lj1.book_id})`, v2.lane_judge_verdicts.filter((r) => r.kind === 'item').reduce((s, r) => s + r.rows, 0), hand2.filter((r) => r.kind === 'item').length);
  }
  console.log(` TOTAL 2 (withheld English):`);
  const w = await withheldTotals({ book_id: bid });
  const hand = pg.filter((p) => p.translation_withheld?.reason != null);
  check('withheld now (record + no English text)', w.withheld_now_pages, hand.filter((p) => !(typeof p.translation?.data === 'string' && p.translation.data !== '')).length);
  check('record only (English back on the page)', w.record_only_pages, hand.filter((p) => typeof p.translation?.data === 'string' && p.translation.data !== '').length);
  if (!SKIP_REV) {
    console.log(` TOTAL 3 (page_revisions):`);
    const r = await revisionTotals({ book_id: bid });
    const hr = await db.collection('page_revisions').find({ book_id: bid }, { projection: { source: 1, field: 1 } }).toArray();
    check('revision rows', r.by_source.reduce((s, x) => s + x.rows, 0), hr.length);
    check('revision rows classed READ', r.by_source.filter((x) => x.class === 'read').reduce((s, x) => s + x.rows, 0), hr.filter((x) => READ_SOURCES.has(x.source)).length);
  }
  return fails;
}

// ── run ───────────────────────────────────────────────────────────────────────────
if (CONTROL) {
  const fails = await control();
  await client.close();
  console.log(fails.length ? `\nCONTROL FAILED: ${fails.join('; ')}` : '\nCONTROL PASSED: every count matched its hand count.');
  process.exit(fails.length ? 1 : 0);
}

const t0 = Date.now();
const cells = await holdingsTable();
const tTable = Date.now();
const engines = await engineSample();
const verdicts = await verdictTotals();
const withheld = await withheldTotals();
const revisions = SKIP_REV ? null : await revisionTotals();
const pageDocs = await db.collection('pages').estimatedDocumentCount();
const finishedAt = new Date();
await client.close();

// ── print ─────────────────────────────────────────────────────────────────────────
const P = (s) => console.log(s);
P(`# holdings-count (#278) — production ${process.env.MONGODB_DB || 'bookstore'}, read ${startedAt.toISOString()} → ${finishedAt.toISOString()} (${Math.round((finishedAt - startedAt) / 1000)} s; table ${Math.round((tTable - t0) / 1000)} s)`);
P(`Filters: live = visible: true && pages_count > 0 · hidden = not live, pages_count > 0, hold reason not in [${NOT_ACQUIRED_HOLD_REASONS.join(', ')}] · not acquired = those hold reasons · language = books.language (edition) · century = numeric books.year, "unknown" if none.`);
P(`Page counts are the stored visible-page counters (page_number > 0, not a repeat capture): pages_count, pages_ocr, pages_translated (blank leaves out), pages_archived (RECORD tier: archived_photo present).`);
const sum = (arr, k) => arr.reduce((s, c) => s + c[k], 0);
const groups = ['live', 'hidden', 'not acquired', 'no pages'];
P(`\n## Totals by group`);
P(`| group | books | pages held | books w/ OCR | OCR pages | books w/ English | English pages | books w/ archived | archived pages (RECORD) |`);
P(`|---|--:|--:|--:|--:|--:|--:|--:|--:|`);
for (const g of groups) { const c = cells.filter((x) => x.group === g); P(`| ${g} | ${fmt(sum(c, 'books'))} | ${fmt(sum(c, 'pages'))} | ${fmt(sum(c, 'ocr_books'))} | ${fmt(sum(c, 'ocr'))} | ${fmt(sum(c, 'tr_books'))} | ${fmt(sum(c, 'tr'))} | ${fmt(sum(c, 'ar_books'))} | ${fmt(sum(c, 'ar'))} |`); }
P(`| **all** | ${fmt(sum(cells, 'books'))} | ${fmt(sum(cells, 'pages'))} | ${fmt(sum(cells, 'ocr_books'))} | ${fmt(sum(cells, 'ocr'))} | ${fmt(sum(cells, 'tr_books'))} | ${fmt(sum(cells, 'tr'))} | ${fmt(sum(cells, 'ar_books'))} | ${fmt(sum(cells, 'ar'))} |`);
P(`Cross-check: live + hidden pages held = ${fmt(cells.filter((c) => c.group === 'live' || c.group === 'hidden').reduce((s, c) => s + c.pages, 0))} against ${fmt(pageDocs)} page documents (estimatedDocumentCount). The difference includes soft-hidden (page_number ≤ 0) and repeat-capture pages, which no counter counts, and pages of not-acquired records; it is not broken down here.`);

// language × century, live and hidden side by side; small languages folded.
const langPages = new Map();
for (const c of cells) if (c.group === 'live' || c.group === 'hidden') langPages.set(c.language, (langPages.get(c.language) || 0) + c.pages);
const big = new Set([...langPages].filter(([, n]) => n >= MIN_PAGES).map(([l]) => l));
const OTHER = `(other languages: ${langPages.size - big.size} values)`;
const table = new Map();
for (const c of cells) {
  if (c.group !== 'live' && c.group !== 'hidden') continue;
  const l = big.has(c.language) ? c.language : OTHER;
  const k = `${l}\u0001${c.century}`;
  const r = table.get(k) || { language: l, century: c.century, live: { books: 0, pages: 0, ocr: 0, tr: 0, ar: 0 }, hidden: { books: 0, pages: 0, ocr: 0, tr: 0, ar: 0 } };
  for (const f of ['books', 'pages', 'ocr', 'tr', 'ar']) r[c.group][f] += c[f];
  table.set(k, r);
}
const order = (a, b) => (a.language === OTHER) - (b.language === OTHER) || (langPages.get(b.language) || 0) - (langPages.get(a.language) || 0) || a.language.localeCompare(b.language) || (a.century === 'unknown') - (b.century === 'unknown') || a.century.localeCompare(b.century);
P(`\n## Language × century — live beside hidden (not-acquired catalogue records excluded; languages under ${fmt(MIN_PAGES)} live+hidden pages folded into one row)`);
P(`| language | century | live books | live pages | live OCR | live English | live archived | hidden books | hidden pages | hidden OCR | hidden English | hidden archived |`);
P(`|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|`);
for (const r of [...table.values()].sort(order)) P(`| ${r.language} | ${r.century} | ${fmt(r.live.books)} | ${fmt(r.live.pages)} | ${fmt(r.live.ocr)} | ${fmt(r.live.tr)} | ${fmt(r.live.ar)} | ${fmt(r.hidden.books)} | ${fmt(r.hidden.pages)} | ${fmt(r.hidden.ocr)} | ${fmt(r.hidden.tr)} | ${fmt(r.hidden.ar)} |`);

// engines
const share = (rows, keyFn) => { const m = new Map(); for (const r of rows) { const k = keyFn(r); const x = m.get(k) || { n: 0, f: new Map() }; x.n++; x.f.set(r.family, (x.f.get(r.family) || 0) + 1); m.set(k, x); } return m; };
const fams = (rows) => [...new Set(rows.map((r) => r.family))].sort((a, b) => rows.filter((r) => r.family === b).length - rows.filter((r) => r.family === a).length);
function engineTable(title, rows, exactOf) {
  const F = fams(rows);
  P(`\n## ${title}`);
  P(`Seeded page-uniform sample (seed ${SEED}): ${fmt(rows.length)} pages. Share of sampled pages; "≈ pages" = share × the exact counter of that row. 95% margin on a share p is about ±${(1.96 * Math.sqrt(0.25 / Math.max(rows.length, 1)) * 100).toFixed(1)} points at the top line, wider per row (n shown).`);
  P(`| rows | n | ${F.join(' | ')} |`); P(`|---|--:|${F.map(() => '--:').join('|')}|`);
  const line = (label, x, exact) => P(`| ${label} | ${fmt(x.n)} | ${F.map((f) => { const p = (x.f.get(f) || 0) / x.n; return p ? `${(p * 100).toFixed(1)}%${exact ? ` (≈ ${fmt(Math.round(p * exact))})` : ''}` : '–'; }).join(' | ')} |`);
  for (const [g, x] of share(rows, (r) => r.group)) line(`group: ${g}`, x, exactOf({ group: g }));
  for (const [l, x] of [...share(rows.filter((r) => r.group === 'live'), (r) => r.language)].filter(([, x]) => x.n >= 40).sort((a, b) => b[1].n - a[1].n)) line(`live · ${l}`, x, exactOf({ group: 'live', language: l }));
  for (const [c, x] of [...share(rows.filter((r) => r.group === 'live'), (r) => r.century)].filter(([, x]) => x.n >= 40).sort((a, b) => a[0].localeCompare(b[0]))) line(`live · ${c}`, x, exactOf({ group: 'live', century: c }));
}
const exact = (k) => (q) => cells.filter((c) => Object.entries(q).every(([a, v]) => c[a] === v)).reduce((s, c) => s + c[k], 0);
P(`\nEngine frame: ${fmt(engines.frame_books)} books with pages_count > 0 and OCR or English, ${fmt(engines.frame_pages)} pages_count; ${fmt(engines.draws)} page draws.`);
engineTable('OCR text by engine family (sample)', engines.ocr, exact('ocr'));
engineTable('English translation by engine family (same sampled pages)', engines.tr, exact('tr'));

// totals
P(`\n## Total 1 — judge verdicts recorded per page`);
const bcRows = sum(verdicts.book_checks, 'rows'), bcPages = sum(verdicts.book_checks, 'pages_read');
P(`book_checks: ${fmt(bcRows)} book-level rows covering ${fmt(bcPages)} page reads (one row = one book read by one method in one run; pages_read listed per row).`);
const byMethod = new Map(); for (const r of verdicts.book_checks) { const x = byMethod.get(r.method) || { rows: 0, pages: 0, months: new Map() }; x.rows += r.rows; x.pages += r.pages_read; x.months.set(r.month, (x.months.get(r.month) || 0) + r.pages_read); byMethod.set(r.method, x); }
const months = [...new Set(verdicts.book_checks.map((r) => r.month))].sort();
P(`| method | rows | pages read | ${months.join(' | ')} |`); P(`|---|--:|--:|${months.map(() => '--:').join('|')}|`);
for (const [m, x] of [...byMethod].sort((a, b) => b[1].pages - a[1].pages)) P(`| ${m} | ${fmt(x.rows)} | ${fmt(x.pages)} | ${months.map((mo) => fmt(x.months.get(mo) || 0)).join(' | ')} |`);
const byReader = new Map(); for (const r of verdicts.book_checks) byReader.set(r.reader, (byReader.get(r.reader) || 0) + r.pages_read);
P(`Pages read by reader kind: ${[...byReader].map(([k, n]) => `${k ?? 'unrecorded'} ${fmt(n)}`).join(' · ')}`);
const lj = verdicts.lane_judge_verdicts;
P(`\nlane_judge_verdicts: ${fmt(sum(lj, 'rows'))} rows (one row = one judged page or control). Page verdicts (kind = item): ${fmt(sum(lj.filter((r) => r.kind === 'item'), 'rows'))}; controls (wrong_page / planted / draft): ${fmt(sum(lj.filter((r) => r.kind !== 'item'), 'rows'))}.`);
const mirrored = sum(lj.filter((r) => r.kind === 'item' && String(r.instrument ?? '').startsWith('book_checks:')), 'rows');
P(`Of the page verdicts, ${fmt(mirrored)} are test rows whose instrument is \`book_checks:<method>\`: copies of book_checks reads, already counted above. **Page verdicts across both stores, each counted once: ${fmt(bcPages + sum(lj.filter((r) => r.kind === 'item'), 'rows') - mirrored)}** (book_checks pages read + lane_judge item rows − the copies). Test rows carry judged_at: null, so their month is "not recorded".`);
const ljMonths = [...new Set(lj.map((r) => r.month))].sort();
const ljKey = new Map(); for (const r of lj) { const k = `${r.origin} · ${r.instrument ?? '(no instrument)'} · ${r.kind}`; const x = ljKey.get(k) || new Map(); x.set(r.month, (x.get(r.month) || 0) + r.rows); ljKey.set(k, x); }
P(`| origin · instrument · kind | ${ljMonths.join(' | ')} | total |`); P(`|---|${ljMonths.map(() => '--:').join('|')}|--:|`);
for (const [k, x] of [...ljKey].sort((a, b) => [...b[1].values()].reduce((s, n) => s + n, 0) - [...a[1].values()].reduce((s, n) => s + n, 0))) P(`| ${k} | ${ljMonths.map((m) => fmt(x.get(m) || 0)).join(' | ')} | ${fmt([...x.values()].reduce((s, n) => s + n, 0))} |`);

P(`\n## Total 2 — English withheld, and books held`);
P(`Withheld now (translation_withheld record AND no English text on the page): **${fmt(withheld.withheld_now_pages)} pages in ${fmt(withheld.withheld_now_books)} books**. Record only (English repaired and back): ${fmt(withheld.record_only_pages)} pages. ${fmt(withheld.withheld_now_books - withheld.withheld_books_under_decision_hold)} of the withholding books are not under a pipeline hold.`);
P(`| reason | withheld now | record only |`); P(`|---|--:|--:|`);
for (const r of withheld.by_reason) P(`| ${r.reason} | ${fmt(r.withheld_now)} | ${fmt(r.record_only)} |`);
const dec = withheld.holds.filter((h) => !h.not_acquired), na = withheld.holds.filter((h) => h.not_acquired);
P(`\nPipeline holds: ${fmt(sum(dec, 'books'))} books held by decision (${fmt(sum(dec, 'live_books'))} of them live) across ${dec.length} reasons; ${fmt(sum(na, 'books'))} not-acquired catalogue records (${na.map((h) => `${h.reason} ${fmt(h.books)}`).join(', ')}). Top decision reasons: ${dec.slice(0, 8).map((h) => `${h.reason} ${fmt(h.books)}`).join(' · ')}.`);
P(`The \`contained\` label is on GitHub issues: \`gh issue list --label contained --state all\`.`);

if (revisions) {
  P(`\n## Total 3 — page_revisions: which rows are a real second read`);
  const cls = (f, c, t) => revisions.by_source.filter((r) => r.field === f && r.class === c && (t == null || r.has_text === t)).reduce((s, r) => s + r.rows, 0);
  P(`All rows: ${fmt(sum(revisions.by_source, 'rows'))}. Field \`ocr\`: READ ${fmt(cls('ocr', 'read'))} (with superseded text ${fmt(cls('ocr', 'read', true))}) · MOVE ${fmt(cls('ocr', 'move'))} · OTHER ${fmt(cls('ocr', 'other'))}. Field \`translation\`: READ-labelled ${fmt(cls('translation', 'read'))} · MOVE ${fmt(cls('translation', 'move'))} · OTHER ${fmt(cls('translation', 'other'))}. Other fields: ${fmt(revisions.by_source.filter((r) => r.field !== 'ocr' && r.field !== 'translation').reduce((s, r) => s + r.rows, 0))}.`);
  P(`READ = ${[...READ_SOURCES].join(', ')}. MOVE = ${MOVE_SOURCE}.`);
  P(`| field | source | class | rows | with superseded text |`); P(`|---|---|---|--:|--:|`);
  const agg2 = new Map(); for (const r of revisions.by_source) { const k = `${r.field}\u0001${r.source}`; const x = agg2.get(k) || { ...r, rows: 0, text: 0 }; x.rows += r.rows; if (r.has_text) x.text += r.rows; agg2.set(k, x); }
  for (const r of [...agg2.values()].sort((a, b) => b.rows - a.rows).filter((r) => r.rows >= 1000)) P(`| ${r.field} | ${r.source} | ${r.class} | ${fmt(r.rows)} | ${fmt(r.text)} |`);
  P(`(${[...agg2.values()].filter((r) => r.rows < 1000).length} smaller field × source rows in the JSON.)`);
  P(`\nSame image? OCR READ rows whose superseded read recorded its image (engine.input.image_url), against the image the page's current read recorded:`);
  P(`| source | ${['same image URL', 'different image URL', 'current read records no image', 'page missing'].join(' | ')} |`); P(`|---|--:|--:|--:|--:|`);
  for (const s of [...new Set(revisions.image_check.map((r) => r.source))]) P(`| ${s} | ${['same image URL', 'different image URL', 'current read records no image', 'page missing'].map((c) => fmt(revisions.image_check.find((r) => r.source === s && r.result === c)?.rows || 0)).join(' | ')} |`);
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ started_at: startedAt, finished_at: finishedAt, seed: SEED, sample: SAMPLE, not_acquired_reasons: NOT_ACQUIRED_HOLD_REASONS, cells, engines, verdicts, withheld, revisions }, null, 1));
  P(`\nJSON: ${JSON_OUT}`);
}

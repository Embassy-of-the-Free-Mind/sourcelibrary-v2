#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/syriac-kraken-lane.mjs (#4883) and PR #5607's scripts/workers/paddle-zh-lane.mjs
 * (the Paddle Chinese lane, not yet on main), followed step for step in the apply half: hold checked in
 * the loop, revisions first and counted, human-edit guard re-checked in the write filter, textless reads
 * never stored, $literal pipeline write, staleness stamp, recount, sweep_log + one book_events row. Neither
 * fits as is: Kraken runs on this host and routes by script, Paddle takes a fixed SKQS cohort with a
 * Kanripo screen; this lane takes a census cohort, writes only pages that have no OCR, and screens every
 * read with the two #5660 guards (scripts/lib/glm-english-lane.mjs).
 *
 * The GLM English lane (#5660): GLM-OCR over the English 1600–1699 books whose next step is OCR. The GPU
 * half is scripts/gpu/glm-english-pod.sh (one RunPod pod, vLLM, pages fetched by the pod from their image
 * URLs); this file is the Mongo half and never talks to a GPU.
 *
 *   census   the cohort: `pipeline_next.step = ocr`, an English edition (isEnglishOriginal), year 1600–1699;
 *            a held book, one with a `hidden_reason`, or one whose already-read pages are mostly tagged
 *            another language (a Latin book labelled English) is LEFT OUT, with why. → cohort.json. Read-only.
 *   plan     per book: list pages with no OCR text → plan/<bid>.json + manifest.tsv (bid, page, image URL).
 *            With --apply, HOLD the book first (HOLD_REASON). --books <file> / --limit N.
 *   apply    per book whose planned pages are all back from the pod: guards (script, truncation), textless
 *            reads skipped, refused reads kept in page_revisions only, write with provenance + `ocr.guards`,
 *            recount, sweep_log + book_events. Dry unless --apply. The hold is kept.
 *   release  release the hold on planned books that got NO page from the lane (budget stop), to the status
 *            they were held from, so the existing lane can have them. Dry unless --apply.
 *   status   what the files say.
 *
 * No Gemini call anywhere. Every Mongo walk `.toArray()`s before slow work.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/workers/glm-english-lane.mjs census
 *   node --env-file=... scripts/workers/glm-english-lane.mjs plan --books pilot.txt --apply
 *   node --env-file=... scripts/workers/glm-english-lane.mjs apply [--apply] [--book <id>]
 * Options: --dir <lane dir> (default /root/glm-english-5660d)
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { withMongo } from '../lib/mongo.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { recountBook, isEnglishOriginal, computeTranslationState, isReadableInEnglish } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { holdBook, isHeld, releaseBook } from '../lib/pipeline-hold.mjs';
import {
  LANE, LANE_ISSUE, REVISION_REASON, GUARD_SOURCE, BOOK_EVENT, HOLD_REASON, HOLD_RELEASE, MIN_LETTERS, GLM,
  cleanGlmWithStats, letterStats, guardVerdict, bookMedianChars, envelope, ocrSetFields, isHumanEdited, STALE_OCR_FIELDS, markTranslationsStale,
} from '../lib/glm-english-lane.mjs';

const argv = process.argv.slice(2);
const CMD = argv[0];
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const DIR = arg('--dir', '/root/glm-english-5660d');
const APPLY = flag('--apply');
const BOOK = arg('--book', null);
const LIMIT = Number(arg('--limit', 0)) || 0;

const F = {
  cohort: path.join(DIR, 'cohort.json'), planDir: path.join(DIR, 'plan'), outDir: path.join(DIR, 'out'),
  manifest: path.join(DIR, 'manifest.tsv'), box: path.join(DIR, 'box.json'),
  applied: path.join(DIR, 'applied.jsonl'), flagged: path.join(DIR, 'flagged.jsonl'), skipped: path.join(DIR, 'skipped.jsonl'),
  bookLog: path.join(DIR, 'applied-books.jsonl'), log: path.join(DIR, 'lane.log'),
};
const outFile = (bid, pn, ext) => path.join(F.outDir, bid, `${pn}.${ext}`);
const planFile = (bid) => path.join(F.planDir, `${bid}.json`);
function log(msg) {
  const line = `${new Date().toISOString()} [${CMD}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(F.log, line + '\n'); } catch {}
}
const append = (file, row) => fs.appendFileSync(file, JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n');
const readJsonl = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const readJson = (file, d) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : d;
const key = (r) => `${r.bid}/${r.pn}`;
const yearOf = (b) => { for (const v of [b.year, b.published]) { const m = String(v ?? '').match(/1[0-9]{3}/); if (m) return +m[0]; } return null; };
/** A book is read only when at least this share of its language-tagged OCR pages say English (none tagged = read). */
const MIN_ENGLISH_SHARE = 0.5;
const NO_LANGUAGE = new Set(['none', '?', 'n', 'unknown', 'undetermined']);

/** The `<language>` tags on a book's already-read pages (up to 60): `{ tally, english, tagged, share }`. */
async function previewLanguage(db, bookId) {
  const ps = await db.collection('pages').find({ book_id: bookId, 'ocr.data': { $type: 'string', $ne: '' } }, { projection: { 'ocr.data': 1 } }).limit(60).toArray();
  const tally = {};
  for (const p of ps) { const m = p.ocr.data.match(/<language>([^<]*)<\/language>/); const k = m ? m[1].trim().split(/[,;/ ]/)[0] : '?'; tally[k] = (tally[k] || 0) + 1; }
  const tagged = Object.entries(tally).filter(([k]) => !NO_LANGUAGE.has(k.toLowerCase())).reduce((n, [, v]) => n + v, 0);
  const english = (tally.English || 0) + (tally.en || 0);
  return { tally, english, tagged, share: tagged ? +(english / tagged).toFixed(3) : null };
}
const NO_TEXT = { $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] };

// ── census ─────────────────────────────────────────────────────────────────────────────

async function census() {
  const P = { id: 1, title: 1, language: 1, year: 1, published: 1, pages_count: 1, pages_ocr: 1, visible: 1, hidden_reason: 1, pipeline_auto: 1 };
  await withMongo(async (db) => {
    const bs = await db.collection('books').find({ 'pipeline_next.step': 'ocr' }, { projection: P, maxTimeMS: 120000 }).toArray();
    const eng = bs.filter((b) => isEnglishOriginal(b.language) && yearOf(b) >= 1600 && yearOf(b) <= 1699);
    const keep = [], out = [];
    for (const b of eng.sort((x, y) => x.id.localeCompare(y.id))) {
      const row = { id: b.id, title: b.title, year: yearOf(b), pages_count: b.pages_count || 0, pages_ocr: b.pages_ocr || 0, visible: b.visible ?? null, status: b.pipeline_auto?.status ?? null };
      if (isHeld(b)) { out.push({ ...row, why: `held: ${b.pipeline_auto.hold.reason}` }); continue; }
      if (b.hidden_reason) { out.push({ ...row, why: `hidden_reason: ${String(b.hidden_reason).slice(0, 60)}` }); continue; }
      // `books.language` says English on every book here, yet 42 of 124 are Latin by their own preview pages
      // (measured 2026-10-04). The bake-off routes ENGLISH print to GLM, so the pages decide.
      const lang = await previewLanguage(db, b.id);
      if (lang.share != null && lang.share < MIN_ENGLISH_SHARE) out.push({ ...row, why: `preview pages are not English (${lang.english}/${lang.tagged} tagged English)`, preview_lang: lang.tally });
      else keep.push({ ...row, english_share: lang.share, preview_lang: lang.tally });
    }
    const unread = (rows) => rows.reduce((s, r) => s + Math.max(0, r.pages_count - r.pages_ocr), 0);
    const summary = { generated_at: new Date().toISOString(), rule: `pipeline_next.step = ocr, isEnglishOriginal(language), year (year|published) 1600–1699; held, hidden_reason, or < ${MIN_ENGLISH_SHARE} of language-tagged OCR pages English: left out`, english_1600s: eng.length, keep_books: keep.length, keep_pages_unread: unread(keep), left_out_books: out.length, left_out_pages_unread: unread(out) };
    fs.writeFileSync(F.cohort, JSON.stringify({ summary, keep, left_out: out }, null, 1));
    log(`CENSUS ${JSON.stringify(summary)}`);
  });
}

// ── plan ───────────────────────────────────────────────────────────────────────────────

async function plan() {
  fs.mkdirSync(F.planDir, { recursive: true });
  let ids;
  if (arg('--books', null)) ids = fs.readFileSync(arg('--books'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  else if (BOOK) ids = [BOOK];
  else ids = (readJson(F.cohort, null)?.keep || (() => { throw new Error('no cohort.json — run census first, or pass --books'); })()).map((r) => r.id);
  ids = ids.filter((id) => !fs.existsSync(planFile(id)) || flag('--refresh'));
  if (LIMIT) ids = ids.slice(0, LIMIT);
  log(`${ids.length} book(s) to plan${APPLY ? '' : '  [DRY RUN: no holds, no plan files]'}`);
  const tally = { books: 0, pages: 0, keep_human: 0, no_image: 0, skipped_books: [] };
  const rowsOut = [];
  await withMongo(async (db) => {
    for (const bid of ids) {
      const book = await db.collection('books').findOne({ id: bid }, { projection: { id: 1, title: 1, hidden_reason: 1, pipeline_auto: 1, pages_count: 1 } });
      if (!book) { tally.skipped_books.push({ bid, why: 'not_found' }); continue; }
      if (book.hidden_reason) { tally.skipped_books.push({ bid, why: `hidden_reason: ${String(book.hidden_reason).slice(0, 60)}` }); continue; }
      if (isHeld(book) && book.pipeline_auto.hold.reason !== HOLD_REASON) { tally.skipped_books.push({ bid, why: `held: ${book.pipeline_auto.hold.reason}` }); continue; }
      const pages = await db.collection('pages').find({ book_id: book.id, page_number: { $gt: 0 }, ...NO_TEXT }, { projection: {
        id: 1, page_number: 1, 'ocr.edited_by': 1, 'ocr.edited_at': 1, 'ocr.source': 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1,
      } }).sort({ page_number: 1 }).toArray();
      if (!APPLY) { log(`${bid} would plan ${pages.length} unread pages | ${String(book.title).slice(0, 50)}`); tally.pages += pages.length; continue; }
      // the hold BEFORE anything else: an OCR write otherwise lets the pipeline queue paid gap-fill "translation"
      const h = await holdBook(db, book.id, { reason: HOLD_REASON, issue: LANE_ISSUE, release: HOLD_RELEASE, source: LANE, detail: { engine: GLM.model } });
      if (!['held', 'already_held'].includes(h.outcome)) { tally.skipped_books.push({ bid, why: `hold ${h.outcome}` }); log(`${bid} hold: ${h.outcome} — not planned`); continue; }
      const rows = [];
      for (const p of pages) {
        if (isHumanEdited(p.ocr)) { tally.keep_human++; continue; }
        const src = getPageSource(p);
        if (!src) { tally.no_image++; continue; }
        rows.push({ pid: p.id, pn: p.page_number, src });
        rowsOut.push([book.id, p.page_number, src].join('\t'));
      }
      fs.writeFileSync(planFile(book.id), JSON.stringify({ bid: book.id, title: book.title, pages_count: book.pages_count || 0, planned_at: new Date().toISOString(), held_from: h.from ?? null, pages: rows }));
      tally.books++; tally.pages += rows.length;
    }
  });
  if (APPLY && rowsOut.length) fs.appendFileSync(F.manifest, rowsOut.join('\n') + '\n');
  log(`PLAN ${JSON.stringify({ ...tally, skipped_books: tally.skipped_books.length })}${tally.skipped_books.length ? ' skipped: ' + JSON.stringify(tally.skipped_books.slice(0, 20)) : ''}`);
}

// ── apply ──────────────────────────────────────────────────────────────────────────────

async function recordGuardRefusal(db, { page, bid, text, verdict, run }) {
  await db.collection('page_revisions').insertOne({
    id: randomBytes(6).toString('hex'), page_id: page.id, book_id: bid, page_number: page.page_number ?? null, field: 'ocr',
    data: text, source: GUARD_SOURCE, model: GLM.model, reason: `#${LANE_ISSUE}`,
    note: `GLM-OCR read refused at write time by ${[...verdict.script.reasons, ...verdict.truncation.reasons].join(', ')}; the page keeps no GLM text and stays for the existing lane.`,
    guards: verdict, run, created_at: new Date(),
  });
}

async function apply() {
  const box = readJson(F.box, {});
  const done = new Set([...readJsonl(F.applied), ...readJsonl(F.flagged), ...readJsonl(F.skipped)].map(key));
  const planned = fs.existsSync(F.planDir) ? fs.readdirSync(F.planDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  const back = (bid, p) => fs.existsSync(outFile(bid, p.pn, 'txt')) || fs.existsSync(outFile(bid, p.pn, 'err'));
  const ready = [];
  for (const bid of planned) {
    if (BOOK && bid !== BOOK) continue;
    const pl = readJson(planFile(bid));
    // a book is applied in ONE pass, once every planned page is back: the truncation guard needs the book median
    if (!pl.pages.length || !pl.pages.every((p) => back(bid, p))) continue;
    const rows = pl.pages.filter((p) => !done.has(`${bid}/${p.pn}`) && fs.existsSync(outFile(bid, p.pn, 'txt')));
    if (rows.length) ready.push({ pl, rows });
  }
  log(`${ready.length} books ready (${ready.reduce((s, b) => s + b.rows.length, 0)} read pages)${APPLY ? '' : '  [DRY RUN]'}`);
  const totals = { books: 0, written: 0, flagged: 0, flagged_by: {}, textless: 0, human_edited: 0, already_text: 0, not_held: 0, aborted: 0, stale_marked: 0 };
  if (!ready.length) { log(`APPLY ${JSON.stringify(totals)}`); return totals; }
  await withMongo(async (db) => {
    const P = db.collection('pages'), B = db.collection('books');
    for (const { pl, rows } of ready) {
      const bid = pl.bid;
      const book = await B.findOne({ id: bid }, { projection: { id: 1, title: 1, pipeline_auto: 1 } });
      if (!book) { log(`${bid} not found — skipping`); continue; }
      // the hold is the lane's guarantee that no paid "translation" follows the write
      if (book.pipeline_auto?.hold?.reason !== HOLD_REASON) { log(`${bid} NOT held for ${HOLD_REASON} — refusing to write`); totals.not_held++; continue; }
      const pages = await P.find({ id: { $in: rows.map((r) => r.pid) } }, { projection: { id: 1, page_number: 1, ocr: 1 } }).toArray();
      const byId = new Map(pages.map((p) => [p.id, p]));
      const reads = rows.map((r) => { const c = cleanGlmWithStats(fs.readFileSync(outFile(bid, r.pn, 'txt'), 'utf8')); return { r, body: c.text, meta: { ...readJson(outFile(bid, r.pn, 'json'), {}), postprocess: c.postprocess } }; });
      const median = bookMedianChars(reads.map((x) => x.body.length));
      const run = `${LANE}/${box.pod_id || 'unknown-pod'}`;
      const writes = [];
      let bookFlagged = 0;
      for (const { r, body, meta } of reads) {
        const p = byId.get(r.pid);
        if (!p) { if (APPLY) append(F.skipped, { bid, pn: r.pn, why: 'page_gone' }); continue; }
        if (isHumanEdited(p.ocr)) { if (APPLY) append(F.skipped, { bid, pn: r.pn, why: 'human_edited' }); totals.human_edited++; continue; }
        if (p.ocr?.data) { if (APPLY) append(F.skipped, { bid, pn: r.pn, why: 'already_has_text' }); totals.already_text++; continue; }
        if (letterStats(body).letters < MIN_LETTERS) {
          // GLM saw no text (a plate, a blank leaf): never store an empty reading
          if (APPLY) append(F.skipped, { bid, pn: r.pn, why: 'textless' }); totals.textless++; continue;
        }
        const verdict = guardVerdict(body, meta, median);
        if (!verdict.pass) {
          const reasons = [...verdict.script.reasons, ...verdict.truncation.reasons];
          for (const x of reasons) totals.flagged_by[x] = (totals.flagged_by[x] || 0) + 1;
          totals.flagged++; bookFlagged++;
          if (APPLY) { await recordGuardRefusal(db, { page: p, bid, text: envelope(body), verdict, run }); append(F.flagged, { bid, pn: r.pn, pid: r.pid, reasons, detail: { ...verdict.script.detail, ...verdict.truncation.detail }, image: r.src }); }
          continue;
        }
        writes.push({ r, p, text: envelope(body), meta, verdict });
      }
      if (!APPLY) { log(`${bid} would write ${writes.length} of ${rows.length} read pages, ${bookFlagged} flagged (median ${median}) | ${String(book.title || '').slice(0, 50)}`); totals.written += writes.length; continue; }
      if (!writes.length) { log(`${bid} nothing to write (${bookFlagged} flagged)`); continue; }
      const nRev = await saveRevisionsBeforeOverwrite(db, writes.map((w) => w.p.id), 'ocr', { reason: REVISION_REASON, keepMeta: true });
      if (nRev !== 0) { log(`ABORT ${bid}: ${nRev} planned pages gained text since the plan — not writing`); totals.aborted++; continue; }
      const now = new Date();
      let modified = 0;
      const unset = Object.fromEntries([...STALE_OCR_FIELDS, 'translation.health_blocked', 'translation.health_blocked_at'].map((k) => [k, '']));
      for (const w of writes) {
        const set = ocrSetFields(w.text, { run, now, imageUrl: w.r.src, box, meta: { ...w.meta, max_tokens: w.meta.max_tokens ?? box.max_tokens ?? null }, guards: w.verdict });
        // pipeline update: `ocr` can be null on never-read pages; every value $literal (a transcription is arbitrary text).
        // The filter is the guarantee: a page that gained text or a human edit since the plan is never overwritten.
        const literal = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, { $literal: v }]));
        const res = await P.updateOne({ id: w.p.id, ...NO_TEXT, 'ocr.edited_by': { $exists: false }, 'ocr.edited_at': { $exists: false }, 'ocr.source': { $ne: 'manual' } }, [
          { $set: { ocr: { $cond: { if: { $eq: [{ $type: '$ocr' }, 'object'] }, then: '$ocr', else: {} } } } },
          { $set: literal },
          { $unset: Object.keys(unset) },
        ]);
        modified += res.modifiedCount;
        append(F.applied, { bid, pn: w.r.pn, pid: w.p.id, chars: w.text.length, modified: res.modifiedCount });
      }
      totals.written += modified; totals.books++;
      const stale = await markTranslationsStale(db, writes.map((w) => ({ id: w.p.id, text: w.text })), now, LANE);
      totals.stale_marked += stale;
      const { after: counts } = await recountBook(db, book.id, { reason: LANE, now });
      await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'transcribed', detail: { issue: LANE_ISSUE, engine: GLM.model, revision: box.revision || GLM.revision, pages_written: modified, pages_flagged: bookFlagged, run, translations_marked_stale: stale } });
      await db.collection('book_events').updateOne(
        { book_id: bid, type: BOOK_EVENT },
        { $setOnInsert: { book_id: bid, type: BOOK_EVENT, at: now, source: LANE, 'details.issue': LANE_ISSUE, 'details.engine': GLM.model, 'details.repo': GLM.repo },
          $set: { 'details.last_apply_at': now, 'details.pages_ocr_after': counts?.pages_ocr ?? null, 'details.planned': pl.pages.length },
          $inc: { 'details.pages_written': modified, 'details.pages_flagged': bookFlagged } },
        { upsert: true },
      );
      append(F.bookLog, { bid, written: modified, rows: rows.length, flagged: bookFlagged, median, pages_ocr_after: counts?.pages_ocr ?? null, pages_count: counts?.pages_count ?? null });
      log(`${bid} wrote ${modified}/${writes.length} (${bookFlagged} flagged, median ${median}, pages_ocr ${counts?.pages_ocr}/${counts?.pages_count}) | ${String(book.title || '').slice(0, 40)}`);
    }
  }, { timeoutMs: 3 * 3600 * 1000 });
  log(`APPLY ${JSON.stringify(totals)}`);
  return totals;
}

// ── release (books the budget never reached) ───────────────────────────────────────────

async function release() {
  const planned = fs.existsSync(F.planDir) ? fs.readdirSync(F.planDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  const appliedBooks = new Set(readJsonl(F.applied).map((a) => a.bid));
  const untouched = planned.filter((bid) => !appliedBooks.has(bid) && !fs.existsSync(path.join(F.outDir, bid)));
  log(`${untouched.length} planned book(s) got no page from the lane${APPLY ? '' : '  [DRY RUN]'}`);
  await withMongo(async (db) => {
    for (const bid of untouched) {
      const b = await db.collection('books').findOne({ id: bid }, { projection: { pipeline_auto: 1 } });
      if (b?.pipeline_auto?.hold?.reason !== HOLD_REASON) continue;
      const r = await releaseBook(db, bid, { note: `#${LANE_ISSUE}: the GLM lane stopped at its budget before reading this book`, source: LANE }, { dryRun: !APPLY });
      log(`${bid} release: ${JSON.stringify(r)}`);
      if (APPLY && r.outcome === 'released') fs.renameSync(planFile(bid), planFile(bid) + '.released');
    }
  });
}

// ── status ─────────────────────────────────────────────────────────────────────────────

async function status() {
  const planned = fs.existsSync(F.planDir) ? fs.readdirSync(F.planDir).filter((x) => x.endsWith('.json')) : [];
  let pages = 0, read = 0, err = 0, booksRead = 0;
  for (const x of planned) {
    const pl = JSON.parse(fs.readFileSync(path.join(F.planDir, x), 'utf8'));
    pages += pl.pages.length;
    let r = 0;
    for (const p of pl.pages) { if (fs.existsSync(outFile(pl.bid, p.pn, 'txt'))) r++; else if (fs.existsSync(outFile(pl.bid, p.pn, 'err'))) err++; }
    read += r; if (r + err >= pl.pages.length) booksRead++;
  }
  const applied = readJsonl(F.applied), skipped = readJsonl(F.skipped), flagged = readJsonl(F.flagged);
  const byReason = {};
  for (const f of flagged) for (const x of f.reasons) byReason[x] = (byReason[x] || 0) + 1;
  const out = {
    dir: DIR, books_planned: planned.length, books_read: booksRead, books_applied: new Set(readJsonl(F.bookLog).map((b) => b.bid)).size,
    pages_planned: pages, pages_read: read, pages_pod_error: err,
    pages_written: applied.filter((a) => a.modified).length, pages_flagged: flagged.length, flagged_by: byReason,
    pages_skipped: skipped.length, skipped_by_reason: skipped.reduce((m, s) => ({ ...m, [s.why]: (m[s.why] || 0) + 1 }), {}),
  };
  if (flag('--live')) {
    const ids = planned.map((x) => x.slice(0, -5));
    const SINCE = new Date(arg('--since', '2026-10-04T00:00:00Z'));
    await withMongo(async (db) => {
      const bs = await db.collection('books').find({ id: { $in: ids } }, { projection: { id: 1, language: 1, content_type: 1, visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, pages_translatable: 1, translation_state: 1, pipeline_auto: 1 } }).toArray();
      const now = bs.map((b) => ({ b, st: computeTranslationState(b, { language: b.language, content_type: b.content_type }) }));
      out.live = {
        books: bs.length,
        readable_in_english_computed: now.filter((x) => isReadableInEnglish(x.st)).length,
        readable_in_english_computed_visible: now.filter((x) => isReadableInEnglish(x.st) && x.b.visible === true && (x.b.pages_count || 0) > 0).length,
        readable_in_english_stored: bs.filter((b) => isReadableInEnglish(b.translation_state)).length,
        rung_computed: now.reduce((m, x) => ({ ...m, [x.st.rung]: (m[x.st.rung] || 0) + 1 }), {}),
        held_for_lane: bs.filter((b) => b.pipeline_auto?.hold?.reason === HOLD_REASON).length,
        translation_jobs: await db.collection('jobs').countDocuments({ book_id: { $in: ids }, type: { $regex: /translat/i }, created_at: { $gte: SINCE } }),
        pages_translated_since: await db.collection('pages').countDocuments({ book_id: { $in: ids }, 'translation.updated_at': { $gte: SINCE } }),
        since: SINCE.toISOString(),
      };
    });
  }
  console.log(JSON.stringify(out, null, 1));
}

const CMDS = { census, plan, apply, release, status };
const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  if (!CMDS[CMD]) { console.error(`usage: glm-english-lane.mjs ${Object.keys(CMDS).join('|')} [options]`); process.exit(1); }
  fs.mkdirSync(DIR, { recursive: true });
  await CMDS[CMD]();
}

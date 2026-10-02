#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/ndl-koten-lane.mjs (#4925) — plan / apply / status for a GPU OCR lane,
 * followed step for step in its apply half (hold checked in the loop, revisions first and counted,
 * human-edit guard re-checked in the write filter, loop guard, textless reads never stored, $literal
 * pipeline write, staleness stamp, recount, sweep_log + one book_events row). It cannot be reused as is:
 * its plan routes from a page-image census and draws one book per series, where this lane takes a
 * fixed cohort minus Kanripo-key duplicates; its apply writes the NDL envelope and engine block.
 * The duplicate rule is #5547's (scripts/eval/zh-cohort-5547-duplicates.mjs — `juanRange` imported);
 * the QA screen is #5568's Kanripo alignment (scripts/eval/zh-skqs-5568-kanripo.mjs — imported).
 * Policy, conversions and provenance live in scripts/lib/paddle-zh-lane.mjs.
 *
 * The Paddle Chinese lane (#5600): PaddleOCR-VL-1.6 over the 7,894 Siku Quanshu volumes held out of
 * #4719. The GPU half is scripts/gpu/paddle-zh-fleet.mjs (boxes, manifests, pulls); this file is the
 * Mongo half and never talks to a GPU.
 *
 *   dedup    one copy per exact-key cluster (work_id + sub-work + juan range + 之N/上下, #5547): a held
 *            copy is SKIPPED when the cluster has a live copy outside the cohort that is ≥ 90 % OCR'd
 *            (a preview stub does not cover it) or a larger held copy, AND its stored OCR (pages ≤ 30) reads as the same text as that copy (median best
 *            char-bigram Dice ≥ 0.6, #5547's check, 24/30 exact-key pairs). A copy the text check
 *            cannot confirm is read. Writes dedup.json + skipped-duplicates.tsv. Read-only.
 *   plan     list each book's pages → plan/<bid>.json (page id, number, image URL). With --apply,
 *            HOLD the book first (reason paddle-zh-5600-ocr-only); a book held for another reason is
 *            left out, untouched. --books <file> limits to a list (the pilot), --limit N to N books.
 *   apply    per book whose planned pages are all back from a box: convert (paddle-zh-lane.mjs), screen
 *            against Kanripo's WYG text where the work has one (Dice < 0.6 → `ocr.qa_screen.flagged`,
 *            listed in qa-flagged.jsonl), revisions first, write with provenance, stamp
 *            `translation_stale`, recount, sweep_log + book_events. Dry unless --apply. Hold kept.
 *   status   what the files say: books, pages planned / read / written / skipped, QA flag rate.
 *
 * No Gemini call anywhere. Every Mongo walk `.toArray()`s before slow work.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/workers/paddle-zh-lane.mjs dedup
 *   node --env-file=... scripts/workers/paddle-zh-lane.mjs plan --books pilot.txt --apply
 *   node --env-file=... scripts/workers/paddle-zh-lane.mjs apply [--apply] [--book <id>]
 * Options: --dir <lane dir> (default /root/paddle-zh-5600)  --cohort <ids file>
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { loopVerdict, recordLoopRefusal } from '../lib/ocr-loop-guard.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { holdBook, isHeld } from '../lib/pipeline-hold.mjs';
import { juanRange } from '../eval/zh-cohort-5547-duplicates.mjs';
import {
  LANE, LANE_ISSUE, REVISION_REASON, BOOK_EVENT, HOLD_REASON, HOLD_RELEASE, MIN_HAN, PADDLE,
  convertPaddle, envelope, hanCount, workTitleOf, pagePolicy, ocrSetFields,
  isHumanEdited, STALE_OCR_FIELDS, markTranslationsStale,
} from '../lib/paddle-zh-lane.mjs';

const argv = process.argv.slice(2);
const CMD = argv[0];
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const DIR = arg('--dir', '/root/paddle-zh-5600');
const COHORT = arg('--cohort', '/root/preview-stubs-4719/ids-chinese-held-5481.txt');
const APPLY = flag('--apply');
const BOOK = arg('--book', null);
const LIMIT = Number(arg('--limit', 0)) || 0;
/** Kanripo alignment threshold (#5568: aligned = Dice ≥ 0.6). */
const QA_THRESH = 0.6;
/** A page needs this many folded Han characters to be screened (#5568 drift: shorter = cover/plate). */
const QA_MIN = 20;

const F = {
  dedup: path.join(DIR, 'dedup.json'), dedupTsv: path.join(DIR, 'skipped-duplicates.tsv'),
  books: path.join(DIR, 'books.json'), planDir: path.join(DIR, 'plan'), outDir: path.join(DIR, 'out'),
  applied: path.join(DIR, 'applied.jsonl'), refused: path.join(DIR, 'refused.jsonl'), skipped: path.join(DIR, 'skipped.jsonl'),
  qa: path.join(DIR, 'qa-flagged.jsonl'), bookLog: path.join(DIR, 'applied-books.jsonl'),
  assign: path.join(DIR, 'assign.json'), boxes: path.join(DIR, 'boxes'), log: path.join(DIR, 'lane.log'),
};
const outTxt = (bid, pn) => path.join(F.outDir, bid, `${pn}.txt`);
const outErr = (bid, pn) => path.join(F.outDir, bid, `${pn}.err`);
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
const cohortIds = () => fs.readFileSync(COHORT, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);

// ── text check (the #5547 duplicate verification) ──────────────────────────────────────

const hanOnly = (s) => [...String(s || '')].filter((c) => /\p{Script=Han}/u.test(c)).join('');
const bigrams = (s) => { const m = new Map(); for (let i = 0; i + 1 < s.length; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
function diceMaps(a, b) { let inter = 0, na = 0, nb = 0; for (const v of a.values()) na += v; for (const v of b.values()) nb += v; for (const [g, v] of a) inter += Math.min(v, b.get(g) || 0); return na + nb ? 2 * inter / (na + nb) : 0; }

/** Median over A's pages (≥ 100 Han, pages ≤ 30) of the best Dice against any B page; null when either side has none. */
async function sameText(db, aId, bId) {
  const texts = async (id) => (await db.collection('pages').find({ book_id: id, page_number: { $lte: 30 }, 'ocr.data': { $exists: true } }, { projection: { 'ocr.data': 1 }, maxTimeMS: 30000 }).toArray()).map((p) => hanOnly(p.ocr.data)).filter((t) => t.length >= 100);
  const A = await texts(aId), B = (await texts(bId)).map(bigrams);
  if (!A.length || !B.length) return { score: null, a_pages: A.length, b_pages: B.length };
  const per = A.map((a) => Math.max(...B.map((b) => diceMaps(bigrams(a), b)))).sort((x, y) => x - y);
  return { score: +per[per.length >> 1].toFixed(3), a_pages: A.length, b_pages: B.length };
}

// ── dedup ──────────────────────────────────────────────────────────────────────────────

async function dedup() {
  fs.mkdirSync(DIR, { recursive: true });
  const held = new Set(cohortIds());
  const P = { id: 1, title: 1, work_id: 1, pages_count: 1, pages_ocr: 1, visible: 1 };
  const summary = { generated_at: new Date().toISOString(), cohort_books: held.size };
  const rows = { keep: [], skip: [], read_despite_key: [] };
  await withMongo(async (db) => {
    const heldBooks = await db.collection('books').find({ id: { $in: [...held] } }, { projection: P }).toArray();
    const works = [...new Set(heldBooks.map((b) => b.work_id).filter(Boolean))];
    const kin = await db.collection('books').find({ work_id: { $in: works } }, { projection: P, maxTimeMS: 120000 }).toArray();
    const live = (b) => b.visible === true && (b.pages_count || 0) > 0;
    const keyOf = (b) => { const r = juanRange(b.title); return r && b.work_id ? `${b.work_id}|${r.part}|${r[0]}-${r[1]}|${r.sub}` : null; };
    const clusters = new Map();
    for (const b of kin) {
      if (!(held.has(b.id) || live(b))) continue;
      const k = keyOf(b); if (!k) continue;
      if (!clusters.has(k)) clusters.set(k, []);
      clusters.get(k).push(b);
    }
    const redundant = new Map(); // held id → { key, rep }
    for (const [k, members] of clusters) {
      if (members.length < 2) continue;
      const hm = members.filter((b) => held.has(b.id)).sort((a, b) => (b.pages_count || 0) - (a.pages_count || 0) || a.id.localeCompare(b.id));
      // a live copy covers the cluster only when a reader can read it: a 25-page preview stub does not
      // (measured 2026-10-02: all 43 live copies that would have stood in were stubs)
      const outside = members.filter((b) => !held.has(b.id) && (b.pages_ocr || 0) >= 0.9 * (b.pages_count || 1)).sort((a, b) => (b.pages_ocr || 0) - (a.pages_ocr || 0));
      const rep = outside[0] || hm[0];
      for (const b of hm) if (b.id !== rep.id) redundant.set(b.id, { key: k, rep, rep_live: !held.has(rep.id), cluster_size: members.length });
    }
    summary.exact_key_clusters = [...clusters.values()].filter((m) => m.length > 1).length;
    summary.redundant_by_key = redundant.size;
    let n = 0;
    for (const b of heldBooks.sort((x, y) => x.id.localeCompare(y.id))) {
      const r = redundant.get(b.id);
      if (!r) { rows.keep.push(b.id); continue; }
      const t = await sameText(db, b.id, r.rep.id);
      const row = { id: b.id, title: b.title, pages: b.pages_count || 0, key: r.key, represented_by: r.rep.id, represented_by_title: r.rep.title, represented_by_live: r.rep_live, represented_by_pages_ocr: r.rep.pages_ocr || 0, represented_by_pages: r.rep.pages_count || 0, dice: t.score, compared_pages: t.a_pages };
      if (t.score != null && t.score >= 0.6) rows.skip.push(row);
      else { rows.keep.push(b.id); rows.read_despite_key.push({ ...row, why: t.score == null ? 'no stored OCR to compare' : 'stored OCR differs from the cluster copy' }); }
      if (++n % 100 === 0) log(`text check ${n}/${redundant.size}`);
    }
    const pages = (ids) => heldBooks.filter((b) => ids.has(b.id)).reduce((s, b) => s + (b.pages_count || 0), 0);
    summary.skip_books = rows.skip.length;
    summary.skip_pages = rows.skip.reduce((s, r) => s + r.pages, 0);
    summary.skip_of_live_copy = rows.skip.filter((r) => r.represented_by_live).length;
    summary.skip_of_live_copy_not_fully_ocrd = rows.skip.filter((r) => r.represented_by_live && r.represented_by_pages_ocr < 0.9 * (r.represented_by_pages || 1)).length;
    summary.read_despite_key = rows.read_despite_key.length;
    summary.keep_books = rows.keep.length;
    summary.keep_pages = pages(new Set(rows.keep));
    summary.rule = 'exact key = work_id + sub-work + juan range + 之N/上下 (#5547); one copy per cluster is read (a live copy outside the cohort that is >= 90 % OCR-read, else the largest held copy); a held copy is skipped only when its stored OCR (pages ≤ 30, ≥ 100 Han) has median best char-bigram Dice ≥ 0.6 against that copy';
  });
  fs.writeFileSync(F.dedup, JSON.stringify({ summary, keep: rows.keep, skip: rows.skip, read_despite_key: rows.read_despite_key }, null, 1));
  fs.writeFileSync(F.dedupTsv, ['book_id\tpages\tdice\trepresented_by\trep_live\ttitle\trepresented_by_title', ...rows.skip.map((r) => [r.id, r.pages, r.dice, r.represented_by, r.represented_by_live, r.title, r.represented_by_title].join('\t'))].join('\n') + '\n');
  log(`DEDUP ${JSON.stringify(summary)}`);
}

// ── plan ───────────────────────────────────────────────────────────────────────────────

async function plan() {
  fs.mkdirSync(F.planDir, { recursive: true });
  let ids;
  if (arg('--books', null)) ids = fs.readFileSync(arg('--books'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  else if (BOOK) ids = [BOOK];
  else ids = readJson(F.dedup, null)?.keep || (() => { throw new Error('no dedup.json — run dedup first, or pass --books'); })();
  ids = ids.filter((id) => !fs.existsSync(planFile(id)) || flag('--refresh'));
  if (LIMIT) ids = ids.slice(0, LIMIT);
  log(`${ids.length} book(s) to plan${APPLY ? '' : '  [DRY RUN: no holds, no plan files]'}`);
  const books = readJson(F.books, {});
  const tally = { books: 0, pages: 0, keep_human: 0, no_image: 0, already_lane: 0, skipped_books: [] };
  await withMongo(async (db) => {
    for (const bid of ids) {
      const book = await db.collection('books').findOne({ $or: [{ id: bid }, { _id: bid }] }, { projection: { id: 1, title: 1, work_id: 1, hidden_reason: 1, visible: 1, pipeline_auto: 1, pages_count: 1 } });
      if (!book) { tally.skipped_books.push({ bid, why: 'not_found' }); continue; }
      const hr = String(book.hidden_reason || '');
      if (hr && !/^(unprocessed|launch_curation)$/.test(hr)) { tally.skipped_books.push({ bid, why: `hidden_reason: ${hr.slice(0, 60)}` }); continue; }
      if (isHeld(book) && book.pipeline_auto.hold.reason !== HOLD_REASON) { tally.skipped_books.push({ bid, why: `held: ${book.pipeline_auto.hold.reason}` }); continue; }
      const pages = await db.collection('pages').find({ book_id: book.id, page_number: { $gt: 0 } }, { projection: {
        id: 1, page_number: 1, 'ocr.pipeline': 1, 'ocr.edited_by': 1, 'ocr.edited_at': 1, 'ocr.source': 1, 'ocr.data': 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1,
      } }).sort({ page_number: 1 }).toArray();
      if (!APPLY) { log(`${bid} would plan ${pages.length} pages | ${String(book.title).slice(0, 50)}`); continue; }
      // the hold BEFORE anything else: an OCR write on a `complete` book otherwise queues paid gap-fill translation
      const h = await holdBook(db, book.id, { reason: HOLD_REASON, issue: LANE_ISSUE, release: HOLD_RELEASE, source: LANE, detail: { engine: PADDLE.model } });
      if (!['held', 'already_held'].includes(h.outcome)) { tally.skipped_books.push({ bid, why: `hold ${h.outcome}` }); log(`${bid} hold: ${h.outcome} — not planned`); continue; }
      const rows = [];
      for (const p of pages) {
        if (p.ocr?.pipeline === LANE) { tally.already_lane++; continue; }
        if (pagePolicy(p, isHumanEdited).action === 'keep') { tally.keep_human++; continue; }
        const src = getPageSource(p);
        if (!src) { tally.no_image++; continue; }
        rows.push({ pid: p.id, pn: p.page_number, src, first_write: !p.ocr?.data });
      }
      fs.writeFileSync(planFile(book.id), JSON.stringify({ bid: book.id, title: book.title, work_id: book.work_id || null, pages_count: book.pages_count || pages.length, listed: pages.length, planned_at: new Date().toISOString(), pages: rows }));
      books[book.id] = { title: book.title, pages: rows.length, status_before: h.from ?? null };
      tally.books++; tally.pages += rows.length;
      if (tally.books % 200 === 0) { fs.writeFileSync(F.books, JSON.stringify(books)); log(`planned ${tally.books} books, ${tally.pages} pages`); }
    }
  });
  if (APPLY) fs.writeFileSync(F.books, JSON.stringify(books));
  log(`PLAN ${JSON.stringify({ ...tally, skipped_books: tally.skipped_books.length })}${tally.skipped_books.length ? ' skipped: ' + JSON.stringify(tally.skipped_books.slice(0, 20)) : ''}`);
}

// ── the Kanripo QA screen (#5568 test 1: aligned = Dice ≥ 0.6) ──────────────────────────

let kanripo = null;
/** Per page `{ dice, runner_up, pb, flagged }`, or a book-level `{ status: 'not_screened', reason }`. */
async function qaScreen(book, pages) {
  if (!/^kr:/.test(book.work_id || '')) return { status: 'not_screened', reason: 'no Kanripo work_id' };
  kanripo ||= await import('../eval/zh-skqs-5568-kanripo.mjs');
  const krId = book.work_id.slice(3);
  let w;
  try { w = await kanripo.workInfo(krId); } catch (e) { return { status: 'not_screened', reason: `github: ${String(e.message).slice(0, 80)}` }; }
  if (!w?.repo || w.witness !== 'WYG') return { status: 'not_screened', reason: w?.repo ? `no WYG witness (${w.witness || 'none'})` : 'no Kanripo repository' };
  const r = kanripo.juanRange(book.title);
  const align = (pbs) => {
    const res = new Map();
    let last = null;
    for (const p of pages) {
      const t = kanripo.fold(p.text);
      if (t.length < QA_MIN) continue;
      let m = last != null ? kanripo.best(t, pbs, Math.max(0, last - 60), Math.min(pbs.length, last + 60)) : null;
      if (!m || m.dice < QA_THRESH) { const full = kanripo.best(t, pbs); if (full && (!m || full.dice > m.dice)) m = full; }
      if (!m) continue;
      if (m.dice >= QA_THRESH) last = m.i;
      res.set(p.pn, { dice: +m.dice.toFixed(3), runner_up: +m.second.toFixed(3), pb: pbs[m.i].pb, flagged: m.dice < QA_THRESH });
    }
    return res;
  };
  try {
    const near = kanripo.nearJuan(w, r);
    let pbs = await kanripo.pbPages(krId, 'WYG', near.length ? near : w.juan_files);
    let res = align(pbs);
    // the title's juan often does not name Kanripo's file (#5568: 佩文韻府 卷85之1 sits in file 688) — search the whole work then
    const share = res.size ? [...res.values()].filter((x) => !x.flagged).length / res.size : 1;
    let scope = near.length ? 'juan ±5' : 'whole work';
    if (share < 0.5 && near.length && near.length < w.juan_files.length) {
      pbs = await kanripo.pbPages(krId, 'WYG', w.juan_files);
      const all = align(pbs);
      if ([...all.values()].filter((x) => !x.flagged).length > [...res.values()].filter((x) => !x.flagged).length) { res = all; scope = 'whole work'; }
    }
    return { status: 'screened', repo: `kanripo/${krId}`, ref: 'WYG', sha: w.witness_sha || null, scope, pages: res };
  } catch (e) { return { status: 'not_screened', reason: `kanripo: ${String(e.message).slice(0, 80)}` }; }
}

// ── apply ──────────────────────────────────────────────────────────────────────────────

const boxInfo = (() => { const cache = new Map(); return (name) => {
  if (!name) return {};
  if (!cache.has(name)) cache.set(name, readJson(path.join(F.boxes, name, 'box.json'), {}));
  return cache.get(name);
}; })();

async function apply() {
  const assign = readJson(F.assign, {});
  const done = new Set([...readJsonl(F.applied), ...readJsonl(F.refused), ...readJsonl(F.skipped)].map(key));
  const planned = fs.existsSync(F.planDir) ? fs.readdirSync(F.planDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  // A book's pages come back in two waves (the fleet reads never-read pages first, then re-reads the
  // preview pages, so a budget stop leaves the most text): a wave is ready when every page in it is
  // back from a box (.txt, or .err for a page the box failed), and is applied as one pass.
  const back = (bid, p) => fs.existsSync(outTxt(bid, p.pn)) || fs.existsSync(outErr(bid, p.pn));
  const ready = [];
  for (const bid of planned) {
    if (BOOK && bid !== BOOK) continue;
    const pl = readJson(planFile(bid));
    const rows = [];
    for (const wave of [true, false]) {
      const ps = pl.pages.filter((p) => !!p.first_write === wave);
      if (!ps.length || !ps.every((p) => back(bid, p))) continue;
      rows.push(...ps.filter((p) => !done.has(`${bid}/${p.pn}`) && fs.existsSync(outTxt(bid, p.pn)) && !fs.existsSync(outErr(bid, p.pn))));
    }
    if (rows.length) ready.push({ pl, rows });
  }
  log(`${ready.length} books ready (${ready.reduce((s, b) => s + b.rows.length, 0)} read pages)${APPLY ? '' : '  [DRY RUN]'}`);
  const totals = { books: 0, written: 0, stale_marked: 0, textless_kept: 0, refused: 0, human_edited: 0, not_held: 0, qa_screened: 0, qa_flagged: 0, aborted: 0 };
  if (!ready.length) { log(`APPLY ${JSON.stringify(totals)}`); return totals; }
  await withMongo(async (db) => {
    const P = db.collection('pages'), B = db.collection('books');
    for (const { pl, rows } of ready) {
      const bid = pl.bid;
      const book = await B.findOne({ id: bid }, { projection: { id: 1, title: 1, work_id: 1, pipeline_auto: 1 } });
      if (!book) { log(`${bid} not found — skipping`); continue; }
      // the hold is the lane's guarantee that no paid re-translation follows the write
      if (book.pipeline_auto?.hold?.reason !== HOLD_REASON) { log(`${bid} NOT held for ${HOLD_REASON} — refusing to write`); totals.not_held++; continue; }
      const pages = await P.find({ id: { $in: rows.map((r) => r.pid) } }, { projection: { id: 1, page_number: 1, ocr: 1 } }).toArray();
      const byId = new Map(pages.map((p) => [p.id, p]));
      const boxName = assign[bid] || null;
      const box = boxInfo(boxName);
      const workTitle = workTitleOf(book.title);
      const writes = [];
      for (const r of rows) {
        const p = byId.get(r.pid);
        if (!p) { if (APPLY) append(F.skipped, { bid, pn: r.pn, why: 'page_gone' }); continue; }
        if (isHumanEdited(p.ocr)) { if (APPLY) append(F.skipped, { bid, pn: r.pn, why: 'human_edited' }); totals.human_edited++; continue; }
        const { body, stats } = convertPaddle(fs.readFileSync(outTxt(bid, r.pn), 'utf8'), { workTitle });
        const han = hanCount(body);
        const oldLoop = p.ocr?.data ? loopVerdict(p.ocr.data).refuse : false;
        if (han < MIN_HAN && !oldLoop) {
          // Paddle saw no text (a plate, a blank leaf): never store an empty reading. A stored reading is
          // kept; a page with none stays unread. A textless read replaces only a loop.
          if (APPLY) append(F.skipped, { bid, pn: r.pn, why: 'paddle_textless_kept', han, old_chars: hanCount(p.ocr?.data) });
          totals.textless_kept++; continue;
        }
        const text = envelope(body);
        const v = loopVerdict(text);
        if (v.refuse) {
          if (APPLY) { await recordLoopRefusal(db, { pageId: p.id, bookId: bid, pageNumber: p.page_number, text, model: PADDLE.model, verdict: v }); append(F.refused, { bid, pn: r.pn, pid: r.pid, share: v.share }); }
          totals.refused++; continue;
        }
        writes.push({ r, p, text, stats, han, oldLoop });
      }
      if (!writes.length) { log(`${bid} nothing to write`); continue; }
      const qa = await qaScreen(book, writes.map((w) => ({ pn: w.r.pn, text: w.text })));
      const qaOf = (pn) => {
        if (qa.status !== 'screened') return { screen: 'kanripo-wyg-dice', status: 'not_screened', reason: qa.reason };
        const x = qa.pages.get(pn);
        if (!x) return { screen: 'kanripo-wyg-dice', status: 'not_screened', reason: `fewer than ${QA_MIN} Han characters` };
        return { screen: 'kanripo-wyg-dice', status: 'screened', threshold: QA_THRESH, ...x, repo: qa.repo, ref: qa.ref, sha: qa.sha, scope: qa.scope, issue: 5568 };
      };
      const screened = writes.filter((w) => qaOf(w.r.pn).status === 'screened');
      const flagged = screened.filter((w) => qaOf(w.r.pn).flagged);
      totals.qa_screened += screened.length; totals.qa_flagged += flagged.length;
      if (!APPLY) { log(`${bid} would write ${writes.length} of ${rows.length} read pages (QA ${qa.status === 'screened' ? `${flagged.length}/${screened.length} flagged` : qa.reason}) | ${String(book.title || '').slice(0, 50)}`); totals.written += writes.length; continue; }
      const withText = writes.filter((w) => w.p.ocr?.data && w.p.ocr.data !== '[RECITATION_BLOCKED]').length;
      const nRev = await saveRevisionsBeforeOverwrite(db, writes.map((w) => w.p.id), 'ocr', { reason: REVISION_REASON, keepMeta: true });
      if (nRev !== withText) { log(`ABORT ${bid}: saved ${nRev} revisions for ${withText} pages with text — not overwriting`); totals.aborted++; continue; }
      const now = new Date();
      const run = `${LANE}/${boxName || 'unknown-box'}`;
      let modified = 0;
      const unset = Object.fromEntries([...STALE_OCR_FIELDS, 'translation.health_blocked', 'translation.health_blocked_at'].map((k) => [k, '']));
      for (const w of writes) {
        const set = { ...ocrSetFields(w.text, { run, now, imageUrl: w.r.src, box, stats: w.stats }), 'ocr.qa_screen': qaOf(w.r.pn) };
        // pipeline update: `ocr` can be null on never-read pages; every value $literal (a transcription is arbitrary text)
        const literal = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, { $literal: v }]));
        const res = await P.updateOne({ id: w.p.id, 'ocr.edited_by': { $exists: false }, 'ocr.edited_at': { $exists: false }, 'ocr.source': { $ne: 'manual' } }, [
          { $set: { ocr: { $cond: { if: { $eq: [{ $type: '$ocr' }, 'object'] }, then: '$ocr', else: {} } } } },
          { $set: literal },
          { $unset: Object.keys(unset) },
        ]);
        modified += res.modifiedCount;
        append(F.applied, { bid, pn: w.r.pn, pid: w.p.id, han: w.han, modified: res.modifiedCount });
        const q = qaOf(w.r.pn);
        if (q.flagged) append(F.qa, { bid, pn: w.r.pn, pid: w.p.id, dice: q.dice, pb: q.pb, title: book.title, image: w.r.src });
      }
      totals.written += modified; totals.books++;
      // the English on a rewritten page was made from text that is gone: say so ON THE PAGE, never hide it
      const stale = await markTranslationsStale(db, writes.map((w) => ({ id: w.p.id, text: w.text })), now, LANE);
      totals.stale_marked += stale;
      const { after: counts } = await recountBook(db, book.id, { reason: LANE, now });
      const loopsFixed = writes.filter((w) => w.oldLoop).length;
      await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'retranscribed', detail: { issue: LANE_ISSUE, engine: PADDLE.model, pages_written: modified, loops_replaced: loopsFixed, first_writes: writes.filter((w) => !w.p.ocr?.data).length, run, translations_marked_stale: stale, qa_screened: screened.length, qa_flagged: flagged.length } });
      await db.collection('book_events').updateOne(
        { book_id: bid, type: BOOK_EVENT },
        { $setOnInsert: { book_id: bid, type: BOOK_EVENT, at: now, source: LANE, 'details.issue': LANE_ISSUE, 'details.engine': PADDLE.model, 'details.repo': PADDLE.repo },
          $set: { 'details.last_apply_at': now, 'details.pages_ocr_after': counts?.pages_ocr ?? null, 'details.planned': pl.pages.length },
          $inc: { 'details.pages_written': modified, 'details.loops_replaced': loopsFixed, 'details.translations_marked_stale': stale, 'details.qa_flagged': flagged.length } },
        { upsert: true },
      );
      append(F.bookLog, { bid, written: modified, rows: rows.length, qa_screened: screened.length, qa_flagged: flagged.length, qa: qa.status === 'screened' ? qa.scope : qa.reason, stale, box: boxName });
      log(`${bid} wrote ${modified}/${writes.length} (revisions ${nRev}, stale ${stale}, QA ${qa.status === 'screened' ? `${flagged.length}/${screened.length} flagged, ${qa.scope}` : qa.reason}) | ${String(book.title || '').slice(0, 40)}`);
    }
  }, { timeoutMs: 2 * 3600 * 1000 });
  log(`APPLY ${JSON.stringify(totals)}`);
  return totals;
}

// ── status ─────────────────────────────────────────────────────────────────────────────

export function laneStatus(dir = DIR) {
  const f = (n) => path.join(dir, n);
  const planned = fs.existsSync(f('plan')) ? fs.readdirSync(f('plan')).filter((x) => x.endsWith('.json')) : [];
  let pages = 0, read = 0, err = 0, booksRead = 0, pagesCount = 0;
  for (const x of planned) {
    const pl = JSON.parse(fs.readFileSync(path.join(f('plan'), x), 'utf8'));
    pages += pl.pages.length; pagesCount += pl.pages_count || 0;
    let r = 0;
    for (const p of pl.pages) { if (fs.existsSync(path.join(f('out'), pl.bid, `${p.pn}.err`))) err++; else if (fs.existsSync(path.join(f('out'), pl.bid, `${p.pn}.txt`))) r++; }
    read += r; if (r + err >= pl.pages.length) booksRead++;
  }
  const applied = readJsonl(f('applied.jsonl')), skipped = readJsonl(f('skipped.jsonl')), refused = readJsonl(f('refused.jsonl'));
  const bookRows = readJsonl(f('applied-books.jsonl'));
  const screened = bookRows.reduce((s, b) => s + (b.qa_screened || 0), 0), flagged = bookRows.reduce((s, b) => s + (b.qa_flagged || 0), 0);
  const dd = fs.existsSync(f('dedup.json')) ? JSON.parse(fs.readFileSync(f('dedup.json'), 'utf8')).summary : null;
  return {
    dir, books_planned: planned.length, books_read: booksRead, books_applied: new Set(bookRows.map((b) => b.bid)).size,
    pages_count: pagesCount, pages_planned: pages, pages_read: read, pages_box_error: err,
    pages_written: applied.filter((a) => a.modified).length, pages_skipped: skipped.length, pages_refused: refused.length,
    skipped_by_reason: skipped.reduce((m, s) => ({ ...m, [s.why]: (m[s.why] || 0) + 1 }), {}),
    qa: { screened, flagged, rate: screened ? +(flagged / screened).toFixed(4) : null, rule: 'Kanripo WYG page aligning below char-bigram Dice 0.6 (#5568)' },
    dedup: dd && { skip_books: dd.skip_books, skip_pages: dd.skip_pages, keep_books: dd.keep_books, keep_pages: dd.keep_pages },
  };
}
function status() { console.log(JSON.stringify(laneStatus(), null, 1)); }

const CMDS = { dedup, plan, apply, status };
const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  if (!CMDS[CMD]) { console.error(`usage: paddle-zh-lane.mjs ${Object.keys(CMDS).join('|')} [options]`); process.exit(1); }
  fs.mkdirSync(DIR, { recursive: true });
  await CMDS[CMD]();
}

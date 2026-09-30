#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/syriac-kraken-lane.mjs (#4883) — the same plan / work / apply / status
 * lane for Kraken on Hetzner CPU; its apply half (revisions first, human-edit guard in the write
 * filter, loop guard, provenance, staleness stamp, counters, sweep_log + book_events) is followed
 * step for step. It cannot be reused as is: its router reads the stored text's code points and its
 * `work` runs Kraken in-process, where this lane routes from the page-image census and reads on a
 * leased GPU (scripts/gpu/ndl-koten-box.sh). Policy and provenance live in scripts/lib/ndl-koten-lane.mjs.
 *
 * The NDL classical-OCR lane (#4925 / #5100, benchmark #4745): re-transcribe the cursive share of
 * pre-1868 Japanese with NDL古典籍OCR ver.3.
 *
 *   plan     pick books (the census's cursive books; --pilot N draws one book per series), list
 *            their pages, copy each page's current reading to old/<bid>/<pn>.txt (the paired
 *            comparison's other arm), write plan.jsonl + books.json + manifest.tsv (bid, pn, url)
 *            for the box. With --apply, HOLD every planned book first (reason ndl-koten-lane-4925);
 *            a book already held for another reason is left out of the plan, untouched.
 *   work     (on the GPU box) scripts/gpu/ndl-koten-box.sh reads manifest.tsv, writes
 *            out/<bid>/<pn>.txt + box.json. The output file IS the checkpoint.
 *   compare  paired, per page: current reading vs NDL — characters, loop verdicts, character-bigram
 *            agreement; per book and overall; draws --eye N pages (one per book, seeded) and writes
 *            them with both texts next to the image URL for reading against the page. Free.
 *   apply    per book: revisions first, human-edit guard re-checked in the write filter, loop-guard
 *            the NDL text, textless NDL reads keep the stored reading, write with provenance, stamp
 *            `translation_stale` on rewritten pages that carry a real translation, resync counters,
 *            sweep_log + one book_events row. Dry unless --apply. The hold is NOT lifted.
 *   status   what the files say.
 *
 * No Gemini call anywhere. Every Mongo walk `.toArray()`s before slow work.
 *
 *   node --env-file=<main>/.env.production.local scripts/workers/ndl-koten-lane.mjs plan --pilot 20 [--apply]
 *   node --env-file=... scripts/workers/ndl-koten-lane.mjs compare --eye 5
 *   node --env-file=... scripts/workers/ndl-koten-lane.mjs apply [--apply] [--book <id>]
 * Options: --dir <lane dir> (default ~/ndl-koten-lane)  --census <summary.json>  --run <label>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { loopVerdict, recordLoopRefusal } from '../lib/ocr-loop-guard.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { holdBook, isHeld } from '../lib/pipeline-hold.mjs';
import {
  LANE, LANE_ISSUE, REVISION_REASON, BOOK_EVENT, HOLD_REASON, HOLD_RELEASE, NDL,
  routeBook, pilotDraw, pagePolicy, envelope, charCount, ocrSetFields,
  isHumanEdited, STALE_OCR_FIELDS, markTranslationsStale,
} from '../lib/ndl-koten-lane.mjs';

const argv = process.argv.slice(2);
const CMD = argv[0];
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const DIR = arg('--dir', path.join(os.homedir(), 'ndl-koten-lane'));
const CENSUS = arg('--census', 'scripts/eval/results/cursive-census/summary.json');
const APPLY = flag('--apply');
const BOOK = arg('--book', null);
const PILOT = Number(arg('--pilot', 0)) || 0;
const EYE = Number(arg('--eye', 5)) || 5;
const RUN = arg('--run', `${LANE}/${new Date().toISOString().slice(0, 10)}`);
/** Below this many characters an NDL read is "textless": it replaces a loop or an empty page, never a reading. */
const MIN_CHARS = 8;

const F = {
  plan: path.join(DIR, 'plan.jsonl'), books: path.join(DIR, 'books.json'), manifest: path.join(DIR, 'manifest.tsv'),
  box: path.join(DIR, 'box.json'), applied: path.join(DIR, 'applied.jsonl'), refused: path.join(DIR, 'refused.jsonl'),
  skipped: path.join(DIR, 'skipped.jsonl'), compare: path.join(DIR, 'compare.json'), eye: path.join(DIR, 'eye.md'), log: path.join(DIR, 'lane.log'),
};
const outTxt = (bid, pn) => path.join(DIR, 'out', bid, `${pn}.txt`);
const oldTxt = (bid, pn) => path.join(DIR, 'old', bid, `${pn}.txt`);
function log(msg) {
  const line = `${new Date().toISOString()} [${CMD}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(F.log, line + '\n'); } catch {}
}
const append = (file, row) => fs.appendFileSync(file, JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n');
const readJsonl = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const key = (r) => `${r.bid}/${r.pn}`;

// ── plan ───────────────────────────────────────────────────────────────────────────────

async function plan() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(F.plan) && !flag('--refresh')) { log(`plan exists (${readJsonl(F.plan).length} rows) — pass --refresh to rebuild`); return; }
  const census = JSON.parse(fs.readFileSync(CENSUS, 'utf8'));
  let chosen = BOOK ? census.books.filter((b) => b.book_id === BOOK) : census.books.filter((b) => routeBook(b).route);
  if (PILOT) chosen = pilotDraw(census.books, PILOT);
  log(`${chosen.length} book(s) chosen from ${census.books.length} in the census (${PILOT ? `pilot draw of ${PILOT}` : 'all cursive'})${APPLY ? '' : '  [DRY RUN: no holds]'}`);
  const rows = [], booksOut = {}, tally = { books: 0, pages: 0, keep: 0, first_write: 0, old_loops: 0, no_image: 0, skipped_books: [] };
  await withMongo(async (db) => {
    for (const c of chosen) {
      const bid = c.book_id;
      const book = await db.collection('books').findOne({ $or: [{ id: bid }, { _id: bid }] }, { projection: { id: 1, title: 1, hidden_reason: 1, visible: 1, pipeline_auto: 1, pages_count: 1 } });
      if (!book) { tally.skipped_books.push({ bid, why: 'not_found' }); continue; }
      const hr = String(book.hidden_reason || '');
      if (hr && !/^(unprocessed|launch_curation)$/.test(hr)) { tally.skipped_books.push({ bid, why: `hidden_reason: ${hr.slice(0, 60)}` }); continue; }
      if (isHeld(book) && book.pipeline_auto.hold.reason !== HOLD_REASON) { tally.skipped_books.push({ bid, why: `held: ${book.pipeline_auto.hold.reason}` }); continue; }
      const { route, why } = routeBook(c);
      const pages = await db.collection('pages').find({ book_id: bid, page_number: { $gt: 0 } }, { projection: {
        id: 1, page_number: 1, ocr: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1,
      } }).sort({ page_number: 1 }).toArray();
      if (APPLY) {
        const h = await holdBook(db, bid, { reason: HOLD_REASON, issue: LANE_ISSUE, release: HOLD_RELEASE, source: LANE, detail: { route, pilot: !!PILOT } });
        log(`${bid} hold: ${h.outcome} (from ${h.from ?? '—'}) | ${String(book.title).slice(0, 50)}`);
        if (!['held', 'already_held'].includes(h.outcome)) { tally.skipped_books.push({ bid, why: `hold ${h.outcome}` }); continue; }
      }
      let planned = 0;
      for (const p of pages) {
        if (p.ocr?.pipeline === LANE) continue;
        const pol = pagePolicy(p, isHumanEdited);
        if (pol.action === 'keep') { tally.keep++; continue; }
        const src = getPageSource(p);
        if (!src) { tally.no_image++; continue; }
        const old = p.ocr?.data || '';
        fs.mkdirSync(path.dirname(oldTxt(bid, p.page_number)), { recursive: true });
        fs.writeFileSync(oldTxt(bid, p.page_number), old);
        const oldLoop = old ? loopVerdict(old).refuse : false;
        if (oldLoop) tally.old_loops++;
        if (!old) tally.first_write++;
        rows.push({ bid, pid: p.id, pn: p.page_number, route, why: pol.why, src, old_model: p.ocr?.model || null, old_chars: charCount(old), old_loop: oldLoop });
        planned++;
      }
      booksOut[bid] = { title: book.title, visible: book.visible === true, route, why, series: c.series || null, pages: pages.length, planned, status_before: book.pipeline_auto?.hold?.held_from_status ?? book.pipeline_auto?.status ?? null };
      tally.books++; tally.pages += planned;
    }
  });
  fs.writeFileSync(F.plan, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(F.books, JSON.stringify(booksOut, null, 1));
  fs.writeFileSync(F.manifest, rows.map((r) => `${r.bid}\t${r.pn}\t${r.src}`).join('\n') + '\n');
  log(`PLAN ${JSON.stringify(tally)}`);
}

// ── compare ────────────────────────────────────────────────────────────────────────────

function bigrams(t) {
  const s = [...String(t || '').replace(/<[^>]{1,40}>/g, '').replace(/\s+/g, '')];
  const m = new Map();
  for (let i = 0; i + 1 < s.length; i++) { const k = s[i] + s[i + 1]; m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
/** Dice agreement over character bigrams (order-free, 0–1). Agreement, not accuracy: neither arm is a reference. */
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  return na + nb ? (2 * inter) / (na + nb) : 1;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function compare() {
  const rows = readJsonl(F.plan), books = JSON.parse(fs.readFileSync(F.books, 'utf8'));
  const per = [], byBook = {};
  for (const r of rows) {
    if (!fs.existsSync(outTxt(r.bid, r.pn))) continue;
    const ndl = envelope(fs.readFileSync(outTxt(r.bid, r.pn), 'utf8'), r.route);
    const old = fs.existsSync(oldTxt(r.bid, r.pn)) ? fs.readFileSync(oldTxt(r.bid, r.pn), 'utf8') : '';
    const x = { bid: r.bid, pn: r.pn, old_chars: charCount(old), ndl_chars: charCount(ndl), old_loop: old ? loopVerdict(old).refuse : false, ndl_loop: loopVerdict(ndl).refuse, dice: old ? Number(dice(old, ndl).toFixed(3)) : null };
    per.push(x);
    (byBook[r.bid] ||= []).push(x);
  }
  const med = (a) => { const s = a.filter((v) => v != null).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const summ = (xs) => ({ pages: xs.length, old_loops: xs.filter((x) => x.old_loop).length, ndl_loops: xs.filter((x) => x.ndl_loop).length,
    old_empty: xs.filter((x) => x.old_chars < MIN_CHARS).length, ndl_textless: xs.filter((x) => x.ndl_chars < MIN_CHARS).length,
    median_old_chars: med(xs.map((x) => x.old_chars)), median_ndl_chars: med(xs.map((x) => x.ndl_chars)), median_dice: med(xs.map((x) => x.dice)),
    dice_below_0_5: xs.filter((x) => x.dice != null && x.dice < 0.5).length });
  const out = { lane: LANE, generated_at: new Date().toISOString(), measure: 'agreement between the stored (Gemini) reading and NDL — NOT accuracy; neither arm is a reference', overall: summ(per), books: Object.fromEntries(Object.entries(byBook).map(([b, xs]) => [b, { title: books[b]?.title, route: books[b]?.route, ...summ(xs) }])) };
  fs.writeFileSync(F.compare, JSON.stringify({ ...out, pages: per }, null, 1));
  // the by-eye packet: one text page per book, seeded, both readings in full beside the image URL
  const r = rng(4925), bids = Object.keys(byBook).sort().map((b) => [r(), b]).sort((a, b) => a[0] - b[0]).map((x) => x[1]).slice(0, EYE);
  const planBy = new Map(rows.map((x) => [key(x), x]));
  const md = [`# NDL lane pilot — ${EYE} pages to read against the image (seed 4925, one per book)\n`];
  for (const b of bids) {
    const cand = byBook[b].filter((x) => x.ndl_chars >= 60).sort((p, q) => p.pn - q.pn);
    if (!cand.length) continue;
    const x = cand[Math.floor(r() * cand.length)], p = planBy.get(`${b}/${x.pn}`);
    md.push(`## ${books[b]?.title} — p.${x.pn} (${b})\n\nimage: ${p.src}\n\nhttps://sourcelibrary.org/book/${b}?page=${x.pn}\n\nold (${p.old_model}, ${x.old_chars} chars, loop ${x.old_loop}) · NDL (${x.ndl_chars} chars) · bigram agreement ${x.dice}\n`);
    md.push('### stored reading\n\n```\n' + (fs.existsSync(oldTxt(b, x.pn)) ? fs.readFileSync(oldTxt(b, x.pn), 'utf8').slice(0, 1500) : '') + '\n```\n\n### NDL\n\n```\n' + fs.readFileSync(outTxt(b, x.pn), 'utf8').slice(0, 1500) + '\n```\n');
  }
  fs.writeFileSync(F.eye, md.join('\n'));
  log(`COMPARE ${JSON.stringify(out.overall)} → ${F.compare}, ${F.eye}`);
}

// ── apply ──────────────────────────────────────────────────────────────────────────────

async function apply() {
  const books = JSON.parse(fs.readFileSync(F.books, 'utf8'));
  const box = fs.existsSync(F.box) ? JSON.parse(fs.readFileSync(F.box, 'utf8')) : {};
  const done = new Set([...readJsonl(F.applied), ...readJsonl(F.refused), ...readJsonl(F.skipped).filter((r) => r.stage === 'apply')].map(key));
  const pending = readJsonl(F.plan).filter((r) => (!BOOK || r.bid === BOOK) && !done.has(key(r)) && fs.existsSync(outTxt(r.bid, r.pn)));
  const byBook = new Map();
  for (const r of pending) { if (!byBook.has(r.bid)) byBook.set(r.bid, []); byBook.get(r.bid).push(r); }
  log(`${pending.length} read pages pending apply across ${byBook.size} books${APPLY ? '' : '  [DRY RUN]'}`);
  const totals = { books: 0, written: 0, stale_marked: 0, textless_kept: 0, refused: 0, human_edited: 0, not_held: 0 };
  await withMongo(async (db) => {
    const P = db.collection('pages'), B = db.collection('books');
    for (const [bid, rows] of byBook) {
      const book = await B.findOne({ $or: [{ id: bid }, { _id: bid }] }, { projection: { id: 1, title: 1, pipeline_auto: 1 } });
      if (!book) { log(`${bid} not found — skipping`); continue; }
      // the hold is the lane's guarantee that no paid re-translation follows the write
      if (APPLY && book.pipeline_auto?.hold?.reason !== HOLD_REASON) { log(`${bid} NOT held for ${HOLD_REASON} — refusing to write`); totals.not_held++; continue; }
      const pages = await P.find({ id: { $in: rows.map((r) => r.pid) } }, { projection: { id: 1, page_number: 1, ocr: 1 } }).toArray();
      const byId = new Map(pages.map((p) => [p.id, p]));
      const writes = [];
      for (const r of rows) {
        const p = byId.get(r.pid);
        if (!p) { if (APPLY) append(F.skipped, { stage: 'apply', bid, pn: r.pn, why: 'page_gone' }); continue; }
        if (isHumanEdited(p.ocr)) { if (APPLY) append(F.skipped, { stage: 'apply', bid, pn: r.pn, why: 'human_edited' }); totals.human_edited++; continue; }
        const raw = fs.readFileSync(outTxt(bid, r.pn), 'utf8');
        const chars = charCount(raw);
        const oldLoop = p.ocr?.data ? loopVerdict(p.ocr.data).refuse : false;
        if (chars < MIN_CHARS && charCount(p.ocr?.data) >= MIN_CHARS && !oldLoop) {
          // NDL saw no text where the stored reading has some: keep it and say so (a picture page, or
          // a reading NDL missed — either way a blank must not replace text by accident)
          if (APPLY) append(F.skipped, { stage: 'apply', bid, pn: r.pn, why: 'ndl_textless_kept', chars, old_chars: charCount(p.ocr?.data) });
          totals.textless_kept++; continue;
        }
        const text = envelope(raw, r.route);
        const v = loopVerdict(text);
        if (v.refuse) {
          if (APPLY) { await recordLoopRefusal(db, { pageId: p.id, bookId: bid, pageNumber: p.page_number, text, model: `ndl-koten/v${NDL.version}`, verdict: v }); append(F.refused, { bid, pn: r.pn, pid: r.pid, share: v.share }); }
          totals.refused++; continue;
        }
        writes.push({ r, p, text, chars, oldLoop, oldChars: charCount(p.ocr?.data) });
      }
      if (!APPLY) { log(`${bid} would write ${writes.length} of ${rows.length} read pages | ${String(book.title || '').slice(0, 50)}`); totals.written += writes.length; continue; }
      if (!writes.length) { log(`${bid} nothing to write`); continue; }
      const withText = writes.filter((w) => w.p.ocr?.data && w.p.ocr.data !== '[RECITATION_BLOCKED]').length;
      const nRev = await saveRevisionsBeforeOverwrite(db, writes.map((w) => w.p.id), 'ocr', { reason: REVISION_REASON, keepMeta: true });
      if (nRev !== withText) { log(`ABORT ${bid}: saved ${nRev} revisions for ${withText} pages with text — not overwriting`); continue; }
      const now = new Date();
      let modified = 0;
      const unset = Object.fromEntries([...STALE_OCR_FIELDS, 'translation.health_blocked', 'translation.health_blocked_at'].map((k) => [k, '']));
      for (const w of writes) {
        const set = ocrSetFields(w.text, w.r.route, { run: RUN, now, secs: box.secs_per_page ?? null, imageUrl: w.r.src, commit: box.commit || null, host: box.host || null });
        // pipeline update: `ocr` can be null on never-read pages; every value $literal (a transcription is arbitrary text)
        const literal = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, { $literal: v }]));
        const res = await P.updateOne({ id: w.p.id, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' } }, [
          { $set: { ocr: { $cond: { if: { $eq: [{ $type: '$ocr' }, 'object'] }, then: '$ocr', else: {} } } } },
          { $set: literal },
          { $unset: Object.keys(unset) },
        ]);
        modified += res.modifiedCount;
        append(F.applied, { bid, pn: w.r.pn, pid: w.p.id, why: w.r.why, chars: w.chars, old_chars: w.oldChars, old_loop: w.oldLoop, modified: res.modifiedCount });
      }
      totals.written += modified; totals.books++;
      // the English on a rewritten page was made from text that is gone: say so ON THE PAGE, never hide it
      const stale = await markTranslationsStale(db, writes.map((w) => ({ id: w.p.id, text: w.text })), now, LANE);
      totals.stale_marked += stale;
      const [counts] = await P.aggregate(buildVisiblePageCountPipeline(bid)).toArray();
      await B.updateOne({ _id: book._id }, { $set: { pages_ocr: counts?.with_ocr ?? 0, pages_translated: counts?.with_translation ?? 0, updated_at: now } });
      const loopsFixed = writes.filter((w) => w.oldLoop).length;
      await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'retranscribed', detail: { issue: LANE_ISSUE, engine: `ndl-koten/v${NDL.version}`, route: writes[0].r.route, pages_written: modified, loops_replaced: loopsFixed, first_writes: writes.filter((w) => !w.p.ocr?.data).length, run: RUN, translations_marked_stale: stale } });
      await db.collection('book_events').updateOne(
        { book_id: bid, type: BOOK_EVENT },
        { $setOnInsert: { book_id: bid, type: BOOK_EVENT, at: now, source: LANE, 'details.issue': LANE_ISSUE, 'details.engine': `ndl-koten/v${NDL.version}`, 'details.route': writes[0].r.route, 'details.repo': NDL.repo },
          $set: { 'details.last_apply_at': now, 'details.pages_ocr_after': counts?.with_ocr ?? null, 'details.planned': books[bid]?.planned ?? null },
          $inc: { 'details.pages_written': modified, 'details.loops_replaced': loopsFixed, 'details.translations_marked_stale': stale } },
        { upsert: true },
      );
      log(`${bid} wrote ${modified}/${writes.length} (loops replaced ${loopsFixed}, revisions ${nRev}, translations marked stale ${stale}) | ${String(book.title || '').slice(0, 50)}`);
    }
  }, { timeoutMs: 2 * 3600 * 1000 });
  log(`APPLY ${JSON.stringify(totals)}`);
}

// ── status ─────────────────────────────────────────────────────────────────────────────

function status() {
  const plan = readJsonl(F.plan);
  const read = plan.filter((r) => fs.existsSync(outTxt(r.bid, r.pn))).length;
  console.log(JSON.stringify({ dir: DIR, books: Object.keys(fs.existsSync(F.books) ? JSON.parse(fs.readFileSync(F.books, 'utf8')) : {}).length, planned: plan.length, read,
    applied: readJsonl(F.applied).length, refused: readJsonl(F.refused).length, skipped: readJsonl(F.skipped).length,
    box: fs.existsSync(F.box) ? JSON.parse(fs.readFileSync(F.box, 'utf8')) : null }, null, 1));
}

const CMDS = { plan, compare, apply, status };
if (!CMDS[CMD]) { console.error(`usage: ndl-koten-lane.mjs ${Object.keys(CMDS).join('|')} [options]`); process.exit(1); }
await CMDS[CMD]();

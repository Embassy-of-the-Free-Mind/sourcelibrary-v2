#!/usr/bin/env node
/**
 * Dedupe cleanup — the four data decisions of #6019, approved by Derek 2026-10-06.
 *
 * PRIOR ART: scripts/maintenance/apply-collection-copy-keepers.mjs — the nearest shape (hide a
 * confirmed copy through setPublicationMany, verdicts passed in as reviewable data), but it reads
 * scripts/lib/confirmed-copies.mjs, hides only, and has no pointer repair, no text move and no
 * undo file. scripts/maintenance/duplicate-integrity-check.mjs --flatten-chains re-points chains
 * mechanically and refuses cycles, which are what decision 4 is about.
 * scripts/maintenance/repair-ia-ocr-leaf-offset.mjs is the write discipline copied for the text
 * move (pin the update to the state that was read, one sweep_log row per book).
 *
 * WHAT IT DOES, from the review files in scripts/audit/dedupe-review-6019/:
 *   1. e-rara same-object groups (erara-merge-plan.json): copy OCR onto the keeper's EMPTY page,
 *      reverse the two inverted pointers, hide the one second visible copy.
 *   2. Link the four hidden same-edition copies from the sample; for the two visible pairs keep
 *      the copy with more translated pages (tie: more transcribed pages) and hide + link the other.
 *   3. Clear `duplicate_of` on a hidden copy that is not the same edition as its target.
 *   4. Clear `duplicate_of` on visible books that carry it and break the cycles.
 *   Decisions 2-4 are driven by cleanup-verdicts.json, which records what the title pages showed.
 *
 * THE TEXT MOVE IS GATED PER PAGE (paired-artifacts.md). "Same page number in the same e-rara
 * object" does not make two page records the same leaf: e-rara's PDF carries a cover sheet, so a
 * book archived from it holds every image one leaf late (#3186), and OCR that ran after that
 * archive transcribed the neighbour. A page moves only when
 *   - both page records name the same e-rara page id, and
 *   - the image the copy's OCR was READ from (recorded in ocr.engine.input / ocr.source_url, else
 *     decided from the OCR and archive timestamps) has the same dHash as the image the keeper's
 *     reader is shown for that page AND as the keeper's own source image.
 * Anything else is refused and listed; a hash that cannot be fetched is a refusal.
 *
 * WHAT A MOVE WRITES: the copy's whole `ocr` block (model, prompt, engine, content_hash — its
 * provenance travels with it) onto the keeper page, plus `ocr.moved_from`; `page_type` /
 * `script_type` when the keeper page has none; one `page_revisions` row (source `maintenance`,
 * reason `dedupe-move-6019`) so the arrival is on record; then recountBook(). The copy keeps its
 * text. Nothing is deleted and no non-empty keeper page is touched (the update is pinned to an
 * empty `ocr.data`).
 *
 * ACTUATION: a keeper that gains OCR pages becomes eligible for the orchestrator's gap-fill
 * translation at the daily dial's pace (pipeline-status-truth.md). Hides reach Supabase through
 * sync-books-catalog (odd hours :45) and the homepage counts at 05:15.
 *
 * DRY RUN BY DEFAULT.
 *   node --env-file=.env.production.local scripts/maintenance/dedupe-cleanup-6019.mjs [--json out.json]
 *   node --env-file=.env.production.local scripts/maintenance/dedupe-cleanup-6019.mjs --apply
 *       writes scripts/audit/dedupe-review-6019/cleanup-undo-<ts>.json BEFORE the first write
 *   node --env-file=.env.production.local scripts/maintenance/dedupe-cleanup-6019.mjs --undo <file> [--apply]
 * Options: --hash-cache <file> (reuse source-image hashes between runs; R2 images are always re-read)
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EJSON } from 'bson';
import { withMongo } from '../lib/mongo.mjs';
import { computeDHash } from '../lib/dhash.mjs';
import { hammingHex, HASH_MATCH, isUsableArchive } from '../lib/page-alignment.mjs';
import { setPublication, legacyPublication } from '../lib/publication.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';
import { recountBook, hasOcr } from '../lib/page-counts.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { findBookByEitherKey } from '../lib/delete-book.mjs';

const ISSUE = 6019;
const BY = 'script:dedupe-cleanup-6019';
const SWEEP = 'dedupe-cleanup-6019';
const REVISION_REASON = 'dedupe-move-6019';
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../audit/dedupe-review-6019');
const BOOK_UNDO_FIELDS = ['duplicate_of', 'visible', 'hidden', 'hidden_reason', 'hidden_at', 'publication', 'updated_at'];
const BOOK_PROJECTION = { _id: 1, id: 1, title: 1, slug: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, ...Object.fromEntries(BOOK_UNDO_FIELDS.map((f) => [f, 1])) };
const PAGE_PROJECTION = { _id: 1, id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, archive_metadata: 1, ocr: 1, page_type: 1, script_type: 1, updated_at: 1 };

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const UNDO = arg('--undo');
const JSON_OUT = arg('--json');
const HASH_CACHE = arg('--hash-cache');

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
const link = (id) => `https://sourcelibrary.org/book/${id}`;
const short = (s, n = 70) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));

// ── image hashing ───────────────────────────────────────────────────────────────────────────
const OURS = /^https:\/\/images\.sourcelibrary\.org\//;
const diskCache = HASH_CACHE && fs.existsSync(HASH_CACHE) ? JSON.parse(fs.readFileSync(HASH_CACHE, 'utf8')) : {};
const memCache = new Map();
let lastForeignFetch = 0;

/** e-rara serves `/full/full/` at full size; 1000px is what the pipeline reads and enough for a dHash. */
const hashable = (url) => String(url || '').replace(/(\/i3f\/v2\d\/\d+\/full)\/full\//, '$1/1000,/');
const eraraPageId = (url) => (String(url || '').match(/\/i3f\/v2\d\/(\d+)\//) || [])[1] || null;

async function hashUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !/^https?:\/\//.test(rawUrl)) return null;
  const url = hashable(rawUrl);
  if (memCache.has(url)) return memCache.get(url);
  const ours = OURS.test(url);
  if (!ours && diskCache[url]) { memCache.set(url, diskCache[url]); return diskCache[url]; }
  if (!ours) {
    // Source institutions are read serially with a gap (preservation-policy.md: an audit must not become an incident).
    const wait = 700 - (Date.now() - lastForeignFetch);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastForeignFetch = Date.now();
  }
  let hash = null;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'SourceLibrary-maintenance/1.0 (+https://sourcelibrary.org)' } });
    if (res.ok) hash = await computeDHash(Buffer.from(await res.arrayBuffer()));
  } catch { /* a failed fetch is "no hash", which refuses the move */ }
  memCache.set(url, hash);
  if (!ours && hash) diskCache[url] = hash;
  return hash;
}
const distance = (a, b) => (a && b ? hammingHex(a, b) : null);

/** Which image was this page's OCR read from? Recorded when the writer stamped it, else from the clocks. */
function readImageOf(page) {
  const recorded = page.ocr?.engine?.input?.image_url || page.ocr?.source_url;
  if (recorded) return { url: recorded, basis: 'recorded by the OCR writer' };
  const ocrAt = page.ocr?.updated_at, archAt = page.archive_metadata?.archived_at;
  if (ocrAt && archAt && new Date(ocrAt) >= new Date(archAt) && isUsableArchive(page.archived_photo)) {
    return { url: page.archived_photo, basis: 'OCR is later than the archive, so it read the archived image' };
  }
  return { url: page.photo_original || page.photo, basis: 'OCR is earlier than the archive (or there is none), so it read the source image' };
}

async function gateMove(copyPage, keeperPage) {
  const read = readImageOf(copyPage);
  const keeperSource = keeperPage.photo_original || keeperPage.photo;
  const keeperReader = isUsableArchive(keeperPage.archived_photo) ? keeperPage.archived_photo : keeperSource;
  const check = {
    read_from: read.url, read_basis: read.basis,
    same_source_page: Boolean(eraraPageId(copyPage.photo_original || copyPage.photo)) && eraraPageId(copyPage.photo_original || copyPage.photo) === eraraPageId(keeperSource),
    read_vs_keeper_shown: distance(await hashUrl(read.url), await hashUrl(keeperReader)),
    read_vs_keeper_source: distance(await hashUrl(read.url), await hashUrl(keeperSource)),
  };
  let refuse = null;
  if (!check.same_source_page) refuse = 'the two page records do not name the same e-rara page';
  else if (check.read_vs_keeper_shown == null || check.read_vs_keeper_source == null) refuse = 'an image could not be fetched, so the pairing is unproven';
  else if (check.read_vs_keeper_source > HASH_MATCH && check.read_vs_keeper_shown <= HASH_MATCH) refuse = 'the OCR was read from an archive image that is not this page\'s leaf (the #3186 cover-sheet offset, on both copies); the keeper\'s images need the alignment repair first';
  else if (check.read_vs_keeper_shown > HASH_MATCH && check.read_vs_keeper_source <= HASH_MATCH) refuse = 'the text is this leaf\'s, but the keeper shows a different image on this page (its archive is offset); it would sit beside the wrong scan';
  else if (check.read_vs_keeper_shown > HASH_MATCH || check.read_vs_keeper_source > HASH_MATCH) refuse = 'the image the OCR read matches neither the keeper\'s page image nor its source';
  return { check, refuse };
}

// ── plan ────────────────────────────────────────────────────────────────────────────────────
const getBook = (db, id) => db.collection('books').findOne({ id }, { projection: BOOK_PROJECTION });
const stateOf = (b) => legacyPublication(b).state;
const counts = (b) => `${b.pages_count ?? '?'} pp, ${b.pages_ocr ?? 0} transcribed, ${b.pages_translated ?? 0} translated`;

async function buildPlan(db) {
  const actions = [];
  const push = (a) => actions.push(a);
  const pages = db.collection('pages');

  /** set / clear a pointer, with the state it expects to find. */
  async function pointer(decision, kind, bookId, { to, expect, why }) {
    const b = await getBook(db, bookId);
    const a = { decision, action: kind, book: bookId, to: to ?? null, why, title: b?.title, state: b ? stateOf(b) : 'not_found', from: b?.duplicate_of ?? null };
    if (!b) a.status = 'refused: book not found';
    else if (kind === 'set_pointer') {
      const target = await findBookByEitherKey(db, to);
      if (!target) a.status = 'refused: target not found by id or _id';
      else if (b.duplicate_of === to) a.status = 'done';
      else if (b.duplicate_of != null && b.duplicate_of !== expect) a.status = `refused: already points at ${b.duplicate_of}`;
      else if (b.visible === true) a.status = 'refused: the book is visible; a visible book is hidden and linked, not just linked';
      else a.status = 'todo';
    } else {
      if (b.duplicate_of == null) a.status = 'done';
      else if (expect && b.duplicate_of !== expect) a.status = `refused: points at ${b.duplicate_of}, expected ${expect}`;
      else a.status = 'todo';
    }
    push(a);
  }

  async function hideLink(decision, copyId, keeperId, why) {
    const [copy, keeper] = [await getBook(db, copyId), await getBook(db, keeperId)];
    const a = { decision, action: 'hide_and_link', book: copyId, to: keeperId, why, title: copy?.title, state: copy ? stateOf(copy) : 'not_found', book_counts: copy && counts(copy), keeper_counts: keeper && counts(keeper) };
    if (!copy || !keeper) a.status = 'refused: book not found';
    else if (stateOf(keeper) !== 'public') a.status = 'refused: the keeper is not public, so hiding the copy would leave nothing on the shelf';
    else if (stateOf(copy) === 'hidden' && copy.duplicate_of === keeperId && copy.hidden_reason === 'duplicate') a.status = 'done';
    else if (stateOf(copy) !== 'public') a.status = `refused: the copy is ${stateOf(copy)}, not public`;
    else a.status = 'todo';
    push(a);
  }

  // Decision 1 — e-rara same-object groups.
  for (const g of readJson('erara-merge-plan.json').plan.filter((x) => x.action !== 'NOTHING_TO_DO')) {
    const keeper = await getBook(db, g.keeper.id);
    if (g.action.includes('MOVE_TEXT')) {
      const keeperPages = new Map((await pages.find({ book_id: g.keeper.id }, { projection: PAGE_PROJECTION }).toArray()).map((p) => [p.page_number, p]));
      for (const o of g.others) {
        const copyPages = (await pages.find({ book_id: o.id }, { projection: PAGE_PROJECTION }).toArray()).sort((a, b) => a.page_number - b.page_number);
        for (const cp of copyPages) {
          const kp = keeperPages.get(cp.page_number);
          if (!hasOcr(cp) || !kp) continue;
          const base = { decision: 1, action: 'move_ocr', fingerprint: g.fingerprint, title: g.title, keeper: g.keeper.id, copy: o.id, page_number: cp.page_number, keeper_page_id: kp.id ?? String(kp._id), copy_page_id: cp.id ?? String(cp._id), keeper_page_oid: kp._id, chars: cp.ocr.data.length, page_type: cp.page_type ?? null };
          if (kp.ocr?.moved_from?.page_id === base.copy_page_id && contentHash(kp.ocr.data) === contentHash(cp.ocr.data)) { push({ ...base, status: 'done' }); continue; }
          if (hasOcr(kp)) continue; // the keeper has its own text: never touched, not a candidate
          const { check, refuse } = await gateMove(cp, kp);
          push({ ...base, check, status: refuse ? `refused: ${refuse}` : 'todo', _copyPage: cp, _keeperPage: kp });
        }
      }
    }
    if (g.pointer_inverted) {
      for (const o of g.others) {
        await pointer(1, 'clear_pointer', g.keeper.id, { expect: o.id, why: `same e-rara object (${g.fingerprint}); the visible copy pointed at the hidden one` });
        await pointer(1, 'set_pointer', o.id, { to: g.keeper.id, why: `same e-rara object (${g.fingerprint}); the hidden copy now points at the visible one` });
      }
    }
    if (g.action === 'HIDE_COPY') {
      for (const o of g.others.filter((x) => x.visible)) await hideLink(1, o.id, keeper.id, `second visible copy of one e-rara object (${g.fingerprint})`);
    }
  }

  const V = readJson('cleanup-verdicts.json');

  // Decision 2 — the sample's same-edition pairs.
  for (const p of V.decision_2.link_hidden) await pointer(2, 'set_pointer', p.copy, { to: p.keeper, why: `hidden copy of the same edition: ${p.title}` });
  for (const p of V.decision_2.visible_pairs) {
    const [a, b] = [await getBook(db, p.a), await getBook(db, p.b)];
    const rank = (x) => [x?.pages_translated ?? 0, x?.pages_ocr ?? 0];
    const [ra, rb] = [rank(a), rank(b)];
    const keeper = ra[0] !== rb[0] ? (ra[0] > rb[0] ? p.a : p.b) : (ra[1] >= rb[1] ? p.a : p.b);
    const copy = keeper === p.a ? p.b : p.a;
    const alreadyHidden = [a, b].find((x) => x && stateOf(x) === 'hidden' && x.duplicate_of);
    if (alreadyHidden) await hideLink(2, alreadyHidden.id, alreadyHidden.duplicate_of, `${p.title}. ${p.seen}`);
    else if (keeper !== p.expect_keeper) push({ decision: 2, action: 'hide_and_link', book: copy, to: keeper, title: p.title, status: `refused: the counts now favour ${keeper}, the reviewed verdict kept ${p.expect_keeper}` });
    else await hideLink(2, copy, keeper, `${p.title}. ${p.seen}`);
  }

  // Decision 3 — hidden copies 20+ translated pages ahead of their target.
  for (const p of V.decision_3) {
    if (p.verdict === 'not_same_edition') await pointer(3, 'clear_pointer', p.copy, { expect: p.target, why: `${p.title}. ${p.seen}` });
    else if (p.verdict === 'same_edition') {
      const [c, t] = [await getBook(db, p.copy), await getBook(db, p.target)];
      push({ decision: 3, action: 'keep_pointer', book: p.copy, to: p.target, title: p.title, why: p.seen, status: 'no write', book_counts: c && counts(c), keeper_counts: t && counts(t), state: c && stateOf(c) });
    }
  }

  // Decision 4 — visible books that carry a pointer, and the cycles.
  for (const p of V.decision_4.clear) await pointer(4, 'clear_pointer', p.book, { expect: p.other, why: `${p.title}. ${p.seen}` });
  for (const p of V.decision_4.left_alone) push({ decision: 4, action: 'left_alone', book: p.book, to: p.other, title: p.title, why: p.seen, status: 'no write' });

  return actions;
}

function printPlan(actions) {
  const by = (d) => actions.filter((a) => a.decision === d);
  for (const d of [1, 2, 3, 4]) {
    console.log(`\n=== decision ${d} ===`);
    const moves = by(d).filter((a) => a.action === 'move_ocr');
    const groups = new Map();
    for (const m of moves) { const k = `${m.keeper}<-${m.copy}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
    for (const [, ms] of groups) {
      const m0 = ms[0];
      const byStatus = new Map();
      for (const m of ms) { if (!byStatus.has(m.status)) byStatus.set(m.status, []); byStatus.get(m.status).push(m.page_number); }
      console.log(`move_ocr  ${short(m0.title, 60)}  keeper ${link(m0.keeper)}  <-  copy ${link(m0.copy)}`);
      for (const [s, nums] of byStatus) console.log(`    ${s}: ${nums.length} page(s) [${nums.join(',')}]`);
    }
    for (const a of by(d).filter((x) => x.action !== 'move_ocr')) {
      console.log(`${a.action}  [${a.status}]  ${link(a.book)}${a.to ? `  ->  ${link(a.to)}` : ''}  (${a.state ?? ''}${a.from ? `, was -> ${a.from}` : ''})  ${short(a.title, 60)}`);
      if (a.book_counts) console.log(`    this: ${a.book_counts} | other: ${a.keeper_counts}`);
      if (a.why) console.log(`    ${a.why}`);
    }
  }
  const tally = {};
  for (const a of actions) { const k = `${a.action} / ${a.status.split(':')[0]}`; tally[k] = (tally[k] || 0) + 1; }
  console.log('\ncounts:', JSON.stringify(tally, null, 1));
}

const serializable = (actions) => actions.map(({ _copyPage, _keeperPage, keeper_page_oid, ...rest }) => rest);

// ── apply ───────────────────────────────────────────────────────────────────────────────────
const snapshot = (doc, fields) => Object.fromEntries(fields.map((f) => [f, doc[f] === undefined ? { absent: true } : { value: doc[f] }]));

async function apply(db, actions) {
  const todo = actions.filter((a) => a.status === 'todo');
  const now = new Date();
  const books = db.collection('books'), pages = db.collection('pages');

  // 1. The undo file, before any write: every field this run may change, per document.
  const touchedBooks = [...new Set(todo.flatMap((a) => (a.action === 'move_ocr' ? [a.keeper] : [a.book])))];
  const undo = { script: 'scripts/maintenance/dedupe-cleanup-6019.mjs', issue: ISSUE, by: BY, started_at: now, books: {}, pages: {}, gallery_images: {}, revisions: [], actions: serializable(todo) };
  for (const id of touchedBooks) {
    const b = await books.findOne({ id });
    undo.books[id] = { _id: b._id, before: snapshot(b, [...BOOK_UNDO_FIELDS, 'pages_ocr', 'pages_translated', 'pages_blank']) };
  }
  for (const a of todo.filter((x) => x.action === 'move_ocr')) {
    a.revision_id = randomBytes(6).toString('hex');
    undo.pages[a.keeper_page_id] = { _id: a.keeper_page_oid, book_id: a.keeper, page_number: a.page_number, moved_from_page: a.copy_page_id, before: snapshot(a._keeperPage, ['ocr', 'page_type', 'script_type', 'updated_at']) };
    undo.revisions.push(a.revision_id);
  }
  for (const a of todo.filter((x) => x.action === 'hide_and_link')) {
    const rows = await db.collection('gallery_images').find({ book_id: a.book, book_visible: true }, { projection: { _id: 1 } }).toArray();
    if (rows.length) undo.gallery_images[a.book] = rows.map((r) => r._id);
  }
  const undoFile = path.join(DIR, `cleanup-undo-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(undoFile, EJSON.stringify(undo, null, 1, { relaxed: false }));
  console.log(`undo file written: ${undoFile}`);

  const log = [];
  // 2. Text moves.
  const movedKeepers = new Set();
  for (const a of todo.filter((x) => x.action === 'move_ocr')) {
    const cp = a._copyPage, text = cp.ocr.data, hash = cp.ocr.content_hash || contentHash(text);
    const moved_from = { book_id: a.copy, page_id: a.copy_page_id, page_number: cp.page_number, issue: ISSUE, by: BY, at: now };
    await db.collection('page_revisions').insertOne({
      id: a.revision_id, page_id: a.keeper_page_id, book_id: a.keeper, field: 'ocr', data: text,
      source: 'maintenance', reason: REVISION_REASON, model: cp.ocr.model, language: cp.ocr.language, prompt_version: cp.ocr.prompt_version,
      original_date: cp.ocr.updated_at, created_at: now, content_hash: hash, ...(cp.ocr.engine ? { engine: cp.ocr.engine } : {}),
      meta: { moved_from, note: 'text copied from a duplicate record of the same object onto an empty page; nothing was superseded' },
    });
    const $set = { ocr: { ...cp.ocr, content_hash: hash, moved_from }, updated_at: now };
    if (a._keeperPage.page_type == null && cp.page_type != null) $set.page_type = cp.page_type;
    if (a._keeperPage.script_type == null && cp.script_type != null) $set.script_type = cp.script_type;
    // Pinned to an empty page: a page another job filled in the meantime is left alone.
    const res = await pages.updateOne({ _id: a.keeper_page_oid, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] }, { $set });
    a.result = res.modifiedCount === 1 ? 'written' : 'not written: the keeper page was no longer empty';
    if (res.modifiedCount === 1) movedKeepers.add(a.keeper);
    log.push({ sweep: SWEEP, book_id: a.keeper, action: 'ocr-moved-from-duplicate', detail: { page_number: a.page_number, from_book: a.copy, from_page: a.copy_page_id, result: a.result, revision: a.revision_id, check: a.check } });
  }
  for (const id of movedKeepers) {
    const r = await recountBook(db, id, { reason: SWEEP });
    console.log(`  recount ${id}: ${JSON.stringify(r.before)} -> ${JSON.stringify(r.after)}`);
  }
  // 3. Pointers.
  for (const a of todo.filter((x) => x.action === 'clear_pointer' || x.action === 'set_pointer')) {
    const filter = { id: a.book, duplicate_of: a.from ?? null };
    const res = a.action === 'set_pointer'
      ? await books.updateOne(filter, { $set: { duplicate_of: a.to, updated_at: now } })
      : await books.updateOne(filter, { $unset: { duplicate_of: '', 'publication.duplicate_of': '' }, $set: { updated_at: now } });
    a.result = res.modifiedCount === 1 ? 'written' : 'not written: the pointer changed since the plan was read';
    log.push({ sweep: SWEEP, book_id: a.book, action: a.action === 'set_pointer' ? 'duplicate-of-set' : 'duplicate-of-cleared', detail: { decision: a.decision, from: a.from, to: a.to, result: a.result, why: a.why } });
  }
  // 4. Hides, through the one publication writer.
  for (const a of todo.filter((x) => x.action === 'hide_and_link')) {
    const res = await setPublication(db, a.book, { state: 'hidden', reason: 'duplicate', duplicateOf: a.to, by: BY, issue: ISSUE, note: `#${ISSUE} decision ${a.decision}`, from: ['public'], now });
    a.result = res.status;
    if (res.status === 'written') {
      // gallery_images.book_visible follows only page writes; close the leak direction now (visibility-and-stats.md).
      const g = await db.collection('gallery_images').updateMany({ book_id: a.book, book_visible: true }, { $set: { book_visible: false } });
      a.gallery_rows_hidden = g.modifiedCount;
    }
    log.push({ sweep: SWEEP, book_id: a.book, action: 'hidden-as-duplicate', detail: { decision: a.decision, kept: a.to, result: a.result, gallery_rows_hidden: a.gallery_rows_hidden ?? 0, why: a.why } });
  }
  if (log.length) await recordSweepActions(db, log);
  for (const a of todo) console.log(`  ${a.action} ${a.book ?? `${a.keeper} p${a.page_number}`}: ${a.result}`);
  return undoFile;
}

/** Re-read every touched document and assert the SHAPE, not a count. Returns the failures. */
async function verify(db, actions) {
  const fails = [];
  const books = db.collection('books');
  for (const a of actions) {
    if (a.status.startsWith('refused') || a.status === 'no write') continue;
    if (a.action === 'move_ocr') {
      const kp = await db.collection('pages').findOne({ _id: a.keeper_page_oid }, { projection: { ocr: 1 } });
      const cp = await db.collection('pages').findOne({ id: a.copy_page_id }, { projection: { 'ocr.data': 1 } });
      if (!hasOcr(kp)) fails.push(`${a.keeper} p${a.page_number}: keeper page has no text`);
      else if (contentHash(kp.ocr.data) !== contentHash(cp?.ocr?.data)) fails.push(`${a.keeper} p${a.page_number}: keeper text is not the copy's text`);
      else if (kp.ocr.moved_from?.page_id !== a.copy_page_id) fails.push(`${a.keeper} p${a.page_number}: no moved_from stamp`);
      if (!hasOcr(cp)) fails.push(`${a.copy} p${a.page_number}: the copy lost its text`);
      if (await db.collection('page_revisions').countDocuments({ page_id: a.keeper_page_id, reason: REVISION_REASON }) < 1) fails.push(`${a.keeper} p${a.page_number}: no page_revisions row`);
      continue;
    }
    const b = await books.findOne({ id: a.book }, { projection: BOOK_PROJECTION });
    if (a.action === 'clear_pointer') {
      if (b.duplicate_of != null) fails.push(`${a.book}: duplicate_of still set`);
    } else {
      if (b.duplicate_of !== a.to) fails.push(`${a.book}: duplicate_of is ${b.duplicate_of}, wanted ${a.to}`);
      const t = await findBookByEitherKey(db, a.to);
      if (!t) fails.push(`${a.book}: target ${a.to} not found by id or _id`);
      else if (t.duplicate_of === a.book) fails.push(`${a.book}: cycle with ${a.to}`);
      if (a.action === 'hide_and_link') {
        if (!(b.visible === false && b.hidden === true && b.hidden_reason === 'duplicate' && b.publication?.state === 'hidden')) fails.push(`${a.book}: not hidden as a duplicate (${b.visible}/${b.hidden}/${b.hidden_reason})`);
        if (!t || t.visible !== true) fails.push(`${a.book}: keeper ${a.to} is not visible`);
        if (await db.collection('gallery_images').countDocuments({ book_id: a.book, book_visible: true })) fails.push(`${a.book}: gallery rows still marked visible`);
      } else if (b.visible === true) fails.push(`${a.book}: visible and carrying duplicate_of`);
    }
    if (a.action === 'clear_pointer' && a.state !== stateOf(b)) fails.push(`${a.book}: publication state changed (${a.state} -> ${stateOf(b)})`);
  }
  return fails;
}

// ── undo ────────────────────────────────────────────────────────────────────────────────────
async function undoRun(db, file) {
  const undo = EJSON.parse(fs.readFileSync(file, 'utf8'), { relaxed: false });
  const now = new Date();
  const restore = (before) => {
    const $set = {}, $unset = {};
    for (const [f, v] of Object.entries(before)) { if (v.absent) $unset[f] = ''; else $set[f] = v.value; }
    return { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) };
  };
  const recount = new Set();
  for (const [pageId, p] of Object.entries(undo.pages)) {
    // Only a page still holding the text this run put there; one re-OCR'd since is left alone.
    const filter = { _id: p._id, 'ocr.moved_from.page_id': p.moved_from_page, 'ocr.moved_from.issue': ISSUE };
    const n = APPLY ? (await db.collection('pages').updateOne(filter, restore(p.before))).modifiedCount : await db.collection('pages').countDocuments(filter);
    console.log(`page ${pageId} (${p.book_id} p${p.page_number}): ${APPLY ? (n ? 'restored' : 'left alone (text changed since)') : (n ? 'would restore' : 'would leave alone')}`);
    if (n) recount.add(p.book_id);
  }
  for (const [id, b] of Object.entries(undo.books)) {
    const { pages_ocr, pages_translated, pages_blank, ...fields } = b.before; // counters come back through recountBook, not the snapshot
    const cur = await db.collection('books').findOne({ _id: b._id }, { projection: BOOK_PROJECTION });
    console.log(`book ${id}: duplicate_of ${cur?.duplicate_of ?? '-'} -> ${fields.duplicate_of.absent ? '-' : fields.duplicate_of.value}; visible ${cur?.visible} -> ${fields.visible.absent ? 'absent' : fields.visible.value}`);
    if (!APPLY) continue;
    await db.collection('books').updateOne({ _id: b._id }, restore(fields));
    const after = await db.collection('books').findOne({ _id: b._id }, { projection: BOOK_PROJECTION });
    if (cur && stateOf(cur) !== stateOf(after)) {
      await db.collection('publication_events').insertOne({ book_id: id, from: stateOf(cur), from_reason: cur.hidden_reason ?? null, to: stateOf(after), reason: null, note: `undo of ${path.basename(file)}`, by: BY, issue: ISSUE, override: null, at: now, fanout: null });
    }
  }
  for (const [id, ids] of Object.entries(undo.gallery_images)) {
    if (APPLY) await db.collection('gallery_images').updateMany({ _id: { $in: ids } }, { $set: { book_visible: true } });
    console.log(`gallery_images of ${id}: ${ids.length} row(s) ${APPLY ? 'marked visible again' : 'would be marked visible again'}`);
  }
  if (APPLY) {
    for (const id of recount) await recountBook(db, id, { reason: `${SWEEP}-undo` });
    await recordSweepActions(db, Object.keys(undo.books).map((id) => ({ sweep: SWEEP, book_id: id, action: 'undo', detail: { file: path.basename(file) } })));
  }
  console.log(`page_revisions rows written by the run are kept (append-only): ${undo.revisions.length}`);
  console.log(APPLY ? 'undo applied' : 'dry run — pass --apply to restore');
}

// ── main ────────────────────────────────────────────────────────────────────────────────────
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set — pass --env-file=.env.production.local'); process.exit(2); }

await withMongo(async (db) => {
  if (UNDO) { await undoRun(db, UNDO); return; }
  const actions = await buildPlan(db);
  if (HASH_CACHE) fs.writeFileSync(HASH_CACHE, JSON.stringify(diskCache));
  printPlan(actions);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, EJSON.stringify({ generated_at: new Date(), applied: APPLY, actions: serializable(actions) }, null, 1, { relaxed: true }));
  if (!APPLY) { console.log('\ndry run — nothing written. Pass --apply to write.'); return; }
  const undoFile = await apply(db, actions);
  for (const a of actions) if (a.status === 'todo') a.status = 'applied';
  const fails = await verify(db, actions);
  console.log(fails.length ? `\nVERIFY FAILED:\n  ${fails.join('\n  ')}` : `\nverify: every touched document re-read, shape as intended (${actions.filter((a) => a.status === 'applied').length} actions)`);
  console.log(`undo: node --env-file=.env.production.local scripts/maintenance/dedupe-cleanup-6019.mjs --undo ${path.relative(process.cwd(), undoFile)} --apply`);
  if (fails.length) process.exitCode = 1;
}, { timeoutMs: 30 * 60 * 1000 });

#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-longs-pass-5924/longs-pass.mjs (the pass, measured in #7174; read-only, no writes);
// scripts/maintenance/dehyphenate-ia-ocr.mjs and repair-number-word-joins-4784.mjs (rewrite stored OCR text but stamp
// ocr.updated_at, so every page they touch goes stale and gap-fill retranslates it — the opposite of what this must do);
// scripts/lib/page-text-writer.mjs (the writer; its row shape and CAS are reused through scripts/lib/longs-orthography.mjs).
/**
 * longs-pass-5924.mjs — apply the long-s pass to stored Latin OCR, orthographic-only, translations untouched (#5924).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/longs-pass-5924.mjs \
 *     --model <model.json.gz> --out <dir> [--engines lite|lite,flash] [--books-file ids.txt] [--max-books N]
 *     [--max-pages-per-book N] [--max-write-per-book N] [--shard i/n] [--apply]
 *
 * Dry unless --apply. Resumable: <out>/checkpoint.jsonl holds one line per finished book and is skipped on restart.
 *
 * Frame (books): language Latin (the reach-count regex), pages_count > 0, not a duplicate, NOT held (pipeline-hold.mjs),
 * not printed before 1501 (gothic; #7174 measured 4 gothic pages and lost 2 — the 1400s need their own measurement), no
 * open translate_batch_runs run (its rounds drop a page whose OCR hash changed: `ocr_changed`), and the book's own text
 * passes the Latin function-word check (BOOK_GATE: German-as-Latin books exist, #5924 spot check).
 * Pages: ocr.model flash-lite (and gemini-3-flash-preview with `--engines lite,flash`), not human-edited, not
 * ocr.unreadable, script not gothic/Fraktur/manuscript, page Latin gate; then applyLongS (longs-orthography.mjs).
 *
 * Per book, in this order: a `sweep_log` row (`longs-pass-planned`) BEFORE any write, the batch write (one
 * page_revisions row per page, source 'longs-pass-5924', run_id), then the STALENESS ASSERT — every written page re-read
 * and compared with its pre-write snapshot: ocr.updated_at, translation.updated_at, translation_stale and
 * translationStaleness() must all be identical, or the run stops — then a `longs-pass-written` row.
 * Undo: scripts/maintenance/revert-run.mjs --run-id <run_id> --apply.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import {
  Model, applyLongS, pageLatinVerdict, pageScriptVerdict, markerCounts, bodyOnly, share, BOOK_GATE,
  writeOrthographicOcr, LONGS_SWEEP,
} from '../lib/longs-orthography.mjs';
import { isHumanEditedField, newRunId } from '../lib/page-text-writer.mjs';
import { translationStaleness, STALE_FIELD } from '../lib/stale-translation.mjs';
import { NOT_HELD } from '../lib/pipeline-hold.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { RUNS_COLLECTION, TERMINAL_PHASES as SEAM_TERMINAL } from '../lib/translate-batch-seam.mjs';
import { TERMINAL_PHASES as CHAINED_TERMINAL } from '../lib/translate-batch-chained.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const MODEL = opt('model'); const OUT = opt('out');
if (!MODEL || !OUT) { console.error('usage: --model <model.json.gz> --out <dir> [--engines lite,flash] [--books-file f] [--max-books N] [--max-pages-per-book N] [--shard i/n] [--apply]'); process.exit(2); }
const ENGINES = new Set(String(opt('engines', 'lite')).split(','));
const MAX_BOOKS = +opt('max-books', Infinity); const MAX_PAGES = +opt('max-pages-per-book', Infinity);
const MAX_WRITE = +opt('max-write-per-book', Infinity); // canary: cap the pages written per book
const [SHARD, NSHARD] = String(opt('shard', '0/1')).split('/').map(Number);
const CHUNK = 200;
const BY = 'scripts/maintenance/longs-pass-5924.mjs';

const engineOf = (m) => (/flash-lite/.test(String(m)) ? 'lite' : m === 'gemini-3-flash-preview' ? 'flash' : null);
const yearOf = (b) => { const y = String(b.published || '').match(/1[4-9]\d\d/); return y ? +y[0] : null; };
const shardOf = (id) => parseInt(crypto.createHash('sha1').update(id).digest('hex').slice(0, 8), 16) % NSHARD;
const STALE_PROJ = { id: 1, 'ocr.updated_at': 1, 'translation.data': 1, 'translation.source': 1, 'translation.updated_at': 1, 'translation.edited_at': 1, [STALE_FIELD]: 1 };
/** What staleness is decided from, per page, as a comparable string. */
const staleState = (p) => JSON.stringify([
  p.ocr?.updated_at ? new Date(p.ocr.updated_at).getTime() : null,
  p.translation?.updated_at ? new Date(p.translation.updated_at).getTime() : null,
  p[STALE_FIELD] ?? null, translationStaleness(p).stale,
]);

fs.mkdirSync(OUT, { recursive: true });
const CK = path.join(OUT, 'checkpoint.jsonl');
const done = new Set(fs.existsSync(CK) ? fs.readFileSync(CK, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book_id) : []);
const modelBuf = fs.readFileSync(MODEL);
const MODEL_SHA = crypto.createHash('sha256').update(modelBuf).digest('hex').slice(0, 16);
const model = new Model(JSON.parse(zlib.gunzipSync(modelBuf).toString('utf8')));
const RUN_ID = opt('run-id') || (fs.existsSync(path.join(OUT, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'run.json'), 'utf8')).run_id : newRunId('longs-pass-5924'));
fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify({ run_id: RUN_ID, model_sha: MODEL_SHA, engines: [...ENGINES], apply: APPLY, shard: `${SHARD}/${NSHARD}`, started_at: new Date() }, null, 1));
console.log(`run ${RUN_ID} model ${MODEL_SHA} engines ${[...ENGINES]} ${APPLY ? 'APPLY' : 'dry'} shard ${SHARD}/${NSHARD}; ${done.size} books already done`);

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const tally = {}; const inc = (k, n = 1) => { tally[k] = (tally[k] || 0) + n; };
try {
  let books;
  if (opt('books-file')) {
    const ids = fs.readFileSync(opt('books-file'), 'utf8').split(/\s+/).filter(Boolean);
    books = await db.collection('books').find({ $or: [{ id: { $in: ids } }, { _id: { $in: ids } }] }, { projection: { id: 1, published: 1, language: 1, pipeline_auto: 1, duplicate_of: 1, pages_count: 1 } }).toArray();
  } else {
    books = await db.collection('books').find(
      { language: /latin|^lat$|^la$/i, pages_count: { $gt: 0 }, duplicate_of: { $in: [null, ''] } },
      { projection: { id: 1, published: 1, language: 1, pipeline_auto: 1, duplicate_of: 1, pages_count: 1 } }).toArray();
  }
  const openRuns = new Set(await db.collection(RUNS_COLLECTION).distinct('book_id', { phase: { $nin: [...new Set([...SEAM_TERMINAL, ...CHAINED_TERMINAL])] } }));
  books = books.map((b) => ({ ...b, bid: String(b.id ?? b._id) })).filter((b) => shardOf(b.bid) === SHARD).sort((a, b) => a.bid.localeCompare(b.bid));
  console.log(`${books.length} books in frame (shard), ${openRuns.size} with an open translate_batch_run`);
  let nb = 0;
  for (const b of books) {
    if (nb >= MAX_BOOKS) break;
    if (done.has(b.bid)) { inc('books_already_done'); continue; }
    const skipBook = (reason, extra = {}) => { inc(`book_skip_${reason}`); fs.appendFileSync(CK, JSON.stringify({ book_id: b.bid, skipped: reason, ...extra }) + '\n'); };
    if (b.pipeline_auto?.hold || b.pipeline_auto?.status === 'held') { skipBook('held'); continue; }
    if (b.duplicate_of) { skipBook('duplicate'); continue; }
    if (!/latin|^lat$|^la$/i.test(String(b.language || ''))) { skipBook('language_field'); continue; }
    const y = yearOf(b); if (y && y < 1501) { skipBook('pre_1501'); continue; }
    if (openRuns.has(b.bid)) { skipBook('open_translate_run'); continue; }
    nb++;
    const pages = await db.collection('pages').find({ book_id: b.bid, 'ocr.data': { $type: 'string' } },
      { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, page_type: 1 } }).sort({ page_number: 1 }).toArray();
    const cand = pages.filter((p) => ENGINES.has(engineOf(p.ocr?.model)));
    if (!cand.length) { skipBook('no_pages_in_engines', { pages: pages.length }); continue; }
    // book gate: the book's own text reads as Latin
    const bc = { latin: 0, vernacular: 0 }; for (const p of cand) { const m = markerCounts(bodyOnly(p.ocr.data)); bc.latin += m.latin; bc.vernacular += m.vernacular; }
    if (bc.latin < BOOK_GATE.minLatin || share(bc) < BOOK_GATE.minShare) { skipBook('book_not_latin', { ...bc, pages: cand.length }); continue; }
    const items = []; const bt = {}; const binc = (k, n = 1) => { bt[k] = (bt[k] || 0) + n; inc(k, n); };
    for (const p of cand.slice(0, MAX_PAGES)) {
      binc(`pages_${engineOf(p.ocr.model)}`);
      if (isHumanEditedField(p.ocr)) { binc('skip_human_edit'); continue; }
      if (p.ocr.unreadable === true) { binc('skip_unreadable'); continue; }
      const sv = pageScriptVerdict(p.ocr.data); if (!sv.ok) { binc('skip_unmeasured_script'); continue; }
      const lv = pageLatinVerdict(p.ocr.data); if (!lv.ok) { binc(`skip_${lv.reason}`); continue; }
      const o = applyLongS(p.ocr.data, model);
      for (const [k, v] of Object.entries(o.reverted)) if (v) binc(`held_back_${k}`, v);
      if (!o.kept) { binc('skip_no_change'); continue; }
      binc('flips', o.kept); binc(o.habit.habit ? 'pages_habit' : 'pages_no_habit');
      items.push({ page: p, next: o.text, flips: o.kept });
      if (items.length >= MAX_WRITE) break;
    }
    if (!items.length) { fs.appendFileSync(CK, JSON.stringify({ book_id: b.bid, written: 0, ...bt }) + '\n'); inc('books_nothing_to_write'); continue; }
    if (!APPLY) {
      binc('would_write', items.length);
      fs.appendFileSync(path.join(OUT, 'plan.jsonl'), JSON.stringify({ book_id: b.bid, pages: items.length, flips: items.reduce((k, x) => k + x.flips, 0), ...bt }) + '\n');
      fs.appendFileSync(CK, JSON.stringify({ book_id: b.bid, dry: true, would_write: items.length, ...bt }) + '\n');
      continue;
    }
    // ── apply: log, snapshot, write, assert ──
    await recordSweepAction(db, { sweep: LONGS_SWEEP, book_id: b.bid, action: 'longs-pass-planned', detail: { run_id: RUN_ID, pages: items.length, flips: items.reduce((k, x) => k + x.flips, 0), model_sha: MODEL_SHA, engines: [...ENGINES] } });
    const ids = items.map((x) => x.page.id);
    const before = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: STALE_PROJ }).toArray()).map((p) => [p.id, staleState(p)]));
    const res = { written: 0, conflict: 0, prior_changed: 0, refused_human_edit: 0, not_found: 0 };
    for (let i = 0; i < items.length; i += CHUNK) {
      const r = await writeOrthographicOcr(db, items.slice(i, i + CHUNK), { by: BY, run_id: RUN_ID });
      for (const k of Object.keys(res)) res[k] += r[k] || 0;
    }
    const after = await db.collection('pages').find({ id: { $in: ids } }, { projection: STALE_PROJ }).toArray();
    const changed = after.filter((p) => before.get(p.id) !== staleState(p)).map((p) => p.id);
    for (const [k, v] of Object.entries(res)) inc(k, v);
    inc('stale_state_checked', after.length); inc('stale_state_changed', changed.length);
    inc('stale_marked_before', [...before.values()].filter((s) => JSON.parse(s)[3]).length);
    await recordSweepAction(db, { sweep: LONGS_SWEEP, book_id: b.bid, action: 'longs-pass-written', detail: { run_id: RUN_ID, ...res, stale_state_changed: changed.length } });
    fs.appendFileSync(CK, JSON.stringify({ book_id: b.bid, ...res, stale_state_changed: changed.length, ...bt }) + '\n');
    if (changed.length) throw new Error(`STOP: ${changed.length} pages of ${b.bid} changed staleness state after an orthographic write: ${changed.slice(0, 5).join(', ')}`);
    if (nb % 25 === 0) console.log(`${nb} books · written ${tally.written || 0} · conflict ${tally.conflict || 0} · stale changed ${tally.stale_state_changed || 0}`);
  }
} finally {
  const summary = { run_id: RUN_ID, model_sha: MODEL_SHA, apply: APPLY, engines: [...ENGINES], shard: `${SHARD}/${NSHARD}`, finished_at: new Date(), tally };
  fs.writeFileSync(path.join(OUT, `summary-${Date.now()}.json`), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary));
  await c.close();
}

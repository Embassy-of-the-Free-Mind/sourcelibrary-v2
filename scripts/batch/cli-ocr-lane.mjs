#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate-lane.mjs — the translation twin of this runner (#7442): same shape (count/run,
// per-day output folder, a ledger of pages not to retry, release when nothing is left), for CLI_TRANSLATE_HOLD.
// scripts/batch/cli-ocr.mjs (read + apply) — the reader and writer this drives, unchanged but for --stop-on-quota.
// Nothing drained CLI_FLASH_OCR_HOLD (ocr-flash-cli-7075) before this: the orchestrator has held books there since
// #7087 (2026-10-21) and only hand-run jobs read them (#7089).
/**
 * cli-ocr-lane — OCR the books the pipeline held for the agy CLI Flash lane (#7075, #7089).
 *
 * WHO RUNS IT: cron on a Hetzner box whose `agy` is signed in, or a session by hand. No paid API: every read goes
 * through `agy -p` on the subscription (cli-ocr.mjs read --stop-on-quota), and cli-ocr.mjs apply writes it with its
 * usual guards and provenance. It never falls back to the API (2026-10-08 rule): out of quota, the book waits.
 *
 *   node --env-file=.env.production.local scripts/batch/cli-ocr-lane.mjs count
 *   node --env-file=.env.production.local scripts/batch/cli-ocr-lane.mjs run --out=DIR [--max-pages=120] [--book=ID] [--apply]
 *
 * WHICH BOOKS. Those held with reason CLI_FLASH_OCR_HOLD.reason, highest processing_priority first, then visible
 * books, then the oldest hold. The lane is recomputed from ocrLaneForBook: a book now routed to the API channel
 * (flash-lite) is released at once, back to the Batch lanes.
 *
 * WHICH MODEL. The router names `gemini-3-flash-preview`, which agy does not offer (its Gemini models are 3.8 Flash
 * and 4 Argon, checked 2026-10-26 on the laptop and on hetzner). CLI_MODEL_FOR maps the routed model to the CLI model
 * that reads in its place; a book routed to a model with no entry stays held and `count` names it. The mapping is a
 * routing choice, recorded in every write's --reason: on Arabic print, 3.8 Flash low read 23/25 Kraus pages usable
 * against Flash-Lite's 20/25 and does not clear the router's CER bar, where only Opus does
 * (scripts/eval/experiments/2026-10-26-kraus-print-route-7341.md).
 *
 * WHICH PAGES. The orchestrator's Phase 2 selection: page_number > 0, no OCR text, not recitation-blocked, with an
 * image. Re-reading a page that has text is not this lane's work.
 *
 * SPREADS. cli-ocr.mjs sends the plain page prompt, so a book whose frames are two-leaf spreads is not read here: a book
 * with `needs_splitting` (Phase 2 reads those with its spread prompt and its post-OCR split) and, as Phase 2 does
 * (#523), a book whose unread pages all lack crop data and that Phase 1.25 has not split_checked. Both stay held and
 * `count` names them. On 2026-10-26 a first run wrote plain reads to a needs_splitting book; they were reverted.
 *
 * RELEASE. When a book has no unread page left it is released to the status it was held at; Phase 2 then finds
 * nothing to read and advances it to ocr_complete. A page the reader failed or the writer refused is written to the
 * ledger (DIR/../cli-ocr-ledger.jsonl) and not tried again; a book with ledgered pages stays held and `count` names it.
 *
 * HOW IT FAILS. A quota reply or a locked model makes the reader exit 3; the run stops and the next resumes from the
 * reads already on disk. Without --apply it reads and dry-runs the writer, and releases and ledgers nothing.
 *
 * --lane=lite (#7517): THE FLASH-LITE BATCH REPLACEMENT. Books the router sends to gemini-3.1-flash-lite on the Batch
 * API, in the cells where a fresh 3.8 Flash-low read passed the route judge (LITE_AGY.families), read instead on the
 * SECOND agy account (AGY_HOME, agy-guard.sh; required: this mode refuses to run on the main account's pool).
 *   AGY_HOME=/root/.agy-james node --env-file=... scripts/batch/cli-ocr-lane.mjs count --lane=lite
 *   AGY_HOME=/root/.agy-james node --env-file=... scripts/batch/cli-ocr-lane.mjs run --lane=lite --out=DIR [--max-pages=200] [--apply]
 * Before anything it reads `agy -p /quota` on that account and stops when the Gemini weekly remaining is under
 * LITE_AGY.quotaFloor (or unreadable). It first finishes the books it already holds (LITE_AGY_OCR_HOLD), then CLAIMS
 * more, only as many as the page budget covers: Phase 2's own candidates (archive_complete, split_checked, deduped,
 * not recitation-flagged), past the IA free-text gate, not a spread book (spreadReason), with no page in a live or
 * just-saved Batch job (ocr-submit-guard.mjs), under Phase 2's submit lease so the two cannot take one book at once.
 * A claim is a pipeline hold (pipeline-hold.mjs), so every Batch phase stands back from the book. Pages the reader
 * could not deliver (Gemini's recitation filter cuts about a third of fresh reads of early print) or the writer
 * refused are ledgered; once a book has no unread page this lane will try, it is RELEASED to the status it was held
 * at, and Batch reads what is left. Books it did not claim never leave Batch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { ocrLaneForBook, CLI_FLASH_OCR_HOLD, OCR_MODEL_LITE } from '../lib/ocr-routing.mjs';
import { holdBook, releaseBook, HOLD_STATUS } from '../lib/pipeline-hold.mjs';
import { claimBookForOcrSubmit, releaseOcrSubmitClaims, loadOcrPagesInFlight } from '../lib/ocr-submit-guard.mjs';
import { toLanguageCodes, codeFamily } from '../lib/language-normalize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Why this lane must not read the book with the plain page prompt (see SPREADS above), or null. */
export function spreadReason(book, pages) {
  if (book.needs_splitting) return 'needs_splitting: wants the spread prompt and post-OCR split';
  if (pages.length && !book.pipeline_auto?.split_checked && pages.every((p) => !p.crop && !p.cropped_photo)) return 'no page has crop data and the book is not split_checked: possible unsplit spreads (#523)';
  return null;
}

/** The CLI model that reads in place of each routed model agy does not offer (see WHICH MODEL above). */
export const CLI_MODEL_FOR = Object.freeze({ 'gemini-3-flash-preview': 'gemini-3.8-flash-low' });

/** The pages this lane reads: the orchestrator's Phase 2 filter (submitOcrForBook), without the per-model block. */
export const UNREAD = Object.freeze({
  page_number: { $gt: 0 },
  'ocr.recitation_blocked': { $ne: true },
  $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }],
  $and: [{
    $or: [
      { archived_photo: { $exists: true, $regex: /^https?:\/\// } },
      { cropped_photo: { $exists: true, $nin: [null, ''] } },
      { photo: { $exists: true, $ne: null } },
      { photo_original: { $exists: true, $ne: null } },
    ],
  }],
});

/** Highest processing_priority first, then visible, then the oldest hold. */
export const byQueueOrder = (a, b) => (b.processing_priority ?? 0) - (a.processing_priority ?? 0)
  || (b.visible ? 1 : 0) - (a.visible ? 1 : 0)
  || String(a.pipeline_auto?.hold?.held_at ?? '').localeCompare(String(b.pipeline_auto?.hold?.held_at ?? ''));

function run(args) {
  console.log(`$ node ${args.map((a) => path.relative(process.cwd(), a) || a).join(' ')}`);
  return spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, AGY_JOB: process.env.AGY_JOB || 'cli-ocr-lane-7089' } }).status;
}

// ── --lane=lite (#7517, header) ──

/** The hold that marks a book this lane took from the Flash-Lite Batch queue. */
export const LITE_AGY_OCR_HOLD = Object.freeze({
  reason: 'ocr-lite-agy-7517',
  issue: 7517,
  release: 'cli-ocr-lane.mjs --lane=lite read every unread page it could (3.8 Flash-low on the second agy account); it releases the book itself, and Batch reads whatever is left',
});

/**
 * The route that passed the test (scripts/eval/experiments/2026-10-27-flash-low-fresh-vs-lite-7517.md): which
 * language families, read how, and the account floor. Only a family listed here is claimed.
 */
export const LITE_AGY = Object.freeze({
  model: 'gemini-3.8-flash-low',
  families: Object.freeze(['deu', 'fra', 'lat']),
  quotaFloor: 0.10,
  evidence: 'scripts/eval/experiments/2026-10-27-flash-low-fresh-vs-lite-7517.md',
});

/** The language family a book's FIRST language belongs to, or null. */
export function familyOf(book) {
  const first = toLanguageCodes(book?.language).codes[0];
  return first ? codeFamily(first) : null;
}

/** Why this lane must not take (or keep) the book, or null: it is routed to lite on the API, in a passed family. */
export function liteLaneRefusal(book, { families = LITE_AGY.families } = {}) {
  const lane = ocrLaneForBook(book);
  if (lane.channel !== 'api' || lane.model !== OCR_MODEL_LITE) return `routed to ${lane.model} (${lane.channel}), not Flash-Lite Batch`;
  const fam = familyOf(book);
  if (!families.includes(fam)) return `language ${book?.language ?? '?'} (${fam ?? 'no family'}) is not a cell that passed`;
  return null;
}

/**
 * The Gemini weekly remaining fraction from `agy -p /quota --output-format json` (the "Gemini Models" group's weekly
 * bucket), or null when the reply does not say. null stops the run: an unread meter is not a full one.
 */
export function geminiWeeklyRemaining(stdout) {
  let j; try { j = JSON.parse(String(stdout).trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? ''); } catch { return null; }
  const g = j?.command?.data?.groups?.find((x) => /gemini/i.test(x.name ?? ''));
  const b = g?.buckets?.find((x) => x.window === 'weekly') ?? g?.buckets?.[0];
  return typeof b?.remaining_fraction === 'number' ? { remaining: b.remaining_fraction, reset: b.reset_time ?? null } : null;
}

/**
 * Phase 2's candidate filter (pipeline-orchestrator.mjs, Pass 1 and Pass 2) for a book not yet sent to Batch, plus
 * the IA free-text gate in its strict form: a book that is an IA item must have had Phase 1.45's turn
 * (`ia_reference_at`), so this lane never reads a book the free IA text is about to fill.
 */
export const LITE_CLAIM_FILTER = Object.freeze({
  'pipeline_auto.status': 'archive_complete',
  'pipeline_auto.split_checked': true,
  'pipeline_auto.dedup_complete': true,
  'pipeline_auto.recitation_blocked': { $ne: true },
  'pipeline_auto.recitation_retry': { $ne: true },
  'pipeline_auto.recitation_retry_lite': { $ne: true },
  'pipeline_auto.hold': { $exists: false },
  needs_splitting: { $ne: true },
  $or: [
    { 'pipeline_auto.ia_reference_at': { $exists: true } },
    { $and: [{ ia_identifier: { $in: [null, ''] } }, { 'image_source.identifier': { $in: [null, ''] } }] },
  ],
});

const LITE_OWNER = 'cli-ocr-lane-lite-7517';
const BOOK_PROJ = { id: 1, title: 1, language: 1, visible: 1, image_source: 1, processing_priority: 1, created_at: 1, needs_splitting: 1, pipeline_auto: 1, pages_count: 1 };

function readQuota() {
  const r = spawnSync('agy', ['-p', '/quota', '--output-format', 'json'], { encoding: 'utf8', env: process.env, timeout: 120_000 });
  return geminiWeeklyRemaining(r.stdout);
}

/** Take one book from the Batch queue: submit lease, re-check under it, hold, drop the lease. */
async function claimLiteBook(db, book, pages) {
  const lease = await claimBookForOcrSubmit(db, book.id, { owner: LITE_OWNER });
  if (!lease.ok) return { outcome: 'leased', why: lease.reason };
  try {
    const now = await db.collection('books').findOne({ id: book.id, ...LITE_CLAIM_FILTER }, { projection: BOOK_PROJ });
    if (!now) return { outcome: 'moved', why: 'no longer a Phase 2 candidate' };
    const inFlight = await loadOcrPagesInFlight(db, [book.id]);
    if (pages.some((p) => inFlight.has(p.id))) return { outcome: 'in_batch', why: 'a page is in a live or just-saved Batch job' };
    const r = await holdBook(db, book.id, { ...LITE_AGY_OCR_HOLD, source: 'cli-ocr-lane', detail: { routed_model: OCR_MODEL_LITE, cli_model: LITE_AGY.model, unread_pages: pages.length, language: book.language ?? null, account: process.env.AGY_HOME } });
    return { outcome: r.outcome };
  } finally {
    await releaseOcrSubmitClaims(db, [book.id], { owner: LITE_OWNER });
  }
}

async function runLite(db, mode, { OUT, APPLY, LEDGER, MAX, ONLY_BOOK }) {
  if (!process.env.AGY_HOME) { console.error('--lane=lite reads on the second agy account only: set AGY_HOME (e.g. /root/.agy-james)'); return 2; }
  const ledger = LEDGER ? readLedger(LEDGER) : new Set();
  const held = (await db.collection('books').find({ 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold.reason': LITE_AGY_OCR_HOLD.reason, ...(ONLY_BOOK && { id: ONLY_BOOK }) }, { projection: BOOK_PROJ }).toArray()).sort(byQueueOrder);
  const unreadOf = (id) => db.collection('pages').find({ book_id: id, ...UNREAD }, { projection: { id: 1, page_number: 1, crop: 1, cropped_photo: 1 } }).sort({ page_number: 1 }).toArray();
  console.log(`books held by this lane (${LITE_AGY_OCR_HOLD.reason}): ${held.length}`);
  if (mode === 'count') {
    for (const b of held) { const ps = await unreadOf(b.id); console.log(`  ${b.id} ${String(b.title || '').slice(0, 50)} — ${ps.filter((p) => !ledger.has(p.id)).length} to read, ${ps.filter((p) => ledger.has(p.id)).length} ledgered${liteLaneRefusal(b) ? `; ${liteLaneRefusal(b)}` : ''}`); }
    const t = {};
    for await (const b of db.collection('books').find(LITE_CLAIM_FILTER, { projection: { language: 1, visible: 1, created_at: 1, image_source: 1, pages_count: 1 } })) {
      const k = liteLaneRefusal(b) ? 'not this lane' : familyOf(b);
      t[k] ??= { books: 0, pages: 0 }; t[k].books++; t[k].pages += b.pages_count ?? 0;
    }
    console.log('Phase 2 candidates past the IA gate (pages_count, read or not):');
    for (const [k, v] of Object.entries(t)) console.log(`  ${k.padEnd(14)} ${String(v.books).padStart(6)} books ${String(v.pages).padStart(9)} pages`);
    return 0;
  }
  const q = readQuota();
  if (!q) { console.log(`agy /quota unreadable on ${process.env.AGY_HOME}: not reading (an unread meter is not a full one)`); return 0; }
  console.log(`agy ${process.env.AGY_HOME}: Gemini weekly remaining ${(q.remaining * 100).toFixed(1)}% (resets ${q.reset})`);
  if (q.remaining < LITE_AGY.quotaFloor) { console.log(`under the ${LITE_AGY.quotaFloor * 100}% floor: stopping; books stay on Batch`); return 0; }

  const job = `cli-ocr-lane-lite-${new Date().toISOString().slice(0, 10)}`;
  let budget = MAX;
  const release = async (book, note) => {
    console.log(`  release: ${note}`);
    if (APPLY) console.log(`  ${JSON.stringify(await releaseBook(db, book.id, { note, source: 'cli-ocr-lane' }))}`);
  };
  // One book: read its open pages, write them, ledger what did not land, release when nothing is left for us.
  const readBook = async (book, pages) => {
    const open = pages.filter((p) => !ledger.has(p.id));
    const label = `${book.id} ${String(book.title || '').slice(0, 40)}`;
    if (!open.length) return release(book, pages.length ? `#7517: ${pages.length} page(s) this lane could not read go back to Batch` : 'every unread page read by the lite→agy lane (#7517)');
    const take = open.slice(0, budget);
    budget -= take.length;
    const dir = path.join(OUT, book.id);
    fs.mkdirSync(dir, { recursive: true });
    const ids = path.join(dir, 'page-ids.json');
    fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
    console.log(`\n${label}: ${take.length} of ${open.length} pages, fresh read on ${LITE_AGY.model} (routed ${OCR_MODEL_LITE})`);
    const read = run([path.join(HERE, 'cli-ocr.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${LITE_AGY.model}`, `--job=${job}`, '--stop-on-quota']);
    if (read === 3) return 'quota';
    if (read !== 0) { console.log(`  reader exited ${read}: book skipped this run`); return null; }
    const reason = `#7517 lite→agy lane: routed ${OCR_MODEL_LITE} (Batch), read fresh by ${LITE_AGY.model} on agy account ${path.basename(process.env.AGY_HOME)}; route evidence ${LITE_AGY.evidence}`;
    const applied = run([path.join(HERE, 'cli-ocr.mjs'), 'apply', `--out=${dir}`, `--reason=${reason}`, ...(APPLY ? ['--apply'] : [])]);
    if (!APPLY || applied !== 0) return null;
    const left = new Set((await db.collection('pages').find({ id: { $in: take.map((p) => p.id) }, ...UNREAD }, { projection: { id: 1 } }).toArray()).map((p) => p.id));
    for (const p of take.filter((x) => left.has(x.id))) {
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${p.id}.meta.json`), 'utf8')); } catch { /* not read */ }
      fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, model: LITE_AGY.model, lane: 'lite', exit: meta?.exit ?? null, error_class: meta?.error_class ?? meta?.wrapper ?? (meta ? 'not_written' : 'not_read'), at: new Date().toISOString() }) + '\n');
      ledger.add(p.id);
    }
    if (left.size) console.log(`  ${left.size} page(s) not written: ledgered, left for Batch`);
    const unread = await unreadOf(book.id);
    if (!unread.some((p) => !ledger.has(p.id))) await release(book, unread.length ? `#7517: the lite→agy lane read what it could; ${unread.length} page(s) go back to Batch` : 'every unread page read by the lite→agy lane (#7517)');
    return null;
  };

  // 1. The books already held: finish them (or hand back any the router no longer sends to lite).
  for (const book of held) {
    const why = liteLaneRefusal(book);
    if (why) { await release(book, `#7517: ${why}`); continue; }
    if (budget <= 0) break;
    if (await readBook(book, await unreadOf(book.id)) === 'quota') { console.log('quota reached: stopping; the next run resumes'); return 0; }
  }
  // 2. Claim more from the Batch queue, Phase 2's order, only as many as the budget covers.
  const tally = { claimed: 0, skipped: {} };
  const skip = (why) => { tally.skipped[why] = (tally.skipped[why] ?? 0) + 1; };
  const cursor = db.collection('books').find({ ...LITE_CLAIM_FILTER, ...(ONLY_BOOK && { id: ONLY_BOOK }) }, { projection: BOOK_PROJ }).sort({ processing_priority: -1, created_at: -1 }).limit(2000);
  for await (const book of cursor) {
    if (budget <= 0) break;
    const why = liteLaneRefusal(book);
    if (why) { skip(why.replace(/ \(.*$/, '').replace(/^language .*/, 'language not in a passed cell')); continue; }
    const pages = await unreadOf(book.id);
    if (!pages.length) { skip('no unread page'); continue; }
    if (spreadReason(book, pages)) { skip('spread book'); continue; }
    if (!APPLY) { console.log(`\nwould claim ${book.id} ${String(book.title || '').slice(0, 40)} (${book.language}, ${pages.length} unread)`); budget -= Math.min(budget, pages.length); tally.claimed++; continue; }
    const c = await claimLiteBook(db, book, pages);
    if (c.outcome !== 'held') { skip(`claim: ${c.outcome}`); continue; }
    tally.claimed++;
    console.log(`\nclaimed ${book.id} ${String(book.title || '').slice(0, 40)} (${book.language}, ${pages.length} unread)`);
    if (await readBook(book, pages) === 'quota') { console.log('quota reached: stopping; the next run resumes'); break; }
  }
  console.log(`\nclaimed ${tally.claimed}; passed over ${JSON.stringify(tally.skipped)}`);
  return 0;
}

const readLedger = (f) => new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id) : []);

async function heldBooks(db) {
  const books = await db.collection('books').find(
    // The status first: it is indexed, and a held book carries both (pipeline-hold.mjs).
    { 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold.reason': CLI_FLASH_OCR_HOLD.reason },
    { projection: { id: 1, title: 1, language: 1, visible: 1, image_source: 1, processing_priority: 1, created_at: 1, needs_splitting: 1, 'pipeline_auto.hold': 1, 'pipeline_auto.split_checked': 1 } },
  ).toArray();
  return books.sort(byQueueOrder);
}

async function main() {
  const mode = process.argv[2];
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  if (!['count', 'run'].includes(mode)) { console.error('usage: cli-ocr-lane.mjs count | run --out=DIR [--max-pages=120] [--book=ID] [--apply]'); process.exit(2); }
  const APPLY = process.argv.includes('--apply');
  const OUT = arg('out') && path.resolve(arg('out'));
  const LEDGER = arg('ledger') || (OUT ? path.join(path.dirname(OUT), 'cli-ocr-ledger.jsonl') : null);
  if (mode === 'run' && !OUT) { console.error('run needs --out=DIR'); process.exit(2); }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const ONLY_BOOK = arg('book');
  if (arg('lane') === 'lite') {
    const code = await runLite(db, mode, { OUT, APPLY, LEDGER: arg('ledger') || (OUT ? path.join(path.dirname(OUT), 'cli-ocr-lite-ledger.jsonl') : null), MAX: Number(arg('max-pages') || 200), ONLY_BOOK });
    await client.close();
    process.exit(code);
  }
  if (arg('lane')) { console.error(`unknown --lane=${arg('lane')} (lite, or none for the ${CLI_FLASH_OCR_HOLD.reason} lane)`); process.exit(2); }
  const ledger = LEDGER ? readLedger(LEDGER) : new Set();

  const books = (await heldBooks(db)).filter((b) => !ONLY_BOOK || b.id === ONLY_BOOK);
  const plan = [];
  for (const book of books) {
    const lane = ocrLaneForBook(book);
    const pages = await db.collection('pages').find({ book_id: book.id, ...UNREAD }, { projection: { id: 1, page_number: 1, crop: 1, cropped_photo: 1 } }).sort({ page_number: 1 }).toArray();
    plan.push({ book, lane, cliModel: CLI_MODEL_FOR[lane.model] ?? null, spread: spreadReason(book, pages), pages, open: pages.filter((p) => !ledger.has(p.id)) });
  }
  const tally = {};
  for (const r of plan) {
    const k = r.lane.channel !== 'cli' ? 'now api channel: release' : r.spread ? 'spread book: waits for a spread read' : r.cliModel ? `${r.book.language ?? '?'} → ${r.cliModel}` : `no CLI model for ${r.lane.model}: waits`;
    tally[k] ??= { books: 0, pages: 0, ledgered: 0, visible: 0 };
    tally[k].books++; tally[k].pages += r.open.length; tally[k].ledgered += r.pages.length - r.open.length; tally[k].visible += r.book.visible ? 1 : 0;
  }
  console.log(`books held for the CLI OCR lane (${CLI_FLASH_OCR_HOLD.reason}): ${books.length}`);
  for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(48)} ${String(t.books).padStart(4)} books (${t.visible} visible) · ${String(t.pages).padStart(6)} pages to read · ${t.ledgered} ledgered`);
  for (const r of plan.filter((x) => x.open.length === 0 && x.pages.length > 0)) console.log(`  stuck: ${r.book.id} ${String(r.book.title || '').slice(0, 50)} — ${r.pages.length} ledgered page(s) only; look at ${LEDGER ?? 'the ledger'}`);
  for (const r of plan.filter((x) => x.spread && x.pages.length)) console.log(`  spread: ${r.book.id} ${String(r.book.title || '').slice(0, 50)} — ${r.spread}`);
  if (mode === 'count') { await client.close(); return; }

  const MAX = Number(arg('max-pages') || 120);
  const job = `cli-ocr-lane-${new Date().toISOString().slice(0, 10)}`;
  let budget = MAX;
  for (const r of plan) {
    const { book, lane, cliModel } = r;
    const label = `${book.id} ${String(book.title || '').slice(0, 40)}`;
    if (lane.channel !== 'cli') {
      console.log(`\n${label}: now routed to ${lane.model} on the API channel; releasing to the Batch lanes`);
      if (APPLY) console.log(`  ${JSON.stringify(await releaseBook(db, book.id, { note: `ocr routing now sends this book to ${lane.model} (API channel)`, source: 'cli-ocr-lane' }))}`);
      continue;
    }
    if (r.pages.length === 0) {
      console.log(`\n${label}: nothing left to read; releasing`);
      if (APPLY) console.log(`  ${JSON.stringify(await releaseBook(db, book.id, { note: 'every unread page read by the CLI OCR lane (#7089)', source: 'cli-ocr-lane' }))}`);
      continue;
    }
    if (r.spread) continue;
    if (!cliModel || budget <= 0 || r.open.length === 0) continue;
    const take = r.open.slice(0, budget);
    budget -= take.length;
    const dir = path.join(OUT, book.id);
    fs.mkdirSync(dir, { recursive: true });
    const ids = path.join(dir, 'page-ids.json');
    fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
    console.log(`\n${label}: ${take.length} of ${r.open.length} pages on ${cliModel} (routed ${lane.model})`);
    const read = run([path.join(HERE, 'cli-ocr.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${cliModel}`, `--job=${job}`, '--stop-on-quota']);
    if (read === 3) { console.log('quota reached: stopping; the next run resumes'); break; }
    if (read !== 0) { console.log(`  reader exited ${read}: book skipped this run`); continue; }
    const reason = `#7089 CLI OCR lane: routed ${lane.model}, read by ${cliModel} through agy (agy offers no 3 Flash)`;
    const applied = run([path.join(HERE, 'cli-ocr.mjs'), 'apply', `--out=${dir}`, `--reason=${reason}`, ...(APPLY ? ['--apply'] : [])]);
    if (!APPLY || applied !== 0) continue;
    // What this run tried and could not write goes to the ledger, so it is not read again every run.
    const left = new Set((await db.collection('pages').find({ id: { $in: take.map((p) => p.id) }, ...UNREAD }, { projection: { id: 1 } }).toArray()).map((p) => p.id));
    for (const p of take.filter((x) => left.has(x.id))) {
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${p.id}.meta.json`), 'utf8')); } catch { /* not read */ }
      fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, model: cliModel, exit: meta?.exit ?? null, error_class: meta?.error_class ?? (meta ? 'not_written' : 'not_read'), at: new Date().toISOString() }) + '\n');
    }
    if (left.size) console.log(`  ${left.size} page(s) not written: ledgered, not retried`);
    const remaining = await db.collection('pages').countDocuments({ book_id: book.id, ...UNREAD });
    if (remaining === 0) console.log(`  released: ${JSON.stringify(await releaseBook(db, book.id, { note: 'every unread page read by the CLI OCR lane (#7089)', source: 'cli-ocr-lane' }))}`);
  }
  await client.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();

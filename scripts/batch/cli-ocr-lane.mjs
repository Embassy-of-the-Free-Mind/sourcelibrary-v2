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
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { ocrLaneForBook, CLI_FLASH_OCR_HOLD } from '../lib/ocr-routing.mjs';
import { releaseBook, HOLD_STATUS } from '../lib/pipeline-hold.mjs';

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
  const ledger = LEDGER ? readLedger(LEDGER) : new Set();

  const ONLY_BOOK = arg('book');
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

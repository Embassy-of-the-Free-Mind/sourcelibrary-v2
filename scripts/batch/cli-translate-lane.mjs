#!/usr/bin/env node
// PRIOR ART: scripts/batch/refused-pages.mjs — the scheduled `claude -p` job this copies (weekly-limit guard, exit-3
// stop, per-day output folder, a ledger of pages not to retry); it selects REFUSED OCR pages, not books held for a
// translation lane. scripts/batch/claude-translate.mjs and cli-translate.mjs (read + apply) — the readers and the writer
// this drives, unchanged. The OCR twin of the hold (CLI_FLASH_OCR_HOLD) has no runner yet (#7089). Nothing drained
// books held for a CLI translation lane, because nothing held them before #7075.
/**
 * cli-translate-lane — translate the books the pipeline held for a subscription CLI translation lane (#7075).
 *
 * WHO RUNS IT: cron on a Hetzner box whose `claude` (Opus rows) or `agy` (3.8 Flash rows) is signed in — or a session,
 * by hand. No paid API: Opus runs through `claude -p` (claude-translate.mjs), Gemini 3.8 Flash through `agy -p`
 * (cli-translate.mjs read), and cli-translate.mjs apply writes both through translate-core's door.
 *
 *   node --env-file=.env.production.local scripts/batch/cli-translate-lane.mjs count
 *   node --env-file=.env.production.local scripts/batch/cli-translate-lane.mjs run --out=DIR [--max-pages=60]
 *        [--engine=claude-opus-5-5|gemini-3.8-flash+agy-cli] [--max-weekly-pct=70] [--apply]
 *
 * WHICH BOOKS. Those held with reason CLI_TRANSLATE_HOLD.reason: the orchestrator's Phase 4 holds a book when
 * translateLaneForBook (the `channel: "cli"` rows of scripts/lib/translation-routing-table.json) names a CLI reader.
 * The lane is recomputed here from the table: a book whose row is gone or no longer cli is released at once, back to
 * the Batch lanes. Visible books first, then the oldest hold.
 *
 * WHICH PAGES. Untranslated only (no translation.data), translatable, not health-blocked, page_number > 0. Retranslating
 * a page that has English is a separate decision (#7075).
 *
 * RELEASE. When a book has no untranslated page left, it is released to the status it was held at, and Phase 4 then
 * advances it as it does any book with nothing left to translate. A page the reader failed or the writer refused is
 * written to the ledger (DIR/../cli-translate-ledger.jsonl) and not tried again; a book with ledgered pages stays held
 * and `count` names it, for a person to look at.
 *
 * HOW IT FAILS. A usage-limit reply makes the reader exit 3; the run stops and the next resumes. A reader that exits 2
 * (claude-translate's OCR-first gate: the book's OCR is mostly flash-lite and the row has no adoption.ocr_checked) skips
 * that book and says so. Without --apply it reads and dry-runs the writer, and releases and ledgers nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { translateLaneForBook, CLI_TRANSLATE_HOLD, SKIP_TRANSLATION_PAGE_TYPES } from '../lib/translate-core.mjs';
import { releaseBook, HOLD_STATUS } from '../lib/pipeline-hold.mjs';
import { CLI_TRANSLATE_LANES } from '../lib/translation-routing.mjs';
import { laneQuota } from '../lib/lane-quota.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/** The pages this lane translates: the orchestrator's Phase 4 filter without the stale-translation branch. */
export const UNTRANSLATED = Object.freeze({
  page_number: { $gt: 0 },
  'ocr.data': { $exists: true, $nin: [null, ''] },
  page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
  'translation.health_blocked': { $exists: false },
  $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': null }, { 'translation.data': '' }],
});

/** The two commands for one book's read, by engine: the reader's argv (after node). */
export function readerArgs(lane, { ids, dir, job, ocrChecked }) {
  const reader = path.join(ROOT, lane.reader);
  if (lane.engine === 'claude-opus-5-5') {
    return [reader, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${lane.model}`, `--job=${job}`, ...(ocrChecked ? [`--ocr-checked=${ocrChecked}`] : [])];
  }
  return [reader, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${lane.model}`, ...(ocrChecked ? [`--ocr-checked=${ocrChecked}`] : [])];
}

function run(args) {
  console.log(`$ node ${args.map((a) => path.relative(process.cwd(), a) || a).join(' ')}`);
  return spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, CLI_JOB_NAME: process.env.CLI_JOB_NAME || 'cli-translate-lane-7075' } }).status;
}

const readLedger = (f) => new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id) : []);

async function heldBooks(db) {
  return db.collection('books').find(
    // The status first: it is indexed, and a held book carries both (pipeline-hold.mjs).
    { 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold.reason': CLI_TRANSLATE_HOLD.reason },
    { projection: { id: 1, title: 1, language: 1, visible: 1, image_source: 1, 'pipeline_auto.hold': 1 } },
  ).sort({ visible: -1, 'pipeline_auto.hold.held_at': 1 }).toArray();
}

async function main() {
  const mode = process.argv[2];
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  if (!['count', 'run'].includes(mode)) { console.error('usage: cli-translate-lane.mjs count | run --out=DIR [--max-pages=60] [--engine=E] [--max-weekly-pct=70] [--apply]'); process.exit(2); }
  const ENGINE = arg('engine') || null;
  const APPLY = process.argv.includes('--apply');
  const OUT = arg('out') && path.resolve(arg('out'));
  const LEDGER = arg('ledger') || (OUT ? path.join(path.dirname(OUT), 'cli-translate-ledger.jsonl') : null);
  if (mode === 'run') {
    if (!OUT) { console.error('run needs --out=DIR'); process.exit(2); }
    // A cron spends the box account's subscription: the lane's quota gate (lane-quota.mjs, #7301) idles it at its
    // share of the week (70% for Opus) and opens it in the last stretch, when the quota would otherwise be lost: Opus
    // to 95% in the last 24 h (its `endOfWeek`, #7448), agy at the shared 90% in the last 48 h.
    // --max-weekly-pct overrides the registered share.
    const agy = ENGINE === 'gemini-3.8-flash+agy-cli';
    const q = laneQuota(agy ? 'agy-flash-translate' : 'claude-opus-translate', { model: agy ? CLI_TRANSLATE_LANES[ENGINE].model : null, maxWeeklyPct: arg('max-weekly-pct') ?? null });
    if (!q.open) { console.log(`skip: lane ${q.lane} idles (${q.state}): ${q.why}`); return; }
    console.log(`quota: lane ${q.lane} ${q.state}: ${q.why}`);
  }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const ledger = LEDGER ? readLedger(LEDGER) : new Set();

  const books = await heldBooks(db);
  const plan = [];
  for (const book of books) {
    const lane = translateLaneForBook(book);
    const pages = await db.collection('pages').find({ book_id: book.id, ...UNTRANSLATED }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();
    plan.push({ book, lane, pages, open: pages.filter((p) => !ledger.has(p.id)) });
  }
  const tally = {};
  for (const r of plan) {
    const k = r.lane.channel === 'cli' ? `${r.lane.engine} (${r.lane.row.id})` : 'no longer cli: release';
    tally[k] ??= { books: 0, pages: 0, ledgered: 0, visible: 0 };
    tally[k].books++; tally[k].pages += r.open.length; tally[k].ledgered += r.pages.length - r.open.length; tally[k].visible += r.book.visible ? 1 : 0;
  }
  console.log(`books held for a CLI translation lane (${CLI_TRANSLATE_HOLD.reason}): ${books.length}`);
  for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(48)} ${String(t.books).padStart(4)} books (${t.visible} visible) · ${String(t.pages).padStart(6)} pages to translate · ${t.ledgered} ledgered`);
  for (const r of plan.filter((x) => x.open.length === 0 && x.pages.length > 0)) console.log(`  stuck: ${r.book.id} ${String(r.book.title || '').slice(0, 50)} — ${r.pages.length} ledgered page(s) only; look at ${LEDGER ?? 'the ledger'}`);
  if (mode === 'count') { await client.close(); return; }

  const MAX = Number(arg('max-pages') || 60);
  const job = `cli-tr-${new Date().toISOString().slice(0, 10)}`;
  let budget = MAX;
  for (const r of plan) {
    const { book, lane } = r;
    const label = `${book.id} ${String(book.title || '').slice(0, 40)}`;
    if (lane.channel !== 'cli') {
      console.log(`\n${label}: its row is no longer a cli row; releasing to the Batch lanes`);
      if (APPLY) console.log(`  ${JSON.stringify(await releaseBook(db, book.id, { note: 'translation-routing-table no longer routes this book to a CLI lane', source: 'cli-translate-lane' }))}`);
      continue;
    }
    if (ENGINE && lane.engine !== ENGINE) continue;
    if (r.pages.length === 0) {
      console.log(`\n${label}: nothing left to translate; releasing`);
      if (APPLY) console.log(`  ${JSON.stringify(await releaseBook(db, book.id, { note: `every untranslated page written by the ${lane.engine} lane (#7075)`, source: 'cli-translate-lane' }))}`);
      continue;
    }
    if (budget <= 0 || r.open.length === 0) continue;
    const take = r.open.slice(0, budget);
    budget -= take.length;
    const dir = path.join(OUT, book.id);
    fs.mkdirSync(dir, { recursive: true });
    const ids = path.join(dir, 'page-ids.json');
    fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
    console.log(`\n${label}: ${take.length} of ${r.open.length} pages on ${lane.engine} (row ${lane.row.id})`);
    const read = run(readerArgs(lane, { ids, dir, job, ocrChecked: lane.row.adoption?.ocr_checked }));
    if (read === 3) { console.log('usage limit reached: stopping; the next run resumes'); break; }
    if (read !== 0) { console.log(`  reader exited ${read}: book skipped this run`); continue; }
    const reason = `#7075 CLI translation lane: row ${lane.row.id}, ${lane.engine} (adopted on ${lane.row.adoption.sample})`;
    const applied = run([path.join(HERE, 'cli-translate.mjs'), 'apply', `--out=${dir}`, `--reason=${reason}`, ...(APPLY ? ['--apply'] : [])]);
    if (!APPLY || applied !== 0) continue;
    // What this run tried and could not write goes to the ledger, so it is not read again every run.
    const left = new Set((await db.collection('pages').find({ id: { $in: take.map((p) => p.id) }, ...UNTRANSLATED }, { projection: { id: 1 } }).toArray()).map((p) => p.id));
    for (const p of take.filter((x) => left.has(x.id))) {
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${p.id}.meta.json`), 'utf8')); } catch { /* not read */ }
      fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, engine: lane.engine, exit: meta?.exit ?? null, error_class: meta?.error_class ?? (meta ? 'not_written' : 'not_read'), at: new Date().toISOString() }) + '\n');
    }
    if (left.size) console.log(`  ${left.size} page(s) not written: ledgered, not retried`);
    const remaining = await db.collection('pages').countDocuments({ book_id: book.id, ...UNTRANSLATED });
    if (remaining === 0) console.log(`  released: ${JSON.stringify(await releaseBook(db, book.id, { note: `every untranslated page written by the ${lane.engine} lane (#7075)`, source: 'cli-translate-lane' }))}`);
  }
  await client.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();

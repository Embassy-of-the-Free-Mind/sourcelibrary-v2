#!/usr/bin/env node
// PRIOR ART: scripts/batch/stranded-text-repair-5309.mjs (PR #5408, unmerged) — the 2026-09-30 repair of these pages on
// PAID Batch Gemini, with envelopes, holds and chained translation runs; the residual it left is what Gemini Batch
// refused, and agy is a subscription, so none of its spend machinery applies. scripts/maintenance/wrong-leaf-fix-5021.mjs
// — the closest runner (cli-ocr re-read, then cli-translate, pools, ledger), but its re-read keeps cli-ocr's 40% floor,
// which refuses every stranded page by construction (the stored text is another leaf), and its queue is #5021's
// English-side flags. This runner reuses the same two writers and the same pool picker.
/**
 * offleaf-fix-5309 — put each stranded IA page's OWN text back beside its (already right) image (#5309).
 *
 *   node --env-file=.env.production.local scripts/maintenance/offleaf-fix-5309.mjs plan --diagnose F --out DIR
 *   … run --out DIR --diagnose F --wave NAME --max-pages N [--max-book-pages N] [--concurrency 3] [--apply] [--weekly-end 0.25]
 *   … status --out DIR
 *
 * plan   The queue: every page scripts/eval/offleaf-5309/diagnose.mjs lists (the stranded audit's pages; whatever the
 *        diagnosis, since the pre spot check found its `own_like` and `undecided` pages off-leaf too, 10/12 — the
 *        gate decides per page). Books with readers first (human_read_count), then most pages. A held book is listed
 *        and skipped (pipeline_auto.hold), re-checked before each book.
 * run    Per book, N books at once, each on the agy login with most weekly left above its floor:
 *        1. cli-ocr.mjs read (agy gemini-3.8-flash-low, the live OCR prompt, one page a call), then apply --apply with
 *           --stranded=<diagnose> (scripts/lib/stranded-leaf-gate.mjs stands in for the 40% floor; every other guard
 *           stays) and --mark-stale. Run id CLI_RUN_ID=offleaf-5309-<wave> → `offleaf-5309-<wave>-ocr`.
 *        2. A written page drops the #3368 `needs_reocr` flag.
 *        3. Non-English books: cli-translate.mjs read --no-previous-translation (the neighbour's English is often still
 *           another leaf's, and #5026/#8399: context English is what leaks) on the written pages, then apply --apply.
 *           Run id `offleaf-5309-<wave>-tr`. English books are NOT modernised: since #4958 modernisation is
 *           reader-triggered (/api/pages/[id]/modernize), never dispatched.
 *        4. A written page whose English is still the old (wrong-leaf) one — the translation was refused, or the book
 *           is English — has it withheld (`stale_after_reocr`, the old English to page_revisions first).
 *        Every page lands in DIR/ledger.jsonl. Undo: scripts/maintenance/revert-run.mjs --run-id offleaf-5309-<wave>-ocr
 *        (and -tr). A re-run skips books already in the ledger for any wave.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { readPools, agyEnv, poolName, weeklyReserve } from '../lib/agy-pools.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { withholdUpdate, withholdPin, WITHHOLD_REASONS, WITHHOLD_REVISION_SOURCE } from '../lib/stale-translation.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODE = process.argv[2];
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const OUT = path.resolve(arg('out', '.'));
fs.mkdirSync(OUT, { recursive: true });
const F = (f) => path.join(OUT, f);
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const MODEL = 'gemini-3.8-flash-low';
const SWEEP = 'offleaf-5309';
const ENGLISH = /^(english|middle english|early modern english)$/i;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let client, db;
async function open() { client = new MongoClient(process.env.MONGODB_URI); await client.connect(); db = client.db('bookstore'); }

async function plan() {
  const diag = readJsonl(arg('diagnose'));
  const byBook = new Map();
  for (const r of diag) (byBook.get(r.book_id) || byBook.set(r.book_id, []).get(r.book_id)).push(r);
  await open();
  const books = await db.collection('books').find({ id: { $in: [...byBook.keys()] } }, { projection: { id: 1, title: 1, language: 1, visible: 1, human_read_count: 1, 'pipeline_auto.hold.reason': 1 } }).toArray();
  const q = books.map((b) => ({ book_id: b.id, title: String(b.title || '').slice(0, 80), language: b.language, english: ENGLISH.test(b.language || ''), live: b.visible === true,
    reads: b.human_read_count || 0, hold: b.pipeline_auto?.hold?.reason ?? null, pages: byBook.get(b.id).sort((x, y) => x.n - y.n).map((r) => ({ page_id: r.page_id, n: r.n, verdict: r.verdict })) }))
    .sort((a, b) => (b.live - a.live) || (b.reads - a.reads) || (b.pages.length - a.pages.length));
  fs.writeFileSync(F('queue.json'), JSON.stringify(q, null, 1));
  const n = q.reduce((s, b) => s + b.pages.length, 0);
  console.log(`queue: ${n} pages in ${q.length} books (${q.filter((b) => b.english).length} English, ${q.filter((b) => b.hold).length} held, ${q.filter((b) => b.reads > 0).length} with readers)`);
  await client.close();
}

// ── pools (wrong-leaf-fix-5021.mjs's rule: weekly over max(--weekly-end, the reserves), 5-hour bucket over 0.25) ──
const WEEKLY_END = Number(arg('weekly-end', '0.25'));
const FLOOR_5H = 0.25;
let poolCache = { at: 0, pools: [] };
const inUse = new Map();
function poolOpen(r) {
  if (!r) return { open: false, why: 'unread' };
  const line = Math.max(WEEKLY_END, weeklyReserve({ resetTime: r.weeklyReset, lane: null }));
  if (r.weekly < line) return { open: false, why: `weekly ${(100 * r.weekly).toFixed(0)}% < ${(100 * line).toFixed(0)}%` };
  if (typeof r.fiveHour !== 'number' || r.fiveHour < FLOOR_5H) return { open: false, why: `5h ${(100 * (r.fiveHour ?? 0)).toFixed(0)}% < ${100 * FLOOR_5H}%` };
  return { open: true };
}
function pickPool() {
  if (Date.now() - poolCache.at > 10 * 60e3) poolCache = { at: Date.now(), pools: readPools() };
  const ok = poolCache.pools.filter((p) => !p.busy && poolOpen(p.reading).open).sort((a, b) => (inUse.get(poolName(a)) || 0) - (inUse.get(poolName(b)) || 0) || b.reading.weekly - a.reading.weekly);
  return ok[0] ?? null;
}

function run(argv, env, logFile) {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, ['--env-file=.env.production.local', ...argv], { cwd: ROOT, env, stdio: ['ignore', out, out] });
    child.on('close', (code) => { fs.closeSync(out); resolve(code); });
  });
}

async function fixBook(b, wave, pool) {
  const dir = path.join(OUT, wave, b.book_id);
  fs.mkdirSync(dir, { recursive: true });
  const L = path.join(dir, 'run.log');
  const env = agyEnv(pool.home, process.env, { AGY_JOB: SWEEP, TRANSLATE_FOLIO_MARKERS_CLI: '0' });
  const held = await db.collection('books').findOne({ id: b.book_id }, { projection: { 'pipeline_auto.hold.reason': 1 } });
  if (held?.pipeline_auto?.hold) return b.pages.map((p) => ({ ...p, state: 'held', hold: held.pipeline_auto.hold.reason }));
  const ids = path.join(dir, 'ids.json');
  fs.writeFileSync(ids, JSON.stringify(b.pages.map((p) => p.page_id)));
  const ocrDir = path.join(dir, 'ocr');
  const r1 = await run(['scripts/batch/cli-ocr.mjs', 'read', `--page-ids-file=${ids}`, `--out=${ocrDir}`, `--model=${MODEL}`, '--stop-on-quota', `--concurrency=${arg('read-concurrency', '2')}`], env, L);
  if (r1 === 3) return null; // quota: the book stays unledgered and a later run takes it again
  const reason = `#5309 residual: page stranded by the #3368 image repair (its text was read from the shifted image); re-read from the served (repaired) image through agy ${MODEL}, stranded-leaf gate in place of the 40% floor`;
  const t0 = new Date();
  const APPLY = has('apply');
  const r2 = await run(['scripts/batch/cli-ocr.mjs', 'apply', `--out=${ocrDir}`, `--reason=${reason}`, `--stranded=${arg('diagnose')}`, `--mark-stale=${SWEEP}`, ...(APPLY ? ['--apply'] : [])], { ...env, CLI_RUN_ID: `${SWEEP}-${wave}` }, L);
  const sumF = fs.readdirSync(ocrDir).filter((f) => /^apply-summary-.*\.json$/.test(f)).map((f) => path.join(ocrDir, f)).filter((f) => fs.statSync(f).mtimeMs >= t0.getTime()).sort().pop();
  const sum = sumF ? JSON.parse(fs.readFileSync(sumF, 'utf8')) : { written_page_ids: [], skipped_pages: {} };
  const written = new Set(APPLY ? sum.written_page_ids : []);
  const rows = b.pages.map((p) => ({ ...p, ocr_written: written.has(p.page_id), ocr_skip: sum.skipped_pages?.[p.page_id] ?? (written.has(p.page_id) || !APPLY ? null : (fs.existsSync(path.join(ocrDir, `${p.page_id}.meta.json`)) ? 'not written' : 'not read')) }));
  if (!APPLY) { for (const r of rows) r.state = r.ocr_skip ? 'dry-skip' : 'dry-write'; return rows; }
  if (r2 !== 0 && !written.size) return rows.map((r) => ({ ...r, state: `apply exit ${r2}` }));
  // 2. the #3368 flag goes with the stranded text
  if (written.size) await db.collection('pages').updateMany({ id: { $in: [...written] }, needs_reocr: true, needs_reocr_reason: 'jp2-offset-repair-#3368' }, { $unset: { needs_reocr: '', needs_reocr_reason: '' } });
  // 3. translation
  const wrote = rows.filter((r) => r.ocr_written).map((r) => r.page_id);
  let trWritten = new Set();
  if (!b.english && wrote.length) {
    const tids = path.join(dir, 'tr-ids.json');
    fs.writeFileSync(tids, JSON.stringify(wrote));
    const trDir = path.join(dir, 'tr');
    const t1 = new Date();
    const r3 = await run(['scripts/batch/cli-translate.mjs', 'read', `--page-ids-file=${tids}`, `--out=${trDir}`, `--model=${MODEL}`, '--no-previous-translation'], env, L);
    if (r3 === 0 || fs.existsSync(trDir)) {
      await run(['scripts/batch/cli-translate.mjs', 'apply', `--out=${trDir}`, `--reason=#5309 residual: re-translated after the page's stranded (wrong-leaf) OCR was re-read from its own image; no previous-page English in the prompt (#5026)`, '--apply'], { ...env, CLI_RUN_ID: `${SWEEP}-${wave}-tr` }, L);
      trWritten = new Set((await db.collection('pages').find({ id: { $in: wrote }, 'translation.updated_at': { $gte: t1 } }, { projection: { id: 1 } }).toArray()).map((p) => p.id));
      // A page withheld before (2026-10-02's stale_after_reocr, or step 4 of an earlier wave) that now has its own English
      // drops the marker, as wrong-leaf-fix-5021.mjs does; the old English stays in page_revisions.
      if (trWritten.size) await db.collection('pages').updateMany({ id: { $in: [...trWritten] }, 'translation.data': { $exists: true }, translation_withheld: { $exists: true } }, { $unset: { translation_withheld: '' } });
    }
  }
  // 4. withhold the old English a written page still carries
  const left = await db.collection('pages').find({ id: { $in: wrote.filter((id) => !trWritten.has(id)) }, 'translation.data': { $exists: true } }, { projection: { id: 1, page_number: 1, translation: 1 } }).toArray();
  let withheld = new Set();
  if (left.length) {
    const saved = await saveRevisionsBeforeOverwrite(db, left.map((p) => p.id), 'translation', { reason: WITHHOLD_REVISION_SOURCE, keepMeta: true });
    if (saved === left.length) {
      const now = new Date();
      for (const p of left) {
        const u = await db.collection('pages').updateOne({ id: p.id, ...withholdPin(p) }, withholdUpdate(p, WITHHOLD_REASONS.STALE_AFTER_REOCR, now));
        if (u.modifiedCount) withheld.add(p.id);
      }
      await recordSweepAction(db, { sweep: SWEEP, book_id: b.book_id, action: 'withhold-wrong-leaf-english', detail: { wave, pages: left.filter((p) => withheld.has(p.id)).map((p) => p.page_number), why: b.english ? 'English book: modernisation is reader-triggered (#4958)' : 'translation not rewritten after the re-read' } });
    } else log(`  ${b.book_id}: revisions ${saved} != ${left.length}: nothing withheld`);
  }
  await recountBook(db, b.book_id, { reason: SWEEP, now: new Date() });
  return rows.map((r) => ({ ...r, tr_written: trWritten.has(r.page_id), withheld: withheld.has(r.page_id), state: r.ocr_written ? (trWritten.has(r.page_id) ? 'fixed+translated' : b.english ? 'fixed-ocr (English)' : withheld.has(r.page_id) ? 'fixed-ocr, english withheld' : 'fixed-ocr') : 'ocr-not-written' }));
}

async function runWave() {
  const wave = arg('wave');
  if (!wave) throw new Error('--wave NAME');
  if (!arg('diagnose')) throw new Error('--diagnose F (the stranded list the gate reads)');
  const MAX = Number(arg('max-pages', '500'));
  const q = JSON.parse(fs.readFileSync(F('queue.json'), 'utf8'));
  const done = new Set(readJsonl(F('ledger.jsonl')).map((r) => r.book_id));
  const take = [];
  let n = 0;
  // --max-book-pages: leave books bigger than this for a later wave (a top-up for the spot check's one-page-per-book draw)
  const BIG = Number(arg('max-book-pages', 'Infinity'));
  for (const b of q) { if (done.has(b.book_id) || b.hold || b.pages.length > BIG) continue; if (n + b.pages.length > MAX && take.length) continue; take.push(b); n += b.pages.length; if (n >= MAX) break; }
  log(`wave ${wave}: ${n} pages in ${take.length} books${has('apply') ? '' : ' (DRY RUN)'}`);
  await open();
  const conc = Number(arg('concurrency', '3'));
  let stop = null;
  await Promise.all(Array.from({ length: conc }, async () => {
    for (let b = take.shift(); b && !stop; b = take.shift()) {
      const pool = pickPool();
      if (!pool) { stop = 'no agy pool open'; take.unshift(b); break; }
      const name = poolName(pool);
      inUse.set(name, (inUse.get(name) || 0) + 1);
      log(`${b.book_id} (${b.pages.length} pages, ${b.language}, reads ${b.reads}) on ${name}`);
      try {
        const rows = await fixBook(b, wave, pool);
        if (!rows) { stop = `quota on ${name}`; poolCache.at = 0; take.unshift(b); continue; }
        if (has('apply')) for (const r of rows) fs.appendFileSync(F('ledger.jsonl'), JSON.stringify({ wave, book_id: b.book_id, language: b.language, english: b.english, ...r, at: new Date().toISOString() }) + '\n');
        else fs.appendFileSync(F(`dry-${wave}.jsonl`), rows.map((r) => JSON.stringify({ book_id: b.book_id, ...r })).join('\n') + '\n');
        const t = rows.reduce((m, r) => ((m[r.state] = (m[r.state] || 0) + 1), m), {});
        log(`  ${b.book_id}: ${JSON.stringify(t)}`);
      } finally { inUse.set(name, inUse.get(name) - 1); }
    }
  }));
  if (stop) log(`stopped: ${stop}`);
  status();
  await client.close();
}

function status() {
  const led = readJsonl(F('ledger.jsonl'));
  const by = (k) => led.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
  const waves = {};
  for (const r of led) { const w = (waves[r.wave] ||= {}); w[r.state] = (w[r.state] || 0) + 1; }
  const skips = led.filter((r) => r.ocr_skip).reduce((m, r) => { const k = String(r.ocr_skip).replace(/\d+%/, 'N%').slice(0, 70); m[k] = (m[k] || 0) + 1; return m; }, {});
  const res = { pages: led.length, books: new Set(led.map((r) => r.book_id)).size, states: by('state'), waves, ocr_skips: skips };
  fs.writeFileSync(F('status.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
}

const MODES = { plan, run: runWave, status: async () => status() };
if (!MODES[MODE]) { console.error(`mode: ${Object.keys(MODES).join(' | ')}`); process.exit(2); }
await MODES[MODE]();

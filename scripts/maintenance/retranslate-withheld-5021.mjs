#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate-lane.mjs — drives the same readers and the same writer for books held for a
// CLI lane, but only UNTRANSLATED pages of books held with its own reason, and it reads Latin, German, Italian and
// French 4 pages a call (the per_call rows); the #5021 pages must be read ONE page per call, and they are withheld,
// not untranslated, in books held for leaf-shift-5021. scripts/batch/stale-retranslate-6567.mjs --withheld — the
// unset-after-write step is copied from it; it is a Siku-only lane with its own prompt. scripts/maintenance/
// retranslate-pages.mjs — paid Gemini, and this brief allows no paid API.
/**
 * Re-translate the #5021 withheld wrong-leaf pages ONE PAGE PER CALL, each book through its CURRENT routed lane (#5021).
 *
 *   node --env-file=.env.production.local scripts/maintenance/retranslate-withheld-5021.mjs plan  --out=DIR
 *   node --env-file=.env.production.local scripts/maintenance/retranslate-withheld-5021.mjs read  --out=DIR [--parallel=3]
 *   node --env-file=.env.production.local scripts/maintenance/retranslate-withheld-5021.mjs apply --out=DIR [--apply]
 *
 * plan   The pages of scripts/eval/results/translation-leaf-shift-5021/2026-11-03/containment.json (withheld_2026_11_03 and
 *        confirmed_not_withheld) whose English is withheld now (translation_withheld, no translation.data), by book, and
 *        each book's lane from the routing table (translate-core translateLaneForBook): a cli row (agy Gemini 3.8 Flash, or
 *        Opus) is read here; a Batch row is a paid API and is NOT read (listed in DIR/plan.json `paid`).
 * read   Per book, the lane's reader, one page per call: agy rows through cli-translate.mjs read with the folio-marker
 *        pair OFF (TRANSLATE_FOLIO_MARKERS_CLI=0: a pair is two pages a call), never the row's per_call block reader;
 *        Opus rows through claude-translate.mjs read --per-call=1. The row's adoption.ocr_checked goes to the readers'
 *        OCR-first gate, as cli-translate-lane passes it; a book the gate stops is listed and not read. Writes nothing.
 * apply  cli-translate.mjs apply on each book's reads (its guards and translate-core's write door: page_revisions
 *        snapshot, human-edit guard, provenance). Then, on each page the apply wrote (translation.updated_at after its
 *        withheld_at), translation_withheld is unset: the old English stays in page_revisions. Dry run without --apply.
 *        Book holds are never touched here: a hold is released only after the Opus read of the new pages passes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { translateLaneForBook } from '../lib/translate-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CONTAINMENT = path.join(ROOT, 'scripts/eval/results/translation-leaf-shift-5021/2026-11-03/containment.json');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const MODE = process.argv[2];
const OUT = arg('out') && path.resolve(arg('out'));
const APPLY = process.argv.includes('--apply');
if (!['plan', 'read', 'apply'].includes(MODE) || !OUT) { console.error('usage: retranslate-withheld-5021.mjs plan|read|apply --out=DIR [--parallel=3] [--apply]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const JOB = process.env.JOB_NAME || 'retranslate-withheld-5021';
const REASON = '#5021 re-translation of a withheld wrong-leaf page (Opus-confirmed against the scans), one page per call, through its routed lane';

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
try {
  if (MODE === 'plan') {
    const c = JSON.parse(fs.readFileSync(CONTAINMENT, 'utf8'));
    const want = [...c.withheld_2026_11_03, ...c.confirmed_not_withheld];
    const books = new Map((await db.collection('books').find({ id: { $in: want.map((b) => b.book_id) } }, { projection: { id: 1, title: 1, language: 1, publisher: 1, image_source: 1, 'pipeline_auto.hold': 1 } }).toArray()).map((b) => [b.id, b]));
    const plan = { built_at: new Date().toISOString(), cli: [], paid: [], not_withheld: 0 };
    for (const w of want) {
      const book = books.get(w.book_id);
      const pages = await db.collection('pages').find({ book_id: w.book_id, page_number: { $in: w.pages } }, { projection: { id: 1, page_number: 1, translation_withheld: 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray();
      const held = pages.filter((p) => p.translation_withheld && !p.translation?.data);
      plan.not_withheld += pages.length - held.length;
      if (!held.length) continue;
      const lane = translateLaneForBook(book);
      const row = { book_id: w.book_id, title: book.title, language: book.language, hold: book.pipeline_auto?.hold?.reason ?? null, channel: lane.channel, engine: lane.engine, lane_row: lane.row?.id ?? null, ocr_checked: lane.row?.adoption?.ocr_checked ?? null, page_ids: held.map((p) => p.id), pages: held.map((p) => p.page_number) };
      (lane.channel === 'cli' ? plan.cli : plan.paid).push(row);
    }
    fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(plan, null, 1));
    const sum = (rows) => rows.reduce((s, r) => s + r.pages.length, 0);
    const by = {};
    for (const r of [...plan.cli, ...plan.paid]) by[`${r.channel}:${r.engine}`] = (by[`${r.channel}:${r.engine}`] || 0) + r.pages.length;
    console.log(`plan: ${sum(plan.cli)} pages in ${plan.cli.length} books on a cli lane; ${sum(plan.paid)} pages in ${plan.paid.length} books on a paid Batch lane (not read); ${plan.not_withheld} listed pages not withheld now`);
    console.log(by);
  }

  if (MODE === 'read') {
    const plan = JSON.parse(fs.readFileSync(path.join(OUT, 'plan.json'), 'utf8'));
    const PAR = Number(arg('parallel', 3));
    const queue = [...plan.cli];
    const results = [];
    const one = (row) => new Promise((resolve) => {
      const dir = path.join(OUT, row.book_id);
      fs.mkdirSync(dir, { recursive: true });
      const ids = path.join(dir, 'ids.json');
      fs.writeFileSync(ids, JSON.stringify(row.page_ids));
      const opus = row.engine === 'claude-opus-5-5';
      const args = opus
        ? [path.join(ROOT, 'scripts/batch/claude-translate.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, '--model=opus', '--per-call=1', `--job=${JOB}`]
        : [path.join(ROOT, 'scripts/batch/cli-translate.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, '--model=gemini-3.8-flash-low'];
      if (row.ocr_checked) args.push(`--ocr-checked=${row.ocr_checked}`);
      const log = fs.openSync(path.join(dir, 'read.log'), 'w');
      const t0 = Date.now();
      const r = spawnSync(process.execPath, ['--env-file=' + (process.env.SL_ENV_FILE || path.join(ROOT, '.env.production.local')), ...args], { stdio: ['ignore', log, log], env: { ...process.env, TRANSLATE_FOLIO_MARKERS_CLI: '0', CLI_JOB_NAME: JOB }, cwd: ROOT });
      fs.closeSync(log);
      resolve({ book_id: row.book_id, engine: row.engine, pages: row.pages.length, exit: r.status, secs: Math.round((Date.now() - t0) / 1000) });
    });
    // spawnSync blocks the loop, so "parallel" runs one reader per worker process: fork this script per book instead.
    if (process.env.RW5021_CHILD) {
      const row = plan.cli.find((r) => r.book_id === process.env.RW5021_CHILD);
      const res = await one(row);
      fs.appendFileSync(path.join(OUT, 'read-results.jsonl'), JSON.stringify(res) + '\n');
    } else {
      const done = new Set(fs.existsSync(path.join(OUT, 'read-results.jsonl')) ? fs.readFileSync(path.join(OUT, 'read-results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.exit === 0).map((r) => r.book_id) : []);
      const todo = queue.filter((r) => !done.has(r.book_id));
      console.log(`read: ${todo.length} books (${todo.reduce((s, r) => s + r.pages.length, 0)} pages), ${PAR} at a time; ${done.size} already read`);
      const { spawn } = await import('node:child_process');
      await Promise.all(Array.from({ length: PAR }, async () => {
        while (todo.length) {
          const row = todo.shift();
          await new Promise((res) => spawn(process.execPath, [fileURLToPath(import.meta.url), 'read', `--out=${OUT}`], { stdio: 'ignore', env: { ...process.env, RW5021_CHILD: row.book_id } }).on('close', res));
          console.log(`  ${row.book_id} ${row.language} ${row.pages.length} pages read`);
        }
      }));
      for (const l of fs.readFileSync(path.join(OUT, 'read-results.jsonl'), 'utf8').split('\n').filter(Boolean)) results.push(JSON.parse(l));
      console.log(`read results: ${results.filter((r) => r.exit === 0).length} books exit 0, ${results.filter((r) => r.exit !== 0).length} not (see DIR/<book>/read.log)`);
    }
  }

  if (MODE === 'apply') {
    const plan = JSON.parse(fs.readFileSync(path.join(OUT, 'plan.json'), 'utf8'));
    const report = [];
    for (const row of plan.cli) {
      const dir = path.join(OUT, row.book_id);
      if (!fs.existsSync(dir)) continue;
      const reason = `${REASON}: row ${row.lane_row}, ${row.engine}`;
      const r = spawnSync(process.execPath, ['--env-file=' + (process.env.SL_ENV_FILE || path.join(ROOT, '.env.production.local')), path.join(ROOT, 'scripts/batch/cli-translate.mjs'), 'apply', `--out=${dir}`, `--reason=${reason}`, ...(APPLY ? ['--apply'] : [])], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, CLI_JOB_NAME: JOB } });
      fs.writeFileSync(path.join(dir, `apply${APPLY ? '' : '-dry'}.log`), (r.stdout || '') + (r.stderr || ''));
      let unset = 0;
      if (APPLY) {
        const pages = await db.collection('pages').find({ id: { $in: row.page_ids } }, { projection: { id: 1, translation_withheld: 1, 'translation.data': 1, 'translation.updated_at': 1 } }).toArray();
        for (const p of pages) {
          const w = p.translation_withheld;
          if (!w || !p.translation?.data || !(new Date(p.translation.updated_at) > new Date(w.withheld_at))) continue;
          const u = await db.collection('pages').updateOne({ id: p.id, 'translation.updated_at': p.translation.updated_at }, { $unset: { translation_withheld: '' } });
          unset += u.modifiedCount;
        }
      }
      const tail = (r.stdout || '').trim().split('\n').slice(-3).join(' | ');
      report.push({ book_id: row.book_id, engine: row.engine, pages: row.pages.length, exit: r.status, withheld_unset: unset, tail });
      console.log(`  ${row.book_id} ${row.language}: exit ${r.status}${APPLY ? `, withheld marker cleared on ${unset}` : ''} — ${tail.slice(0, 200)}`);
    }
    fs.writeFileSync(path.join(OUT, `apply${APPLY ? '' : '-dry'}-report.json`), JSON.stringify(report, null, 1));
  }
} finally {
  await client.close();
}

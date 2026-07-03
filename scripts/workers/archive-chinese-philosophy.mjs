#!/usr/bin/env node
/**
 * Archive-only driver for the Chinese philosophy acquisition (#2453).
 *
 * The pipeline is globally PAUSED (Gemini spend), so the orchestrator — which
 * does enrollment + archiving + OCR + translation in one worker — exits and
 * nothing archives. To durably preserve these originals on R2 WITHOUT incurring
 * any Gemini/OCR cost, we drive archive-bulk.mjs in its --book-id one-off mode,
 * which bypasses the pause for ARCHIVING ONLY and never touches the shared
 * selective-unpause scope (so the orchestrator never enrolls these for OCR).
 *
 * IA books only (archive-bulk = jp2.zip bulk, fast). Harvard books go via
 * archive-harvard.mjs separately.
 *
 * Idempotent/resumable: archive-bulk skips already-archived pages; this driver
 * pre-filters to books not yet fully archived and records done ids.
 *
 * Run on HETZNER under tmux:
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/archive-chinese-philosophy.mjs --concurrency=5
 *   node scripts/workers/archive-chinese-philosophy.mjs --dry-run
 */
import { MongoClient } from 'mongodb';
import { spawn } from 'child_process';
import fs from 'fs';

const args = process.argv.slice(2);
const getArg = (n) => args.find(a => a.startsWith(`--${n}=`))?.split('=')[1];
const DRY = args.includes('--dry-run');
const CONC = parseInt(getArg('concurrency') || '5', 10);
const PROGRESS = '/root/works-catalog-cache/archive-chinese-progress.json';
const LOG = (m) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${m}\n`);

function runBulk(id) {
  return new Promise((resolve) => {
    const p = spawn('node', ['scripts/workers/archive-bulk.mjs', `--book-id=${id}`, '--page-concurrency=8'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    p.on('close', (code) => {
      const m = out.match(/pages_archived[:=]?\s*(\d+)/i) || out.match(/(\d+)\s*pages? archived/i);
      resolve({ id, code, pages: m ? parseInt(m[1], 10) : null, tail: out.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 160) });
    });
  });
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const books = c.db('bookstore').collection('books');
  // IA philosophy books needing archiving
  const q = { work_id: { $regex: '^(kr:|wd:)' }, hidden: true, 'image_source.provider': 'internet_archive',
    $expr: { $lt: [{ $ifNull: ['$pages_archived', 0] }, '$pages_count'] } };
  const list = await books.find(q, { projection: { id: 1, pages_count: 1, pages_archived: 1 } }).toArray();
  await c.close();

  let done = {};
  if (fs.existsSync(PROGRESS)) done = JSON.parse(fs.readFileSync(PROGRESS, 'utf8'));
  const todo = list.filter(b => !done[b.id]);
  LOG(`IA philosophy books needing archive: ${list.length} | already done this run: ${Object.keys(done).length} | to process: ${todo.length}`);
  if (DRY) { LOG('dry-run — exiting'); return; }
  if (!todo.length) { LOG('nothing to do'); return; }

  let i = 0, ok = 0, fail = 0, pages = 0;
  async function worker() {
    while (i < todo.length) {
      const b = todo[i++];
      const r = await runBulk(b.id);
      if (r.code === 0) { ok++; if (r.pages) pages += r.pages; done[b.id] = r.pages || 'ok'; }
      else { fail++; done[b.id] = `fail:${r.code}`; LOG(`  FAIL ${b.id} code=${r.code} ${r.tail}`); }
      if ((ok + fail) % 25 === 0) { fs.writeFileSync(PROGRESS, JSON.stringify(done)); LOG(`[${ok + fail}/${todo.length}] ok=${ok} fail=${fail} pages~${pages}`); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  fs.writeFileSync(PROGRESS, JSON.stringify(done));
  LOG(`DONE: ok=${ok} fail=${fail} pages~${pages}`);
}
main().catch(e => { console.error(e); process.exit(1); });

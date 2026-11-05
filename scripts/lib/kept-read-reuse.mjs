// PRIOR ART: scripts/lib/candidate-reads.mjs findRead/reuseInto — the reuse step the CLI readers already take, which no
// paid lane called; scripts/lib/ocr-submit-guard.mjs — the submit-time guards against paying twice for a page, which
// cover pages in flight but not pages already read for free and kept. This joins the two (#7075).
/**
 * Before a PAID lane buys a page, apply any usable read of it we already kept (#7075).
 *
 * Derek, 2026-10-26: "we will need to get them all read at some point through the router … record the reads so we
 * don't need to do it multiple times". The CLI readers keep every read in R2 candidate-reads/ and reuse it themselves,
 * but the paid lanes (batch OCR in pipeline-orchestrator, the chained translation lane) only look at `ocr.data` /
 * `translation.data`. A read kept but never applied was bought again.
 *
 *   reuseKeptReads(db, { bookId, field: 'ocr'|'translation', pageIds, minModel, log })
 *     -> { considered, applied, appliedIds: Set, byModel }
 *
 * HOW. It never re-implements a write. For each model that has kept reads of these pages (best first) it runs the
 * reader's own `read --reuse-only` (which matches a kept read by model, exact prompt, and the page's CURRENT input:
 * the image sha256 for OCR, the OCR hash for a translation, so a read of a since-re-split image is never reused) and
 * then the reader's own `apply --apply` (every write guard, provenance block with api 'cli', page_revisions snapshot).
 * A page with no matching kept read, or one apply refuses, is simply still unread and the paid lane buys it: nothing
 * here can strand a page.
 *
 * WHICH READS. Only models at least as good as the lane's (modelRank below). An unknown model is never reused.
 *
 * BEST EFFORT. Any failure logs one line and returns what was applied so far; the caller re-selects its pages from
 * the database afterwards. KEPT_READ_REUSE=off turns it off.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listKeptReads } from './candidate-reads.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const READER = { ocr: 'scripts/batch/cli-ocr.mjs', translation: 'scripts/batch/cli-translate.mjs' };
const STEP_TIMEOUT_MS = 20 * 60 * 1000;

/** 0 = unknown (never reused); higher = better. Lite is what the paid lanes run. */
export function modelRank(model) {
  const m = String(model || '').toLowerCase();
  if (!m) return 0;
  if (/opus|claude/.test(m)) return 4;
  if (/gemini.*pro/.test(m)) return 3;
  if (/gemini.*flash-lite|gemini.*-lite\b/.test(m)) return 1;
  if (/gemini.*flash/.test(m)) return 2;
  return 0;
}

function run(args, log) {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: ROOT, env: { ...process.env, CLI_JOB_NAME: 'kept-read-reuse' }, timeout: STEP_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const tail = String(stdout || '').trim().split('\n').slice(-2).join(' | ');
      if (err) log(`    kept-read reuse: ${path.basename(args[0])} ${args[1]} failed: ${String(err.message).split('\n')[0]}`);
      else if (tail) log(`    kept-read reuse: ${tail}`);
      resolve(!err);
    });
  });
}

export async function reuseKeptReads(db, { bookId, field, pageIds, minModel = 'gemini-3.1-flash-lite', log = console.log } = {}) {
  const none = { considered: 0, applied: 0, appliedIds: new Set(), byModel: {} };
  if (process.env.KEPT_READ_REUSE === 'off' || !bookId || !READER[field] || !pageIds?.length) return none;
  const want = new Set(pageIds);
  // A page whose text was WITHHELD (contained as invented or wrong-leaf, withhold-stale-translations.mjs) is waiting
  // for a fresh read; a kept read of it may be the very text that was withdrawn. Never hand one back.
  const withheld = await db.collection('pages').find(
    { id: { $in: [...want] }, [`${field}_withheld`]: { $exists: true } }, { projection: { _id: 0, id: 1 } }).toArray();
  for (const p of withheld) want.delete(p.id);
  if (!want.size) return none;
  const floor = Math.max(1, modelRank(minModel));
  const kept = (await listKeptReads(bookId, field, [...want])).filter((k) => want.has(k.page_id) && modelRank(k.model) >= floor);
  if (!kept.length) return none;

  const byModel = new Map();
  for (const k of kept) byModel.set(k.model, (byModel.get(k.model) || new Set()).add(k.page_id));
  const models = [...byModel.keys()].sort((a, b) => modelRank(b) - modelRank(a));
  const considered = new Set(kept.map((k) => k.page_id));
  log(`    kept-read reuse: ${considered.size} page(s) of ${bookId} have kept ${field} reads (${models.join(', ')}); applying before paying`);

  const textField = `${field}.data`;
  const stillUnread = async (ids) => new Set((await db.collection('pages').find(
    { id: { $in: [...ids] }, $or: [{ [textField]: { $exists: false } }, { [textField]: null }, { [textField]: '' }] },
    { projection: { _id: 0, id: 1 } }).toArray()).map((p) => p.id));

  const tally = {};
  try {
    for (const model of models) {
      const ids = await stillUnread(byModel.get(model));
      if (!ids.size) continue;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kept-reuse-${field}-`));
      const idsFile = path.join(dir, 'page-ids.json');
      fs.writeFileSync(idsFile, JSON.stringify([...ids]));
      const out = path.join(dir, 'reads');
      const ok = await run([READER[field], 'read', '--reuse-only', `--page-ids-file=${idsFile}`, `--out=${out}`, `--model=${model}`, '--job=kept-read-reuse'], log)
        && await run([READER[field], 'apply', `--out=${out}`, `--reason=kept read applied before a paid lane bought the page (#7075)`, '--apply'], log);
      const after = await stillUnread(ids);
      tally[model] = ids.size - after.size;
      fs.rmSync(dir, { recursive: true, force: true });
      if (!ok) break;
    }
  } catch (e) {
    log(`    kept-read reuse: stopped on ${e.message}; the paid lane takes the rest`);
  }
  const unread = await stillUnread(considered);
  const appliedIds = new Set([...considered].filter((id) => !unread.has(id)));
  return { considered: considered.size, applied: appliedIds.size, appliedIds, byModel: tally };
}

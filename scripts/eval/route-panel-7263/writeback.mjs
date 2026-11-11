#!/usr/bin/env node
// PRIOR ART: scripts/eval/queue-routes-7853/writeback.mjs (one lane apply per page from the arm's own read directory, dry
// unless --apply, every outcome listed; its paths are wired to that test's arms and OUT) and arms.mjs trDryApply (the
// one-page directory, because cli-translate's apply has no --only; not exported, arms.mjs runs its stage on import).
/**
 * The panel's write-back (brief, feedback from Derek 2026-10-27). Latin: each page's best judged read. German: the best
 * judged read only where it beats the stored English or none exists. Greek is held (#6694): refused here by name.
 * Every write goes through the lane's own apply and its guards. Dry run unless --apply. Page-level outcomes stay in
 * OUT/<cell>/writeback-<dry|applied>.json (scratch, then private R2); this prints counts.
 *   node --env-file=... writeback.mjs --cell=latin|german [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { ROOT, ENV_FILE, PANEL_LANE, arg, flag, cellOf, selected, jsonl, sha, readText, writeJ } from './lib.mjs';
import { seriousSpans } from '../confidence-7866/regrade.mjs';
import { translateLaneForBook } from '../../lib/translate-core.mjs';

const APPLY = flag('apply');
const cell = cellOf(arg('cell'));
if (!['latin', 'german'].includes(cell.name) || !cell.writes) throw new Error(`no write on ${cell.name}: Greek is held (#6694), measure only`);
const CLI = path.join(ROOT, 'scripts/batch/cli-ocr.mjs'), CLI_TR = path.join(ROOT, 'scripts/batch/cli-translate.mjs');
const TIE = { latin: ['read4', 'corr', 'pero4'], german: ['tr4', 'tr1'] }[cell.name];   // cheaper first
const REASON = `#7263 route panel 1 write-back: the judged best read of a random page, accepted by the blind Opus judge against the image`;
const node = (args) => spawnSync(process.execPath, [`--env-file=${ENV_FILE}`, ...args], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, AGY_JOB: 'route-panel-1-7263-writeback', AGY_HOME: cell.agy_home } });
const norm = (t) => String(t).trim();
const hash = (t) => sha(norm(t)).slice(0, 16);

const V = new Map(jsonl(path.join(cell.dir, 'verdicts-opus.jsonl')).filter((r) => r.verdict && r.set === 'abs').map((r) => [`${r.key}:${r.text_sha}`, r.verdict]));
const judgedOf = (s, label) => { const t = readText(cell, s.key, label); if (t == null || !norm(t)) return null; const v = V.get(`${s.key}:${hash(t)}`); return v ? { label, text: t, hash: hash(t), v, fid: Number(v.fidelity), serious: seriousSpans(v) } : null; };
const better = (a, b) => (b.v.accept - a.v.accept) || (b.fid - a.fid) || (a.serious - b.serious) || (TIE.indexOf(a.label) - TIE.indexOf(b.label));

function choose(s) {
  const st = judgedOf(s, 'stored'), best = TIE.map((a) => judgedOf(s, a)).filter(Boolean).sort(better)[0];
  if (!best) return { skip: 'no judged read' };
  if (!best.v.accept) return { skip: 'best read not accepted' };
  if (cell.name === 'latin') {
    if (!st) return { skip: 'stored text not judged' };
    if (best.hash === st.hash) return { skip: 'best read is the stored text' };
    if (best.fid < st.fid || best.serious > st.serious) return { skip: 'stored judged better' };
    return { best };
  }
  const stored = readText(cell, s.key, 'stored');
  if (stored == null || !norm(stored)) return { best };
  if (!st) return { skip: 'stored English not judged' };
  if (best.hash === st.hash) return { skip: 'best read is the stored text' };
  if ((best.v.accept && !st.v.accept) || (best.fid > st.fid && best.serious < st.serious)) return { best };
  return { skip: 'does not beat the stored English' };
}
const summaryAfter = (dir, t0, write) => { const f = fs.readdirSync(dir).filter((x) => (write ? /^apply-summary-(?!refused|dry)/ : /^apply-summary-dry/).test(x)).map((x) => path.join(dir, x)).filter((x) => fs.statSync(x).mtimeMs >= t0).sort().pop(); return f ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; };
function applyOcr(s, best, write) {
  const dir = path.join(cell.dir, best.label, s.book_id);
  const only = path.join(dir, 'wb-only.json'); fs.writeFileSync(only, JSON.stringify([s.page_id]));
  const emit = path.join(dir, 'wb-emit.jsonl'); fs.rmSync(emit, { force: true });
  const extra = best.label === 'read4' ? [`--lane=${PANEL_LANE}`, '--print-only', `--mark-stale=${PANEL_LANE}`] : [`--mark-stale=${PANEL_LANE}`];
  const t0 = Date.now() - 1000;
  const r = node([CLI, 'apply', `--out=${dir}`, `--only=${only}`, `--reason=${REASON} (${cell.arms[best.label].route})`, `--emit-written=${emit}`, ...extra, ...(write ? ['--apply'] : [])]);
  const sm = summaryAfter(dir, t0, write), text = jsonl(emit).find((x) => x.page_id === s.page_id)?.text ?? null;
  return { exit: r.status, written: text != null, same_as_judged: text != null && hash(text) === best.hash, run: sm.run ?? null, skipped: sm.skipped_pages?.[s.page_id] ?? null };
}
function applyTr(s, best, write) {
  const dir = path.join(cell.dir, best.label, s.book_id), ad = path.join(dir, 'apply-one');
  fs.rmSync(ad, { recursive: true, force: true }); fs.mkdirSync(ad, { recursive: true });
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`${s.page_id}.`))) fs.copyFileSync(path.join(dir, f), path.join(ad, f));
  if (fs.existsSync(path.join(dir, 'prompts'))) fs.cpSync(path.join(dir, 'prompts'), path.join(ad, 'prompts'), { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(ad, `${s.page_id}.meta.json`), 'utf8'));
  if (m.prompt_sent_file && fs.existsSync(path.join(dir, m.prompt_sent_file))) { fs.mkdirSync(path.dirname(path.join(ad, m.prompt_sent_file)), { recursive: true }); fs.copyFileSync(path.join(dir, m.prompt_sent_file), path.join(ad, m.prompt_sent_file)); }
  const r = node([CLI_TR, 'apply', `--out=${ad}`, `--reason=${REASON} (${cell.arms[best.label].route})`, ...(write ? ['--apply'] : [])]);
  const out = r.stdout || '', raw = fs.readFileSync(path.join(ad, `${s.page_id}.txt`), 'utf8');
  return { exit: r.status, written: new RegExp(write ? 'WRITE p\\.' : 'would write p\\.').test(out), same_as_judged: hash(raw) === best.hash, run: /run (cli-translate-\d+)/.exec(out)?.[1] ?? null, skipped: /skip p\.\S*: (.*)/.exec(out)?.[1] ?? null };
}

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const log = [], looked = new Set(jsonl(path.join(cell.dir, 'verdicts-opus.jsonl')).filter((r) => r.set === 'abs').map((r) => r.key));
for (const s of selected(cell).filter((x) => looked.has(x.key))) {
  const c = choose(s);
  if (c.skip) { log.push({ page_id: s.page_id, book_id: s.book_id, skip: c.skip }); continue; }
  const book = await db.collection('books').findOne({ id: s.book_id }), page = await db.collection('pages').findOne({ id: s.page_id }, { projection: { ocr: 1, translation: 1 } });
  const storedNow = cell.task === 'ocr' ? page?.ocr?.data : page?.translation?.data;
  const storedThen = readText(cell, s.key, 'stored');
  // A later writer's text was never judged: leave it. (Latin) a stale flag on a book the table does not send to a cli lane could queue paid lanes.
  if (norm(storedNow ?? '') !== norm(storedThen ?? '')) { log.push({ page_id: s.page_id, book_id: s.book_id, skip: 'stored text changed since the draw' }); continue; }
  if (cell.name === 'latin' && translateLaneForBook(book).channel !== 'cli') { log.push({ page_id: s.page_id, book_id: s.book_id, skip: 'book is not on a cli translation lane' }); continue; }
  const fn = cell.task === 'ocr' ? applyOcr : applyTr;
  const dry = fn(s, c.best, false);
  if (!dry.written || !dry.same_as_judged) { log.push({ page_id: s.page_id, book_id: s.book_id, arm: c.best.label, skip: dry.written ? 'lane would write another text than the judged one' : `lane refused: ${dry.skipped ?? 'no reason'}` }); continue; }
  const res = APPLY ? fn(s, c.best, true) : dry;
  log.push({ page_id: s.page_id, book_id: s.book_id, arm: c.best.label, apply: APPLY, had_translation: !!page?.translation?.data, ...res });
}
await client.close();
writeJ(path.join(cell.dir, `writeback-${APPLY ? 'applied' : 'dry'}.json`), { at: new Date().toISOString(), pages: log });
const tally = (f) => log.reduce((a, r) => { const k = f(r); if (k) a[k] = (a[k] ?? 0) + 1; return a; }, {});
console.log(JSON.stringify({ cell: cell.name, apply: APPLY, pages: log.length, written: log.filter((r) => r.written).length, by_arm: tally((r) => r.written && r.arm), stale_candidates: log.filter((r) => r.written && r.had_translation).length, skipped: tally((r) => r.skip), runs: [...new Set(log.map((r) => r.run).filter(Boolean))] }, null, 1));

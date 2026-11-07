// PRIOR ART: scripts/eval/queue-routes-7853/lib.mjs (seeded helpers, imageFor, jsonl; its OUT and ARMS are fixed at module
// level, so they are restated here per cell) and scripts/eval/router-confirm/confirm.mjs (the page rule, restated in
// draw.mjs because its frameFor takes Flash-Lite queues only). What is new: three cells, a stop rule read in batches.
/**
 * Shared pieces of the first route panel (#7263; scripts/eval/experiments/2026-11-04-route-panel-1-prereg-7263.md).
 * Bulky files live in OUT ($JOB_SCRATCH/panel); the committed results are in scripts/eval/route-judge-6740/results/.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');
export const ENV_FILE = '/root/sourcelibrary/.env.production.local';
export const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
export const flag = (n) => process.argv.includes(`--${n}`);
export const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || '/tmp', 'panel'));
export const PANEL_LANE = 'route-panel-1-7263';
export const AGY_MODEL = 'gemini-3.8-flash-low';
export const SEED = 72631;
export const SURPLUS = 130;   // drawn per cell; the stop rule's cap is 100, the rest replaces a page that is no page
export const CAP = 100;
export const OPUS_CAP = 1300;
export const OCR_CHECKED = 'eval reads #7263 panel; the judge reads each page against its image';

export const CELLS = Object.freeze({
  latin: {
    id: 'latin-flash3/print', base: 'latin-flash3', task: 'ocr', lang: 'Latin', re: '^Latin', agy_home: '/root/.agy-james',
    arms: {
      read4: { route: 'agy-flash-low@4-read', kind: 'read', per_call: 4 },
      pero4: { route: 'pero>agy-flash-low@4', kind: 'gpu', per_call: 4, draft_source: 'pero' },
      corr: { route: '3flash>agy-flash-low', kind: 'correct', per_call: 1, draft_source: '3flash' },
      stored: { route: '3flash', kind: 'stored', tier: 1 },
    },
    pairs: [['read4', 'corr'], ['pero4', 'corr'], ['pero4', 'read4']], repeat: 'read4', writes: true,
  },
  greek: {
    id: 'greek-flash3/print', base: 'greek-flash3', task: 'ocr', lang: 'Greek', re: '^Greek', agy_home: '/root/.agy-milo',
    arms: {
      read4: { route: 'agy-flash-low@4-read', kind: 'read', per_call: 4 },
      stored: { route: '3flash', kind: 'stored' },
    },
    pairs: [['read4', 'stored']], repeat: 'read4', writes: false,   // Greek is held (Derek 2026-10-14, #6694): measure only
  },
  german: {
    id: 'german-tr-lite/print', base: 'german-tr-lite', task: 'translation', lang: 'German', re: '^German', agy_home: '/root/.agy-milo',
    arms: {
      tr1: { route: 'agy-flash-low-tr@1', kind: 'tr1', per_call: 1 },
      tr4: { route: 'agy-flash-low-tr@4', kind: 'tr4', per_call: 4 },
      stored: { route: 'flash-lite', kind: 'stored' },
    },
    pairs: [['tr1', 'stored'], ['tr4', 'stored'], ['tr4', 'tr1']], repeat: 'tr4', writes: true,
  },
});
export const cellOf = (name) => { const c = CELLS[name]; if (!c) throw new Error(`--cell must be one of ${Object.keys(CELLS).join(', ')}`); return { ...c, name, dir: path.join(OUT, name) }; };

export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const writeJ = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(x, null, 1)); };
/** One U in (0, 1) from a string: the draw's keys and positions do not depend on visit order. */
export const unit = (s) => (parseInt(sha(s).slice(0, 13), 16) + 0.5) / 2 ** 52;
export const shuffleBy = (xs, salt, idOf = (x) => x) => [...xs].sort((a, b) => unit(`${salt}:${idOf(a)}`) - unit(`${salt}:${idOf(b)}`));
export const textFile = (cell, key, arm) => path.join(cell.dir, 'texts', `${key}.${arm}.txt`);
export const readText = (cell, key, arm) => { const f = textFile(cell, key, arm); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
export const writeText = (cell, key, arm, t) => { fs.mkdirSync(path.join(cell.dir, 'texts'), { recursive: true }); fs.writeFileSync(textFile(cell, key, arm), t); };
export const selected = (cell) => readJ(path.join(cell.dir, 'selected.json')).selected;

/** Fetch once: the same bytes for every judge call of a page. */
export async function imageBytes(cell, key, url) {
  const f = path.join(cell.dir, 'img', `${key}.jpg`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  let last = null;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/7263 (https://sourcelibrary.org)' } });
      if (!r.ok) { last = new Error(`image HTTP ${r.status}`); await new Promise((d) => setTimeout(d, 3000 * (a + 1))); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) { last = new Error('image under 2 KB'); continue; }
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
      return buf;
    } catch (e) { last = e; }
  }
  throw last;
}
/** Run fn over items, `conc` at a time, until done or fn returns 'stop'. */
export async function pool(items, conc, fn) {
  let i = 0, stop = false;
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < items.length) { if (await fn(items[i++]) === 'stop') stop = true; } }));
  return stop;
}

const tokensOf = (u) => (Array.isArray(u) ? u : u ? [u] : []).reduce((a, x) => a + (Number(x?.total ?? x?.total_tokens) || Number(x?.input ?? 0) + Number(x?.output ?? 0) || 0), 0);
/** Calls and tokens of a read dir: blocks from calls.jsonl (one row a call), other reads from their metas; a reused read costs 0. */
export function costOf(dir) {
  const blocks = jsonl(path.join(dir, 'calls.jsonl')).filter((c) => !c.guard);
  const callIds = new Set(blocks.map((c) => c.call_id));
  const metas = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const single = metas.filter((m) => !m.call_id || !callIds.has(m.call_id));
  return {
    calls: blocks.reduce((a, c) => a + (c.calls || 1), 0) + single.reduce((a, m) => a + (m.reused_from ? 0 : m.calls || 1), 0),
    tokens: blocks.reduce((a, c) => a + tokensOf(c.usage), 0) + single.reduce((a, m) => a + (m.reused_from ? 0 : tokensOf(m.usage ?? m.call_usage)), 0),
    pages_read: metas.length, reused: metas.filter((m) => m.reused_from).length,
  };
}

/** Refused, filter-cut and failed reads are reported apart from misreads; each counts against the arm. */
export function category(why) {
  const w = String(why || '');
  if (/UNCHANGED/i.test(w)) return 'unchanged';
  if (/CONTAIN/i.test(w)) return 'contain';
  if (/check by eye|% of its words|% of the draft|diff-guard/i.test(w)) return 'guard';   // the lane's own diff or overlap guard
  if (/filter|recitation|cut|truncat|wrapper|MAX_TOKENS|finish/i.test(w)) return 'filter_cut';
  if (/refus|chatter|not a translation|never opened|safety|blocked/i.test(w)) return 'refused';
  return /exit -9/.test(w) ? 'killed' : 'failed';
}


#!/usr/bin/env node
// PRIOR ART: scripts/batch/claude-translate.mjs (the sealed `claude -p` call, subscription env strip, usage-limit
// classing — copied here, it is not exported) and scripts/eval/opus-tib-sa-6948/audit.mjs (fetchImage — its field
// order is photo_original first, which is the unsplit spread on split books; this reads display_photo, the leaf the
// reader sees). The 2026-10-13 by-eye check (#5021) used Opus subagents on one page per flagged book; this asks, per
// flagged RUN, about every page of the run with both neighbours' leaves attached, so a whole run is confirmed or not.
/**
 * leaf-shift-confirm-5021 — does the English of a flagged run render its own leaf or a neighbour's? (#5021)
 * Reads Mongo and page images; writes files under --out only. One `claude -p --model opus` call per flagged run.
 *
 * Input: the jsonl that translation-leaf-shift.mjs --frame … writes (one line per book, `runs`, `tier`).
 * For each selected book, up to --max-runs runs (strong runs first); for each run, the pages start..end (at most
 * --max-run-pages of them) and one leaf either side. Each call gets: every window leaf's image (display_photo, else
 * photo, else archived_photo, resized to ≤ 1,400 px) and transcription, and the English readers are shown on each run
 * page. It is NOT told the direction flagged, the tier, or that a shift is expected on any given page.
 * Verdict per run page: own | next | prev | other | mixed | cannot_tell, with a quoted piece of evidence.
 *
 * Selection: every flagged book when there are ≤ --select of them; otherwise a seeded random --select stratified by
 * tier (proportional allocation), tier A called first. Results are checkpointed per run in <out>/results.jsonl.
 * A page whose English is already withheld is not sent (no live English to judge); --as-of rebuilds the English from
 * page_revisions as translation-leaf-shift.mjs does (for the controls, which are withheld).
 *
 *   node --env-file=.env.production.local scripts/audit/leaf-shift-confirm-5021.mjs \
 *     --flagged <dir or file.jsonl> --out <dir> [--select 300] [--seed 5021] [--concurrency 4]
 *     [--max-runs 3] [--max-run-pages 6] [--book <id> --run <start-end> --as-of <ISO>] [--plan]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { claudeBlocked, noteLimitHit } from '../lib/model-limits.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const OUT = path.resolve(arg('out', `${process.env.JOB_SCRATCH || '/tmp'}/leaf-shift-confirm`));
const SELECT = Number(arg('select', '300'));
const SEED = Number(arg('seed', '5021'));
const CONC = Math.min(4, Number(arg('concurrency', '4')));
const MAX_RUNS = Number(arg('max-runs', '3'));
const MAX_RUN_PAGES = Number(arg('max-run-pages', '6'));
const MODEL = arg('model', 'opus');
const TEXT_MAX = 3500;

const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;
// `claude -p` prefers an API key over the subscription login, and node --env-file loads one: strip it (#6553).
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }

function claudeCall(prompt, cwd) {
  const blocked = claudeBlocked();
  if (blocked) return Promise.resolve({ text: '', cls: 'usage_limit', err: blocked.reason, secs: 0, not_called: true });
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('claude', ['-p', '--model', MODEL, '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '').trim();
      const failed = j.is_error || code !== 0;
      const cls = failed && USAGE_LIMIT.test(text + out + err) ? 'usage_limit' : code === null ? 'timeout' : failed ? `exit_${code}` : !text ? 'empty' : null;
      if (cls === 'usage_limit') noteLimitHit('claude', { reason: (err || text).slice(-200) });
      resolve({ text, cls, model: Object.keys(j.modelUsage || {})[0] || null, usage: j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens, cache_read: j.usage.cache_read_input_tokens, turns: j.num_turns } : null, err: (err || (failed ? text : '')).slice(-300), secs: (Date.now() - t0) / 1000 });
    });
  });
}

const isImage = (b) => b && b.length > 4 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0x52 && b[1] === 0x49) || (b[0] === 0x47 && b[1] === 0x49) || (b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d) || (b[0] === 0x00 && b[1] === 0x00));
async function fetchLeaf(page, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 3000) return 'cached';
  const sharp = (await import('sharp')).default;
  for (const f of ['display_photo', 'photo', 'archived_photo', 'photo_original']) {
    const url = page[f];
    if (!url || !/^https?:/.test(url)) continue;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-audit/5021' }, signal: AbortSignal.timeout(90e3) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 3000 || !isImage(buf)) continue;
      await sharp(buf, { limitInputPixels: false }).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(file);
      return f;
    } catch { /* next field */ }
  }
  return null;
}

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (xs, rnd) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clip = (s) => { s = String(s || '').trim(); return s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX)} […]` : s; };

export function buildPrompt(book, window, runPages) {
  const lines = [];
  lines.push(`You are checking whether the English translation shown on a page renders the text printed on THAT page, or the text of a neighbouring page. (A translation step sometimes shifts the text by one leaf, so a page shows the English of the page before or after it.)`);
  lines.push('');
  lines.push(`Book: "${book.title}" (language: ${book.language || 'unknown'}). Below are ${window.length} consecutive pages. For each page you get its scan image file — open EVERY image with the Read tool — and a machine transcription (OCR) of the scan, which can be wrong; trust the image. For some pages you also get the English that readers are shown on that page.`);
  lines.push('');
  for (const p of window) {
    lines.push(`=== Page ${p.page_number} ===`);
    lines.push(p.image ? `Image file: ${p.image}` : 'Image: (not available)');
    lines.push(`Transcription of page ${p.page_number}:`);
    lines.push('<<<');
    lines.push(clip(p.ocr) || '(empty)');
    lines.push('>>>');
    if (runPages.includes(p.page_number)) {
      lines.push(`English shown on page ${p.page_number}:`);
      lines.push('<<<');
      lines.push(clip(p.tr));
      lines.push('>>>');
    }
    lines.push('');
  }
  lines.push(`For EACH page that has English shown (pages ${runPages.join(', ')}), decide which page's printed text that English renders:`);
  lines.push(`- own: this page's own text (a sentence carried across the page edge, or a few omissions, is still own)`);
  lines.push(`- next: mainly the FOLLOWING page's text`);
  lines.push(`- prev: mainly the PRECEDING page's text`);
  lines.push(`- mixed: substantial parts of two different pages`);
  lines.push(`- other: text from none of these pages (elsewhere in the book, invented, or a comment instead of a translation)`);
  lines.push(`- cannot_tell: the images and transcriptions do not let you decide`);
  lines.push(`Evidence: one short phrase from the English and the matching words of the original (in the original language) with the page number you found them on.`);
  lines.push('');
  lines.push(`Answer with JSON only, no code fence: {"pages":[{"page":N,"verdict":"own|next|prev|mixed|other|cannot_tell","evidence":"..."}]}`);
  return lines.join('\n');
}

function parseVerdicts(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { const j = JSON.parse(text.slice(a, b + 1)); return Array.isArray(j.pages) ? j.pages : null; } catch { return null; }
}

function loadFlagged(src) {
  const files = fs.statSync(src).isDirectory() ? fs.readdirSync(src).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(src, f)) : [src];
  const out = new Map();
  for (const f of files) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.flagged) out.set(j.book_id, { ...j, frame: path.basename(f).split('.')[0] });
  }
  return [...out.values()];
}

export function selectBooks(flagged, n, seed) {
  const rnd = mulberry32(seed);
  const byTier = { A: flagged.filter((b) => b.tier === 'A'), B: flagged.filter((b) => b.tier === 'B') };
  if (flagged.length <= n) return { picked: [...byTier.A, ...byTier.B], quota: { A: byTier.A.length, B: byTier.B.length } };
  const qa = Math.round((n * byTier.A.length) / flagged.length);
  const quota = { A: qa, B: n - qa };
  const sortId = (xs) => [...xs].sort((x, y) => (x.book_id < y.book_id ? -1 : 1));
  return { picked: [...shuffle(sortId(byTier.A), rnd).slice(0, quota.A), ...shuffle(sortId(byTier.B), rnd).slice(0, quota.B)], quota };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const resultsFile = path.join(OUT, 'results.jsonl');
  let jobs;
  if (arg('book')) {
    const [s, e] = arg('run').split('-').map(Number);
    jobs = [{ book: { book_id: arg('book'), tier: 'control', runs: [] }, run: { dir: '?', start: s, end: e, strong: null, control: true } }];
  } else {
    const flagged = loadFlagged(arg('flagged'));
    const { picked, quota } = selectBooks(flagged, SELECT, SEED);
    fs.writeFileSync(path.join(OUT, 'selection.json'), JSON.stringify({ flagged: flagged.length, byTier: { A: flagged.filter((b) => b.tier === 'A').length, B: flagged.filter((b) => b.tier === 'B').length }, quota, seed: SEED, picked: picked.map((b) => b.book_id) }, null, 1));
    jobs = [];
    for (const b of picked) {
      const runs = [...b.runs].sort((x, y) => (y.strong - x.strong) || (y.voting - x.voting) || (x.start - y.start)).slice(0, MAX_RUNS);
      for (const r of runs) jobs.push({ book: b, run: r });
    }
    console.error(`flagged ${flagged.length} books; selected ${picked.length} (quota ${JSON.stringify(quota)}); ${jobs.length} runs to call`);
    if (argv.includes('--plan')) return;
  }
  const done = new Set(fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return j.cls === 'usage_limit' ? null : `${j.book_id}:${j.run.start}-${j.run.end}`; }).filter(Boolean) : []);
  const queue = jobs.filter((j) => !done.has(`${j.book.book_id}:${j.run.start}-${j.run.end}`));
  console.error(`${queue.length} runs left (${done.size} done)`);
  if (!spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout) throw new Error('claude CLI not on PATH');

  const { MongoClient, ObjectId } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred', maxPoolSize: 6 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const asOf = arg('as-of') ? new Date(arg('as-of')) : null;
  let stop = false, n = 0;
  const worker = async () => {
    for (let job = queue.shift(); job && !stop; job = queue.shift()) {
      const { book, run } = job;
      const last = Math.min(run.end, run.start + MAX_RUN_PAGES - 1);
      const or = [{ id: book.book_id }];
      if (/^[0-9a-f]{24}$/i.test(book.book_id)) or.push({ _id: new ObjectId(book.book_id) });
      const meta = await db.collection('books').findOne({ $or: or }, { projection: { title: 1, language: 1 } }) || { title: book.title, language: book.language };
      const pages = await db.collection('pages').find({ book_id: book.book_id, page_number: { $gte: run.start - 1, $lte: last + 1 } },
        { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.source': 1, 'translation.edited_by': 1, translation_withheld: 1, display_photo: 1, photo: 1, archived_photo: 1, photo_original: 1 } }).sort({ page_number: 1 }).toArray();
      if (asOf) {
        const revs = await db.collection('page_revisions').find({ page_id: { $in: pages.map((p) => p.id) }, field: 'translation', created_at: { $gt: asOf } }).sort({ created_at: 1 }).toArray();
        const first = new Map(); for (const r of revs) if (!first.has(r.page_id)) first.set(r.page_id, r);
        for (const p of pages) if (typeof first.get(p.id)?.data === 'string') p.translation = { ...(p.translation || {}), data: first.get(p.id).data };
      }
      const runPages = pages.filter((p) => p.page_number >= run.start && p.page_number <= last && String(p.translation?.data || '').trim()).map((p) => p.page_number);
      const row = { book_id: book.book_id, title: String(meta.title || '').slice(0, 90), language: meta.language || null, tier: book.tier, frame: book.frame || null, run: { dir: run.dir, start: run.start, end: run.end, strong: run.strong, strict: run.strict, tail: run.tail ?? null, voting: run.voting }, sent: runPages };
      if (!runPages.length) {
        fs.appendFileSync(resultsFile, JSON.stringify({ ...row, cls: 'no_live_english' }) + '\n');
        continue;
      }
      const dir = path.join(OUT, 'calls', `${book.book_id}-${run.start}-${run.end}`);
      fs.mkdirSync(dir, { recursive: true });
      const window = [];
      for (const p of pages) {
        const img = `p${p.page_number}.jpg`;
        const got = await fetchLeaf(p, path.join(dir, img));
        window.push({ page_number: p.page_number, image: got ? img : null, ocr: p.ocr?.data || '', tr: p.translation?.data || '' });
      }
      const prompt = buildPrompt(meta, window, runPages);
      fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
      const r = await claudeCall(prompt, dir);
      const verdicts = r.cls ? null : parseVerdicts(r.text);
      const human = pages.filter((p) => runPages.includes(p.page_number) && (p.translation?.source === 'human' || p.translation?.edited_by)).map((p) => p.page_number);
      fs.appendFileSync(resultsFile, JSON.stringify({ ...row, images: window.filter((w) => w.image).length, human, cls: r.cls || (verdicts ? null : 'unparsed'), verdicts, model: r.model, usage: r.usage, secs: r.secs, ...(verdicts ? {} : { raw: r.text.slice(0, 1500), err: r.err }) }) + '\n');
      if (r.cls === 'usage_limit') { stop = true; console.error('usage limit: stopping at this run; re-run to resume'); }
      if (++n % 10 === 0) console.error(`  ${n} calls, ${queue.length} left`);
    }
  };
  try {
    await Promise.all(Array.from({ length: CONC }, worker));
  } finally {
    await client.close();
  }
  console.error(`DONE ${n} calls${stop ? ' (stopped on usage limit)' : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

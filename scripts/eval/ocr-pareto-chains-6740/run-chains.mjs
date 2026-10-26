#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs `correct` (PR #7434) — runs the same two correctors (correct.mjs for
// Opus, cli-ocr.mjs correct mode with the fc-prompt.mjs template for agy), but on Source Library pages by page id with
// the STORED draft, judged by Opus against the image; the Pareto panels' pages include Wikisource scans we do not hold,
// their drafts are the benchmark reads the dots were scored from, and they are scored against typed references.
// scripts/batch/ocr-convergence/correct.mjs — its instruction, reply split and answer parser are imported unchanged;
// its sealed call reads the page and draft from the database, so the same call is made here from files.
// scripts/eval/ocr-pareto-6293/run-arms.mjs + rescore-extract.mjs — the bench layout and the panel scorer this feeds.
/**
 * run-chains.mjs — chained routes (draft engine → corrector) on the OCR Pareto charts (#6740). Eval only: nothing is
 * written to pages, books or the routing table. Each chain is re-run on the panel's OWN pages, from the panel's own
 * read by the draft engine, and scored by the panel's scorer against the panel's reference (eval-design.md §7).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ocr-pareto-chains-6740/run-chains.mjs <stage> [opts]
 *
 *   prep                       lay $WORK/bench/<stratum>/<slug>.jpg (each page's image, sealed as the benchmark sealed it,
 *                              checked against the bench's sha256) and out/<draft>/<slug>.txt from results/drafts.jsonl.gz
 *   correct --by=opus|agy      run one corrector on every draft of --charts (default: all, in CHARTS order); resumes;
 *          [--charts=a,b] [--concurrency=3] [--limit=N]
 *                              a Claude 5-hour or weekly limit (or the weekly cap, MAX_WEEKLY) stops the Opus side;
 *                              an agy quota or lock stops the agy side
 *   collect                    write results/outputs-<chain>.jsonl.gz and meter-<chain>.jsonl from $WORK/corr
 *   cjk-tags                   SENSITIVITY only, never on the chart: the Chinese chains re-scored with the tags normAlpha already
 *                              drops for Latin-script pages (<vocab>, <meta>, <warning> …) removed with their text, as the
 *                              CJK path keeps it (results/cjk-tags-sensitivity.json)
 *   score                      benchmark-score.mjs over $WORK/bench, then the #6523 extractor for the Latin-script strata,
 *                              exactly as build-ocr-pareto.mjs scores every other engine; CONTROL: every draft must
 *                              re-score to the committed CER of the panel's dot, or nothing is written. Writes
 *                              results/scored-chains.json
 *
 * Opus: one sealed `claude -p --restricted --tools Read` call a page (the panels hold one page per work), the folder
 *   holding p01.jpg and d01.txt only, prompt = the live OCR prompt + correct.mjs correctInstruction(1): the production
 *   correction lane's prompt (#6694 arm B). A page counts as answered only if the transcript shows both files opened.
 * agy: Gemini 3.8 Flash low through agy-cli.mjs agyCall (plan mode, tool gate, markers), with the #5924 one-page
 *   template fc-prompt.mjs builds from the same live prompt (its hash check included). Never Argon or Pro.
 * Flash-Lite is not a corrector here: #7275 measured that it fails as one.
 * The prompt sent is hashed per call (prompt_sent_hash) with the live prompt's id/version (provenance, PR #7389).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { correctInstruction, splitAnswers, parseAnswer } from '../../batch/ocr-convergence/correct.mjs';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { agyCall, installToolGate, gateCalls, unwrapRead, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';
import { extractTranscription } from '../../lib/cli-chatter.mjs';
import { levenshtein, scoreAgainstReference } from '../lib/metrics.mjs';
import { loadRefText } from '../lib/private-refs.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dirname, '..');
const REPO = path.join(EVAL, '..', '..');
const RES = path.join(__dirname, 'results');
const WORK = process.env.JOB_SCRATCH || '/root/jobs/pareto-chains-6740';
const BENCH = path.join(WORK, 'bench');
const CORR = path.join(WORK, 'corr');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const STAGE = process.argv[2];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const MAX_WEEKLY = Number(process.env.CHAINS_MAX_WEEKLY || 85);   // the brief: stay under 85% of the account-week

// Charts, largest production volume first (the brief's order when the run cannot do them all); the draft engines each
// chain starts from: the chart's engine in use, and Paddle (the GPU engine) on the Chinese print chart.
export const CHARTS = [
  { id: 'latin', drafts: ['gemini-3.1-flash-lite'] },
  { id: 'chinese-manuscript', drafts: ['paddleocr-vl-1.6'] },
  { id: 'latin-script-other', drafts: ['gemini-3.1-flash-lite'] },
  { id: 'english', drafts: ['gemini-3.1-flash-lite'] },
  { id: 'greek', drafts: ['gemini-3-flash-preview'] },
  { id: 'chinese-print', drafts: ['gemini-3-flash-preview', 'paddleocr-vl-1.6'] },
  { id: 'armenian', drafts: ['gemini-3.1-flash-lite'] },
];
export const CORRECTORS = {
  opus: { engine: 'claude-opus-5-5+claude-cli', model: 'opus' },
  agy: { engine: 'gemini-3.8-flash+antigravity-cli', model: 'gemini-3.8-flash-low' },
};
export const chainEngine = (draft, by) => `${draft}>${CORRECTORS[by].engine}`;

/** Each chart's pages per draft engine: every page a panel of the chart holds a read of by that engine. */
function chartPages() {
  const f = path.join(WORK, 'rows.json');
  if (!fs.existsSync(f)) spawnSync(process.execPath, [path.join(EVAL, 'build-ocr-pareto.mjs'), `--dump-rows=${f}`], { stdio: 'inherit' });
  const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  const out = {};
  for (const c of CHARTS) for (const d of c.drafts) (out[c.id] ||= {})[d] = [...new Set((rows[c.id] || []).filter((r) => r.engine === d).map((r) => r.page))].sort();
  return out;
}

/** The panel drafts exported from the scoring box (drafts.jsonl.gz), and the ones it did not hold ({missing}). */
function readDrafts() {
  const f = path.join(RES, 'drafts.jsonl.gz');
  const all = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { drafts: all.filter((d) => d.slug), missing: all.find((d) => d.missing)?.missing ?? [] };
}
// A draft the scoring box did not hold: the read the draft engine stored for the page, where that engine wrote it
// (Paddle's production lane, same model, a later run). Recorded in results/stored-drafts.json; scored, never assumed equal.
const STORED_MODEL = { 'paddleocr-vl-1.6': /^PaddleOCR-VL-1\.6/ };

// ── prep ──────────────────────────────────────────────────────────────────────────────────────
// The benchmark sealed a page as benchmark-seal.mjs does: getPageSource for our pages, Commons' rendering for the
// Wikisource tier; wider than 2,400 px resized to 2,400 at JPEG quality 92, a non-JPEG re-encoded at 92.
async function sealImage(buf, maxW = 2400) {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(buf).metadata();
  if (meta.width > maxW) return sharp(buf).resize({ width: maxW }).jpeg({ quality: 92 }).toBuffer();
  if (meta.format !== 'jpeg') return sharp(buf).jpeg({ quality: 92 }).toBuffer();
  return buf;
}
async function prep() {
  const { drafts, missing } = readDrafts();
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db('bookstore');
  const reg = new Map();
  for (const f of fs.readdirSync(path.join(EVAL, 'benchmark')).filter((f) => f.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(EVAL, 'benchmark', f), 'utf8'));
    for (const p of (Array.isArray(j.pages) ? j.pages : [])) reg.set(`${f.replace(/\.json$/, '')}|${p.slug}`, p);
  }
  const stored = [];
  for (const m of missing) {
    const r = reg.get(`${m.stratum}|${m.slug}`);
    const p = r && await db.collection('pages').findOne({ book_id: r.book_id, page_number: r.page_number }, { projection: { id: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.updated_at': 1 } });
    const ok = p?.ocr?.data && STORED_MODEL[m.engine]?.test(p.ocr.model || '');
    stored.push({ stratum: m.stratum, slug: m.slug, engine: m.engine, page_id: p?.id ?? null, stored_model: p?.ocr?.model ?? null, pipeline: p?.ocr?.pipeline ?? null, updated_at: p?.ocr?.updated_at ?? null,
      used: !!ok, why: ok ? null : `no read by ${m.engine} stored for this page (stored: ${p?.ocr?.model ?? 'none'})`, sha256: ok ? contentHash(p.ocr.data) : null });
    if (ok) drafts.push({ stratum: m.stratum, slug: m.slug, engine: m.engine, text: p.ocr.data, tree: 'stored', meter: null, image: null });
  }
  fs.writeFileSync(path.join(RES, 'stored-drafts.json'), JSON.stringify({ issue: 6740, why: 'the scoring box held no benchmark read by this engine for these pages; the stored read by the same engine is the draft', rows: stored }, null, 1) + '\n');
  console.log(`stored drafts: ${stored.filter((x) => x.used).length} used, ${stored.filter((x) => !x.used).length} with none`);
  const imgDone = new Set(), report = { images: 0, sha_match: 0, sha_mismatch: [], no_image: [] };
  for (const d of drafts) {
    const dir = path.join(BENCH, d.stratum, 'out', d.engine);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${d.slug}.txt`), d.text ?? '');
    if (d.meter) fs.appendFileSync(path.join(dir, '_meter.jsonl'), JSON.stringify(d.meter) + '\n');
    const key = `${d.stratum}|${d.slug}`;
    if (imgDone.has(key)) continue;
    imgDone.add(key);
    const dst = path.join(BENCH, d.stratum, `${d.slug}.jpg`);
    if (fs.existsSync(dst)) { report.images++; continue; }
    let url = null, bookId = null, pageNumber = null;
    if (d.stratum === 'ref-ws') url = JSON.parse(fs.readFileSync(path.join(EVAL, 'ground-truth-ws', `${d.slug}.json`), 'utf8')).image_url;
    else if (d.stratum === 'ref-pinned') ({ book_id: bookId, page_number: pageNumber } = JSON.parse(fs.readFileSync(path.join(EVAL, 'ground-truth', `${d.slug}.json`), 'utf8')));
    else { const r = reg.get(key); bookId = r?.book_id; pageNumber = r?.page_number; url = r?.image_url ?? null; }
    if (bookId) {
      const p = await db.collection('pages').findOne({ book_id: bookId, page_number: pageNumber }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1 } });
      url = (p && getPageSource(p)) || url;
    }
    if (!url) { report.no_image.push(key); continue; }
    const res = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/1.0 (https://sourcelibrary.org; #6740)' } });
    if (!res.ok) { report.no_image.push(`${key} HTTP ${res.status}`); continue; }
    const raw = Buffer.from(await res.arrayBuffer());
    // the bench's own bytes decide: raw first (a Commons rendering was not resized), then the sealed form
    let buf = d.image?.sha256 && sha(raw) === d.image.sha256 ? raw : await sealImage(raw);
    // the archive's image can differ in bytes or size from the one the bench sealed; where only the scale differs, the
    // corrector gets the bench's pixel size, so it sees the page at the resolution the draft engine read
    if (d.image?.width && sha(buf) !== d.image.sha256) {
      const sharp = (await import('sharp')).default;
      const m = await sharp(buf).metadata();
      const aspect = (m.width / m.height) / (d.image.width / d.image.height);
      if (m.width !== d.image.width && Math.abs(aspect - 1) < 0.01) buf = await sharp(buf).resize({ width: d.image.width, height: d.image.height, fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, buf);
    report.images++;
    if (d.image?.sha256 && sha(buf) === d.image.sha256) report.sha_match++;
    else {
      const m = await (await import('sharp')).default(buf).metadata();
      report.sha_mismatch.push({ page: key, ours_wh: [m.width, m.height], bench_wh: d.image ? [d.image.width, d.image.height] : null });
    }
  }
  await client.close();
  fs.writeFileSync(path.join(WORK, 'prep-report.json'), JSON.stringify(report, null, 1));
  console.log(`images ${report.images}: sha matches the bench ${report.sha_match}, differs ${report.sha_mismatch.length}, none ${report.no_image.length}`);
}

// ── the correctors ───────────────────────────────────────────────────────────────────────────
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER|^CLAUDECODE$|^CLAUDE_CODE_(SESSION|ENTRYPOINT|CHILD)/.test(k)) delete e[k]; return e; }
const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;

/** correct.mjs's sealed call, from files: a stream-json transcript proves which files the model opened. */
function claudeCall(prompt, cwd, transcript) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const fd = fs.openSync(transcript, 'w');
    const child = spawn('claude', ['-p', prompt, '--model', CORRECTORS.opus.model, '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'], { cwd, stdio: ['ignore', fd, 'pipe'], env: claudeEnv() });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer); fs.closeSync(fd);
      const lines = fs.readFileSync(transcript, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const res = lines.findLast((l) => l.type === 'result') || {};
      const opened = new Set();
      for (const l of lines) for (const c of (l.type === 'assistant' && Array.isArray(l.message?.content) ? l.message.content : [])) if (c.type === 'tool_use' && c.name === 'Read' && c.input?.file_path) opened.add(path.basename(c.input.file_path));
      const text = String(res.result ?? '').trim();
      const failed = res.is_error || code !== 0;
      const all = text + err;
      const cls = failed && USAGE_LIMIT.test(all) ? 'usage_limit' : code === null ? 'timeout' : failed ? `exit_${code}` : !text ? 'empty' : null;
      const models = Object.keys(res.modelUsage || {});
      resolve({ text, opened, model: models.find((m) => /opus/.test(m)) || models[0] || null, cls, err: (err || (failed ? text : '')).slice(-300), secs: (Date.now() - t0) / 1000,
        usage: res.usage ? { input: res.usage.input_tokens, output: res.usage.output_tokens, cache_read: res.usage.cache_read_input_tokens, cache_write: res.usage.cache_creation_input_tokens, turns: res.num_turns } : null,
        list_cost_usd: res.total_cost_usd ?? null });
    });
  });
}

async function prompts() {
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const { base, ref } = await liveOcrPrompt(client.db('bookstore')); await client.close();
  const tplFile = path.join(WORK, 'fc-correct-prompt.txt');
  const r = spawnSync(process.execPath, [path.join(EVAL, 'flash-reread-5924', 'fc-prompt.mjs'), tplFile], { encoding: 'utf8', env: process.env, cwd: REPO });
  if (r.status !== 0) throw new Error(`fc-prompt.mjs failed (the agy template could not be rebuilt): ${r.stderr || r.stdout}`);
  return { opus: base + correctInstruction(1), agy: fs.readFileSync(tplFile, 'utf8'), ref };
}

/** The weekly % of the account `claude` runs as (CLAUDE_CONFIG_DIR's login, not the box's), from the climits poll. */
function claudeWeekly() {
  try {
    const home = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '/root');
    const email = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).oauthAccount?.emailAddress?.toLowerCase();
    const m = JSON.parse(fs.readFileSync('/root/.claude-limits/latest.json', 'utf8'));
    if (Date.now() - Date.parse(m.checked_at) > 30 * 60e3) return null;
    const a = m.accounts.find((x) => x.ok && x.email === email);
    const get = (k) => a?.limits?.find((l) => l.key === k)?.percent ?? null;
    return a ? { email, weekly: get('weekly_all:all'), session: get('session:all') } : null;
  } catch { return null; }
}

async function correct() {
  const by = arg('by'); if (!CORRECTORS[by]) { console.error('--by=opus|agy'); process.exit(2); }
  const only = arg('charts') ? arg('charts').split(',') : null;
  const conc = Number(arg('concurrency', 3)), limit = Number(arg('limit', 1e9));
  const P = await prompts();
  const sent0 = by === 'opus' ? P.opus : P.agy;
  fs.mkdirSync(path.join(CORR, 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(CORR, 'prompts', `${by}-${contentHash(sent0)}.txt`), sent0);
  const pages = chartPages();
  const tasks = [], seen = new Set();
  for (const c of CHARTS) if (!only || only.includes(c.id)) for (const d of c.drafts) for (const pg of pages[c.id][d] || []) {
    const [st, slug] = pg.split('|'), k = `${st}|${slug}|${d}`;
    if (seen.has(k)) continue; seen.add(k);
    const out = path.join(CORR, chainEngine(d, by), st, `${slug}.json`);
    if (fs.existsSync(out) && JSON.parse(fs.readFileSync(out, 'utf8')).outcome !== 'no-answer') continue;
    tasks.push({ chart: c.id, st, slug, draft: d, out });
  }
  const todo = tasks.slice(0, limit);
  console.log(`${by}: ${todo.length} pages to correct (${tasks.length} open); prompt ${P.ref.name} v${P.ref.version}; sent hash ${contentHash(sent0)}`);
  let stop = null, n = 0;
  const one = async (t) => {
    const img = path.join(BENCH, t.st, `${t.slug}.jpg`), draftFile = path.join(BENCH, t.st, 'out', t.draft, `${t.slug}.txt`);
    const ids = { stratum: t.st, slug: t.slug, chart: t.chart, draft_engine: t.draft, corrector: CORRECTORS[by].engine, engine: chainEngine(t.draft, by) };
    if (!fs.existsSync(draftFile)) return { ...ids, outcome: 'no-draft', reason: `no read by ${t.draft} on record for this page (results/stored-drafts.json)` };
    if (!fs.existsSync(img)) return { ...ids, outcome: 'no-image', reason: 'the page image could not be fetched again (prep-report)' };
    const draft = fs.readFileSync(draftFile, 'utf8');
    const imgBuf = fs.readFileSync(img);
    const ws = path.join(WORK, 'ws', `${by}-${t.st}-${t.slug}-${t.draft}`.replace(/[^\w.-]/g, '_'));
    fs.rmSync(ws, { recursive: true, force: true }); fs.mkdirSync(ws, { recursive: true });
    const common = { stratum: t.st, slug: t.slug, chart: t.chart, draft_engine: t.draft, corrector: CORRECTORS[by].engine, engine: chainEngine(t.draft, by),
      prompt_ref: P.ref, image_sha256: sha(imgBuf), draft_sha256: contentHash(draft), started_at: new Date().toISOString() };
    if (!draft.trim()) return { ...common, outcome: 'no-draft', reason: 'the draft is empty (the draft engine did not read the page)' };
    if (by === 'opus') {
      fs.writeFileSync(path.join(ws, 'p01.jpg'), imgBuf); fs.writeFileSync(path.join(ws, 'd01.txt'), draft);
      const sent = P.opus;
      for (let attempt = 0; attempt < 2; attempt++) {
        const tr = path.join(CORR, 'transcripts', `${common.engine.replace(/[^\w.-]/g, '_')}-${t.st}-${t.slug}-${attempt}.jsonl`);
        fs.mkdirSync(path.dirname(tr), { recursive: true });
        const r = await claudeCall(sent, ws, tr);
        if (r.cls === 'usage_limit') { stop = `claude usage limit: ${r.err || r.text.slice(0, 200)}`; return null; }
        const meta = { ...common, model: r.model, secs: Math.round(r.secs * 10) / 10, usage: r.usage, list_cost_usd: r.list_cost_usd, prompt_sent_hash: contentHash(sent), attempt, opened: [...r.opened].sort(), cls: r.cls };
        if (r.cls) { if (attempt) return { ...meta, outcome: 'no-answer', reason: r.cls }; continue; }
        if (!r.opened.has('p01.jpg') || !r.opened.has('d01.txt')) { if (attempt) return { ...meta, outcome: 'no-answer', reason: 'image or draft not opened' }; continue; }
        const { answers } = splitAnswers(r.text, 1);
        const ans = answers ? parseAnswer(answers[0]) : { outcome: 'no-answer', reason: 'markers do not match' };
        if (ans.outcome === 'no-answer' && !attempt) continue;
        return { ...meta, ...ans };
      }
    }
    // agy: the #6560 correction request exactly (template with the draft in its slot, then the attachment)
    fs.writeFileSync(path.join(ws, 'page.jpg'), imgBuf);
    const gate = installToolGate(ws);
    const sent = `${P.agy.split('{draft}').join(draft)} @./page.jpg`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await agyCall(['-p', sent, '--model', CORRECTORS.agy.model, ...CLI_SAFE_ARGS], ws);
      if (r.cls === 'quota') { stop = `agy quota: ${r.err}`; return null; }
      const { text, problem } = unwrapRead(r.text);
      const meta = { ...common, model: CORRECTORS.agy.model, secs: Math.round(r.secs * 10) / 10, usage: r.usage, prompt_sent_hash: contentHash(P.agy), prompt_sent_full_hash: contentHash(sent), attempt, tool_calls: gateCalls(gate), cls: r.cls, wrapper: problem };
      if (r.cls || problem) { if (attempt) return { ...meta, outcome: 'no-answer', reason: r.cls || problem }; continue; }
      const ans = parseAnswer(text);
      if (ans.outcome === 'no-answer' && !attempt) continue;
      return { ...meta, ...ans };
    }
    return null;
  };
  const queue = [...todo];
  let lastCheck = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (queue.length && !stop) {
      if (by === 'opus' && Date.now() - lastCheck > 5 * 60_000) {
        lastCheck = Date.now();
        const u = claudeWeekly();
        if (u?.weekly != null && u.weekly >= MAX_WEEKLY) { stop = `weekly ${u.weekly}% >= ${MAX_WEEKLY}%`; break; }
      }
      const t = queue.shift();
      const res = await one(t);
      if (!res) { queue.unshift(t); break; }
      res.finished_at = new Date().toISOString();
      fs.mkdirSync(path.dirname(t.out), { recursive: true });
      fs.writeFileSync(t.out, JSON.stringify(res, null, 1));
      n++;
      if (n % 10 === 0) console.log(`  ${by}: ${n}/${todo.length} (${t.chart} ${t.st}|${t.slug}: ${res.outcome}${res.secs ? `, ${res.secs}s` : ''})`);
    }
  }));
  console.log(`${by}: ${n} pages answered this run${stop ? `; STOPPED: ${stop}` : ''}`);
  if (stop) process.exit(3);
}

// ── collect: the committed record of every corrector answer ─────────────────────────────────
function collect() {
  fs.mkdirSync(RES, { recursive: true });
  for (const chain of fs.readdirSync(CORR).filter((d) => d.includes('>'))) {
    const rows = [];
    for (const st of fs.readdirSync(path.join(CORR, chain)).sort()) for (const f of fs.readdirSync(path.join(CORR, chain, st)).filter((f) => f.endsWith('.json')).sort()) rows.push(JSON.parse(fs.readFileSync(path.join(CORR, chain, st, f), 'utf8')));
    const safe = chain.replace('>', '__');
    const outputs = rows.map((r) => ({ stratum: r.stratum, slug: r.slug, engine: r.engine, draft_engine: r.draft_engine, corrector: r.corrector, outcome: r.outcome, reason: r.reason ?? null, text: r.outcome === 'corrected' ? r.text : null }));
    fs.writeFileSync(path.join(RES, `outputs-${safe}.jsonl.gz`), zlib.gzipSync(outputs.map((o) => JSON.stringify(o)).join('\n') + '\n', { level: 9 }));
    // characters, for the price: the draft the corrector was given and the answer it returned
    const charsOf = (r) => { const f = path.join(BENCH, r.stratum, 'out', r.draft_engine, `${r.slug}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').length : null; };
    const meters = rows.map(({ text, ...m }) => ({ ...m, draft_chars: charsOf(m), answer_chars: text?.length ?? 0 }));
    fs.writeFileSync(path.join(RES, `meter-${safe}.jsonl`), meters.map((m) => JSON.stringify(m)).join('\n') + '\n');
    const t = {}; for (const r of rows) t[r.outcome] = (t[r.outcome] || 0) + 1;
    console.log(`${chain}: ${rows.length} pages ${JSON.stringify(t)}`);
  }
}

// ── score ────────────────────────────────────────────────────────────────────────────────────
// rescore-extract.mjs score(), copied: that script runs (and writes) on import. The control below re-scores every draft
// to its committed CER, which checks this copy against the scorer on every page whose read the extractor changes.
function normAlpha(s) {
  return stripMarkupTags(String(s || '')
    .replace(/<(warning|meta|image-desc|figure|note|scan-quality|language|page-type|columns|detected-images|vocab)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '))
    .replace(/```[a-z]*/g, ' ')
    .normalize('NFC').toLowerCase().replace(/ſ/g, 's').replace(/[’‘ʼ`´]/g, "'").replace(/[“”„]/g, '"')
    .replace(/[‐‑‒–—―¬]/g, '-').replace(/(\p{L})-\s*\n\s*/gu, '$1')
    .replace(/\s+/g, ' ').trim();
}
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const lettersOnly = (s) => s.replace(/[^\p{L}\p{N}]+/gu, '');
const sealedCer = (hyp, ref) => { const h = lettersOnly(normAlpha(hyp).slice(0, 6000)), r = lettersOnly(normAlpha(ref).slice(0, 6000)); return r.length ? r3(levenshtein([...h], [...r]) / r.length) : null; };
function extractScore(stratum, slug, text) {
  if (stratum.startsWith('ref-')) {
    const g = JSON.parse(fs.readFileSync(path.join(EVAL, stratum === 'ref-pinned' ? 'ground-truth' : 'ground-truth-ws', `${slug}.json`), 'utf8'));
    const script = g.script === 'cjk' || g.script === 'chinese' ? 'cjk' : (g.script || 'latin');
    const r = scoreAgainstReference(g.ocr_ground_truth, text, script, undefined, { digits: false });
    return { aligned: r.aligned, cer: r3(r.charAccuracyWindowed == null ? null : 1 - r.charAccuracyWindowed) };
  }
  const ref = loadRefText(path.join(EVAL, 'benchmark', 'refs'), slug).text;
  return { aligned: true, cer: ref == null ? null : sealedCer(text, ref) };
}
async function score() {
  const LATIN_SCRIPT = new Set(['ref-ws', 'ref-pinned', 'latin-period-5126', 'eebo-tcp-5488']);
  // every chain's text into the bench, beside its draft: a corrected page as answered, an UNCHANGED page as the draft
  const answers = new Map();
  for (const f of fs.readdirSync(RES).filter((f) => /^outputs-.*\.jsonl\.gz$/.test(f))) {
    for (const o of zlib.gunzipSync(fs.readFileSync(path.join(RES, f))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))) {
      answers.set(`${o.stratum}|${o.slug}|${o.engine}`, o);
      const text = o.outcome === 'corrected' ? o.text : o.outcome === 'unchanged' ? fs.readFileSync(path.join(BENCH, o.stratum, 'out', o.draft_engine, `${o.slug}.txt`), 'utf8') : null;
      const dir = path.join(BENCH, o.stratum, 'out', o.engine);
      fs.mkdirSync(dir, { recursive: true });
      if (text != null) fs.writeFileSync(path.join(dir, `${o.slug}.txt`), text); else fs.rmSync(path.join(dir, `${o.slug}.txt`), { force: true });
    }
  }
  const strata = [...new Set([...answers.values()].map((o) => o.stratum))].sort();
  const scoredDir = path.join(WORK, 'scored');
  fs.rmSync(scoredDir, { recursive: true, force: true }); fs.mkdirSync(scoredDir, { recursive: true });
  // the references benchmark-score.mjs reads, with the bundled ones unpacked (left packed, the Chinese cohort is scored
  // against the proxy engine without a word: EXPERIMENTS.md, #5547); a copy in scratch, the repo's refs untouched
  const refsDir = path.join(WORK, 'refs');
  fs.rmSync(refsDir, { recursive: true, force: true }); fs.mkdirSync(refsDir, { recursive: true });
  const REFS = path.join(EVAL, 'benchmark', 'refs');
  for (const f of fs.readdirSync(REFS)) {
    if (!f.endsWith('.refs.jsonl')) { fs.copyFileSync(path.join(REFS, f), path.join(refsDir, f)); continue; }
    for (const r of jl(path.join(REFS, f))) {
      fs.writeFileSync(path.join(refsDir, `${r.slug}.json`), JSON.stringify(r.record, null, 2));
      if (r.text != null) fs.writeFileSync(path.join(refsDir, `${r.slug}.txt`), r.text);
    }
  }
  const r = spawnSync(process.execPath, [path.join(EVAL, 'benchmark-score.mjs'), `--root=${BENCH}`, `--stratum=${strata.join(',')}`, `--out=${scoredDir}`, `--refs-dir=${refsDir}`], { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
  if (r.status !== 0) throw new Error('benchmark-score.mjs failed');
  const cell = new Map();
  for (const f of fs.readdirSync(scoredDir).filter((f) => /-\d{4}-\d{2}-\d{2}\.json$/.test(f) && !f.startsWith('summary'))) {
    const st = f.replace(/-\d{4}-\d{2}-\d{2}\.json$/, '');
    for (const p of JSON.parse(fs.readFileSync(path.join(scoredDir, f), 'utf8')).pages) for (const [e, c] of Object.entries(p.engines)) cell.set(`${st}|${p.slug}|${e}`, { ...c, has_ref: p.has_ref, ref_mismatch: !!p.ref_mismatch });
  }
  // the committed score of each draft, as build-ocr-pareto.mjs reads it (extractor re-score included)
  const rowsF = path.join(WORK, 'rows.json');
  const committed = new Map();
  for (const rows of Object.values(JSON.parse(fs.readFileSync(rowsF, 'utf8')))) for (const x of rows) committed.set(`${x.page}|${x.engine}`, x);
  const finalOf = (st, slug, e, text) => {
    const c = cell.get(`${st}|${slug}|${e}`);
    if (!c || c.missing) return null;
    let aligned = st.startsWith('ref-') ? !!c.aligned : true, cer = c.cer ?? null;
    // the reference tiers' committed scores were made with digits dropped (normalizeForScript v3; rescore-extract.mjs
    // V3_DIGITS), which benchmark-score.mjs no longer does: they are scored with that rule, as their dots were
    if (st.startsWith('ref-') && text != null && !c.refused) { const ex = extractTranscription(text); ({ aligned, cer } = extractScore(st, slug, ex.changed ? ex.text : text)); }
    else if (LATIN_SCRIPT.has(st) && text != null) { const ex = extractTranscription(text); if (ex.changed) ({ aligned, cer } = extractScore(st, slug, ex.text)); }
    return { aligned, cer, refused: !!c.refused, has_ref: c.has_ref, ref_mismatch: c.ref_mismatch, cell: c };
  };
  const control = { checked: 0, reproduced: 0, mismatches: [] };
  const mismatched = new Set();   // drafts whose read here is not the one their dot was scored from
  // drafts the scoring box did not hold: the stored read by the same engine, scored here; never part of the control
  const storedF = path.join(RES, 'stored-drafts.json');
  const storedKeys = new Set(fs.existsSync(storedF) ? JSON.parse(fs.readFileSync(storedF, 'utf8')).rows.filter((x) => x.used).map((x) => `${x.stratum}|${x.slug}|${x.engine}`) : []);
  const storedDraft = new Map();
  for (const k of storedKeys) {
    const [st, slug, e] = k.split('|');
    const s = finalOf(st, slug, e, fs.readFileSync(path.join(BENCH, st, 'out', e, `${slug}.txt`), 'utf8'));
    storedDraft.set(k, s ? (s.aligned ? Math.min(1, s.cer ?? 1) : 1) : null);
  }
  const out = [];
  const drafts = new Set([...answers.values()].map((o) => `${o.stratum}|${o.slug}|${o.draft_engine}`));
  for (const k of [...drafts].sort()) {
    const [st, slug, e] = k.split('|');
    const cm = committed.get(k);
    if (!cm || cm.failure || storedKeys.has(k)) continue;
    if (!fs.existsSync(path.join(BENCH, st, `${slug}.jpg`))) { control.no_image = (control.no_image || 0) + 1; continue; }   // the scorer lists a page by its image
    if (!fs.existsSync(path.join(BENCH, st, 'out', e, `${slug}.txt`))) { control.no_draft = (control.no_draft || 0) + 1; continue; }   // no read on record (stored-drafts.json)
    const s = finalOf(st, slug, e, fs.readFileSync(path.join(BENCH, st, 'out', e, `${slug}.txt`), 'utf8'));
    control.checked++;
    const theirs = cm.cer, ours = s ? (s.aligned ? Math.min(1, s.cer ?? 1) : 1) : null;
    if (ours != null && Math.abs(ours - theirs) < 1e-9) control.reproduced++; else { control.mismatches.push(`${k}: committed ${theirs} vs ${ours}`); mismatched.add(k); }
  }
  for (const [k, o] of [...answers].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [st, slug] = k.split('|');
    const dk = `${st}|${slug}|${o.draft_engine}`;
    const base = { page: `${st}|${slug}`, engine: o.engine, draft_engine: o.draft_engine, corrector: o.corrector, outcome: o.outcome,
      ...(storedKeys.has(dk) ? { draft_source: 'stored', draft_cer: storedDraft.get(dk) } : {}) };
    // a draft that did not read the page (the copy filter cut it, say) leaves the chain nothing to correct: the chain
    // did not read it either, for the same reason
    // a draft that does not re-score to its dot (the read exported is not the one the dot was scored from, or the
    // reference was refreshed since): the chain cannot be set beside the dot on this page, so it is counted, not scored
    if (mismatched.has(dk)) { out.push({ ...base, cer: null, failure: 'other', failure_why: 'the draft read on record does not re-score to its dot here (another read, or a reference refreshed since); not scored' }); continue; }
    const draftFail = o.outcome === 'no-draft' ? committed.get(dk)?.failure : null;
    if (draftFail) { out.push({ ...base, cer: null, failure: draftFail, failure_why: `the draft did not read the page (${committed.get(dk).failure_why || draftFail})` }); continue; }
    if (o.outcome !== 'corrected' && o.outcome !== 'unchanged') { out.push({ ...base, cer: null, failure: o.outcome === 'contain' ? 'refusal' : o.outcome === 'no-answer' ? 'empty' : 'other', failure_why: o.outcome === 'contain' ? `CONTAIN: ${o.reason}` : o.reason || o.outcome }); continue; }
    const text = o.outcome === 'corrected' ? o.text : fs.readFileSync(path.join(BENCH, st, 'out', o.draft_engine, `${slug}.txt`), 'utf8');
    const s = finalOf(st, slug, o.engine, text);
    if (!s) { out.push({ ...base, cer: null, failure: 'other', failure_why: 'not scored' }); continue; }
    out.push({ ...base, aligned: s.aligned, cer: s.cer == null ? null : Math.min(1, s.cer), unplaced: !s.aligned || s.cer == null, ref_mismatch: s.ref_mismatch || undefined });
  }
  console.log(`control: ${control.reproduced}/${control.checked} drafts re-score to the committed CER of the panel's dot`);
  for (const m of control.mismatches.slice(0, 15)) console.log(`  mismatch ${m}`);
  const json = JSON.stringify({ issue: 6740, generated_by: 'scripts/eval/ocr-pareto-chains-6740/run-chains.mjs score', scorer: 'scripts/eval/benchmark-score.mjs, then rescore-extract.mjs score() where extractTranscription changes a Latin-script read (as build-ocr-pareto.mjs)',
    control: { checked: control.checked, reproduced: control.reproduced, mismatches: control.mismatches, no_image: control.no_image || 0, no_draft: control.no_draft || 0 }, rows: out }, null, 1) + '\n';
  // a few drafts may not reproduce (each is listed and its chains are not scored); many means the scorer copy is wrong
  if (control.checked - control.reproduced > 0.02 * control.checked && !process.argv.includes('--allow-mismatch')) { console.error('control failed: over 2% of drafts do not re-score to their dot; nothing written'); process.exit(1); }
  fs.writeFileSync(path.join(RES, 'scored-chains.json'), json);
  console.log(`wrote ${path.relative(process.cwd(), path.join(RES, 'scored-chains.json'))} (${out.length} rows)`);
}

// ── cjk-tags: how much of a Chinese chain's score is the text inside its metadata tags ─────────
// The correctors answer in the library's tagged format (the live prompt asks for <vocab>, <language>, <meta> …). On a
// Latin-script page the scorer drops those tags with their text (normAlpha); on a CJK page it drops the tags and keeps
// the text (normCJK), so a list of key terms is scored as text the page does not print. No other engine on these panels
// writes the format. This re-scores each Chinese chain page with normAlpha's tag list removed first, normCJK otherwise
// copied from benchmark-score.mjs (its variant folding read from the file).
async function cjkTags() {
  const src = fs.readFileSync(path.join(EVAL, 'benchmark-score.mjs'), 'utf8');
  const kyu = src.match(/const KYU_SHIN = '([^']+)'/)[1];
  const KM = new Map(); for (let i = 0; i + 1 < kyu.length; i += 2) KM.set(kyu[i], kyu[i + 1]);
  const normCJK = (x) => [...stripMarkupTags([...String(x || '')].map((c) => KM.get(c) || c).join('')).normalize('NFC')].filter((c) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}〇]/u.test(c)).join('').slice(0, 6000);
  const TAGS = /<(warning|meta|image-desc|figure|note|scan-quality|language|page-type|columns|detected-images|vocab)\b[^>]*>[\s\S]*?<\/\1>/gi;
  const CJK = new Set(['chinese', 'chinese-ext', 'chinese-cohort-5547']);
  const rows = [], scored = JSON.parse(fs.readFileSync(path.join(RES, 'scored-chains.json'), 'utf8')).rows;
  const texts = new Map();
  for (const f of fs.readdirSync(RES).filter((f) => /^outputs-.*\.jsonl\.gz$/.test(f))) for (const l of zlib.gunzipSync(fs.readFileSync(path.join(RES, f))).toString('utf8').split('\n').filter(Boolean)) { const o = JSON.parse(l); texts.set(`${o.stratum}|${o.slug}|${o.engine}`, o); }
  for (const r of scored) {
    const [st, slug] = r.page.split('|');
    if (!CJK.has(st) || r.cer == null) continue;
    const ref = loadRefText(path.join(WORK, 'refs'), slug).text;
    if (!ref) continue;
    const o = texts.get(`${r.page}|${r.engine}`);
    const text = o.outcome === 'corrected' ? o.text : fs.readFileSync(path.join(BENCH, st, 'out', r.draft_engine, `${slug}.txt`), 'utf8');
    const R = [...normCJK(ref)];
    if (!R.length) continue;
    const h = [...normCJK(text.replace(TAGS, ' '))];
    rows.push({ page: r.page, engine: r.engine, cer: r.cer, cer_tags_removed: r3(Math.min(1, levenshtein(h, R) / R.length)) });
  }
  fs.writeFileSync(path.join(RES, 'cjk-tags-sensitivity.json'), JSON.stringify({ issue: 6740, generated_by: 'scripts/eval/ocr-pareto-chains-6740/run-chains.mjs cjk-tags', not_on_the_chart: true,
    removed: 'warning, meta, image-desc, figure, note, scan-quality, language, page-type, columns, detected-images, vocab (the tags normAlpha drops with their text)', rows }, null, 1) + '\n');
  const by = {}; for (const r of rows) { const a = (by[r.engine] ||= [0, 0, 0]); a[0]++; a[1] += r.cer; a[2] += r.cer_tags_removed; }
  for (const [e, [n, a, b]] of Object.entries(by)) console.log(`${e}: ${n} pages, accuracy as scored ${(1 - a / n).toFixed(3)}, tags removed ${(1 - b / n).toFixed(3)}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await ({ prep, correct, collect, score, 'cjk-tags': cjkTags }[STAGE] ?? (() => { console.error('stages: prep | correct --by=opus|agy | collect | score'); process.exit(2); }))();
}

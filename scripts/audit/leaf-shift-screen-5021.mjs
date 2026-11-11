#!/usr/bin/env node
// PRIOR ART: scripts/audit/leaf-shift-confirm-5021.mjs — the Opus confirmer (scans + transcriptions, blind to the
// direction); this is the CHEAP text-only screen in front of it, and its flags feed that script. Batch submit/collect
// follows scripts/eval/langid-5777.mjs (upload, createThenDeleteInput, logUsage) and registers each job as an eval
// batch (scripts/lib/eval-batch-registry.mjs, #5771: an unregistered hand Batch is cancelled as an orphan).
// scripts/lib/leaf-shift.mjs splitLayer strips the running heads, which a shifted page keeps right (Śakuntalā).
/**
 * leaf-shift-screen-5021 — which transcription does this English translate? (#5021) Text only, no image.
 * For page n: the English shown on n, and the transcriptions of n−1, n, n+1 shuffled (seeded per page) and labelled
 * A/B/C. Answer A|B|C|NONE|MULTI. Mapped back: own | next | prev | none | multi. A flag is anything but own.
 * A flag is anything but own or parallel (v2: a facing-page translation holds the same passage). READ-ONLY on pages/books; writes files under --out, a `batch_jobs` eval row per Batch job, and a gemini_usage row.
 *
 *   build   --items f.jsonl --out DIR --name X [--prompt v1|v2]   items: {book_id, page, y?, arm?, language?, as_of?, synthetic?}
 *           synthetic 'next' serves page n+1's English on n (a made shift from a clean window; answer should be next)
 *   submit  --out DIR --name X --approved-usd U [--model gemini-3.1-flash-lite]
 *   collect --out DIR --name X [--wait-min M]
 *   score   --out DIR --name X                   recall / false-flag rate against y, by language and arm
 *   agy     --out DIR --name X [--model gemini-3.8-flash-low] [--concurrency 3]   the same prompts through agy
 *   claude  --out DIR --name X [--model sonnet] [--concurrency 4] [--max-weekly 90]   the same prompts through
 *           `claude -p` on this box's subscription, no tools; stops at a usage-limit reply or when the box account's
 *           weekly percent (/root/.claude-limits/latest.json) reaches --max-weekly. Subscription use is priced as
 *           fee × the weekly percent it moved (Derek, 2026-11-03), never as free.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { agyCall, installToolGate, CLI_SAFE_ARGS } from '../lib/agy-cli.mjs';
import { splitLayer, windowLang } from '../lib/leaf-shift.mjs';
import { priceFor, BATCH_MULTIPLIER } from '../lib/model-pricing.mjs';
import { createThenDeleteInput } from '../lib/gemini-batch-input-file.mjs';

const argv = process.argv.slice(2);
const MODE = argv[0];
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const OUT = path.resolve(arg('out', `${process.env.JOB_SCRATCH || '/tmp'}/leaf-shift-screen`));
const NAME = arg('name', 'gate');
const DIR = path.join(OUT, NAME);
const MODEL = arg('model', 'gemini-3.1-flash-lite');
const API = 'https://generativelanguage.googleapis.com';
const CHUNK = 2000;
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const F = (x) => path.join(DIR, x);

// Caseless scripts carry about one token per character: cap them shorter.
// v1 (gate 1): 1,500 / 700. v2: longer, because a page's English can begin past v1's cut of its own leaf.
const PROMPT_V = arg('prompt', 'v2');
const capFor = (s) => ((s.match(/\p{Lo}/gu) || []).length > s.length * 0.3 ? (PROMPT_V === 'v1' ? 700 : 1000) : (PROMPT_V === 'v1' ? 1500 : 2500));
export function prep(text, { tail = 0 } = {}) {
  const body = splitLayer(text).body.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const cap = capFor(body);
  if (body.length <= cap + tail) return body;
  // v3: the English keeps its END too: an absorbing page opens on its own leaf and ends on the next one.
  return tail ? `${body.slice(0, cap)} […] ${body.slice(-tail)}` : `${body.slice(0, cap)} […]`;
}

// windowLang moved to scripts/lib/leaf-shift.mjs (#8399: the page-join echo detector applies the same rule); re-exported here.
export { windowLang };
/** A facing-page (parallel-text) window: the page and a neighbour hold text in two different languages. */
export const isParallelWindow = (w) => !!w.own && [w.prev, w.next].some((x) => x && x !== w.own);
/**
 * The cross-language rule (gate 1, 2026-11-03): a next/prev answer whose chosen neighbour is in a DIFFERENT language
 * from the page's own transcription is the bilingual signature (the English matched the facing translation of the
 * same passage: Loeb Latin/English, Welsh/English, Coptic/English, Quiché/French). It is not a flag. Excluding whole
 * parallel windows instead cost 9 of 75 positives on gate 1.
 */
export const crossLanguage = (r, role) => (role === 'next' || role === 'prev') && !!r.win?.own && !!r.win?.[role] && r.win[role] !== r.win.own;

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seedOf = (s) => { let h = 5021; for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h; };

export function buildPrompt({ language, english, cands }) {
  const L = [];
  L.push(`Below is an English translation of one page of a historical book (original language: ${language || 'unknown'}), and the transcriptions of ${cands.length} pages of that book, in random order, labelled ${cands.map((c) => c.label).join(', ')}.`);
  L.push(`Which transcription does the English translate? A sentence carried over a page edge, small omissions, or OCR errors still count as that one. Answer NONE if it translates none of them, MULTI if it translates substantial parts of two or more.`);
  // v2 (gate 1's false flags were all facing-page editions: Loeb Latin/English, Welsh/English, Coptic/English).
  if (PROMPT_V === 'v2') L.push(`Some editions print the original and a translation of it on facing pages, so two transcriptions can hold the SAME passage in two languages. If the English renders a passage that two transcriptions both hold in that way, answer PARALLEL.`);
  // v3: gate 2's false flags were still facing-page editions (Loeb, Coptic/English, Quiché/French).
  if (PROMPT_V === 'v3') L.push(`Many of these books are bilingual editions: one page prints the original text and the facing page prints a translation of the same passage (into English, French, Latin or another language). First check whether two of the transcriptions hold the same passage in two different languages. If they do and the English renders that passage, answer PARALLEL, and do not pick either of them. If the English is long, its beginning and its end are shown, with […] between.`);
  L.push('');
  L.push('ENGLISH:');
  L.push('<<<');
  L.push(english);
  L.push('>>>');
  for (const c of cands) { L.push(''); L.push(`TRANSCRIPTION ${c.label}:`); L.push('<<<'); L.push(c.text || '(empty page)'); L.push('>>>'); }
  L.push('');
  L.push(`Reply with JSON only: {"answer":"${cands.map((c) => c.label).join('|')}|NONE|MULTI${PROMPT_V !== 'v1' ? '|PARALLEL' : ''}"}`);
  return L.join('\n');
}

async function build() {
  const items = readJsonl(arg('items'));
  fs.mkdirSync(DIR, { recursive: true });
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred', maxPoolSize: 8, compressors: ['zlib'] });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const out = [];
  const bookLang = new Map();
  let skipped = 0;
  const queue = [...items];
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      const pages = await db.collection('pages').find({ book_id: it.book_id, page_number: { $gte: it.page - 1, $lte: it.page + 2 } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray();
      if (it.as_of) {
        const revs = await db.collection('page_revisions').find({ page_id: { $in: pages.map((p) => p.id) }, field: 'translation', created_at: { $gt: new Date(it.as_of) } }, { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();
        const first = new Map(); for (const r of revs) if (!first.has(r.page_id)) first.set(r.page_id, r);
        for (const p of pages) if (typeof first.get(p.id)?.data === 'string') p.translation = { data: first.get(p.id).data };
      }
      const by = new Map(pages.map((p) => [p.page_number, p]));
      const enPage = it.synthetic === 'next' ? it.page + 1 : it.synthetic === 'prev' ? it.page - 1 : it.page;
      const english = prep(by.get(enPage)?.translation?.data || '', { tail: PROMPT_V === 'v3' ? 1000 : 0 });
      const self = by.get(it.page);
      if (!self || english.length < 80 || !String(self.ocr?.data || '').trim()) { skipped++; continue; }
      if (!bookLang.has(it.book_id)) bookLang.set(it.book_id, (await db.collection('books').findOne({ id: it.book_id }, { projection: { language: 1 } }))?.language || it.language || null);
      const rel = [[-1, 'prev'], [0, 'own'], [1, 'next']].filter(([d]) => by.has(it.page + d)).map(([d, role]) => ({ role, text: prep(by.get(it.page + d).ocr?.data || '') }));
      const rnd = mulberry32(seedOf(`${it.book_id}:${it.page}:${it.synthetic || ''}`));
      for (let i = rel.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rel[i], rel[j]] = [rel[j], rel[i]]; }
      const cands = rel.map((c, i) => ({ ...c, label: 'ABC'[i] }));
      const key = `${it.book_id}:${it.page}${it.synthetic ? `:syn-${it.synthetic}` : ''}`;
      const win = Object.fromEntries([[-1, 'prev'], [0, 'own'], [1, 'next']].map(([d, role]) => [role, by.has(it.page + d) ? windowLang(by.get(it.page + d).ocr?.data || '') : null]));
      out.push({ key, ...it, language: bookLang.get(it.book_id), win, parallel: isParallelWindow(win), map: Object.fromEntries(cands.map((c) => [c.label, c.role])), prompt: buildPrompt({ language: bookLang.get(it.book_id), english, cands }) });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  await client.close();
  fs.writeFileSync(F('requests.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const chars = out.reduce((s, o) => s + o.prompt.length, 0);
  console.log(`built ${out.length} requests (${skipped} skipped: no English / no transcription), ${(chars / out.length).toFixed(0)} chars a prompt`);
}

const tokEst = (s) => Math.ceil(s.length / 3.2);

async function submit() {
  const reqs = readJsonl(F('requests.jsonl'));
  const answered = new Set(readJsonl(F('answers.jsonl')).filter((a) => a.answer).map((a) => a.key));
  const todo = reqs.filter((r) => !answered.has(r.key));
  const p = priceFor(MODEL);
  const est = todo.reduce((s, r) => s + BATCH_MULTIPLIER * ((tokEst(r.prompt) / 1e6) * p.input + (12 / 1e6) * p.output), 0);
  const approved = Number(arg('approved-usd', 0));
  console.log(`${todo.length} requests; ESTIMATE (Batch, ${MODEL}): $${est.toFixed(4)}`);
  if (!(approved >= est)) throw new Error(`--approved-usd ${approved} is below the estimate $${est.toFixed(4)}`);
  const envName = process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY';
  const key = process.env[envName];
  const recF = F('batch.json');
  const rec = fs.existsSync(recF) ? JSON.parse(fs.readFileSync(recF, 'utf8')) : { key_env: envName, model: MODEL, jobs: [] };
  if (rec.jobs.some((j) => !j.collected_at)) throw new Error('uncollected job(s): run collect first');
  const { withMongo } = await import('../lib/mongo.mjs');
  const { registerEvalBatch } = await import('../lib/eval-batch-registry.mjs');
  for (let c = 0; c * CHUNK < todo.length; c++) {
    const chunk = todo.slice(c * CHUNK, (c + 1) * CHUNK);
    const jsonl = chunk.map((r) => JSON.stringify({ key: r.key, request: { contents: [{ role: 'user', parts: [{ text: r.prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 40, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } } } })).join('\n');
    const bytes = Buffer.byteLength(jsonl);
    const disp = `shift-screen-5021-${NAME}-${rec.jobs.length}`;
    const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'text/plain' }, body: JSON.stringify({ file: { display_name: disp } }) });
    if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
    const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: jsonl });
    if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
    const fileName = (await up.json()).file?.name;
    const job = await createThenDeleteInput({ fileName, apiKey: key, create: async () => {
      const r = await fetch(`${API}/v1beta/models/${MODEL}:batchGenerateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch: { display_name: disp, input_config: { file_name: fileName } } }) });
      if (!r.ok) throw new Error(`batch create ${r.status} ${(await r.text()).slice(0, 500)}`);
      return r.json();
    } });
    rec.jobs.push({ job_name: job.name, requests: chunk.length, estimate_usd: +(est * chunk.length / todo.length).toFixed(4), submitted_at: new Date().toISOString() });
    fs.writeFileSync(recF, JSON.stringify(rec, null, 1));
    await withMongo((db) => registerEvalBatch(db, { jobName: job.name, id: disp, submittedBy: 'scripts/audit/leaf-shift-screen-5021.mjs', model: MODEL, pageCount: chunk.length, issue: 5021, note: 'leaf-shift screen (#5021); answers go to files only, never to pages' }));
    console.log(`submitted ${job.name} (${chunk.length} requests, ${(bytes / 1e6).toFixed(1)} MB), registered`);
  }
}

export function parseAnswer(text) {
  const m = String(text || '').match(/"answer"\s*:\s*"([A-Za-z]+)"/) || String(text || '').match(/\b(A|B|C|NONE|MULTI|PARALLEL)\b/);
  return m ? m[1].toUpperCase() : null;
}
const roleOf = (req, ans) => (ans === 'NONE' ? 'none' : ans === 'MULTI' ? 'multi' : ans === 'PARALLEL' ? 'parallel' : req.map[ans] || 'invalid');
// A SHIFT flag: the English renders a neighbour's leaf, or none of the three. Pre-registered 2026-11-03 13:05Z after
// gate 1 and before the held-out gate 2: MULTI (two leaves) is the absorption shape, reported as its own class and
// sent to Opus separately, not counted as a shift flag; PARALLEL (a facing translation) is not a flag.
export const isFlag = (role) => role === 'next' || role === 'prev' || role === 'none';
export const isMulti = (role) => role === 'multi';

async function collect() {
  const recF = F('batch.json');
  const rec = JSON.parse(fs.readFileSync(recF, 'utf8'));
  const key = process.env[rec.key_env];
  const reqs = new Map(readJsonl(F('requests.jsonl')).map((r) => [r.key, r]));
  const p = priceFor(rec.model);
  const waitMax = Number(arg('wait-min', 0)) * 60e3, t0 = Date.now();
  const { withMongo } = await import('../lib/mongo.mjs');
  const { closeEvalBatch } = await import('../lib/eval-batch-registry.mjs');
  for (;;) {
    let pending = 0;
    for (const j of rec.jobs) {
      if (j.collected_at) continue;
      const data = await (await fetch(`${API}/v1beta/${j.job_name}?key=${key}`)).json();
      const state = data.metadata?.state || data.state;
      const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
      if (!rf && /FAILED|CANCELLED|EXPIRED/.test(state || '')) { Object.assign(j, { collected_at: new Date().toISOString(), state, responses: 0, cost_usd: 0, dead: JSON.stringify(data.error || '').slice(0, 200) }); continue; }
      if (!rf) { pending++; console.log(`${j.job_name} ${state} ${JSON.stringify(data.metadata?.batchStats || {})}`); continue; }
      const text = await (await fetch(`${API}/download/v1beta/${rf}:download?alt=media&key=${key}`)).text();
      let inTok = 0, outTok = 0, n = 0, errors = 0;
      const lines = [];
      for (const line of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(line); const k = r.key || r.metadata?.key; const req = reqs.get(k);
        const resp = r.response, u = resp?.usageMetadata || {};
        const it = { key: k };
        if (r.error || !resp) { it.error = JSON.stringify(r.error || 'no response').slice(0, 200); errors++; }
        else {
          const out = (resp.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
          it.answer = parseAnswer(out);
          if (!it.answer) { it.error = `unparseable: ${out.slice(0, 120)}`; errors++; } else it.role = roleOf(req, it.answer);
          inTok += u.promptTokenCount || 0; outTok += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
        }
        lines.push(JSON.stringify(it)); n++;
      }
      fs.appendFileSync(F('answers.jsonl'), lines.join('\n') + '\n');
      const cost = BATCH_MULTIPLIER * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output);
      Object.assign(j, { collected_at: new Date().toISOString(), state, responses: n, errors, in_tokens: inTok, out_tokens: outTok, cost_usd: +cost.toFixed(5) });
      fs.writeFileSync(recF, JSON.stringify(rec, null, 1));
      try {
        const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
        await logUsage({ type: 'eval', mode: 'batch', model: rec.model, page_count: n - errors, input_tokens: inTok, output_tokens: outTok, batch_job_id: j.job_name, endpoint: 'audit/leaf-shift-screen-5021', triggered_by: 'manual', prompt_version: 'shift-screen-5021' });
      } catch (e) { console.warn(`logUsage failed: ${e.message}`); }
      await withMongo((db) => closeEvalBatch(db, j.job_name, { evidence: F('answers.jsonl'), usage: { input_tokens: inTok, output_tokens: outTok, cost_usd: +cost.toFixed(5) } }));
      console.log(`collected ${j.job_name}: ${n} (${errors} errors) $${cost.toFixed(4)}`);
    }
    fs.writeFileSync(recF, JSON.stringify(rec, null, 1));
    if (!pending) { console.log(`all collected; total $${rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4)}`); return; }
    if (Date.now() - t0 > waitMax) { console.log(`${pending} pending; re-run collect`); return; }
    await new Promise((r) => setTimeout(r, 60e3));
  }
}

const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;
// `claude -p` prefers an API key over the subscription login, and node --env-file loads one: strip it (#6553).
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
/** This box's Claude login's weekly percent from the climits poll, or null. The poll's `claude_code_account` is the
 *  POLLING box's login (main), not this box's: read the login from ~/.claude.json (2026-11-03, l7a ≠ main). */
export function boxWeekly() {
  try {
    const d = JSON.parse(fs.readFileSync('/root/.claude-limits/latest.json', 'utf8'));
    // A job runs `claude` under CLAUDE_CONFIG_DIR (gex45: /root/.claude-milo), and the spawned `claude -p` inherits it:
    // ~/.claude.json there is a different login (2026-11-03: dereklomas@ 9% vs the job's milolomas@ 81%).
    const me = JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json'), 'utf8')).oauthAccount?.emailAddress;
    const a = d.accounts.find((x) => x.email === me);
    const w = a?.limits?.find((l) => l.key === 'weekly_all:all');
    return w ? { account: a.email, pct: w.percent, resets_at: w.resets_at, checked_at: d.checked_at } : null;
  } catch { return null; }
}
function claudeText(prompt, model) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('claude', ['-p', '--model', model, '--system-prompt', 'You classify text and reply with JSON only.', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 5 * 60e3);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '').trim();
      const failed = j.is_error || code !== 0;
      const cls = failed && USAGE_LIMIT.test(text + out + err) ? 'usage_limit' : code === null ? 'timeout' : failed ? `exit_${code}` : !text ? 'empty' : null;
      const u = j.usage || {};
      resolve({ text, cls, secs: (Date.now() - t0) / 1000, list_usd: j.total_cost_usd ?? null, tokens: { in: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), out: u.output_tokens || 0 }, err: err.slice(-200) });
    });
  });
}

async function claude() {
  const model = arg('model', 'sonnet');
  const maxWeekly = Number(arg('max-weekly', '90'));
  const reqs = readJsonl(F('requests.jsonl'));
  const ansF = F(`answers-claude-${model}.jsonl`);
  const done = new Set(readJsonl(ansF).filter((a) => a.answer).map((a) => a.key));
  const queue = reqs.filter((r) => !done.has(r.key));
  const w0 = boxWeekly();
  console.log(`${queue.length} claude -p calls (${model}); box weekly ${w0?.pct}% (${w0?.account}, resets ${w0?.resets_at})`);
  fs.appendFileSync(F('claude-meter.jsonl'), JSON.stringify({ at: new Date().toISOString(), phase: 'start', model, n: queue.length, weekly: w0 }) + '\n');
  let stop = false, n = 0;
  const worker = async () => {
    for (let r = queue.shift(); r && !stop; r = queue.shift()) {
      const w = boxWeekly();
      if (w && w.pct >= maxWeekly) { stop = true; console.error(`box weekly ${w.pct}% >= ${maxWeekly}%: stopping`); break; }
      const res = await claudeText(r.prompt, model);
      if (res.cls === 'usage_limit') { stop = true; console.error('usage limit reply: stopping'); }
      const answer = res.cls ? null : parseAnswer(res.text);
      fs.appendFileSync(ansF, JSON.stringify({ key: r.key, answer, role: answer ? roleOf(r, answer) : null, secs: res.secs, list_usd: res.list_usd, tokens: res.tokens, ...(answer ? {} : { error: `${res.cls} ${res.text.slice(-200)} ${res.err}` }) }) + '\n');
      if (++n % 50 === 0) console.error(`  ${n} calls`);
    }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', '4')) }, worker));
  fs.appendFileSync(F('claude-meter.jsonl'), JSON.stringify({ at: new Date().toISOString(), phase: 'end', model, n, weekly: boxWeekly() }) + '\n');
}

async function agy() {
  const model = arg('model', 'gemini-3.8-flash-low');
  const reqs = readJsonl(F('requests.jsonl'));
  const ansF = F(`answers-agy-${model}.jsonl`);
  const done = new Set(readJsonl(ansF).filter((a) => a.answer).map((a) => a.key));
  const queue = reqs.filter((r) => !done.has(r.key));
  console.log(`${queue.length} agy calls (${model})`);
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-shift-'));
      installToolGate(ws, { task: 'translate' });
      const res = await agyCall(['-p', r.prompt, '--model', model, ...CLI_SAFE_ARGS], ws);
      fs.rmSync(ws, { recursive: true, force: true });
      if (res.cls === 'quota') { console.error(`agy quota: ${res.err}`); queue.length = 0; break; }
      const answer = res.cls ? null : parseAnswer(res.text);
      fs.appendFileSync(ansF, JSON.stringify({ key: r.key, answer, role: answer ? roleOf(r, answer) : null, secs: res.secs, ...(answer ? {} : { error: `${res.cls} ${String(res.text || '').slice(-200)} ${res.err || ''}` }) }) + '\n');
    }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', '3')) }, worker));
}

export function scoreRows(reqs, answers) {
  const ans = new Map(answers.filter((a) => a.answer).map((a) => [a.key, a]));
  const rows = reqs.filter((r) => r.y != null).map((r) => ({ ...r, role: ans.get(r.key)?.role ?? null }));
  const withFilter = (xs) => xs.map((r) => ({ ...r, role: crossLanguage(r, r.role) ? 'parallel-window' : r.role }));
  const tally = (xs) => {
    const pos = xs.filter((r) => r.y === 1 && r.role), neg = xs.filter((r) => r.y === 0 && r.role);
    const flag = (r) => isFlag(r.role);
    return { pos: pos.length, recall: pos.length ? +(pos.filter(flag).length / pos.length).toFixed(3) : null, neg: neg.length, false_flag: neg.length ? +(neg.filter(flag).length / neg.length).toFixed(3) : null, unanswered: xs.filter((r) => !r.role).length,
      pos_roles: pos.reduce((m, r) => ((m[r.role] = (m[r.role] || 0) + 1), m), {}), neg_roles: neg.reduce((m, r) => ((m[r.role] = (m[r.role] || 0) + 1), m), {}) };
  };
  const group = (fn) => { const m = {}; for (const r of rows) (m[fn(r)] ||= []).push(r); return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, tally(v)])); };
  return { all: tally(rows), all_cross_language_rule: tally(withFilter(rows)), parallel_windows: { pos: rows.filter((r) => r.parallel && r.y === 1).length, neg: rows.filter((r) => r.parallel && r.y === 0).length }, by_arm: group((r) => r.arm || '-'), by_language: group((r) => r.language || '-') };
}

function score() {
  const reqs = readJsonl(F('requests.jsonl'));
  const files = fs.readdirSync(DIR).filter((f) => /^answers.*\.jsonl$/.test(f));
  const out = Object.fromEntries(files.map((f) => [f, scoreRows(reqs, readJsonl(F(f)))]));
  fs.writeFileSync(F('score.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fn = { build, submit, collect, score, agy, claude }[MODE];
  if (!fn) throw new Error('mode: build | submit | collect | score | agy | claude');
  await fn();
}

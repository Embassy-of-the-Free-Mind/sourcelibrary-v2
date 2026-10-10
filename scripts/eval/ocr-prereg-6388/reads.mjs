#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-cli-pilot-6375.mjs (images / prompt / lite / cli-req stages, copied: same live prompt,
// same realtime-ocr.mjs generationConfig, same gemini-script-client metering); scripts/eval/run-cli-arm.py (the agy
// arm, run unchanged on the requests this writes); scripts/eval/en-ocr-reference-5124.mjs leafTexts (the IA djvu
// leaf parser, copied); /root/bench2-kraken/run-bench2.sh (the Kraken + CATMuS command, copied). None of them runs
// Sonnet through `claude -p` on page images, or keeps every arm's read per page for one shared draw.
/**
 * reads.mjs — every read for the #6388 draw, one stage at a time. Writes NOTHING to Mongo.
 * Bulky files (images, raw outputs) go under $JOB_SCRATCH/work; the per-arm reads land in reads/<arm>.jsonl.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ocr-prereg-6388/reads.mjs <stage>
 *     images   fetch each drawn page's image (a failed fetch promotes the stratum's next spare; logged)
 *     prompt   the live OCR prompt (the one realtime-ocr.mjs and cli-ocr.mjs send)
 *     stored   P: production's stored pages.ocr.data
 *     lite --run=L1|L2   gemini-3.1-flash-lite, paid API, metered; stops at $1 total across both runs
 *     cli-req  requests for run-cli-arm.py (arm G)
 *     sonnet   S: `claude -p --model sonnet` (subscription), image opened with the Read tool, no other tool
 *     kraken   O: Kraken + CATMuS, CPU (Latin and English only)
 *     ia       IA: Archive OCR leaf, located within ±3 leaves of page_number − 1 by agreement with arm G
 *     import-g G: import run-cli-arm.py's output into reads/G.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WORK = path.join(process.env.JOB_SCRATCH || '/tmp', 'work');
const W = (...f) => path.join(WORK, ...f);
const R = f => path.join(HERE, 'reads', f);
fs.mkdirSync(W('img'), { recursive: true });
fs.mkdirSync(path.join(HERE, 'reads'), { recursive: true });
const STAGE = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const LITE = 'gemini-3.1-flash-lite', ENDPOINT = 'scripts/eval/ocr-prereg-6388/reads.mjs', SPEND_CAP = 1.0;
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const append = (f, row) => fs.appendFileSync(f, JSON.stringify(row) + '\n');
const safe = uid => uid.replace(/[^\w.-]/g, '_');
const img = uid => W('img', `${safe(uid)}.jpg`);
const UA = 'SourceLibraryEval/1.0 (https://sourcelibrary.org; #6388)';

// The sample actually read: draw.json rows, with spares promoted for failed images (sample.json, written by `images`).
const sample = () => readJson(path.join(HERE, 'sample.json')).rows;
async function pool(items, k, fn) { let i = 0; await Promise.all(Array.from({ length: k }, async () => { while (i < items.length) await fn(items[i++]); })); }

async function mongo() {
  const { MongoClient } = await import('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  return { client, db: client.db('bookstore') };
}

async function fetchImage(r) {
  const f = img(r.uid);
  if (fs.existsSync(f) && fs.statSync(f).size > 1000) return true;
  try {
    const res = await fetch(r.image, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error(`only ${buf.length} bytes`);
    fs.writeFileSync(f, buf); return true;
  } catch (e) { console.log(`! ${r.uid}: ${e.message}`); return false; }
}

async function stageImages() {
  const d = readJson(path.join(HERE, 'draw.json'));
  const spares = Object.groupBy(d.spares, s => s.stratum);
  const rows = [], swaps = [];
  for (const r of d.rows) {
    if (await fetchImage(r)) { rows.push(r); continue; }
    let rep = null;
    while (!rep && spares[r.stratum]?.length) { const s = spares[r.stratum].shift(); if (await fetchImage(s)) rep = s; else swaps.push({ spare: s.uid, why: 'spare image failed too' }); }
    swaps.push({ out: r.uid, in: rep?.uid ?? null, why: 'image fetch failed' });
    if (rep) rows.push(rep);
  }
  fs.writeFileSync(path.join(HERE, 'sample.json'), JSON.stringify({ from: 'draw.json', swaps, rows }, null, 1) + '\n');
  console.log('sample', rows.length, 'swaps', swaps.length);
}

const LANGUAGE_INSTRUCTION = '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).';
async function stagePrompt() {
  const { client, db } = await mongo();
  const p = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  await client.close();
  const base = p.content.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '');
  fs.writeFileSync(W('prompt-lite.txt'), base);
  fs.writeFileSync(W('prompt-cli.txt'), base + '\n\nTranscribe the attached page image. Output only the transcription in the format above, with no preamble and no commentary. The page image is attached:');
  fs.writeFileSync(path.join(HERE, 'prompt-ref.json'), JSON.stringify({ id: String(p._id), name: p.name, version: String(p.version ?? ''), hash: p.content_hash ?? null, chars: base.length }, null, 1) + '\n');
  console.log('prompt', p.name, 'v' + p.version, base.length, 'chars');
}

async function stageStored() {
  const { client, db } = await mongo();
  const rows = sample();
  const pages = await db.collection('pages').find({ id: { $in: rows.map(r => r.page_id) } }, { projection: { _id: 0, id: 1, ocr: 1 } }).toArray();
  await client.close();
  const by = new Map(pages.map(p => [p.id, p]));
  fs.writeFileSync(R('P.jsonl'), '');
  for (const r of rows) {
    const o = by.get(r.page_id)?.ocr || {};
    append(R('P.jsonl'), { uid: r.uid, arm: 'P', model: o.model ?? null, prompt_version: o.prompt_version ?? null, updated_at: o.updated_at ?? null, source: o.source ?? null, text: o.data || '', unreadable: o.unreadable ?? null });
  }
  console.log('stored', rows.length);
}

async function stageLite() {
  const run = args.run;
  if (!['L1', 'L2'].includes(run)) throw new Error('--run=L1|L2');
  const { callGemini } = await import('../../lib/gemini-script-client.mjs');
  const { MODEL_PRICING } = await import('../../lib/model-pricing.mjs');
  const price = MODEL_PRICING[LITE];
  const costOf = r => ((r.inputTokens || 0) * price.input + ((r.outputTokens || 0) + (r.thinkingTokens || 0)) * price.output) / 1e6;
  const spent = () => [...readJsonl(R('L1.jsonl')), ...readJsonl(R('L2.jsonl'))].reduce((n, r) => n + (r.cost || 0), 0);
  const promptText = fs.readFileSync(W('prompt-lite.txt'), 'utf8');
  const done = new Set(readJsonl(R(`${run}.jsonl`)).filter(r => !r.error).map(r => r.uid));
  const todo = sample().filter(r => !done.has(r.uid));
  console.log(run, todo.length, 'to run; spent so far $' + spent().toFixed(4));
  let stopped = false;
  await pool(todo, 4, async r => {
    if (stopped) return;
    if (spent() > SPEND_CAP - 0.05) { stopped = true; console.log('SPEND STOP'); return; }
    const t0 = Date.now(); let row;
    try {
      // realtime-ocr.mjs generationConfig: temperature 0.1, thinkingBudget 0, maxOutputTokens 16384
      const g = await callGemini({ model: LITE, prompt: promptText, endpoint: ENDPOINT, imageParts: [fs.readFileSync(img(r.uid))], type: 'ocr', bookId: r.book_id, pageIds: [r.page_id], temperature: 0.1, maxOutputTokens: 16384, thinkingBudget: 0 });
      row = { uid: r.uid, arm: run, model: LITE, route: 'api', date: new Date().toISOString(), text: g.text || '', finishReason: g.finishReason ?? null, inputTokens: g.inputTokens, outputTokens: g.outputTokens, thinkingTokens: g.thinkingTokens, secs: (Date.now() - t0) / 1000 };
      row.cost = costOf(row);
    } catch (e) { row = { uid: r.uid, arm: run, model: LITE, date: new Date().toISOString(), error: String(e.message).slice(0, 300) }; }
    append(R(`${run}.jsonl`), row);
  });
  console.log(run, 'done; spent $' + spent().toFixed(4));
}

function stageCliReq() {
  const rows = sample().map(r => ({ uid: r.uid, image: img(r.uid) }));
  fs.writeFileSync(W('cli-requests.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log('cli requests', rows.length, '→', W('cli-requests.jsonl'));
}

function stageImportG() {
  const last = new Map(readJsonl(W('G-raw.jsonl')).map(r => [r.uid, r]));
  fs.writeFileSync(R('G.jsonl'), '');
  for (const r of sample()) { const g = last.get(r.uid); append(R('G.jsonl'), g ? { ...g, arm: 'G' } : { uid: r.uid, arm: 'G', text: '', error: 'not run' }); }
  console.log('G imported', last.size);
}

// ── Sonnet via claude -p (subscription). No API key may reach it: every ANTHROPIC_* variable is removed. ──
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function runClaude(r, promptText) {
  return new Promise(resolve => {
    const ws = W('sonnet-ws', safe(r.uid));
    fs.mkdirSync(ws, { recursive: true });
    fs.copyFileSync(img(r.uid), path.join(ws, 'page.jpg'));
    const prompt = `${promptText}\n\nThe page image to transcribe is the file ./page.jpg in the current directory. Open it with the Read tool (that is the only tool you may use), then transcribe it. Output only the transcription in the format above, with no preamble and no commentary.`;
    const t0 = Date.now();
    const p = spawn('claude', ['-p', prompt, '--model', 'sonnet', '--output-format', 'json', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Agent,Task', '--max-turns', '4'], { cwd: ws, env: claudeEnv() });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 300000);
    p.on('close', code => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not json */ }
      fs.rmSync(ws, { recursive: true, force: true });
      resolve({ uid: r.uid, arm: 'S', model: 'claude-sonnet (claude -p)', route: 'claude-cli', date: new Date().toISOString(), text: j.result || '', exit: code, is_error: j.is_error ?? null, subtype: j.subtype ?? null, num_turns: j.num_turns ?? null, secs: (Date.now() - t0) / 1000, error: code === 0 && !j.is_error ? null : (err || out).slice(-300) });
    });
  });
}
async function stageSonnet() {
  const promptText = fs.readFileSync(W('prompt-lite.txt'), 'utf8');
  const done = new Set(readJsonl(R('S.jsonl')).filter(r => r.text && !r.error).map(r => r.uid));
  let todo = sample().filter(r => !done.has(r.uid));
  if (args.limit) todo = todo.slice(0, +args.limit);
  console.log('S', todo.length, 'to run');
  await pool(todo, +(args.parallel || 2), async r => {
    const row = await runClaude(r, promptText);
    append(R('S.jsonl'), row);
    console.log(`  ${r.uid} ${row.error ? 'ERR ' + row.error.slice(0, 80) : 'ok'} ${row.text.length} chars ${Math.round(row.secs)}s`);
  });
}

// ── Kraken + CATMuS on CPU, serial and niced (the bench2 command). ──
async function stageKraken() {
  const K = '/root/bench2-kraken/venv/bin/kraken', M = '/root/bench2-kraken/models/catmus.mlmodel';
  const done = new Set(readJsonl(R('O.jsonl')).filter(r => !r.error).map(r => r.uid));
  const todo = sample().filter(r => r.stratum !== 'zh-manuscript' && !done.has(r.uid));
  console.log('O', todo.length, 'to run');
  fs.mkdirSync(W('kraken'), { recursive: true });
  for (const r of todo) {
    const outF = W('kraken', `${safe(r.uid)}.txt`);
    const t0 = Date.now();
    const p = spawnSync('timeout', ['600', 'nice', '-n', '15', K, '-i', img(r.uid), outF, 'segment', '-bl', 'ocr', '-m', M], { encoding: 'utf8' });
    const text = fs.existsSync(outF) ? fs.readFileSync(outF, 'utf8') : '';
    const row = { uid: r.uid, arm: 'O', model: 'kraken+catmus.mlmodel', route: 'local-cpu', date: new Date().toISOString(), text, exit: p.status, secs: (Date.now() - t0) / 1000, error: p.status === 0 ? null : (p.stderr || '').slice(-300) };
    append(R('O.jsonl'), row);
    console.log(`  ${r.uid} rc=${p.status} ${text.length} chars ${Math.round(row.secs)}s`);
  }
}

// ── Archive OCR leaf (IA books, Latin and English). ──
const decode = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
function leafTexts(xml) {
  const out = [];
  for (const o of xml.split(/<OBJECT\b/).slice(1)) {
    const paras = [];
    for (const p of o.split(/<PARAGRAPH\b/).slice(1)) {
      const lines = [];
      for (const l of p.split(/<LINE\b/).slice(1)) { const w = [...l.matchAll(/<WORD[^>]*>([\s\S]*?)<\/WORD>/g)].map(m => decode(m[1]).trim()).filter(Boolean); if (w.length) lines.push(w.join(' ')); }
      if (lines.length) paras.push(lines.join('\n'));
    }
    out.push(paras.join('\n\n'));
  }
  return out;
}
async function stageIa() {
  const { agreementPrimary } = await import('../lib/metrics.mjs');
  const G = new Map(readJsonl(R('G.jsonl')).map(r => [r.uid, r]));
  fs.mkdirSync(W('ia-cache'), { recursive: true });
  fs.writeFileSync(R('IA.jsonl'), '');
  for (const r of sample().filter(x => x.stratum !== 'zh-manuscript')) {
    if (!r.ia_identifier) { append(R('IA.jsonl'), { uid: r.uid, arm: 'IA', text: '', skipped: 'not an Internet Archive book' }); continue; }
    const id = r.ia_identifier, x = W('ia-cache', `${id}_djvu.xml`), shared = `/root/sl-ia-cache/${id}_djvu.xml`;
    let xml = fs.existsSync(x) ? fs.readFileSync(x, 'utf8') : fs.existsSync(shared) ? fs.readFileSync(shared, 'utf8') : null;
    if (!xml) {
      const res = await fetch(`https://archive.org/download/${id}/${id}_djvu.xml`, { headers: { 'User-Agent': UA }, redirect: 'follow' }).catch(() => null);
      if (res?.ok) { xml = await res.text(); fs.writeFileSync(x, xml); }
      await new Promise(s => setTimeout(s, 1000));
    }
    if (!xml) { append(R('IA.jsonl'), { uid: r.uid, arm: 'IA', text: '', skipped: 'no _djvu.xml' }); continue; }
    const leaves = leafTexts(xml), g = G.get(r.uid)?.text || '';
    let best = null;
    for (let off = -3; off <= 3; off++) {
      const k = r.page_number - 1 + off;
      if (k < 0 || k >= leaves.length) continue;
      const a = g ? agreementPrimary(leaves[k], g) ?? 0 : (off === 0 ? 1 : 0);
      if (!best || a > best.a) best = { k, off, a };
    }
    append(R('IA.jsonl'), best ? { uid: r.uid, arm: 'IA', model: 'ia-djvu', text: leaves[best.k], leaf_index: best.k, offset: best.off, locate_agreement: +best.a.toFixed(3), leaves: leaves.length } : { uid: r.uid, arm: 'IA', text: '', skipped: 'leaf out of range' });
    console.log(`  ${r.uid} ${best ? `off ${best.off} agr ${best.a.toFixed(2)}` : 'out of range'}`);
  }
}

const STAGES = { images: stageImages, prompt: stagePrompt, stored: stageStored, lite: stageLite, 'cli-req': stageCliReq, 'import-g': stageImportG, sonnet: stageSonnet, kraken: stageKraken, ia: stageIa };
if (!STAGES[STAGE]) { console.error('stages:', Object.keys(STAGES).join(' ')); process.exit(2); }
await STAGES[STAGE]();

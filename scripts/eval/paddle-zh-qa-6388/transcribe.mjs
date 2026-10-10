#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-prereg-6388/reads.mjs — stagePrompt (the live OCR prompt, built the same way), stageCliReq
// (requests for run-cli-arm.py) and runClaude (`claude -p`, image opened with Read, every ANTHROPIC_* variable removed),
// copied here because that script is bound to its own draw (sample.json) and runs Sonnet, not Opus.
//
// #6388 Paddle zh QA: the TRANSCRIPTION comparison. Opus and Gemini 3.8 Flash each transcribe the 60 drawn pages from
// the image alone, with the live OCR prompt. Writes NOTHING to Mongo. $0 (subscriptions).
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/paddle-zh-qa-6388/transcribe.mjs <stage>
//     prompt    the live OCR prompt → $JOB_SCRATCH/prompt-{base,cli}.txt, prompt-ocr-ref.json
//     cli-req   $JOB_SCRATCH/tx-requests.jsonl for run-cli-arm.py (arm TG, Gemini 3.8 Flash)
//     opus      arm TO: `claude -p --model opus` → reads/TO.jsonl   [--parallel=3] [--limit=N]
//     import-g  $JOB_SCRATCH/TG-raw.jsonl → reads/TG.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH || '/tmp/paddle-qa-6388';
const W = f => path.join(SCRATCH, f);
const R = f => path.join(HERE, 'reads', f);
fs.mkdirSync(path.join(HERE, 'reads'), { recursive: true });
const STAGE = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const append = (f, row) => fs.appendFileSync(f, JSON.stringify(row) + '\n');
const safe = uid => uid.replace(/[^\w.-]/g, '_');
const img = uid => W(`img/${safe(uid)}.jpg`);
const sample = () => JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8')).rows;
const MAX_CALLS = Number(args['max-calls'] || 70);

const LANGUAGE_INSTRUCTION = '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).';
async function stagePrompt() {
  const { MongoClient } = await import('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const p = await client.db('bookstore').collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  await client.close();
  const base = p.content.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '');
  fs.writeFileSync(W('prompt-base.txt'), base);
  fs.writeFileSync(W('prompt-cli.txt'), base + '\n\nTranscribe the attached page image. Output only the transcription in the format above, with no preamble and no commentary. The page image is attached:');
  const ref = { id: String(p._id), name: p.name, version: String(p.version ?? ''), hash: p.content_hash ?? null, chars: base.length, fetched_at: new Date().toISOString() };
  fs.writeFileSync(path.join(HERE, 'prompt-ocr-ref.json'), JSON.stringify(ref, null, 1) + '\n');
  console.log('prompt', p.name, 'v' + p.version, base.length, 'chars');
}

function stageCliReq() {
  const rows = sample().map(r => ({ uid: r.uid, image: img(r.uid) }));
  for (const r of rows) if (!fs.existsSync(r.image)) throw new Error(`missing image ${r.image}`);
  fs.writeFileSync(W('tx-requests.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log('cli requests', rows.length, '→', W('tx-requests.jsonl'));
}

function stageImportG() {
  const last = new Map(readJsonl(W('TG-raw.jsonl')).map(r => [r.uid, r]));
  fs.writeFileSync(R('TG.jsonl'), '');
  for (const r of sample()) { const g = last.get(r.uid); append(R('TG.jsonl'), g ? { ...g, arm: 'TG' } : { uid: r.uid, arm: 'TG', text: '', error: 'not run' }); }
  console.log('TG imported', last.size);
}

function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function runClaude(r, promptText) {
  return new Promise(resolve => {
    const ws = W(`opus-tx-ws/${safe(r.uid)}`);
    fs.mkdirSync(ws, { recursive: true });
    fs.copyFileSync(img(r.uid), path.join(ws, 'page.jpg'));
    const prompt = `${promptText}\n\nThe page image to transcribe is the file ./page.jpg in the current directory. Open it with the Read tool (that is the only tool you may use), then transcribe it. Output only the transcription in the format above, with no preamble and no commentary.`;
    const t0 = Date.now();
    const p = spawn('claude', ['-p', prompt, '--model', 'opus', '--output-format', 'json', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Agent,Task', '--max-turns', '4'], { cwd: ws, env: claudeEnv() });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 600000);
    p.on('close', code => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not json */ }
      fs.rmSync(ws, { recursive: true, force: true });
      resolve({ uid: r.uid, arm: 'TO', model: Object.keys(j.modelUsage || {}).join(',') || 'opus (claude -p)', route: 'claude-cli', date: new Date().toISOString(), text: j.result || '', exit: code, is_error: j.is_error ?? null, subtype: j.subtype ?? null, num_turns: j.num_turns ?? null, secs: (Date.now() - t0) / 1000, error: code === 0 && !j.is_error ? null : (err || out).slice(-300) });
    });
  });
}
async function stageOpus() {
  const promptText = fs.readFileSync(W('prompt-base.txt'), 'utf8');
  const prior = readJsonl(R('TO.jsonl'));
  const done = new Set(prior.filter(r => r.text && !r.error).map(r => r.uid));
  let todo = sample().filter(r => !done.has(r.uid));
  if (args.limit) todo = todo.slice(0, +args.limit);
  console.log(`TO: ${todo.length} to run, ${prior.length} calls already made (cap ${MAX_CALLS})`);
  let calls = prior.length, i = 0;
  await Promise.all(Array.from({ length: +(args.parallel || 3) }, async () => {
    while (i < todo.length) {
      const r = todo[i++];
      if (calls >= MAX_CALLS) { console.log('CALL CAP'); return; }
      calls++;
      const row = await runClaude(r, promptText);
      append(R('TO.jsonl'), row);
      console.log(`  ${r.uid} ${row.error ? 'ERR ' + row.error.slice(0, 80) : row.text.length + ' chars'} ${Math.round(row.secs)}s`);
      if (/usage limit|rate limit|quota/i.test(row.error || '')) { console.log('LIMIT — stopping'); i = todo.length; }
    }
  }));
}

const stages = { prompt: stagePrompt, 'cli-req': stageCliReq, opus: stageOpus, 'import-g': stageImportG };
if (!stages[STAGE]) { console.error('stage?', Object.keys(stages).join(' | ')); process.exit(2); }
await stages[STAGE]();

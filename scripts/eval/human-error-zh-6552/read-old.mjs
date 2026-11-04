#!/usr/bin/env node
// PRIOR ART: judge.mjs (this directory; the same lean claude -p call, for a verdict on a span). agy-ocr-per-call-6740 reads with Gemini. Here Opus transcribes a whole leaf once.
// #6552 collection C: Opus reads the old print's leaves on a CLI, or the Taisho leaf's body, into $JOB_SCRATCH/<c>/pages/<uid>.json as its `ocr`. Never written anywhere else.
//   node read-old.mjs --c=c-o
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const ROOT = path.join(process.env.JOB_SCRATCH, arg('c')), CONC = +arg('conc', 3);
const PROMPT = (f) => `Read the image ${f}: one leaf of a Chinese woodblock print of a Buddhist sutra (columns top to bottom, right to left). Transcribe exactly what is printed in the body, character by character, in reading order. Write the forms the block writes, variant forms and errors included: do not correct, do not supply from memory what the text ought to say. An illegible character is □. Leave out page margins, fold labels and marginal notes. Reply with the text only.`;
const call = (prompt) => new Promise((res) => { const c = spawn('claude', ['-p', '--model', 'opus', '--strict-mcp-config', '--setting-sources', 'local', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json', '--system-prompt', 'You transcribe Chinese prints from images, exactly as written.', '--tools', 'Read', '--allowedTools', 'Read'], { cwd: path.join(ROOT, 'img'), stdio: ['pipe', 'pipe', 'pipe'] }); let o = ''; c.stdout.on('data', (d) => o += d); c.stderr.on('data', () => {}); c.stdin.end(prompt); c.on('close', () => { try { const j = JSON.parse(o); res({ text: j.is_error ? '' : j.result, cost: j.total_cost_usd }); } catch { res({ text: '' }); } }); });
const todo = fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => !JSON.parse(fs.readFileSync(path.join(ROOT, 'pages', f))).ocr); let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (next < todo.length) { const f = todo[next++], uid = f.slice(0, -5), r = await call(PROMPT(path.join(ROOT, 'img', `${uid}.jpg`))); if (!r.text) { console.log(uid, 'FAILED'); continue; } const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages', f))); d.ocr = r.text; d.read_by = 'opus-cli'; fs.writeFileSync(path.join(ROOT, 'pages', f), JSON.stringify(d)); console.log(uid, [...r.text].length, r.cost); } }));

#!/usr/bin/env node
// PRIOR ART: translate-cli-lane-7075/sample.mjs judge (Opus and Gemini over a packet, resumable: parseJson imported, its packets
// are translations); agy-ocr-per-call-6740/judge.mjs (the claude -p call shape). Same shape here for span panels.
// #6552: one reader over one tag's packets. --reader=opus|gemini|opus-noimage. Verdicts: $JOB_SCRATCH/<c>/tags/<tag>/verdicts-<reader>.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { agyCall, installToolGate, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const C = arg('c'), TAG = arg('tag'), READER = arg('reader'), CONC = +arg('conc', READER === 'gemini' ? 4 : 3), LIMIT = +arg('limit', 1e9);
const OUT = path.join(process.env.JOB_SCRATCH, C, 'tags', TAG), F = path.join(OUT, `verdicts-${READER}.jsonl`);
const packs = JSON.parse(fs.readFileSync(path.join(OUT, 'packets.json'), 'utf8'));
const done = new Set(fs.existsSync(F) ? fs.readFileSync(F, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.items).map((r) => r.packet) : []);

const RULES = `Each numbered entry has a context with [?] at one position, and usually two candidate readings for that position. A reading of "(nothing)" means no character there. Readings can be right or wrong; neither has any authority, and the context can hold slips of its own (□ marks an unsettled character).
For each entry answer from the leaf, not from what the text ought to say:
- choice: "A" or "B" if that reading is what the leaf writes at [?]; "neither" if the leaf clearly writes something else; "cannot_tell" if the panel does not show this passage, or the character is damaged or illegible. If the passage is not in the panel, say cannot_tell: do not guess from sense.
- seen: the character(s) you see on the leaf at [?], as written, "" if you cannot see it. For an entry with no candidate readings, seen is the whole answer and choice is "read" or "cannot_tell".
- variant: true if A and B are two written forms of one character (異體字, 俗字, 古今字), false if they are different characters, null if no readings.
- slip: true only if the leaf itself evidently has a mistake at [?] and the other reading is what the text must mean. Otherwise false.
Reply with JSON only: {"items":[{"n":1,"choice":"A","seen":"…","variant":false,"slip":false}, …]}`;
const WITH_IMAGE = (p, file) => `The image ${file} has up to six numbered panels (red numbers), each cropped from a page of a Chinese manuscript or print. Look at it first; zoom is not available. Vertical columns read top to bottom, columns right to left; small double-line notes run inside a column.\n\n${RULES}\n\n${p.text}`;
const NO_IMAGE = (p) => `No image is available. These are positions in classical Chinese texts. For each entry say which reading is the likelier text from your knowledge and the sense of the context alone.\n\n${RULES.replace('answer from the leaf, not from what the text ought to say', 'answer from your knowledge of the text and the sense')}\n\n${p.text}`;

const parse = (t, n) => { const m = String(t || '').match(/\{[\s\S]*\}/); try { const v = JSON.parse(m[0]); return Array.isArray(v.items) && v.items.length === n ? v.items : null; } catch { return null; } };
function claude(prompt, withRead) {
  const args = ['-p', '--model', 'opus', '--strict-mcp-config', '--setting-sources', 'local', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json', '--system-prompt', 'You read Chinese manuscripts and prints against their images and reply with JSON only.', ...(withRead ? ['--tools', 'Read', '--allowedTools', 'Read'] : ['--tools', ''])];
  return new Promise((res) => {
    const c = spawn('claude', args, { cwd: path.join(OUT, 'sheets'), stdio: ['pipe', 'pipe', 'pipe'] }); let o = '', e = '';
    const timer = setTimeout(() => c.kill('SIGKILL'), 420_000);
    c.stdout.on('data', (d) => o += d); c.stderr.on('data', (d) => e += d); c.stdin.end(prompt);
    c.on('close', () => { clearTimeout(timer); try { const j = JSON.parse(o); res({ text: j.result, usage: j.usage, cost: j.total_cost_usd, err: j.is_error ? String(j.result).slice(0, 200) : null }); } catch { res({ text: '', err: (e || o).slice(0, 300) }); } });
  });
}
async function gemini(prompt) {
  const dir = path.join(OUT, 'sheets'); installToolGate(dir, { task: 'ocr' });
  const r = await agyCall(['-p', prompt, '--model', 'gemini-3.8-flash-high', ...CLI_SAFE_ARGS], dir);
  return { text: r.text, usage: r.usage, err: r.cls && r.cls !== 'ok' ? `${r.cls} ${String(r.err || '').slice(0, 200)}` : null };
}
const todo = packs.filter((p) => !done.has(p.packet)).slice(0, LIMIT); let next = 0, fails = 0;
async function worker() {
  while (next < todo.length && fails < 8) {
    const p = todo[next++];
    const prompt = READER === 'opus-noimage' ? NO_IMAGE(p) : WITH_IMAGE(p, READER === 'opus' ? path.join(OUT, 'sheets', p.file) : p.file);
    let r, items = null;
    for (let a = 0; a < 2 && !items; a++) {
      r = READER === 'gemini' ? await gemini(prompt) : await claude(prompt, READER === 'opus');
      items = parse(r.text, p.n);
      if (r.err && /quota/i.test(r.err)) { fails = 99; break; }
    }
    if (!items) fails++;
    fs.appendFileSync(F, JSON.stringify({ packet: p.packet, reader: READER, items, err: items ? null : (r.err || String(r.text).slice(0, 200)), usage: r.usage ?? null, cost: r.cost ?? null }) + '\n');
    console.log(READER, p.packet, items ? 'ok' : 'FAILED', items ? '' : (r.err || '').slice(0, 120));
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

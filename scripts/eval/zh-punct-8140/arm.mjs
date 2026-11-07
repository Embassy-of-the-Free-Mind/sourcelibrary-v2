// PRIOR ART: scripts/lib/agy-cli.mjs gatedTextCall (the agy text call: plan mode, tool gate, sentinels — used as is);
// scripts/eval/temp-6202/dispatch.sh and pro-translate-6545/claude-arm.py (`claude -p --model opus` per chunk); neither
// takes a page list and writes one JSON row per page with timing, so this is a small runner over both.
/**
 * #8140 arm runner. One page per call. Reads <priv>/<frame>/<slug>.key.txt (frame A) or <slug>.input.txt (frame B),
 * builds the input with lib.stripForInput, sends prompt.txt, writes <priv>/<frame>/out-<arm>/<slug>.json
 * ({slug, arm, raw, answer, problem, calls, seconds, cls}). Outputs hold the source's characters → never committed.
 *   node scripts/eval/zh-punct-8140/arm.mjs --arm=G|G2|O --frame=A|B --priv=DIR --slugs=a,b,c|--list=FILE [--conc=3]
 */
import fs from 'fs'; import path from 'path'; import os from 'os'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { stripForInput } from './lib.mjs';
import { gatedTextCall, isQuotaError } from '../../lib/agy-cli.mjs';
import { unwrapSentinels } from '../../lib/cli-chatter.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ARM = argOf('arm'), FRAME = argOf('frame', 'A'), PRIV = path.join(argOf('priv'), FRAME), CONC = +argOf('conc', 3);
const slugs = argOf('slugs') ? argOf('slugs').split(',') : fs.readFileSync(argOf('list'), 'utf8').split('\n').filter(Boolean);
const TEMPLATE = fs.readFileSync(path.join(here, 'prompt.txt'), 'utf8');
const OUT = path.join(PRIV, `out-${ARM}`); fs.mkdirSync(OUT, { recursive: true });
const inputOf = (slug) => { const f = path.join(PRIV, `${slug}.input.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : stripForInput(fs.readFileSync(path.join(PRIV, `${slug}.key.txt`), 'utf8')); };
let stop = false;

function claudeCall(prompt) {
  return new Promise((resolve) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zhp-opus-'));
    const t0 = Date.now();
    const p = spawn('/root/.local/bin/claude', ['-p', '--model', 'opus', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence'], { cwd, env: { ...process.env } });
    let out = '', err = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    const killer = setTimeout(() => p.kill('SIGKILL'), 360_000);
    p.on('close', (code) => {
      clearTimeout(killer); fs.rmSync(cwd, { recursive: true, force: true });
      let j = {}; try { j = JSON.parse(out); } catch { /* not json */ }
      const text = j.result ?? '';
      const limit = /usage limit|rate limit|limit reached|resets? at/i.test(err + (j.is_error ? text : ''));
      resolve({ code, text, err: err.slice(0, 500), seconds: (Date.now() - t0) / 1000, cls: limit ? 'quota' : (code !== 0 || j.is_error ? 'error' : null), usage: j.usage || null, cost_equiv: j.total_cost_usd ?? null });
    });
    p.stdin.end(prompt);
  });
}

async function one(slug) {
  const f = path.join(OUT, `${slug}.json`);
  if (fs.existsSync(f)) return;
  const input = inputOf(slug);
  const prompt = TEMPLATE.replace('{{TEXT}}', input);
  const t0 = Date.now();
  let row;
  if (ARM.startsWith('G')) {
    const r = await gatedTextCall(prompt, { model: 'gemini-3.8-flash-low', task: 'translate', attempts: 3, tmp: os.tmpdir() });
    const quota = r.cls === 'quota' || isQuotaError({ out: r.out || '', err: r.err || '', text: r.text || '' });
    row = { slug, arm: ARM, raw: r.text ?? '', answer: r.answer ?? null, problem: r.problem ?? null, calls: r.calls, seconds: (Date.now() - t0) / 1000, cls: quota ? 'quota' : r.cls ?? null, usage: r.usage ?? null };
  } else {
    let r, calls = 0;
    while (calls < 3) { r = await claudeCall(prompt); calls++; if (r.cls === 'quota') break; const u = unwrapSentinels(r.text); if (!r.cls && u.inside) break; }
    const u = unwrapSentinels(r.text);
    row = { slug, arm: ARM, raw: r.text, answer: u.inside ?? null, problem: u.inside ? null : 'no-markers', calls, seconds: (Date.now() - t0) / 1000, cls: r.cls, usage: r.usage, cost_equiv: r.cost_equiv, err: r.cls ? r.err : undefined };
  }
  if (row.cls === 'quota') { stop = true; console.error(`QUOTA at ${slug}: stopping`); return; }
  fs.writeFileSync(f, JSON.stringify(row));
  process.stdout.write(`${slug} ${row.answer ? 'ok' : 'EMPTY:' + row.problem} ${row.seconds.toFixed(0)}s c${row.calls}\n`);
}
const q = [...slugs];
await Promise.all(Array.from({ length: CONC }, async () => { while (q.length && !stop) await one(q.shift()); }));
console.log(stop ? 'STOPPED on quota' : 'done');

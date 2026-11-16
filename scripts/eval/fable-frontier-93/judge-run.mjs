#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs judge (judgePrompt, parseVerdict, opusCall's sealed claude -p with
// Read only; its verdicts-<judge>.jsonl rows). Reused: the prompt and parser. Not reused: its loop, which is Opus only
// and reads limits through model-limits.mjs's sessionMax; #93 needs a second Claude judge (Fable) on the same items and
// the brief's two stops (team@ week >= 85%, Fable bar >= 70%), so the loop is re-done here, lean (JOB-HOSTS.md).
/**
 *   node scripts/eval/fable-frontier-93/judge-run.mjs --out=DIR --judge=opus|fable [--concurrency=3] [--limit=N] [--kinds=item,planted] [--max-rank=0]
 * One output per call, the page image in the call's empty workspace, Read the only tool. Appends DIR/verdicts-<judge>.jsonl.
 * Resumable; an item that failed to parse 3 times is left. Exit 3 = stopped on a limit (meter or quota reply).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { judgePrompt, parseVerdict, QUOTA } from '../route-judge-6740/judge.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out'), JUDGE = arg('judge');
export const MODELS = { opus: 'claude-opus-5-5', fable: 'claude-fable-5-2' };
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** The brief's stops, from the climits meter this box gets every 5 min (team@ is l7a's login). */
export function meterStop({ weeklyMax = 85, fableMax = 70, email = 'team@sourcelibrary.org' } = {}) {
  try {
    const d = JSON.parse(fs.readFileSync('/root/.claude-limits/latest.json', 'utf8'));
    const a = d.accounts.find((x) => x.email === email && x.ok);
    if (!a) return null;
    const w = a.limits.find((l) => l.key === 'weekly_all:all')?.percent, f = a.limits.find((l) => l.key === 'weekly_scoped:Fable')?.percent;
    if (w >= weeklyMax) return `team@ week ${w}% >= ${weeklyMax}%`;
    if (f >= fableMax) return `team@ Fable ${f}% >= ${fableMax}%`;
    return null;
  } catch { return null; }
}
const env = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER|^CLAUDE_CODE_SESSION|^CLAUDE_CODE_MESSAGING/.test(k)) delete e[k]; return e; };
/** Lean sealed call: Read only, no MCP, no settings, no slash commands, no transcript. */
export function call(prompt, cwd, model) {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--model', model, '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: env() });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 7200e3); // the pace guard's queue wait counts against this
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '');
      resolve({ text, cls: (j.is_error || code !== 0) && QUOTA.test(text + out + err) ? 'quota' : code !== 0 ? `exit_${code}` : null, models: Object.keys(j.modelUsage || {}), usage: j.usage ?? null, cost: j.total_cost_usd ?? null });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  if (!OUT || !MODELS[JUDGE]) { console.error('--out=DIR --judge=opus|fable'); process.exit(2); }
  const kinds = arg('kinds')?.split(','), limit = Number(arg('limit') || Infinity);
  const key = JSON.parse(fs.readFileSync(path.join(OUT, 'key.json'), 'utf8'));
  const want = new Set(key.filter((k) => !kinds || kinds.includes(k.kind)).map((k) => k.judged_as));
  const items = JSON.parse(fs.readFileSync(path.join(OUT, 'packet.json'), 'utf8')).items.filter((it) => want.has(it.id));
  const file = path.join(OUT, `verdicts-${JUDGE}.jsonl`);
  const rows = jsonl(file), done = new Set(rows.filter((r) => r.verdict).map((r) => r.id)), tries = new Map();
  for (const r of rows) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  // Priority, so a budget stop still leaves the main answer: FABLE and OPUSX items and the controls, then OPUS2, then LIVE.
  const rank = new Map();
  // Within a rank: controls first, then items page by page, so a stop mid-run leaves both arms judged on the same pages.
  const sub = new Map();
  for (const k of key) {
    rank.set(k.judged_as, Math.min(rank.get(k.judged_as) ?? 9, { FABLE: 0, OPUSX: 0, OPUS2: 1, LIVE: 2 }[k.route] ?? 3));
    sub.set(k.judged_as, `${k.kind === 'item' ? 1 : 0}:${k.uid}`);
  }
  // --max-rank=0 judges only the FABLE/OPUSX items and their controls (the main comparison), so both judges can cover it first.
  const maxRank = Number(arg('max-rank') ?? 9);
  const todo = items.filter((it) => !done.has(it.id) && (tries.get(it.id) ?? 0) < 3 && rank.get(it.id) <= maxRank)
    .sort((a, b) => rank.get(a.id) - rank.get(b.id) || sub.get(a.id).localeCompare(sub.get(b.id)));
  console.log(`${JUDGE}: ${todo.length} of ${items.length} items to judge`);
  let stop = null, calls = 0, i = 0;
  const one = async (it) => {
    if (stop || calls >= limit) return;
    if (calls % 10 === 0) { const m = meterStop(); if (m) { stop = m; return; } }
    calls++;
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `f93-${JUDGE}-`));
    try {
      fs.copyFileSync(it.image_file, path.join(ws, 'page.jpg'));
      const t0 = Date.now();
      const r = await call(judgePrompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws, MODELS[JUDGE]);
      if (r.cls === 'quota') { stop = `quota reply: ${r.text.slice(0, 160)}`; return; }
      const v = parseVerdict(r.text);
      fs.appendFileSync(file, JSON.stringify({ id: it.id, judge: JUDGE, models: r.models, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 500), usage: r.usage, list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.id}: ${v ? `accept=${v.accept} ${v.fidelity} (${(v.defects || []).length} defects)` : `unparsed ${r.cls ?? ''}`} [${r.models.join(',')}]`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const conc = Math.max(1, Math.min(6, Number(arg('concurrency') || 3)));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length && calls < limit) await one(todo[i++]); }));
  if (stop) { console.log(`STOPPED: ${stop}`); process.exit(3); }
  console.log('done');
}

// PRIOR ART: scripts/eval/paddle-table-pilot-6388/opus.mjs (PR #6574, itself a copy of paddle-table-6388/opus.mjs), copied unchanged apart from this line: claude -p --model opus, one call per request; rows {uid, image, prompt}; ledger opus-calls.jsonl in cwd.
// claude -p --model opus, one call per request. rows: {uid, image, prompt}. Copied shape from paddle-zh-qa-6388/transcribe.mjs runClaude.
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process';
const [, , REQ, OUT, CAP, PAR] = process.argv;
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const reqs = readJsonl(REQ); const prior = readJsonl(OUT);
const done = new Set(prior.filter(r => r.text && !r.error).map(r => r.uid));
const ledger = 'opus-calls.jsonl'; const used = () => readJsonl(ledger).length;
function env() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function run(r) {
  return new Promise(resolve => {
    const ws = path.join(process.cwd(), 'opus-ws', r.uid); fs.mkdirSync(ws, { recursive: true });
    fs.copyFileSync(r.image, path.join(ws, 'page.jpg'));
    const t0 = Date.now();
    const p = spawn('claude', ['-p', r.prompt, '--model', 'opus', '--output-format', 'json', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Agent,Task', '--max-turns', '4'], { cwd: ws, env: env() });
    let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    const timer = setTimeout(() => p.kill('SIGKILL'), 600000);
    p.on('close', code => { clearTimeout(timer); let j = {}; try { j = JSON.parse(out); } catch {} fs.rmSync(ws, { recursive: true, force: true });
      resolve({ uid: r.uid, model: Object.keys(j.modelUsage || {}).join(',') || 'opus', date: new Date().toISOString(), text: j.result || '', exit: code, secs: (Date.now() - t0) / 1000, num_turns: j.num_turns ?? null, api_equiv_usd: j.total_cost_usd ?? null, error: code === 0 && !j.is_error ? null : (err || out).slice(-300) }); });
  });
}
const todo = reqs.filter(r => !done.has(r.uid)); let i = 0;
console.log(`${todo.length} to run; ledger ${used()} of cap ${CAP}`);
await Promise.all(Array.from({ length: +(PAR || 3) }, async () => {
  while (i < todo.length) { const r = todo[i++];
    if (used() >= +CAP) { console.log('CAP BINDS'); return; }
    fs.appendFileSync(ledger, JSON.stringify({ uid: r.uid, out: OUT, at: new Date().toISOString() }) + '\n');
    const row = await run(r); fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    console.log(r.uid, row.error ? 'ERR ' + row.error.slice(0, 100) : row.text.length + ' chars', Math.round(row.secs) + 's');
    if (/usage limit|rate limit|quota/i.test(row.error || '')) { console.log('LIMIT'); i = todo.length; } }
}));
console.log('DONE ledger', used());

// node run-claude.mjs <OK|TEAM|BARE> <runName> [concurrency] : Opus 5.5 via `claude -p` (subscription), one call per group.
// Resumable; stops queueing on a usage-limit answer. Writes $MS/runs/<runName>/<groupId>.json.
// PRIOR ART: round 2's run-claude2.mjs (l7a scratch), same spawn/parse/limit handling, Palenque paths.
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
import { buildPrompt, groups, MS } from './prompts.mjs';
const [arm, name, conc = '4'] = process.argv.slice(2);
const out = MS + 'runs/' + name; fs.mkdirSync(out, { recursive: true });
let limitHit = false;
function run(it) {
  return new Promise((res) => {
    const f = `${out}/${it.id}.json`;
    if (fs.existsSync(f) && JSON.parse(fs.readFileSync(f)).ok) return res();
    if (limitHit) return res();
    const prompt = buildPrompt(arm, it).replace(/\{IMG:([^}]+)\}/g, (_, n) => `[image file ${MS}set/img/${n} — open it with the Read tool]`);
    const t0 = Date.now(); const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'ms-'));
    const ch = spawn(process.env.CLAUDE_BIN || '/root/.local/bin/claude', ['-p', prompt, '--model', 'claude-opus-5-5', '--allowedTools', 'Read', '--output-format', 'json'], { cwd: ws, stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '', se = ''; ch.stdout.on('data', (d) => so += d); ch.stderr.on('data', (d) => se += d);
    const timer = setTimeout(() => ch.kill('SIGKILL'), 1200000);
    ch.on('close', (code) => {
      clearTimeout(timer); fs.rmSync(ws, { recursive: true, force: true });
      let j = {}; try { j = JSON.parse(so); } catch {}
      const text = j.result || ''; const m = text.match(/<<<BEGIN>>>([\s\S]*?)<<<END>>>/); let parsed = null;
      try { parsed = JSON.parse((m ? m[1] : text).trim().replace(/^```(json)?|```$/g, '')); } catch {}
      const limit = !parsed && /usage limit|limit reached|rate limit/i.test(text + se);
      if (limit) limitHit = true;
      fs.writeFileSync(f, JSON.stringify({ id: it.id, arm, model: 'claude-opus-5-5', ok: !!parsed, parsed, text, code, err: se.slice(-500), limit, secs: (Date.now() - t0) / 1000, turns: j.num_turns, at: new Date().toISOString() }, null, 1));
      console.log(it.id, arm, parsed ? 'ok' : 'FAIL', ((Date.now() - t0) / 1000).toFixed(0) + 's', parsed ? '' : (text || se).slice(0, 200));
      res();
    });
  });
}
const q = groups(arm); let i = 0;
await Promise.all(Array.from({ length: +conc }, async () => { while (i < q.length) await run(q[i++]); }));
console.log(limitHit ? 'LIMIT' : 'DONE', name);

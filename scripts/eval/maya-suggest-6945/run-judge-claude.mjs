// node run-judge-claude.mjs <tag> : Opus 5.5 blind judge (claude -p, no tools) over $MS/runs/judge_prompts_<tag>.json
// -> $MS/runs/judge_opus_<tag>.json. Resumable. PRIOR ART: round 2's run-judge-claude.mjs (l7a scratch), unchanged logic.
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const MS = process.env.MS || '/data/scratch/sl/jobs/maya-suggest-6945/';
const tag = process.argv[2]; const P = JSON.parse(fs.readFileSync(MS + `runs/judge_prompts_${tag}.json`, 'utf8'));
const of = MS + `runs/judge_opus_${tag}.json`; const out = fs.existsSync(of) ? JSON.parse(fs.readFileSync(of, 'utf8')) : {};
for (const p of P) {
  if (out[p.id]?.ok) continue;
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'msj-'));
  const r = spawnSync(process.env.CLAUDE_BIN || '/root/.local/bin/claude', ['-p', p.prompt + '\n\nDo not use any tool; everything you need is above.', '--model', 'claude-opus-5-5', '--output-format', 'json', '--tools', ''], { cwd: ws, encoding: 'utf8', maxBuffer: 1e8, timeout: 1200000 });
  fs.rmSync(ws, { recursive: true, force: true });
  let j = {}; try { j = JSON.parse(r.stdout); } catch {}
  const text = j.result || ''; const m = text.match(/<<<BEGIN>>>([\s\S]*?)<<<END>>>/); let parsed = null;
  try { parsed = JSON.parse((m ? m[1] : text).trim()); } catch {}
  out[p.id] = { ok: !!parsed, parsed, text: parsed ? '' : text.slice(0, 3000), err: (r.stderr || '').slice(-300) };
  fs.writeFileSync(of, JSON.stringify(out, null, 1)); console.log(p.id, parsed ? 'ok' : 'FAIL', parsed?.blocks?.length);
}
console.log('DONE');

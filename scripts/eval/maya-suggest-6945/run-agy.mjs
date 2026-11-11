// Runs on a box where agy is signed in (main). node run-agy.mjs <dir> <model> <runName> [conc]
// <dir> holds prompts-<runName>.json ([{id, prompt, images:[file]}]) and img/<file>; writes <dir>/out-<runName>.json.
// PRIOR ART: round 2's run-agy.mjs (l7a scratch) — same gated agy call via scripts/lib/agy-cli.mjs; per-run prompt files.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const LIB = process.env.AGY_LIB || '/root/sourcelibrary/scripts/lib/agy-cli.mjs';
const { agyCall, installToolGate, gateCalls, CLI_SAFE_ARGS, unwrapRead } = await import(LIB);
const [dir, model, runName, conc = '2'] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync(path.join(dir, `prompts-${runName.replace(/\d+$/, '')}.json`), 'utf8'));
const outF = path.join(dir, `out-${runName}.json`);
const done = fs.existsSync(outF) ? JSON.parse(fs.readFileSync(outF, 'utf8')) : {};
const args = CLI_SAFE_ARGS.map((a) => (a === '300s' ? '600s' : a));
async function one(p) {
  if (done[p.id]?.ok) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ms-agy-'));
    for (const f of p.images) fs.copyFileSync(path.join(dir, 'img', f), path.join(ws, f));
    const log = installToolGate(ws, { task: 'ocr' });
    const sent = p.prompt.replace(/\{IMG:([^}]+)\}/g, (_, n) => `@./${n}`);
    const r = await agyCall(['-p', sent, '--model', model, ...args], ws, { killAfterMs: 700_000 });
    const tools = gateCalls(log); fs.rmSync(ws, { recursive: true, force: true });
    const { text, problem } = unwrapRead(r.text);
    let parsed = null; try { parsed = JSON.parse(text.trim().replace(/^```(json)?|```$/g, '')); } catch {}
    done[p.id] = { id: p.id, model, ok: !!parsed, parsed, raw: r.text.slice(0, 20000), cls: r.cls, problem, tools, secs: r.secs, usage: r.usage, at: new Date().toISOString(), attempt };
    fs.writeFileSync(outF, JSON.stringify(done, null, 1));
    console.log(p.id, r.cls || 'ok', parsed ? 'parsed' : 'NOPARSE', r.secs.toFixed(0) + 's');
    if (r.cls === 'quota') { console.log('QUOTA — stopping'); process.exit(3); }
    if (parsed) return;
  }
}
let i = 0;
await Promise.all(Array.from({ length: +conc }, async () => { while (i < P.length) await one(P[i++]); }));
console.log('DONE', Object.values(done).filter((x) => x.ok).length, '/', P.length);

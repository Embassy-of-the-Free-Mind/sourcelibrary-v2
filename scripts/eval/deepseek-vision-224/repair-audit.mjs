#!/usr/bin/env node
// PRIOR ART: scripts/batch/ocr-convergence/driver.mjs audit-packets / audit-opus / audit-score — the blind stored-vs-candidate Opus audit
// this reuses unchanged (AUDITOR.md, sealed `claude -p` chunks, X/Y drawn per page, no diff hint). Those steps need a decisions dir from the
// convergence lane; here the candidate is DeepSeek V4.1 Flash's read of the 151 repair-queue pages, so this builds the same items and chunks
// from the stored text + the DeepSeek text and runs the same sealed call. The auditor brief is copied, not changed. #224.
//   node scripts/eval/deepseek-vision-224/repair-audit.mjs packets|opus|score
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { createHash } from 'node:crypto';
const J = process.env.JOB_SCRATCH; const B = `${J}/repair`; const AUD = `${B}/audit`; const ENG = 'deepseek-v4-1-flash';
const meta = JSON.parse(fs.readFileSync(`${B}/meta.json`, 'utf8'));
const OUT = `${B}/bench/repair-queue/out/${ENG}`;
const meter = new Map(fs.readFileSync(`${OUT}/_meter.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.slug, r]));
const sideOf = (id) => (parseInt(createHash('sha1').update(`ds-224:${id}`).digest('hex').slice(0, 8), 16) % 2 === 0 ? 'stored-is-A' : 'ds-is-A');
const readFailed = (id) => { const m = meter.get(id); const t = fs.existsSync(`${OUT}/${id}.txt`) ? fs.readFileSync(`${OUT}/${id}.txt`, 'utf8') : ''; if (!m || m.error) return 'error'; if (t.trim().length < 30) return 'empty'; return null; };
const claudeEnv = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; };
const step = process.argv[2];
if (step === 'packets') {
  fs.mkdirSync(`${AUD}/chunks`, { recursive: true }); fs.mkdirSync(`${AUD}/images`, { recursive: true });
  const done = new Set(); for (const f of fs.existsSync(`${AUD}/opus`) ? fs.readdirSync(`${AUD}/opus`) : []) for (const v of JSON.parse(fs.readFileSync(`${AUD}/opus/${f}`, 'utf8'))) done.add(v.item_id);
  const start = fs.readdirSync(`${AUD}/chunks`).length;
  const items = [], key = [];
  for (const m of meta) {
    const id = m.page_id; const f = readFailed(id);
    if (f) { key.push({ page_id: id, did_not_read: f }); continue; }
    const stored = fs.readFileSync(`${B}/stored/${id}.txt`, 'utf8'), ds = fs.readFileSync(`${OUT}/${id}.txt`, 'utf8');
    fs.copyFileSync(`${B}/bench/repair-queue/${id}.jpg`, `${AUD}/images/${id}.jpg`);
    const side = sideOf(id); const [tx, ty] = side === 'stored-is-A' ? [stored, ds] : [ds, stored];
    if (!done.has(id)) items.push({ item_id: id, language: m.language, image_file: `images/${id}.jpg`, text_x: tx, text_y: ty });
    key.push({ page_id: id, stored_is: side === 'stored-is-A' ? 'X' : 'Y' });
  }
  for (let i = 0; i * 10 < items.length; i++) fs.writeFileSync(`${AUD}/chunks/a${String(start + i).padStart(3, '0')}.json`, JSON.stringify(items.slice(i * 10, (i + 1) * 10), null, 1));
  fs.writeFileSync(`${AUD}/key.jsonl`, key.map(k => JSON.stringify(k)).join('\n') + '\n');
  console.log('items', items.length, 'did-not-read', key.filter(k => k.did_not_read).length);
} else if (step === 'opus') {
  fs.mkdirSync(`${AUD}/opus`, { recursive: true }); fs.mkdirSync(`${AUD}/meta`, { recursive: true });
  const brief = fs.readFileSync('scripts/batch/ocr-convergence/AUDITOR.md', 'utf8');
  const runOne = (f) => new Promise((resolve) => {
    const name = f.replace(/\.json$/, ''); const sealed = path.join(J, 'tmp', 'sealed-audit', name);
    fs.rmSync(sealed, { recursive: true, force: true }); fs.mkdirSync(`${sealed}/images`, { recursive: true });
    fs.writeFileSync(`${sealed}/AUDITOR.md`, brief);
    const items = JSON.parse(fs.readFileSync(`${AUD}/chunks/${f}`, 'utf8')); fs.writeFileSync(`${sealed}/items.json`, JSON.stringify(items, null, 1));
    for (const it of items) fs.copyFileSync(`${AUD}/${it.image_file}`, `${sealed}/${it.image_file}`);
    const prompt = 'Your instructions are the full text of `AUDITOR.md` in this folder (skip the leading `<!-- … -->` comment); follow them exactly. Work only inside this folder.\nITEMS_FILE: `items.json`\nOUTPUT_FILE: `review.json`';
    const fd = fs.openSync(`${AUD}/meta/${name}.jsonl`, 'w'); const t0 = Date.now();
    const child = spawn('/usr/bin/claude', ['-p', prompt, '--model', 'opus', '--restricted', '--tools', 'Read', 'Write', '--allowedTools', 'Read', 'Write', '--strict-mcp-config', '--output-format', 'stream-json', '--verbose'], { cwd: sealed, stdio: ['ignore', fd, fd], env: claudeEnv() });
    const timer = setTimeout(() => child.kill('SIGKILL'), 40 * 60 * 1000);
    child.on('close', (code) => { clearTimeout(timer); fs.closeSync(fd); let ok = false; try { const j = JSON.parse(fs.readFileSync(`${sealed}/review.json`, 'utf8')); if (Array.isArray(j) && j.length) { fs.writeFileSync(`${AUD}/opus/${f}`, JSON.stringify(j, null, 1)); ok = true; } } catch { /* retried */ } resolve({ name, ok, code, secs: Math.round((Date.now() - t0) / 1000) }); });
  });
  const queue = fs.readdirSync(`${AUD}/chunks`).filter(f => !fs.existsSync(`${AUD}/opus/${f}`));
  await Promise.all(Array.from({ length: Number(process.env.PAR || 4) }, async () => { while (queue.length) { const f = queue.shift(); let r = await runOne(f); if (!r.ok) r = await runOne(f); console.log(r.name, r.ok ? 'ok' : 'FAILED', r.secs + 's'); } }));
} else if (step === 'score') {
  const key = fs.readFileSync(`${AUD}/key.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const op = new Map(); for (const f of fs.existsSync(`${AUD}/opus`) ? fs.readdirSync(`${AUD}/opus`) : []) for (const v of JSON.parse(fs.readFileSync(`${AUD}/opus/${f}`, 'utf8'))) op.set(v.item_id, v);
  const mm = new Map(meta.map(m => [m.page_id, m]));
  const rows = key.map(k => { const m = mm.get(k.page_id); const v = op.get(k.page_id); let outcome;
    if (k.did_not_read) outcome = 'did-not-read'; else if (!v) outcome = 'unjudged';
    else if (v.better === 'same') outcome = 'same'; else if (v.better === k.stored_is) outcome = v.worse_serious ? 'new-serious-error' : 'stored-better-minor'; else outcome = v.worse_serious ? 'finding-fixed' : 'ds-better-minor';
    return { page_id: k.page_id, book_id: m.book_id, cell: m.cell, route: m.route, status: m.status, language: m.language, year: m.year, published: m.published, classes: m.classes, outcome, did_not_read: k.did_not_read || null, opus: v ? { better: v.better === 'same' ? 'same' : v.better === k.stored_is ? 'stored' : 'ds', serious: v.worse_serious, confidence: v.confidence, note: v.note } : null }; });
  fs.writeFileSync(`${AUD}/result.json`, JSON.stringify(rows, null, 1));
  const tally = {}; for (const r of rows) tally[r.outcome] = (tally[r.outcome] || 0) + 1; console.log(tally);
}

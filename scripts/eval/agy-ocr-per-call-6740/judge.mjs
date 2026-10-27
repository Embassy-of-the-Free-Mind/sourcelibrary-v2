#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs — its judgePrompt (imported unchanged) and its Opus call (copied:
// it is not exported) are the judge; its packet stage reads routes from cells, not arms of one reader, and has no
// planted line drop or bleed. scripts/eval/agy-per-call-7503/prep.mjs plants the controls the same way (3 drop, 2 bleed)
// on translations, against a SEPARATE fresh read; here the judge sees one output per call, so it cannot diff a control
// against its untampered twin, and the A1b read is tampered.
/**
 *   node scripts/eval/agy-ocr-per-call-6740/judge.mjs prep  --scratch=DIR
 *        Items: every arm's read of every page (a text two arms share exactly is one item), plus 5 controls per task
 *        (seeded, 5 different books: 3 with a middle line dropped, 2 with the first line of the pair's other page
 *        appended). Opaque ids in a seeded order; the id -> {task, arm, page} key goes to DIR/judge/key.json and the
 *        tamper record to controls.json here. T1 items carry the page's own Kanripo leaf as a reference.
 *   node scripts/eval/agy-ocr-per-call-6740/judge.mjs judge --scratch=DIR [--concurrency=3]
 *        Opus via `claude -p`, one item per call, the page image in a sealed folder; DIR/judge/verdicts.jsonl (resumable).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { judgePrompt } from '../route-judge-6740/judge.mjs';
import { parseJson } from '../translate-cli-lane-7075/sample.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = arg('scratch'), J = S && path.join(S, 'judge');
const STAGE = process.argv[2];
if (!S || !['prep', 'judge'].includes(STAGE)) { console.error('usage: judge.mjs prep|judge --scratch=DIR'); process.exit(2); }
fs.mkdirSync(path.join(J, 'img'), { recursive: true });
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const h = (s) => createHash('sha256').update(String(s)).digest('hex');
const ARMS = ['A1', 'A1b', 'B2', 'C3'];
const LANG = { T1: 'Chinese', T2: 'German' };
const gzl = (f) => zlib.gunzipSync(fs.readFileSync(path.join(S, f))).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
const readOf = (task, arm, id) => { const f = path.join(S, task, arm, `${id}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };

/** Body lines worth planting: no tags, long enough that dropping or adding one is a real fault. */
const plantable = (task, t) => t.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => !/[<>]/.test(l) && (task === 'T1' ? [...l].filter((c) => /\p{Script=Han}/u.test(c)).length >= 12 : l.replace(/[^\p{L}]/gu, '').length >= 30));

if (STAGE === 'prep') {
  const refs = new Map(gzl('kanripo.jsonl.gz').map((r) => [r.page_id, r]));
  const items = [], key = {}, controls = [];
  const seen = new Map();
  for (const task of ['T1', 'T2']) {
    for (const b of draw[task].books) for (const p of b.pages) for (const arm of ARMS) {
      const t = readOf(task, arm, p.page_id);
      if (t == null || !t.trim()) continue;
      const sk = `${task}|${p.page_id}|${h(t)}`;
      if (seen.has(sk)) { key[seen.get(sk)].arms.push(arm); continue; }
      const id = `j${h(`6740-ppc-item${sk}`).slice(0, 10)}`;
      seen.set(sk, id);
      key[id] = { task, page_id: p.page_id, book_id: b.book_id, arms: [arm], control: null };
      items.push({ id, task: 'ocr', lang: LANG[task], page_id: p.page_id, image_url: p.image, text: t, reference: task === 'T1' ? refs.get(p.page_id)?.raw?.replace(/¶/g, '\n').trim() ?? null : null });
    }
    // Controls: 5 books in a seeded order; the first page of the pair, tampered from its A1b read.
    const books = [...draw[task].books].sort((x, y) => h(`ctl${task}${x.book_id}`).localeCompare(h(`ctl${task}${y.book_id}`)));
    let made = 0;
    for (const b of books) {
      if (made >= 5) break;
      const [p, q] = b.pages;
      const t = readOf(task, 'A1b', p.page_id), next = readOf(task, 'A1b', q.page_id);
      if (!t?.trim() || !next?.trim()) continue;
      const kind = made < 3 ? 'drop' : 'bleed';
      const lines = t.split('\n');
      let tampered, span;
      if (kind === 'drop') {
        const c = plantable(task, t); if (c.length < 3) continue;
        const v = c[Math.floor(c.length / 2)]; span = v.l;
        tampered = lines.filter((_, i) => i !== v.i).join('\n');
      } else {
        const c = plantable(task, next); if (!c.length) continue;
        span = c[0].l;
        // Before the closing metadata (<vocab> etc.) if there is one, else at the end.
        const at = lines.findIndex((l) => /^<(vocab|summary|keywords)>/.test(l));
        tampered = at < 0 ? `${t}\n${span}` : [...lines.slice(0, at), span, ...lines.slice(at)].join('\n');
      }
      const id = `j${h(`6740-ppc-ctl${task}${p.page_id}`).slice(0, 10)}`;
      key[id] = { task, page_id: p.page_id, book_id: b.book_id, arms: ['CTL'], control: kind };
      controls.push({ id, task, page_id: p.page_id, partner_id: q.page_id, kind, span });
      items.push({ id, task: 'ocr', lang: LANG[task], page_id: p.page_id, image_url: p.image, text: tampered, reference: task === 'T1' ? refs.get(p.page_id)?.raw?.replace(/¶/g, '\n').trim() ?? null : null });
      made++;
    }
  }
  items.sort((a, b) => h(`ord${a.id}`).localeCompare(h(`ord${b.id}`)));
  fs.writeFileSync(path.join(J, 'items.json'), JSON.stringify(items));
  fs.writeFileSync(path.join(J, 'key.json'), JSON.stringify(key, null, 1));
  fs.writeFileSync(path.join(HERE, 'controls.json'), JSON.stringify(controls, null, 1) + '\n');
  console.log(`${items.length} items (${controls.length} controls)`);
  process.exit(0);
}

// ── judge ────────────────────────────────────────────────────────────────────
const QUOTA = /usage limit|limit reached|hit your (?:usage )?limit|rate.?limit|out of extra usage/i;
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function opusCall(prompt, cwd) {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--model', 'opus', '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 900e3);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '');
      resolve({ text, cls: (j.is_error || code !== 0) && QUOTA.test(text + out + err) ? 'quota' : code !== 0 ? `exit_${code}` : null, model: Object.keys(j.modelUsage || {})[0] ?? null, usage: j.usage ?? null });
    });
  });
}
const parseVerdict = (t) => parseJson(t, (v) => typeof v.accept === 'boolean' && Number(v.fidelity) >= 1 && Number(v.fidelity) <= 5 && Array.isArray(v.defects ?? []));
const items = JSON.parse(fs.readFileSync(path.join(J, 'items.json'), 'utf8'));
const file = path.join(J, 'verdicts.jsonl');
const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const done = new Set(rows.filter((r) => r.verdict).map((r) => r.id));
const tries = new Map(); for (const r of rows) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
const todo = items.filter((it) => !done.has(it.id) && (tries.get(it.id) ?? 0) < 3);
console.log(`opus: ${todo.length} of ${items.length} items to judge`);
let stop = null, i = 0;
const one = async (it) => {
  const img = path.join(J, 'img', `${it.page_id}.jpg`);
  if (!fs.existsSync(img)) { const r = await fetch(it.image_url); if (!r.ok) throw new Error(`image ${r.status}`); fs.writeFileSync(img, Buffer.from(await r.arrayBuffer())); }
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ppc-opus-'));
  try {
    fs.copyFileSync(img, path.join(ws, 'page.jpg'));
    const t0 = Date.now();
    const r = await opusCall(judgePrompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws);
    if (r.cls === 'quota') { stop = r.text.slice(0, 200); return; }
    const v = parseVerdict(r.text);
    fs.appendFileSync(file, JSON.stringify({ id: it.id, judge: 'opus', model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 500), usage: r.usage, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
    console.log(`  ${it.id}: ${v ? `accept=${v.accept} ${v.fidelity} (${(v.defects || []).length} defects)` : `unparsed ${r.cls ?? ''}`}`);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
};
const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
if (stop) { console.log(`BLOCKED: ${stop}`); process.exit(3); }

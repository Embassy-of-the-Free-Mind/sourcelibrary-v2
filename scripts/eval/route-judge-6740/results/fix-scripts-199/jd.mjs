// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs and paired-arm.mjs — the judge prompt, call and parse are imported from judge.mjs unchanged; this is the job's thin driver (judge model choice, per-wave audit draw/record, wave report), kept here as the record of how v3#199 ran, not as a reusable tool.
// v3#199 fix-scripts scratch judge driver. judge.mjs `judge` is wired to Opus and its named cells; this loops the SAME
// judgePrompt / opusCall / parseVerdict (imported unchanged) over a packet with a chosen judge model, and writes the
// key.json / verdicts-<judge>.jsonl files paired-arm.mjs reads.
//   packet --dir=D --arms=opus:DIR,fable:DIR --lang=Greek --cell=NAME [--controls=2 --repeats=5] [--only=ids.json]
//   judge  --dir=D --judge=opus|fable [--concurrency=4]
//   score  --dir=D
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { createHash, randomBytes } from 'node:crypto';
const R = '/root/worktrees/job-fix-scripts/';
const { judgePrompt, opusCall, parseVerdict } = await import(R + 'scripts/eval/route-judge-6740/judge.mjs');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const DIR = path.resolve(arg('dir')); const STAGE = process.argv[2];
const J = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const OTHER = { opus: 'fable', fable: 'opus' };

if (STAGE === 'packet') {
  fs.mkdirSync(DIR, { recursive: true });
  const arms = Object.fromEntries(arg('arms').split(',').map((s) => s.split(':')));
  const NC = Number(arg('controls', 2)), NR = Number(arg('repeats', 5)), cell = arg('cell'), langArg = arg('lang');
  const only = arg('only') ? new Set(JSON.parse(fs.readFileSync(arg('only'), 'utf8'))) : null;
  const first = Object.values(arms)[0];
  const man = jsonl(path.join(first, 'manifest.jsonl')).filter((m) => !only || only.has(m.page_id));
  const img = (dir, id) => { for (const w of fs.readdirSync(path.join(dir, 'reads')).filter((x) => x.startsWith('ws-'))) { const f = path.join(dir, 'reads', w, `${id}.jpg`); if (fs.existsSync(f)) return f; } return null; };
  const items = [], key = [], assign = {};
  const add = (text, m, image, judges) => { const id = 'j' + randomBytes(6).toString('hex'); items.push({ id, task: 'ocr', lang: m.language || langArg, text, image_file: image }); assign[id] = judges; return id; };
  const out = {}; // arm -> page -> {outcome,text}
  const stored = new Map(), storedId = new Map();
  for (const m of man) {
    const image = Object.values(arms).map((d) => img(d, m.page_id)).find(Boolean);
    const st = Object.values(arms).map((d) => path.join(d, 'stored', `${m.page_id}.txt`)).find((f) => fs.existsSync(f));
    if (!image || !st) { console.log('no image/stored yet', m.page_id); continue; }
    m.image = image; stored.set(m.page_id, fs.readFileSync(st, 'utf8'));
  }
  const pages = man.filter((m) => m.image);
  const storedJudges = arg('stored-judges', 'opus,fable').split(',');
  for (const m of pages) { const id = add(stored.get(m.page_id), m, m.image, storedJudges); storedId.set(m.page_id, id); key.push({ id: `stored:${m.page_id}`, judged_as: id, cell, route: 'stored', kind: 'item', page_id: m.page_id, book_id: m.book_id }); }
  for (const [arm, d] of Object.entries(arms)) {
    out[arm] = new Map();
    for (const m of pages) {
      const mf = path.join(d, 'reads', `${m.page_id}.meta.json`); if (!fs.existsSync(mf)) continue;
      const meta = JSON.parse(fs.readFileSync(mf, 'utf8'));
      if (meta.outcome === 'corrected') { const text = fs.readFileSync(path.join(d, 'reads', `${m.page_id}.txt`), 'utf8'); out[arm].set(m.page_id, text); const id = add(text, m, m.image, [OTHER[arm]]); key.push({ id: `${arm}:${m.page_id}`, judged_as: id, cell, route: arm, kind: 'item', page_id: m.page_id, book_id: m.book_id }); }
      else if (meta.outcome === 'unchanged') key.push({ id: `${arm}:${m.page_id}`, judged_as: storedId.get(m.page_id), cell, route: arm, kind: 'item', page_id: m.page_id, book_id: m.book_id, unchanged: true });
      else key.push({ id: `${arm}:${m.page_id}`, judged_as: null, cell, route: arm, kind: meta.outcome, page_id: m.page_id, book_id: m.book_id, reason: meta.reason });
    }
  }
  // wrong-page controls: page i's image with another book's text from the same arm
  const ctl = (route, textOf, judges, salt) => { const ps = pages.filter((m) => textOf(m.page_id)); for (let i = 0; i < Math.min(NC, ps.length - 1); i++) { const a = ps[(i * 7 + salt) % ps.length], b = ps[(i * 7 + salt + Math.floor(ps.length / 2)) % ps.length]; if (a.book_id === b.book_id) continue; const id = add(textOf(b.page_id), a, a.image, judges); key.push({ id: `wp:${route}:${judges.join('+')}:${a.page_id}`, judged_as: id, cell, route, kind: 'wrong_page', page_id: a.page_id, book_id: a.book_id, other: b.page_id }); } };
  for (const j of storedJudges) ctl('stored', (id) => stored.get(id), [j], j === 'opus' ? 1 : 4);
  for (const arm of Object.keys(arms)) ctl(arm, (id) => out[arm].get(id), [OTHER[arm]], 2);
  for (const j of storedJudges) for (let i = 0; i < Math.min(NR, pages.length); i++) { const m = pages[(i * 5 + 3) % pages.length]; const id = add(stored.get(m.page_id), m, m.image, [j]); key.push({ id: `rep:${j}:${m.page_id}`, judged_as: id, cell, route: 'stored', kind: 'repeat', page_id: m.page_id, book_id: m.book_id }); }
  items.sort((a, b) => createHash('sha1').update(a.id).digest('hex').localeCompare(createHash('sha1').update(b.id).digest('hex')));
  fs.writeFileSync(path.join(DIR, 'packet.json'), JSON.stringify({ items }, null, 1)); fs.writeFileSync(path.join(DIR, 'key.json'), JSON.stringify(key, null, 1)); fs.writeFileSync(path.join(DIR, 'assign.json'), JSON.stringify(assign, null, 1));
  console.log(`packet ${items.length} items; key ${key.length} rows; per judge: ${['opus', 'fable'].map((j) => `${j} ${Object.values(assign).filter((a) => a.includes(j)).length}`).join(', ')}`);
} else if (STAGE === 'judge') {
  const judge = arg('judge'); const assign = J('assign.json'); const file = path.join(DIR, `verdicts-${judge}.jsonl`);
  const stopAt = arg('stop-at') ? new Date(arg('stop-at')).getTime() : Infinity;
  const done = new Set(jsonl(file).filter((r) => r.verdict).map((r) => r.id)); const tries = new Map(); for (const r of jsonl(file)) if (!r.verdict) tries.set(r.id, (tries.get(r.id) || 0) + 1);
  const todo = J('packet.json').items.filter((it) => assign[it.id].includes(judge) && !done.has(it.id) && (tries.get(it.id) || 0) < 3);
  console.log(`${judge}: ${todo.length} to judge`); let i = 0, stop = null;
  const one = async (it) => {
    if (Date.now() > stopAt) { stop = 'stop-at'; return; }
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `jd-${judge}-`));
    try { fs.copyFileSync(it.image_file, path.join(ws, 'page.jpg')); const t0 = Date.now();
      const r = await opusCall(judgePrompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws, judge);
      if (r.cls === 'quota') { stop = 'quota: ' + r.text.slice(0, 200); return; }
      const v = parseVerdict(r.text);
      fs.appendFileSync(file, JSON.stringify({ id: it.id, judge, model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 500), usage: r.usage, list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.id}: ${v ? `accept=${v.accept} ${v.fidelity}` : `unparsed ${r.cls ?? ''}`}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 4)) }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log('BLOCKED', stop); process.exit(3); }
} else if (STAGE === 'score') {
  const key = J('key.json'); const V = {}; for (const j of ['opus', 'fable']) V[j] = new Map(jsonl(path.join(DIR, `verdicts-${j}.jsonl`)).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const res = { arms: {}, controls: {}, noise: {}, pages: [] };
  for (const j of ['opus', 'fable']) {
    const reps = key.filter((k) => k.kind === 'repeat' && k.id.startsWith(`rep:${j}:`)).map((k) => { const a = V[j].get(k.judged_as), b = V[j].get(key.find((x) => x.id === `stored:${k.page_id}`).judged_as); return a && b ? { flip: a.accept !== b.accept, d: Math.abs(a.fidelity - b.fidelity) } : null; }).filter(Boolean);
    res.noise[j] = { n: reps.length, accept_flips: reps.filter((r) => r.flip).length, fidelity_moved: reps.filter((r) => r.d >= 1).length, moved_2plus: reps.filter((r) => r.d >= 2).length };
    const st = key.filter((k) => k.route === 'stored' && k.kind === 'item').map((k) => V[j].get(k.judged_as)).filter(Boolean);
    res.arms[`stored by ${j}`] = { n: st.length, accept: st.filter((v) => v.accept).length, mean_fidelity: +(st.reduce((a, v) => a + v.fidelity, 0) / (st.length || 1)).toFixed(2) };
  }
  for (const k of key.filter((k) => k.kind === 'wrong_page')) { const j = k.id.split(':')[2]; const v = V[j].get(k.judged_as); (res.controls[`${k.route} by ${j}`] ||= []).push(v ? { accept: v.accept, fidelity: v.fidelity, held: !v.accept && v.fidelity <= 2 } : null); }
  for (const arm of ['opus', 'fable']) {
    const j = OTHER[arm]; const rows = key.filter((k) => k.route === arm && k.kind !== 'wrong_page'); if (!rows.length) continue;
    const a = { judge: j, pages: rows.length, corrected: 0, unchanged: 0, contain: 0, no_answer: 0, judged: 0, better: 0, same: 0, worse: 0, accept_gained: 0, accept_lost: 0, accept: 0, worse_pages: [] }; let fs_ = 0;
    for (const k of rows) {
      if (k.kind === 'contain') { a.contain++; continue; } if (k.kind !== 'item') { a.no_answer++; continue; }
      const s = V[j].get(key.find((x) => x.id === `stored:${k.page_id}`).judged_as);
      if (k.unchanged) { a.unchanged++; if (s) { a.judged++; a.same++; if (s.accept) a.accept++; fs_ += s.fidelity; res.pages.push({ arm, page_id: k.page_id, unchanged: true, stored: [s.accept, s.fidelity] }); } continue; }
      a.corrected++; const c = V[j].get(k.judged_as); if (!s || !c) continue; a.judged++; fs_ += c.fidelity; if (c.accept) a.accept++;
      const worse = c.fidelity < s.fidelity || (s.accept && !c.accept), better = !worse && (c.fidelity > s.fidelity || (!s.accept && c.accept));
      if (worse) { a.worse++; a.worse_pages.push(k.page_id); } else if (better) a.better++; else a.same++;
      if (!s.accept && c.accept) a.accept_gained++; if (s.accept && !c.accept) a.accept_lost++;
      res.pages.push({ arm, page_id: k.page_id, book_id: k.book_id, stored: [s.accept, s.fidelity], corr: [c.accept, c.fidelity], rel: worse ? 'worse' : better ? 'better' : 'same' });
    }
    a.mean_fidelity = +(fs_ / (a.judged || 1)).toFixed(2); const ctl = (res.controls[`${arm} by ${j}`] || []); a.controls_held = ctl.length > 0 && ctl.every((c) => c && c.held);
    a.pass = a.worse <= 2 && a.accept_gained > a.accept_lost && a.controls_held; res.arms[arm] = a;
  }
  fs.writeFileSync(path.join(DIR, 'jd-score.json'), JSON.stringify(res, null, 1)); const { pages, ...show } = res; console.log(JSON.stringify(show, null, 1));
}

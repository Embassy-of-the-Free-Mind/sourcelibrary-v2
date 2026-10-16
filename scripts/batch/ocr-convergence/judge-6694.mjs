#!/usr/bin/env node
// PRIOR ART: ./driver.mjs (decide, audit-packets/audit-opus/audit-score: the sealed Opus call and the Gemini request
// file this copies; it compares ONE candidate with the stored text and cannot hold two arms), scripts/eval/lib/
// pareto-stats.mjs clusterCI (book-clustered intervals). This is the #6694 side-by-side: arm A (lane B, driver.mjs
// decisions) against arm B (correct.mjs), judged blind on the pages where their final texts differ.
/**
 *   node --env-file=.env.production.local scripts/batch/ocr-convergence/judge-6694.mjs <step> --a=DIR_A --b=DIR_B
 *
 *   decide-b   correct.mjs outcomes → DIR_B/decisions.jsonl, actions as driver.mjs names them: write (a correction,
 *              book not in a translate lane), defer (a correction in such a book), keep (UNCHANGED, or a correction
 *              that normalises to the stored text), contain (CONTAIN), no-answer.
 *   frame      both arms' final texts per page (a write or defer serves the arm's text; anything else serves the
 *              stored text), the pages where they differ (≤ 2 per book, seeded, ≤ 200) plus 40 seeded agreeing
 *              controls → DIR_B/judge/frame.jsonl. A page whose stored text changed between the arms is left out.
 *   packets    sealed chunks of 5 (S, X, Y; X/Y drawn per page) + gemini-requests.jsonl → DIR_B/judge/
 *   opus       fresh Opus per chunk (sealed claude -p, subscription) → DIR_B/judge/opus/
 *   (gemini)   python3 scripts/eval/run-cli-arm.py --requests DIR_B/judge/gemini-requests.jsonl --out DIR_B/judge/gemini-out.jsonl
 *              --arm judge6694-g38h --model gemini-3.8-flash-high --job opus-correct-6694 --kind judge --no-sentinels --parallel 2
 *   score      verdicts → DIR_B/judge/result.json: per judge, by language group, book-clustered 95% intervals, and
 *              the preregistered rule of #6694.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { translationLaneReason, normaliseForCer } from './lib.mjs';
import { clusterCI } from '../../eval/lib/pareto-stats.mjs';

const STEP = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const A = path.resolve(arg('a', '')), B = path.resolve(arg('b', ''));
const J = path.join(B, 'judge');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SEED = 6694;
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (a, r) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const xIs = (pageId) => (parseInt(createHash('sha1').update(`judge-6694:${pageId}`).digest('hex').slice(0, 8), 16) % 2 === 0 ? 'A' : 'B');
const same = (s, t) => normaliseForCer(s) === normaliseForCer(t);
const txt = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

async function decideB() {
  const manifest = readJsonl(path.join(B, 'manifest.jsonl'));
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const books = new Map((await client.db('bookstore').collection('books').find({ id: { $in: [...new Set(manifest.map((m) => m.book_id))] } }, { projection: { id: 1, pages_ocr: 1, pages_blank: 1, pages_translated: 1, pipeline_auto: 1 } }).toArray()).map((b) => [b.id, b]));
  await client.close();
  const out = manifest.map((m) => {
    const base = { page_id: m.page_id, book_id: m.book_id, slug: m.slug, page_number: m.page_number, group: m.group, language: m.language };
    const metaF = path.join(B, 'reads', `${m.page_id}.meta.json`);
    if (!fs.existsSync(metaF)) return { ...base, action: 'no-answer', why: 'not reached' };
    const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
    if (meta.outcome === 'unchanged') return { ...base, action: 'keep', why: 'UNCHANGED' };
    if (meta.outcome === 'contain') return { ...base, action: 'contain', why: meta.reason };
    if (meta.outcome !== 'corrected') return { ...base, action: 'no-answer', why: meta.reason };
    if (same(txt(path.join(B, 'stored', `${m.page_id}.txt`)), txt(path.join(B, 'reads', `${m.page_id}.txt`)))) return { ...base, action: 'keep', why: 'correction normalises to the stored text' };
    const lane = translationLaneReason(books.get(m.book_id));
    return { ...base, action: lane ? 'defer' : 'write', ...(lane ? { why: lane } : {}) };
  });
  writeJsonl(path.join(B, 'decisions.jsonl'), out);
  const t = {}; for (const o of out) t[o.action] = (t[o.action] || 0) + 1;
  fs.writeFileSync(path.join(B, 'summary.json'), JSON.stringify({ set: path.basename(B), arm: 'B: Opus corrects the stored text (correct.mjs)', pages: out.length, books: new Set(out.map((o) => o.book_id)).size, actions: t, decided_at: new Date().toISOString() }, null, 1));
  console.log(JSON.stringify(t));
}

const CHANGES = new Set(['write', 'defer']);
function finals() {
  const da = new Map(readJsonl(path.join(A, 'decisions.jsonl')).map((d) => [d.page_id, d]));
  const db = new Map(readJsonl(path.join(B, 'decisions.jsonl')).map((d) => [d.page_id, d]));
  const rows = [];
  for (const m of readJsonl(path.join(B, 'manifest.jsonl'))) {
    const a = da.get(m.page_id), b = db.get(m.page_id);
    const sA = txt(path.join(A, 'stored', `${m.page_id}.txt`)), sB = txt(path.join(B, 'stored', `${m.page_id}.txt`));
    const stored = sB ?? sA;
    const tA = a && CHANGES.has(a.action) ? txt(path.join(A, 'reads', `${m.page_id}.txt`)) : stored;
    const tB = b && CHANGES.has(b.action) ? txt(path.join(B, 'reads', `${m.page_id}.txt`)) : stored;
    rows.push({ m, a: a?.action ?? 'none', b: b?.action ?? 'none', stored, tA, tB, drift: sA != null && sB != null && sA !== sB });
  }
  return rows;
}

function frame() {
  const rows = finals();
  const drift = rows.filter((r) => r.drift);
  const ok = rows.filter((r) => !r.drift && r.stored != null);
  const differ = ok.filter((r) => !same(r.tA, r.tB));
  const agree = ok.filter((r) => same(r.tA, r.tB));
  const r = rng(SEED);
  const byBook = new Map();
  for (const x of shuffle(differ, r)) { const k = x.m.book_id; if (!byBook.has(k)) byBook.set(k, []); if (byBook.get(k).length < 2) byBook.get(k).push(x); }
  const picked = shuffle([...byBook.values()].flat(), r).slice(0, 200);
  const controls = shuffle(agree, r).slice(0, 40);
  const out = [...picked.map((x) => ({ kind: 'differ', x })), ...controls.map((x) => ({ kind: 'control', x }))].map(({ kind, x }) => ({
    page_id: x.m.page_id, book_id: x.m.book_id, slug: x.m.slug, page_number: x.m.page_number, group: x.m.group, language: x.m.language, kind,
    a_action: x.a, b_action: x.b, a_changed: !same(x.tA, x.stored), b_changed: !same(x.tB, x.stored),
  }));
  fs.mkdirSync(J, { recursive: true });
  writeJsonl(path.join(J, 'frame.jsonl'), out);
  const cross = {}; for (const x of ok) { const k = `A:${x.a} / B:${x.b}`; cross[k] = (cross[k] || 0) + 1; }
  fs.writeFileSync(path.join(J, 'frame-summary.json'), JSON.stringify({ pages: rows.length, stored_drift_excluded: drift.map((x) => x.m.page_id), differ: differ.length, differ_books: new Set(differ.map((x) => x.m.book_id)).size, agree: agree.length, judged_differ: picked.length, judged_controls: controls.length, cross }, null, 1));
  console.log(`${rows.length} pages; ${drift.length} drifted; differ ${differ.length} in ${new Set(differ.map((x) => x.m.book_id)).size} books; agree ${agree.length}; judged ${picked.length} + ${controls.length} controls`);
}

function packets() {
  const fr = readJsonl(path.join(J, 'frame.jsonl'));
  const all = new Map(finals().map((r) => [r.m.page_id, r]));
  fs.mkdirSync(path.join(J, 'chunks'), { recursive: true }); fs.mkdirSync(path.join(J, 'images'), { recursive: true });
  const items = [], key = [];
  for (const f of shuffle(fr, rng(SEED + 1))) {
    const r = all.get(f.page_id);
    const img = [path.join(A, 'reads', `ws-${f.page_id}`, `${f.page_id}.jpg`), path.join(B, 'reads', `ws-${f.page_id}`, `${f.page_id}.jpg`)].find((p) => fs.existsSync(p));
    fs.copyFileSync(img, path.join(J, 'images', `${f.page_id}.jpg`));
    const x = xIs(f.page_id);
    items.push({ item_id: f.page_id, language: f.language, image_file: `images/${f.page_id}.jpg`, text_s: r.stored, text_x: x === 'A' ? r.tA : r.tB, text_y: x === 'A' ? r.tB : r.tA });
    key.push({ page_id: f.page_id, x_is: x });
  }
  for (const f of fs.readdirSync(path.join(J, 'chunks'))) fs.unlinkSync(path.join(J, 'chunks', f));
  const per = 5;
  for (let i = 0; i * per < items.length; i++) fs.writeFileSync(path.join(J, 'chunks', `j${String(i).padStart(3, '0')}.json`), JSON.stringify(items.slice(i * per, (i + 1) * per), null, 1));
  writeJsonl(path.join(J, 'key.jsonl'), key);
  const brief = fs.readFileSync(path.join(HERE, 'JUDGE.md'), 'utf8').replace(/^\s*<!--[\s\S]*?-->\s*/, '');
  const wrapper = '## How this request is run (not part of the brief)\n\nYou cannot open files, run commands or write files here; do not try. ITEMS_FILE is given inline below and holds ONE item; its image is the file attached at the end of this message: open it with view_file before you judge (verdicts given without opening it are discarded). OUTPUT_FILE is your reply: reply with ONLY one JSON object (`item_id`, `x_vs_s`, `y_vs_s`, `x_serious`, `y_serious`, `prefer`, `confidence`, `note`), with no prose and no markdown fence. If you cannot see the attached image, reply with {"item_id": "…", "no_image": true}.';
  writeJsonl(path.join(J, 'gemini-requests.jsonl'), items.map((it) => ({ uid: it.item_id, image: path.join(J, it.image_file), prompt: `${brief}\n\n${wrapper}\n\nITEMS_FILE:\n${JSON.stringify([{ ...it, image_file: `${it.item_id}.jpg` }], null, 1)}` })));
  console.log(`${items.length} items in ${Math.ceil(items.length / per)} chunks`);
}

// Sealed like driver.mjs runSealed: a folder holding only the brief, the items and their images; Read/Write only;
// the subscription login, never an API key (#6589).
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function runSealed(chunkFile, outFile, metaDir) {
  const name = path.basename(chunkFile, '.json');
  const sealed = path.join(process.env.TMPDIR || '/tmp', 'judge-6694-sealed', name);
  fs.rmSync(sealed, { recursive: true, force: true }); fs.mkdirSync(path.join(sealed, 'images'), { recursive: true });
  fs.copyFileSync(path.join(HERE, 'JUDGE.md'), path.join(sealed, 'JUDGE.md'));
  const items = JSON.parse(fs.readFileSync(chunkFile, 'utf8'));
  fs.writeFileSync(path.join(sealed, 'items.json'), JSON.stringify(items, null, 1));
  for (const it of items) fs.copyFileSync(path.join(J, it.image_file), path.join(sealed, it.image_file));
  const prompt = 'Your instructions are the full text of `JUDGE.md` in this folder (skip the leading `<!-- … -->` comment); follow them exactly. Work only inside this folder.\nITEMS_FILE: `items.json`\nOUTPUT_FILE: `review.json`';
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = fs.openSync(path.join(metaDir, `${name}.jsonl`), 'w');
    const child = spawn('claude', ['-p', prompt, '--model', arg('model', 'opus'), '--restricted', '--tools', 'Read', 'Write', '--allowedTools', 'Read', 'Write', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'], { cwd: sealed, stdio: ['ignore', out, out], env: claudeEnv() });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer); fs.closeSync(out);
      let ok = false;
      try { const j = JSON.parse(fs.readFileSync(path.join(sealed, 'review.json'), 'utf8')); if (Array.isArray(j) && j.length) { fs.writeFileSync(outFile, JSON.stringify(j, null, 1)); ok = true; } } catch { /* missing or malformed: retried */ }
      const limit = !ok && /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage/i.test(fs.readFileSync(path.join(metaDir, `${name}.jsonl`), 'utf8').slice(-4000));
      resolve({ name, ok, code, limit, secs: Math.round((Date.now() - t0) / 1000) });
    });
  });
}
async function opus() {
  fs.mkdirSync(path.join(J, 'opus'), { recursive: true }); fs.mkdirSync(path.join(J, 'meta'), { recursive: true });
  const queue = fs.readdirSync(path.join(J, 'chunks')).filter((f) => !fs.existsSync(path.join(J, 'opus', f)));
  let limit = false;
  await Promise.all(Array.from({ length: Math.min(8, Number(arg('parallel', 4))) }, async () => {
    while (queue.length && !limit) {
      const f = queue.shift();
      let r = await runSealed(path.join(J, 'chunks', f), path.join(J, 'opus', f), path.join(J, 'meta'));
      if (!r.ok && !r.limit) r = await runSealed(path.join(J, 'chunks', f), path.join(J, 'opus', f), path.join(J, 'meta'));
      if (r.limit) limit = true;
      console.log(`  ${r.name} ${r.ok ? 'ok' : r.limit ? 'USAGE LIMIT' : 'FAILED'} ${r.secs}s`);
    }
  }));
  if (limit) { console.error('STOPPED: usage limit'); process.exit(3); }
}

function score() {
  const fr = new Map(readJsonl(path.join(J, 'frame.jsonl')).map((f) => [f.page_id, f]));
  const key = new Map(readJsonl(path.join(J, 'key.jsonl')).map((k) => [k.page_id, k.x_is]));
  const verdicts = { opus: new Map(), gemini: new Map() };
  const dropped = { opus: [], gemini: [] };
  for (const f of fs.existsSync(path.join(J, 'opus')) ? fs.readdirSync(path.join(J, 'opus')) : []) {
    const tr = txt(path.join(J, 'meta', f.replace(/\.json$/, '.jsonl'))) || '';
    for (const v of JSON.parse(fs.readFileSync(path.join(J, 'opus', f), 'utf8'))) {
      // A verdict counts only if the transcript shows that page's image was opened (driver.mjs decide's test).
      if (!new RegExp(`"name":"Read","input":\\{"file_path":"[^"]*images/${v.item_id}\\.jpg`).test(tr)) { dropped.opus.push(v.item_id); continue; }
      verdicts.opus.set(v.item_id, v);
    }
  }
  for (const l of (txt(path.join(J, 'gemini-out.jsonl')) || '').split('\n')) {
    try {
      const o = JSON.parse(l); if (!o.text) continue; const m = o.text.match(/\{[\s\S]*\}/); if (!m) continue;
      const v = { ...JSON.parse(m[0]), item_id: o.uid };
      // The Gemini judge's image is attached to the request, and agy opens it with view_file (the #6523 tool gate
      // logs it as gate_calls). A verdict with no view_file, a reply that says it saw no image, or one without the
      // verdict fields is dropped.
      if (!(o.gate_calls || []).includes('view_file') || v.no_image || !v.prefer || !v.x_vs_s || !v.y_vs_s) { dropped.gemini.push(o.uid); continue; }
      verdicts.gemini.set(o.uid, v);
    } catch { /* unparsable: missing */ }
  }
  const per = (judge) => [...fr.values()].map((f) => {
    const v = verdicts[judge].get(f.page_id); if (!v) return null;
    const x = key.get(f.page_id);
    const vsA = x === 'A' ? v.x_vs_s : v.y_vs_s, vsB = x === 'A' ? v.y_vs_s : v.x_vs_s;
    const pref = v.prefer === 'same' ? 'same' : v.prefer === 'X' ? x : x === 'A' ? 'B' : 'A';
    return { ...f, vsA, vsB, pref, serA: !!(x === 'A' ? v.x_serious : v.y_serious), serB: !!(x === 'A' ? v.y_serious : v.x_serious), confidence: v.confidence, note: v.note };
  }).filter(Boolean);
  const r1 = (x) => Math.round(x * 1000) / 10;
  const summarise = (rows, seed) => {
    const bCh = rows.filter((r) => r.b_changed), aCh = rows.filter((r) => r.a_changed), dif = rows.filter((r) => r.kind === 'differ');
    const rate = (xs, pred) => (xs.length ? xs.filter(pred).length / xs.length : null);
    const h2h = (xs) => (xs.length ? (xs.filter((r) => r.pref === 'A').length - xs.filter((r) => r.pref === 'B').length) / xs.length : null);
    const tally = (xs, k) => { const t = { better: 0, same: 0, worse: 0 }; for (const r of xs) t[r[k]] = (t[r[k]] || 0) + 1; return t; };
    return {
      judged: rows.length, books: new Set(rows.map((r) => r.book_id)).size,
      b_changed: { n: bCh.length, ...tally(bCh, 'vsB'), worse_pct: bCh.length ? r1(rate(bCh, (r) => r.vsB === 'worse')) : null, ci: clusterCI(bCh, (r) => r.book_id, (xs) => 100 * rate(xs, (r) => r.vsB === 'worse'), seed) },
      a_changed: { n: aCh.length, ...tally(aCh, 'vsA'), worse_pct: aCh.length ? r1(rate(aCh, (r) => r.vsA === 'worse')) : null, ci: clusterCI(aCh, (r) => r.book_id, (xs) => 100 * rate(xs, (r) => r.vsA === 'worse'), seed) },
      head_to_head: { n: dif.length, prefer_A: dif.filter((r) => r.pref === 'A').length, prefer_B: dif.filter((r) => r.pref === 'B').length, same: dif.filter((r) => r.pref === 'same').length, losses_minus_wins_pts: dif.length ? r1(h2h(dif)) : null, ci: clusterCI(dif, (r) => r.book_id, (xs) => 100 * h2h(xs), seed + 1) },
      controls: { n: rows.filter((r) => r.kind === 'control').length, a_worse: rows.filter((r) => r.kind === 'control' && r.a_changed && r.vsA === 'worse').length, b_worse: rows.filter((r) => r.kind === 'control' && r.b_changed && r.vsB === 'worse').length, either_changed: rows.filter((r) => r.kind === 'control' && (r.a_changed || r.b_changed)).length },
    };
  };
  const res = { dropped, judges: {} };
  for (const judge of ['opus', 'gemini']) {
    const rows = per(judge);
    const groups = {};
    for (const g of [...new Set(rows.map((r) => r.group))]) groups[g] = summarise(rows.filter((r) => r.group === g), SEED);
    res.judges[judge] = { all: summarise(rows, SEED), by_group: groups, rows };
  }
  // The preregistered rule (#6694): adopt B iff, under BOTH judges, B's made-worse rate ≤ 5% of its changed pages and
  // B's head-to-head (losses minus wins vs A) ≤ 5 points.
  const pass = (j) => { const s = res.judges[j].all; return s.b_changed.worse_pct != null && s.b_changed.worse_pct <= 5 && s.head_to_head.losses_minus_wins_pts != null && s.head_to_head.losses_minus_wins_pts <= 5; };
  res.rule = { opus: pass('opus'), gemini: pass('gemini'), adopt: pass('opus') && pass('gemini') ? 'B' : 'A' };
  fs.writeFileSync(path.join(J, 'result.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ dropped: { opus: dropped.opus.length, gemini: dropped.gemini.length }, rule: res.rule, opus: res.judges.opus.all, gemini: res.judges.gemini.all }, null, 1));
}

const steps = { 'decide-b': decideB, frame, packets, opus, score };
if (!steps[STEP]) { console.error(`unknown step ${STEP}; one of ${Object.keys(steps).join(', ')}`); process.exit(2); }
await steps[STEP]();

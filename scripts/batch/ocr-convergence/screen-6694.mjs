#!/usr/bin/env node
// PRIOR ART: ./driver.mjs (lane B; its audit-packets / audit-opus steps are reused here unchanged, and its sealed
// `claude -p` call is copied), ./judge-6694.mjs (decide-b: arm B's decisions, which this screens), scripts/batch/
// cli-ocr.mjs (the guarded writer this calls), scripts/eval/run-cli-arm.py (the agy runner). None of them puts a
// different-family check between arm B's correction and the write: in q300 arm B said CONTAIN on 0 of 976 pages and
// wrote a correction on all 12 pages whose stored text was invented or another leaf's. This is #6694 step 3.
/**
 * Screen arm B's reads before writing them (#6694 step 3). Per run dir (q400 … q1000):
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/batch/ocr-convergence/screen-6694.mjs <step> --set=qNNN
 *
 *   prep          unpack results/run/qNNN/reads.tar.gz into $JOB_SCRATCH/b/qNNN, fetch the image of every page arm B
 *                 changed (write) or left as it is (keep), books held now left out → screen/requests.jsonl (SCREEN.md)
 *   (screen)      python3 scripts/eval/run-cli-arm.py --requests W/screen/requests.jsonl --out W/screen/out.jsonl
 *                 --arm screen6694-g38l --model gemini-3.8-flash-low --job opus-screen-6694 --kind screen
 *                 --no-sentinels --parallel 3          (re-run the same command to resume after a quota stop)
 *   screen-score  replies → W/screen/verdicts.jsonl. A reply with no answer, or whose call never opened the image, is
 *                 "no screen", never OK; `--retry` writes W/screen/retry.jsonl for one more pass (out-retry.jsonl).
 *   settle        every non-OK page → sealed Opus (SETTLE.md, 5 pages a call, image opened or the verdict is dropped)
 *   decide        → W/decisions.jsonl: write (B wrote, screen OK or Opus not-confirmed), keep, contain (Opus
 *                 confirmed), residual (no screen, or Opus gave no verdict). Arm B's own decisions stay in decisions-b.jsonl.
 *   contain       hold `ocr-unsettled-6420` + withhold the pages' English (containment-on-finding). Dry unless --apply.
 *   (audit)       driver.mjs audit-packets --run=$JOB_SCRATCH/b --set=qNNN; driver.mjs audit-opus …; run-cli-arm.py
 *                 over audit/gemini-requests.jsonl with gemini-3.8-flash-high
 *   audit-score   Derek's rule (q300, 2026-10-14): a page either auditor calls worse is not written (residual); the
 *                 batch stops only if Opus calls any worse or Gemini more than 4 of 40. Krippendorff α per measure.
 *   apply         cli-ocr.mjs apply on the writes left, books held at apply time left out. Dry unless --apply.
 *   greek-frame   the batch's greek-lane-a.json books, unheld now, as a frame.json for driver.mjs (lane B, $JOB_SCRATCH/g)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { judgeReliability, reliabilityLine } from '../../eval/lib/agreement-stats.mjs';

const STEP = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const flag = (n) => process.argv.includes(`--${n}`);
const SET = arg('set');
if (!SET) { console.error('--set=qNNN is required'); process.exit(2); }
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '../../..');
const SRC = path.join(HERE, 'results/run', SET);
const SCRATCH = process.env.JOB_SCRATCH || '/tmp';
const W = path.join(SCRATCH, 'b', SET);
const ANSWERS = ['OK', 'WRONG-LEAF', 'INVENTED', 'UNREADABLE'];
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const readJsonlGz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const brief = (f) => fs.readFileSync(path.join(HERE, f), 'utf8').replace(/^\s*<!--[\s\S]*?-->\s*/, '');
async function connect() { const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 }); await c.connect(); return { client: c, db: c.db('bookstore') }; }
const heldNow = async (db, ids) => new Set((await db.collection('books').find({ id: { $in: [...ids] }, 'pipeline_auto.hold': { $exists: true, $ne: null } }, { projection: { id: 1 } }).toArray()).map((b) => b.id));
/** The text arm B would serve: its correction for a write, the stored text otherwise. */
const bText = (d) => fs.readFileSync(path.join(W, d.action === 'write' ? 'reads' : 'stored', `${d.page_id}.txt`), 'utf8');
const imgOf = (id) => path.join(W, 'reads', `ws-${id}`, `${id}.jpg`);

// ── prep ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function prep() {
  fs.mkdirSync(W, { recursive: true });
  if (!fs.existsSync(path.join(W, 'reads'))) spawnSync('tar', ['xzf', path.join(SRC, 'reads.tar.gz'), '-C', W], { stdio: 'inherit' });
  const dec = readJsonlGz(path.join(SRC, 'decisions.jsonl.gz'));
  writeJsonl(path.join(W, 'decisions-b.jsonl'), dec);
  const { client, db } = await connect();
  const held = await heldNow(db, new Set(dec.map((d) => d.book_id)));
  const todo = dec.filter((d) => (d.action === 'write' || d.action === 'keep') && !held.has(d.book_id));
  const pages = new Map((await db.collection('pages').find({ id: { $in: todo.map((d) => d.page_id) } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, crop: 1 } }).toArray()).map((p) => [p.id, p]));
  await client.close();
  const S = brief('SCREEN.md');
  const wrapper = '## How this request is run (not part of the brief)\n\nYou cannot open files, run commands or write files here; do not try. ITEMS_FILE is given inline below and holds ONE item; its image is the file attached at the end of this message: open it with view_file before you answer (#6694: answers given without opening it are discarded). Reply with ONLY one JSON object (`item_id`, `answer`, `note`), with no prose and no markdown fence. If you cannot see the attached image, reply with {"item_id": "…", "no_image": true}.';
  const reqs = [], failed = [];
  let i = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const d = queue.shift();
      const f = imgOf(d.page_id);
      if (!fs.existsSync(f)) {
        const meta = JSON.parse(fs.readFileSync(path.join(W, 'reads', `${d.page_id}.meta.json`), 'utf8'));
        const url = meta.image_url || getPageSource(pages.get(d.page_id) || {});
        try {
          const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status}`);
          fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
        } catch (e) { failed.push({ page_id: d.page_id, why: String(e.message || e) }); continue; }
      }
      const item = { item_id: d.page_id, language: d.language, image_file: `${d.page_id}.jpg`, text: bText(d) };
      reqs.push({ uid: d.page_id, image: f, prompt: `${S}\n\n${wrapper}\n\nITEMS_FILE:\n${JSON.stringify([item], null, 1)}` });
      if (++i % 100 === 0) console.log(`  ${i} images`);
    }
  }));
  fs.mkdirSync(path.join(W, 'screen'), { recursive: true });
  // Request order = decision order, so a quota stop leaves whole books screened, not a scatter.
  const order = new Map(todo.map((d, k) => [d.page_id, k]));
  reqs.sort((a, b) => order.get(a.uid) - order.get(b.uid));
  writeJsonl(path.join(W, 'screen', 'requests.jsonl'), reqs);
  const st = { set: SET, prepared_at: new Date().toISOString(), decisions: dec.length, held_books_skipped: [...held], pages_held_skipped: dec.filter((d) => (d.action === 'write' || d.action === 'keep') && held.has(d.book_id)).length, to_screen: reqs.length, write: todo.filter((d) => d.action === 'write').length, keep: todo.filter((d) => d.action === 'keep').length, image_failed: failed };
  fs.writeFileSync(path.join(W, 'state.json'), JSON.stringify(st, null, 1));
  console.log(JSON.stringify({ ...st, held_books_skipped: st.held_books_skipped.length }));
}

// ── screen-score ───────────────────────────────────────────────────────────────────────────────────────────────────
function parseScreen(o) {
  if (!o?.text) return { answer: null, why: o?.error || 'empty' };
  if (!(o.gate_calls || []).includes('view_file')) return { answer: null, why: 'image not opened' };
  const m = o.text.match(/\{[\s\S]*\}/); if (!m) return { answer: null, why: 'no JSON' };
  let v; try { v = JSON.parse(m[0]); } catch { return { answer: null, why: 'bad JSON' }; }
  if (v.no_image) return { answer: null, why: 'no image' };
  const a = String(v.answer || '').toUpperCase().replace(/[_ ]/g, '-');
  return ANSWERS.includes(a) ? { answer: a, note: v.note || '' } : { answer: null, why: `answer ${JSON.stringify(v.answer)}` };
}
function screenScore() {
  const reqs = readJsonl(path.join(W, 'screen', 'requests.jsonl'));
  const last = new Map();
  for (const f of ['out.jsonl', 'out-retry.jsonl']) for (const o of readJsonl(path.join(W, 'screen', f))) { const p = parseScreen(o); if (p.answer || !last.get(o.uid)?.answer) last.set(o.uid, { ...p, model: o.model, secs: o.secs }); }
  const dec = new Map(readJsonl(path.join(W, 'decisions-b.jsonl')).map((d) => [d.page_id, d]));
  const rows = reqs.map((r) => ({ page_id: r.uid, action_b: dec.get(r.uid).action, book_id: dec.get(r.uid).book_id, group: dec.get(r.uid).group, ...(last.get(r.uid) || { answer: null, why: 'not reached' }) }));
  writeJsonl(path.join(W, 'screen', 'verdicts.jsonl'), rows);
  const t = {}; for (const r of rows) { const k = `${r.action_b}:${r.answer || 'no-screen'}`; t[k] = (t[k] || 0) + 1; }
  const ns = rows.filter((r) => !r.answer);
  console.log(JSON.stringify({ screened: rows.length - ns.length, of: rows.length, tally: t, no_screen_why: ns.reduce((a, r) => ((a[r.why] = (a[r.why] || 0) + 1), a), {}) }));
  if (flag('retry')) {
    const answeredOrNotReached = new Set(rows.filter((r) => r.answer || r.why === 'not reached').map((r) => r.page_id));
    const retry = reqs.filter((r) => !answeredOrNotReached.has(r.uid));
    writeJsonl(path.join(W, 'screen', 'retry.jsonl'), retry);
    console.log(`retry.jsonl: ${retry.length}`);
  }
}

// ── settle (sealed Opus) ───────────────────────────────────────────────────────────────────────────────────────────
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function runSealed(items, name, outDir, metaDir, briefFile) {
  const sealed = path.join(SCRATCH, 'sealed', `${SET}-${briefFile.replace(/\.md$/, '')}`, name);
  fs.rmSync(sealed, { recursive: true, force: true }); fs.mkdirSync(path.join(sealed, 'images'), { recursive: true });
  fs.copyFileSync(path.join(HERE, briefFile), path.join(sealed, briefFile));
  fs.writeFileSync(path.join(sealed, 'items.json'), JSON.stringify(items, null, 1));
  for (const it of items) fs.copyFileSync(imgOf(it.item_id), path.join(sealed, it.image_file));
  const prompt = `Your instructions are the full text of \`${briefFile}\` in this folder (skip the leading \`<!-- … -->\` comment); follow them exactly. Work only inside this folder.\nITEMS_FILE: \`items.json\`\nOUTPUT_FILE: \`review.json\``;
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tr = path.join(metaDir, `${name}.jsonl`);
    const out = fs.openSync(tr, 'w');
    const child = spawn('claude', ['-p', prompt, '--model', arg('model', 'opus'), '--restricted', '--tools', 'Read', 'Write', '--allowedTools', 'Read', 'Write', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'], { cwd: sealed, stdio: ['ignore', out, out], env: claudeEnv() });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer); fs.closeSync(out);
      let ok = false;
      try { const j = JSON.parse(fs.readFileSync(path.join(sealed, 'review.json'), 'utf8')); if (Array.isArray(j) && j.length) { fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(j, null, 1)); ok = true; } } catch { /* missing or malformed: retried */ }
      const limit = !ok && /usage limit|limit reached|hit your (?:usage |session )?limit|out of extra usage/i.test(fs.readFileSync(tr, 'utf8').slice(-4000));
      resolve({ name, ok, code, limit, secs: Math.round((Date.now() - t0) / 1000) });
    });
  });
}
const opened = (tr, id) => new RegExp(`"name":"Read","input":\\{"file_path":"[^"]*images/${id}\\.jpg`).test(tr);

async function settle() {
  const D = path.join(W, 'settle');
  fs.mkdirSync(path.join(D, 'opus'), { recursive: true }); fs.mkdirSync(path.join(D, 'meta'), { recursive: true });
  const dec = new Map(readJsonl(path.join(W, 'decisions-b.jsonl')).map((d) => [d.page_id, d]));
  const flagged = readJsonl(path.join(W, 'screen', 'verdicts.jsonl')).filter((r) => r.answer && r.answer !== 'OK');
  const items = flagged.map((r) => ({ item_id: r.page_id, language: dec.get(r.page_id).language, image_file: `images/${r.page_id}.jpg`, text: bText(dec.get(r.page_id)), flag: r.answer, flag_note: r.note }));
  const chunks = []; for (let i = 0; i * 5 < items.length; i++) chunks.push([`s${String(i).padStart(3, '0')}`, items.slice(i * 5, (i + 1) * 5)]);
  fs.writeFileSync(path.join(D, 'items.json'), JSON.stringify(chunks.map(([n, xs]) => ({ name: n, ids: xs.map((x) => x.item_id) }))));
  const queue = chunks.filter(([n]) => !fs.existsSync(path.join(D, 'opus', `${n}.json`)));
  console.log(`${SET}: ${items.length} flagged pages, ${queue.length} of ${chunks.length} chunks to settle`);
  let limit = false;
  await Promise.all(Array.from({ length: Math.min(4, Number(arg('parallel', 4))) }, async () => {
    while (queue.length && !limit) {
      const [n, xs] = queue.shift();
      let r = await runSealed(xs, n, path.join(D, 'opus'), path.join(D, 'meta'), 'SETTLE.md');
      if (!r.ok && !r.limit) r = await runSealed(xs, n, path.join(D, 'opus'), path.join(D, 'meta'), 'SETTLE.md');
      if (r.limit) limit = true;
      console.log(`  ${n} ${r.ok ? 'ok' : r.limit ? 'USAGE LIMIT' : 'FAILED'} ${r.secs}s`);
    }
  }));
  if (limit) { console.error('STOPPED: usage limit'); process.exit(3); }
}
function settleVerdicts() {
  const D = path.join(W, 'settle');
  const out = new Map();
  if (!fs.existsSync(path.join(D, 'opus'))) return out;
  for (const f of fs.readdirSync(path.join(D, 'opus'))) {
    const tr = fs.readFileSync(path.join(D, 'meta', f.replace(/\.json$/, '.jsonl')), 'utf8');
    for (const v of JSON.parse(fs.readFileSync(path.join(D, 'opus', f), 'utf8'))) if (opened(tr, v.item_id) && ['confirmed', 'not-confirmed'].includes(v.verdict)) out.set(v.item_id, v);
  }
  return out;
}

// ── decide ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function decide() {
  const screen = new Map(readJsonl(path.join(W, 'screen', 'verdicts.jsonl')).map((r) => [r.page_id, r]));
  const settled = settleVerdicts();
  // override.json: [{ page_id, action, why }] — a settled flag whose fault is arm B's OWN text (a model comment in place
  // of the page), not the served text: no write, and no containment, since what readers get now was not found wrong.
  const ovF = path.join(W, 'override.json');
  const ov = new Map(fs.existsSync(ovF) ? JSON.parse(fs.readFileSync(ovF, 'utf8')).map((o) => [o.page_id, o]) : []);
  const out = readJsonl(path.join(W, 'decisions-b.jsonl')).map((d) => {
    const s = screen.get(d.page_id);
    // Not screened because the book was held at prep: never written here (apply also drops held books).
    if (!s && d.action === 'write') return { ...d, action_b: d.action, action: 'held-skip', screen: null };
    if (!s || !['write', 'keep'].includes(d.action)) return { ...d, action_b: d.action, screen: null };
    const base = { ...d, action_b: d.action, screen: s.answer || 'no-screen', screen_note: s.note ?? s.why };
    if (!s.answer) return d.action === 'write' ? { ...base, action: 'residual', why: `no screen (${s.why})` } : base;
    if (s.answer === 'OK') return base;
    const v = settled.get(d.page_id);
    if (!v) return { ...base, action: 'residual', why: `screen ${s.answer}, not settled` };
    const settle = { verdict: v.verdict, kind: v.kind, confidence: v.confidence, note: v.note };
    if (ov.has(d.page_id)) return { ...base, action: ov.get(d.page_id).action, why: ov.get(d.page_id).why, settle };
    // Opus confirms the flag: the text is not this leaf's (containment-on-finding). A low-confidence confirmation is
    // not a finding with the image open: no write, listed for a person.
    if (v.verdict === 'confirmed' && v.confidence !== 'low') return { ...base, action: 'contain', why: `screen ${s.answer}; Opus confirmed ${v.kind}: ${v.note}`.slice(0, 400), settle };
    if (v.verdict === 'confirmed') return { ...base, action: 'residual', why: `screen ${s.answer}; Opus confirmed at low confidence`, settle };
    return { ...base, settle };
  });
  writeJsonl(path.join(W, 'decisions.jsonl'), out);
  const t = {}; for (const o of out) t[o.action] = (t[o.action] || 0) + 1;
  // Two judges on the same flagged pages: Gemini's flag vs Opus's settlement. Nominal "not this leaf's text" (yes/no)
  // — every unit is a Gemini yes, so α measures how often Opus agrees on a selected set, not a general reliability.
  const pairs = out.filter((o) => o.settle).map((o) => ({ cluster: o.book_id, values: [1, o.settle.verdict === 'confirmed' ? 1 : 0] }));
  const conf = pairs.filter((p) => p.values[1] === 1).length;
  console.log(JSON.stringify({ actions: t, flagged_settled: pairs.length, opus_confirmed: conf }));
}

// ── contain ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function contain() {
  const APPLY = flag('apply');
  const dec = readJsonl(path.join(W, 'decisions.jsonl')).filter((d) => d.action === 'contain' && d.settle); // arm B's own CONTAIN pages were contained by opus-route-6694
  const byBook = {}; for (const d of dec) (byBook[d.book_id] ??= []).push(d);
  const { client, db } = await connect();
  const { holdBook } = await import('../../lib/pipeline-hold.mjs');
  const log = [];
  for (const [bookId, ds] of Object.entries(byBook)) {
    const pages = ds.map((d) => d.page_number).sort((a, b) => a - b);
    const evidence = `#6694 step 3 (job opus-screen-6694, ${SET}): a gemini-3.8-flash-low screen of arm B's text flagged the page and a sealed Opus reader of the image confirmed it: ${ds.map((d) => `p.${d.page_number} ${d.settle.kind}: ${d.settle.note}`).join('; ')}`.slice(0, 1800);
    const h = await holdBook(db, bookId, { reason: 'ocr-unsettled-6420', issue: 6694, release: 'the contained pages are re-read from their own images and settled, or a person releases them', source: 'scripts/batch/ocr-convergence/screen-6694.mjs', detail: { pages, set: SET } }, { dryRun: !APPLY });
    const w = spawnSync('node', [path.join(REPO, 'scripts/maintenance/withhold-stale-translations.mjs'), `--book=${bookId}`, `--by-eye-pages=${pages.join(',')}`, `--evidence=${evidence}`, '--issue=6694', ...(APPLY ? ['--apply'] : [])], { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
    log.push(`== ${bookId} ${ds[0].slug} hold:${h.outcome} pages ${pages.join(',')}\n${w.stdout}${w.stderr}`);
    console.log(`  contain ${ds[0].slug} p.${pages.join(',')}: hold ${h.outcome}; withhold exit ${w.status}`);
  }
  fs.writeFileSync(path.join(W, `contain${APPLY ? '' : '.dry'}.log`), log.join('\n'));
  await client.close();
}

// ── audit-score ────────────────────────────────────────────────────────────────────────────────────────────────────
function auditScore() {
  const AUD = path.join(W, 'audit');
  const key = readJsonl(path.join(AUD, 'key.jsonl'));
  const opus = new Map();
  for (const f of fs.readdirSync(path.join(AUD, 'opus'))) {
    const tr = fs.readFileSync(path.join(AUD, 'meta', f.replace(/\.json$/, '.jsonl')), 'utf8');
    for (const v of JSON.parse(fs.readFileSync(path.join(AUD, 'opus', f), 'utf8'))) if (opened(tr, v.item_id)) opus.set(v.item_id, v);
  }
  const gem = new Map();
  // gemini-out-retry.jsonl: one more call for a verdict that never opened its image (a later answer wins).
  for (const o of [...readJsonl(path.join(AUD, 'gemini-out.jsonl')), ...readJsonl(path.join(AUD, 'gemini-out-retry.jsonl'))]) {
    try { if (!o.text || !(o.gate_calls || []).includes('view_file')) continue; const m = o.text.match(/\{[\s\S]*\}/); if (m) { const v = JSON.parse(m[0]); if (v.better) gem.set(o.uid, v); } } catch { /* missing */ }
  }
  const dec = new Map(readJsonl(path.join(W, 'decisions.jsonl')).map((d) => [d.page_id, d]));
  const verdict = (v, k) => (!v ? null : v.better === 'same' ? 'same' : v.better === k.stored_is ? 'stored' : 'cli');
  const rows = key.map((k) => ({ ...k, book_id: dec.get(k.page_id).book_id, group: dec.get(k.page_id).group, opus: verdict(opus.get(k.page_id), k), gemini: verdict(gem.get(k.page_id), k), opus_serious: opus.get(k.page_id)?.worse_serious ?? null, gemini_serious: gem.get(k.page_id)?.worse_serious ?? null, opus_note: opus.get(k.page_id)?.note, gemini_note: gem.get(k.page_id)?.note }));
  const writes = rows.filter((r) => r.action === 'write');
  const n = (who, v) => writes.filter((r) => r[who] === v).length;
  const worse = writes.filter((r) => r.opus === 'stored' || r.gemini === 'stored').map((r) => r.page_id);
  const stop = n('opus', 'stored') > 0 || n('gemini', 'stored') > 4;
  const R = rng(6694);
  const units = (f) => writes.map((r) => ({ cluster: r.book_id, values: [f(r.opus), f(r.gemini)] }));
  const alpha = {
    verdict: judgeReliability(units((x) => x), { rng: R }),
    worse: judgeReliability(units((x) => (x == null ? null : x === 'stored' ? 1 : 0)), { rng: R }),
  };
  const res = { set: SET, audited: rows.length, writes: writes.length, read: { opus: writes.filter((r) => r.opus).length, gemini: writes.filter((r) => r.gemini).length },
    opus: { better: n('opus', 'cli'), same: n('opus', 'same'), worse: n('opus', 'stored') }, gemini: { better: n('gemini', 'cli'), same: n('gemini', 'same'), worse: n('gemini', 'stored') },
    rule: 'Derek 2026-10-14 (#6694): a page either auditor calls worse is not written; STOP if Opus calls any worse or Gemini > 4/40',
    gate: stop ? 'STOP' : 'GO', not_written_audit_worse: worse,
    alpha: { verdict: { ...alpha.verdict, line: reliabilityLine('better (B/stored/same)', alpha.verdict) }, worse: { ...alpha.worse, line: reliabilityLine('B worse (yes/no)', alpha.worse) } }, rows };
  fs.writeFileSync(path.join(AUD, 'result.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ ...res, rows: undefined }, null, 1));
  for (const r of writes.filter((x) => x.opus === 'stored' || x.gemini === 'stored')) console.log(`  worse? ${r.page_id} ${r.group} opus=${r.opus} gemini=${r.gemini} | ${r.opus_note} | ${r.gemini_note}`);
}

// ── apply ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function apply() {
  const APPLY = flag('apply');
  const res = JSON.parse(fs.readFileSync(path.join(W, 'audit', 'result.json'), 'utf8'));
  if (res.gate !== 'GO') { console.error(`audit gate ${res.gate}: nothing is written`); process.exit(4); }
  const worse = new Set(res.not_written_audit_worse);
  const dec = readJsonl(path.join(W, 'decisions.jsonl'));
  const { client, db } = await connect();
  const held = await heldNow(db, new Set(dec.map((d) => d.book_id)));
  await client.close();
  const ids = dec.filter((d) => d.action === 'write' && !worse.has(d.page_id) && !held.has(d.book_id)).map((d) => d.page_id);
  const A = path.join(W, 'apply'); fs.mkdirSync(A, { recursive: true });
  fs.writeFileSync(path.join(A, 'write-ids.json'), JSON.stringify(ids));
  const reason = `#6694 step 3 (${SET}): Opus (claude -p, subscription) corrected the stored transcription against the page image in place (job opus-route-6694); a gemini-3.8-flash-low leaf screen found it this leaf's text (or a flag Opus did not confirm), and the batch's 40-write audit passed (Opus ${res.opus.worse}, Gemini ${res.gemini.worse} worse of ${res.writes}; job opus-screen-6694)`;
  fs.writeFileSync(path.join(A, 'reason.txt'), reason);
  const r = spawnSync('node', [path.join(REPO, 'scripts/batch/cli-ocr.mjs'), 'apply', `--out=${path.join(W, 'reads')}`, `--only=${path.join(A, 'write-ids.json')}`, `--reason=${reason}`, '--mark-stale=convergent-ocr-6420', ...(APPLY ? ['--apply'] : [])], { encoding: 'utf8', env: process.env, maxBuffer: 256 * 1024 * 1024 });
  fs.writeFileSync(path.join(A, `apply${APPLY ? '' : '.dry'}.log`), r.stdout + r.stderr);
  // The shared-words guard's refusals, for a by-eye look.
  const refused = (r.stdout || '').split('\n').filter((l) => /% of its words are in the stored read/.test(l));
  fs.writeFileSync(path.join(A, `refused${APPLY ? '' : '.dry'}.txt`), refused.join('\n'));
  console.log(`candidates ${ids.length} (held books left out: ${dec.filter((d) => d.action === 'write' && held.has(d.book_id)).length}, audit-worse ${worse.size})`);
  console.log((r.stdout || '').split('\n').slice(-2).join('\n'), r.stderr?.slice(-500) || '');
}

// ── greek-frame ────────────────────────────────────────────────────────────────────────────────────────────────────
async function greekFrame() {
  const G = path.join(SCRATCH, 'g');
  const gl = JSON.parse(fs.readFileSync(path.join(SRC, 'greek-lane-a.json'), 'utf8')).books;
  const { client, db } = await connect();
  const held = await heldNow(db, new Set(gl.map((b) => b.book_id)));
  await client.close();
  fs.mkdirSync(G, { recursive: true });
  const fF = path.join(G, 'frame.json');
  const fr = fs.existsSync(fF) ? JSON.parse(fs.readFileSync(fF, 'utf8')) : { built_at: new Date().toISOString(), note: 'greek-lane-a.json books of each batch, unheld at the time, for driver.mjs select (#6694 step 3)', books: [] };
  const have = new Set(fr.books.map((b) => b.book_id));
  const add = gl.filter((b) => !held.has(b.book_id) && !have.has(b.book_id));
  fr.books.push(...add);
  fs.writeFileSync(fF, JSON.stringify(fr, null, 1));
  const ranks = gl.map((b) => b.rank);
  console.log(`${SET}: ${gl.length} Greek books, ${held.size} held now, ${add.length} added; select with --books=${Math.min(...ranks)}-${Math.max(...ranks)}`);
}

const steps = { prep, 'screen-score': screenScore, settle, decide, contain, 'audit-score': auditScore, apply, 'greek-frame': greekFrame };
if (!steps[STEP]) { console.error(`unknown step ${STEP}; one of ${Object.keys(steps).join(', ')}`); process.exit(2); }
await steps[STEP]();

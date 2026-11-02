#!/usr/bin/env node
// PRIOR ART: scripts/eval/router-confirm/confirm.mjs — the correction runner (cli-ocr.mjs read --correct-prompt on the
// fc template, then a dry apply whose --emit-written is the served text), the read-only Mongo preload and the evidence
// exclusion (evidenceSources, imported); it draws only the german/french-lite queue frames and confirms a switch, it does
// not test a route. scripts/eval/route-judge-6740/judge.mjs — the router tests' frames (zh-dice's Paddle rule, the Latin
// OCR rule) restated here, because its draw takes the first books of a fixed salt (the same books as the earlier tests)
// and cannot cut by script type. scripts/eval/latin-diffqa-7591/diffqa.mjs — the diff-QA stages, run unchanged.
// scripts/eval/correction-pass-7818/lib.mjs judgeAgy — the second (Gemini CLI) judge, imported unchanged.
// scripts/eval/eu-agy-translate-7263/run.mjs opusJudgeCall — the sealed Opus judge with a transcript that shows the image.
/**
 * The live router table's tests[] queue, ranks 1-3 (current.json -> 2026-11-01-validated-7263, #7263; dispatcher note
 * 2026-11-01 23:46Z). Each: 30 pages, one per book, books in none of the cell's evidence, the named route only.
 *
 *   latin-lite/print                  lite>agy-flash-low+diffqa  (agy correction, apply guards, fresh read, #7591 diff-QA)
 *   latin-flash3/unknown              3flash>agy-flash-low       (agy correction, apply guards)
 *   zh-paddle-dice-lt090/manuscript   paddle>agy-flash-low       (agy correction, apply guards; + the Gemini CLI judge)
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/router-queue-7263/run.mjs plan
 *   AGY_HOME=... node ... run.mjs read [--cell=K]       corrections (+ fresh reads and diff-QA for latin-lite)
 *   node ... run.mjs judge [--max-calls=N]              Opus on every served text + 2 wrong-page controls a cell; Gemini too (manuscript)
 *   node ... run.mjs analyze                            results/score.json, the router evidence files
 *
 * A route's SERVED text is what its lane would write: the correction after cli-ocr.mjs apply's guards (dry run), and for
 * +diffqa the diff-QA merge of it; a page the guards refuse serves the stored draft. Nothing is written to the database.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { LITE_MODELS, isInterior } from '../../batch/cli-ocr-lane.mjs';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { bookHand, loadOcrProfile } from '../../lib/ocr-trust-gate.mjs';
import { tagOf } from '../router-next-7263/script-type.mjs';
import { evidenceSources } from '../router-confirm/confirm.mjs';
import { judgePrompt, parseVerdict } from '../route-judge-6740/judge.mjs';
import { judgeAgy, wrongText } from '../correction-pass-7818/lib.mjs';
import { opusJudgeCall } from '../eu-agy-translate-7263/run.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const PRELOAD = path.join(ROOT, 'scripts/eval/router-confirm/readonly-mongo.mjs');
const CLI = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const DIFFQA = path.join(ROOT, 'scripts/eval/latin-diffqa-7591/diffqa.mjs');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'router-queue-7263'));
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1)); };
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const shuffle = (xs, rnd) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const UA = { 'User-Agent': 'SourceLibrary-eval/7263 (https://sourcelibrary.org)' };
export const SEED = 7263_1102;
const AGY_MODEL = 'gemini-3.8-flash-low';
const LANE = 'router-queue-7263-eval';
const HAN = /\p{Script=Han}/gu;

export const CELLS = {
  'latin-lite/print': { base: 'latin-lite', script: 'print', lang: 'Latin', route: 'lite>agy-flash-low+diffqa', draft: 'lite', diffqa: true },
  'latin-flash3/unknown': { base: 'latin-flash3', script: 'unknown', lang: 'Latin', route: '3flash>agy-flash-low', draft: '3flash' },
  'zh-paddle-dice-lt090/manuscript': { base: 'zh-paddle-dice-lt090', script: 'manuscript', lang: 'Chinese', route: 'paddle>agy-flash-low', draft: 'paddle', secondJudge: true, judgeRead: true },
  // judgeRead: cli-ocr.mjs apply refused all 30 corrections on 'more transcription headers than the draft' (the fc template
  // adds <scan-quality>/<warning>/<page-type>/<page-num>, which a Paddle draft never has), so the lane would serve the draft
  // everywhere. The correction READ is judged (as the cell's 2026-10-28 paddle>agy-flash-low evidence was); served counts are reported.
};
const slug = (c) => c.replace(/[^a-z0-9]+/gi, '-');
async function withDb(fn) { const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 }); await c.connect(); try { return await fn(c.db('bookstore')); } finally { await c.close(); } }

/** Every book id in the cell's evidence (confirm.mjs evidenceSources: the score files and their study folders), pages resolved. */
async function evidenceBooks(db, base) {
  const src = evidenceSources(base);
  const ids = new Set();
  for (const f of src.files) { let t = fs.readFileSync(f); if (f.endsWith('.gz')) t = zlib.gunzipSync(t); for (const x of String(t).match(/[0-9a-f]{24}/g) || []) ids.add(x); }
  const all = [...ids], books = new Set(all);
  for (let i = 0; i < all.length; i += 1000) for (const p of await db.collection('pages').find({ id: { $in: all.slice(i, i + 1000) } }, { projection: { book_id: 1 } }).toArray()) books.add(p.book_id);
  return { books, files: src.files.length };
}

/** The router's per-page script class (router-next-7263/script-type.mjs order): the tag, the field, the book's hand, unknown. */
const CLASS = { printed: 'print', mixed: 'print', handwritten: 'manuscript' };
const pageClass = (p, hand) => CLASS[tagOf(p.ocr?.data)] ?? CLASS[p.script_type] ?? (hand === 'print' || hand === 'manuscript' ? hand : 'unknown');

const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, script_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.pipeline': 1, 'ocr.unreadable': 1, 'ocr.edited_by': 1, 'ocr.qa_screen': 1, translation_withheld: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 };

async function plan() {
  const n = Number(arg('n') || 30);
  const out = await withDb(async (db) => {
    const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../../lib/translate-core.mjs');
    const zhBooks = [...new Set((await db.collection('book_events').find({ type: 'paddle_zh_reocr', 'details.pages_written': { $gt: 0 } }, { projection: { _id: 0, book_id: 1 } }).toArray()).map((e) => e.book_id))];
    const res = {};
    for (const [cid, c] of Object.entries(CELLS)) {
      const ex = await evidenceBooks(db, c.base);
      const laneHolds = /^(paddle-zh-(5600|6388)-ocr-only|gpu-backlog-5660)$/;
      const q = c.draft === 'paddle' ? { id: { $in: zhBooks } } : { language: { $regex: '^Latin', $options: 'i' } };
      const books = (await db.collection('books').find({ ...q, visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, title: 1, pages_count: 1, pipeline_auto: 1 } }).toArray())
        .filter((b) => { const h = b.pipeline_auto?.hold; const held = h || b.pipeline_auto?.status === 'held' || b.pipeline_auto?.held; return !held || (c.draft === 'paddle' && h && laneHolds.test(h.reason)); })
        .sort((a, b) => a.id.localeCompare(b.id));
      const eligible = (p) => !p.ocr?.unreadable && !p.ocr?.edited_by && p.ocr?.source !== 'manual' && typeof p.ocr?.data === 'string' && !p.translation_withheld && !SKIP_TRANSLATION_PAGE_TYPES.includes(p.page_type)
        && (c.draft === 'paddle'
          ? p.ocr.source === 'paddle' && p.ocr.pipeline !== 'paddle-zh-guarded-2026-10' && p.ocr.qa_screen?.status === 'screened' && p.ocr.qa_screen.dice >= 0.6 && p.ocr.qa_screen.dice < 0.9 && (p.ocr.data.match(HAN) || []).length >= 40
          : (c.draft === 'lite' ? LITE_MODELS.includes(p.ocr.model) : p.ocr.model === 'gemini-3-flash-preview') && p.ocr.data.length >= 300 && !p.ocr.pipeline);
      const tally = { books_in_frame: books.length, excluded_evidence: 0, walked: 0, no_page: 0, no_page_of_script: 0, image: 0 };
      const sel = [];
      for (const b of shuffle(books, makeRng(SEED + Object.keys(CELLS).indexOf(cid)))) {
        if (sel.length >= n) break;
        if (ex.books.has(b.id)) { tally.excluded_evidence++; continue; }
        tally.walked++;
        const ps = (await db.collection('pages').find({ book_id: b.id, ...VISIBLE_PAGE_MATCH, page_number: { $gt: 0 } }, { projection: PROJ }).toArray())
          .filter((p) => isInterior(p.page_number, b.pages_count) && eligible(p));
        if (!ps.length) { tally.no_page++; continue; }
        const hand = ps.some((p) => !CLASS[tagOf(p.ocr?.data)] && !CLASS[p.script_type]) ? bookHand(await loadOcrProfile(db, b.id, [])) : null;
        const ok = ps.filter((p) => pageClass(p, hand) === c.script).sort((x, y) => sha(`${SEED}${x.id}`).localeCompare(sha(`${SEED}${y.id}`)));
        if (!ok.length) { tally.no_page_of_script++; continue; }
        const p = ok[0], image = getPageSource(p);
        let bytes = 0; try { const r = await fetch(image, { headers: UA }); bytes = r.ok ? (await r.arrayBuffer()).byteLength : 0; } catch { bytes = 0; }
        if (bytes < 2000) { tally.image++; continue; }
        const key = `${c.base.split('-')[0]}-${p.id}`;
        fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true }); fs.writeFileSync(path.join(OUT, 'texts', `${key}.draft.txt`), p.ocr.data);
        sel.push({ key, cell: cid, book_id: b.id, title: String(b.title || '').slice(0, 80), page_id: p.id, page_number: p.page_number, image, ocr_model: p.ocr.model, ocr_source: p.ocr.source ?? null,
          draft_sha: sha(p.ocr.data).slice(0, 16), words: p.ocr.data.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length, han: (p.ocr.data.match(HAN) || []).length, dice: p.ocr.qa_screen?.dice ?? null,
          script_basis: CLASS[tagOf(p.ocr.data)] ? 'tag' : CLASS[p.script_type] ? 'page' : 'book' });
        console.log(`  ${cid} ${sel.length}/${n} ${b.id} p.${p.page_number} ${p.ocr.model} ${String(b.title || '').slice(0, 40)}`);
      }
      res[cid] = { ...c, tally, evidence_files: ex.files, selected: sel };
      console.log(`${cid}: ${sel.length} drawn ${JSON.stringify(tally)}`);
    }
    return res;
  });
  W('plan.json', { at: new Date().toISOString(), seed: SEED, cells: out });
}
const selected = () => Object.values(J('plan.json').cells).flatMap((c) => c.selected);

// ── reads ──
function node(args, log) {
  return new Promise((resolve) => {
    const fd = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [`--import=${PRELOAD}`, ...args], { stdio: ['ignore', fd, fd], env: { ...process.env, AGY_JOB: 'router-queue-7263' } });
    child.on('close', (code) => { fs.closeSync(fd); resolve(code); });
  });
}
const nodePlain = (args, log) => spawnSync(process.execPath, args, { stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')], env: process.env }).status;
async function read() {
  const P = J('plan.json');
  const tpl = path.join(OUT, 'fc-correct-prompt.txt');
  if (!fs.existsSync(tpl)) { const r = spawnSync(process.execPath, [`--import=${PRELOAD}`, path.join(ROOT, 'scripts/eval/flash-reread-5924/fc-prompt.mjs'), tpl], { stdio: 'inherit' }); if (r.status) throw new Error('fc-prompt.mjs refused'); }
  for (const [cid, c] of Object.entries(P.cells)) {
    if (arg('cell') && arg('cell') !== cid) continue;
    const d = path.join(OUT, slug(cid)); fs.mkdirSync(d, { recursive: true });
    const ids = path.join(d, 'ids.json'); fs.writeFileSync(ids, JSON.stringify(c.selected.map((s) => s.page_id)));
    const corr = path.join(d, 'corr'); fs.mkdirSync(corr, { recursive: true });
    console.log(`${cid}: correction reads`);
    let code = await node([CLI, 'read', `--page-ids-file=${ids}`, `--out=${corr}`, `--model=${AGY_MODEL}`, '--job=router-queue-7263', '--stop-on-quota', '--concurrency=2', '--fresh', `--correct-prompt=${tpl}`, `--lane=${LANE}`], path.join(d, 'corr.log'));
    if (code === 3) { console.log('agy quota: stopped'); process.exit(3); }
    const emit = path.join(d, 'emit.jsonl'); fs.rmSync(emit, { force: true });
    for (const f of fs.readdirSync(corr).filter((f) => /^apply-summary-dry/.test(f))) fs.rmSync(path.join(corr, f));
    await node([CLI, 'apply', `--out=${corr}`, '--reason=#7263 router tests[] queue (dry run, never applied)', `--emit-written=${emit}`], path.join(d, 'apply.log'));
    if (c.diffqa) {
      const fresh = path.join(d, 'fresh'); fs.mkdirSync(fresh, { recursive: true });
      console.log(`${cid}: fresh reads + diff-QA`);
      code = await node([CLI, 'read', `--page-ids-file=${ids}`, `--out=${fresh}`, `--model=${AGY_MODEL}`, '--job=router-queue-7263', '--stop-on-quota', '--concurrency=2', '--fresh'], path.join(d, 'fresh.log'));
      if (code === 3) { console.log('agy quota: stopped'); process.exit(3); }
      const q = path.join(d, 'dq'); fs.mkdirSync(q, { recursive: true });
      const sum = path.join(corr, 'apply-summary-dry.json');
      const steps = [['list', `--corr=${corr}`, `--fresh=${fresh}`, ...(fs.existsSync(sum) ? [`--skip=${sum}`] : []), `--out=${q}/L.jsonl`], ['spans', `--list=${q}/L.jsonl`, `--out=${q}/S.jsonl`],
        ['judge-req', `--list=${q}/L.jsonl`, `--spans=${q}/S.jsonl`, `--req=${q}/R.jsonl`, `--key=${q}/K.json`], ['judge', `--req=${q}/R.jsonl`, `--out=${q}/O.jsonl`, '--concurrency=2'],
        ['merge', `--list=${q}/L.jsonl`, `--spans=${q}/S.jsonl`, `--key=${q}/K.json`, `--replies=${q}/O.jsonl`, `--out=${q}/M.jsonl`]];
      for (const s of steps) { const r = s[0] === 'list' ? await node([DIFFQA, ...s], path.join(q, 'dq.log')) : nodePlain([DIFFQA, ...s], path.join(q, 'dq.log')); if (r) { console.log(`diff-QA ${s[0]} exit ${r}`); if (r === 3) process.exit(3); } }
    }
    serve(cid, c);
  }
}
/** texts/<key>.route.txt: the text the route would serve, and why. */
function serve(cid, c0) {
  const c = { ...c0, ...CELLS[cid] };
  const d = path.join(OUT, slug(cid));
  const emitted = new Map(jsonl(path.join(d, 'emit.jsonl')).map((r) => [r.page_id, r.text]));
  const sum = fs.existsSync(path.join(d, 'corr', 'apply-summary-dry.json')) ? JSON.parse(fs.readFileSync(path.join(d, 'corr', 'apply-summary-dry.json'), 'utf8')).skipped_pages || {} : {};
  const merged = new Map(jsonl(path.join(d, 'dq', 'M.jsonl')).map((r) => [r.page_id, r]));
  const held = c.diffqa && fs.existsSync(path.join(d, 'dq', 'M.jsonl.held.json')) ? new Set(JSON.parse(fs.readFileSync(path.join(d, 'dq', 'M.jsonl.held.json'), 'utf8'))) : new Set();
  const rows = [];
  for (const s of c.selected) {
    const draft = fs.readFileSync(path.join(OUT, 'texts', `${s.key}.draft.txt`), 'utf8');
    const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(d, 'corr', `${s.page_id}.meta.json`), 'utf8')); } catch { return null; } })();
    let text = draft, why;
    if (!meta) why = 'not read';
    else if (!emitted.has(s.page_id) && c.judgeRead && meta.exit === 0) { text = fs.readFileSync(path.join(d, 'corr', `${s.page_id}.txt`), 'utf8').trim() || draft; why = `read judged; apply would refuse: ${sum[s.page_id] ?? 'not emitted'}`; }
    else if (!emitted.has(s.page_id)) why = `apply refused: ${sum[s.page_id] ?? 'not emitted'}`;
    else if (c.diffqa && held.has(s.page_id)) why = 'diff-QA held (unjudged span): draft';
    else if (c.diffqa && merged.has(s.page_id)) { text = merged.get(s.page_id).text; why = `diff-QA merged (${merged.get(s.page_id).reverted.length} spans put back)`; }
    else { text = emitted.get(s.page_id); why = c.diffqa ? 'correction (no diff-QA row)' : 'correction'; }
    fs.writeFileSync(path.join(OUT, 'texts', `${s.key}.route.txt`), text);
    rows.push({ key: s.key, why, changed: text !== draft, calls: meta?.calls ?? (meta ? 1 : 0) });
  }
  W(`${slug(cid)}/served.json`, rows);
  const t = {}; for (const r of rows) { const k = r.why.replace(/[:(].*$/, '').trim(); t[k] = (t[k] ?? 0) + 1; }
  console.log(`${cid}: served ${JSON.stringify(t)}`);
}

// ── judge ──
const route = (key) => fs.readFileSync(path.join(OUT, 'texts', `${key}.route.txt`), 'utf8');
function items() {
  const P = J('plan.json'), out = [];
  for (const [cid, c] of Object.entries(P.cells)) {
    for (const s of c.selected) if (fs.existsSync(path.join(OUT, 'texts', `${s.key}.route.txt`))) out.push({ id: `${s.key}:${sha(route(s.key)).slice(0, 12)}`, set: 'abs', cell: cid, key: s.key, lang: c.lang, text_of: s.key, second: !!c.secondJudge });
    const pool = shuffle(c.selected.filter((s) => fs.existsSync(path.join(OUT, 'texts', `${s.key}.route.txt`))), makeRng(SEED + 50 + Object.keys(P.cells).indexOf(cid)));
    for (let j = 0; j + 1 < pool.length && j < 4; j += 2) out.push({ id: `wp-${pool[j].key}-${pool[j + 1].key}`, set: 'wrong_page', cell: cid, key: pool[j].key, lang: c.lang, text_of: pool[j + 1].key, second: !!c.secondJudge });
  }
  return out;
}
async function judge() {
  const sel = new Map(selected().map((s) => [s.key, s]));
  const VO = path.join(OUT, 'verdicts.jsonl'), VG = path.join(OUT, 'verdicts-gemini.jsonl');
  const have = jsonl(VO), haveG = jsonl(VG);
  const done = new Set(have.filter((r) => r.verdict && r.opened).map((r) => r.id)), doneG = new Set(haveG.filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of have.filter((x) => !(x.verdict && x.opened))) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const all = items(), cap = Number(arg('max-calls') || 110);
  const todo = all.filter((it) => (!done.has(it.id) && (tries.get(it.id) ?? 0) < 2) || (it.second && !doneG.has(it.id)));
  console.log(`judge: ${all.length} items; ${todo.length} to do; ${have.length} Opus calls made; cap ${cap} this run`);
  const limits = await import('../../lib/model-limits.mjs');
  const { paceCheck } = await import('../correction-pass-7818/lib.mjs');
  const state = {}; let calls = 0, i = 0, stop = null;
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'transcripts'), { recursive: true });
  const img = async (s) => { const f = path.join(OUT, 'img', `${s.key}.jpg`); if (!fs.existsSync(f)) { const r = await fetch(s.image, { headers: UA }); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } return f; };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, Number(arg('concurrency') || 3))) }, async () => {
    while (!stop && i < todo.length) {
      const it = todo[i++], s = sel.get(it.key), f = await img(s), text = route(it.text_of);
      if (!done.has(it.id)) {
        if (calls >= cap) { stop = `cap ${cap}`; break; }
        const why = await paceCheck(limits, state); if (why) { stop = `pace: ${why}`; break; }
        calls++;
        const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rq7263-'));
        try {
          fs.copyFileSync(f, path.join(ws, 'page.jpg'));
          const prompt = judgePrompt({ task: 'ocr', lang: it.lang, text }, 'the file ./page.jpg in your working directory (open it with Read before you answer)');
          const t0 = Date.now(); const r = await opusJudgeCall(prompt, ws);
          if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); stop = 'quota reply'; break; }
          const v = parseVerdict(r.text), tf = path.join(OUT, 'transcripts', `${it.id.replace(/[^a-z0-9-]/gi, '_')}.${Date.now()}.jsonl.gz`);
          fs.writeFileSync(tf, zlib.gzipSync(r.transcript));
          fs.appendFileSync(VO, JSON.stringify({ ...it, verdict: v, opened: r.opened, cls: r.cls, model: r.model, usage: r.usage, list_usd: r.cost, prompt_sha: sha(prompt).slice(0, 16), transcript: path.relative(OUT, tf), secs: Math.round((Date.now() - t0) / 1000), raw: v ? undefined : r.text.slice(0, 300), at: new Date().toISOString() }) + '\n');
          console.log(`  opus ${it.set} ${it.id}: ${v ? `accept=${v.accept} f${v.fidelity}${wrongText(v) ? ' WRONG-TEXT' : ''}` : 'unparsed'}${r.opened ? '' : ' (IMAGE NOT OPENED)'}`);
        } finally { fs.rmSync(ws, { recursive: true, force: true }); }
      }
      if (it.second && !doneG.has(it.id)) {
        const g = await judgeAgy({ lang: it.lang, text }, fs.readFileSync(f), { model: AGY_MODEL });
        if (g.quota) { stop = `agy quota (${g.err})`; break; }
        fs.appendFileSync(VG, JSON.stringify({ ...it, ...g, at: new Date().toISOString() }) + '\n');
        console.log(`  gemini ${it.set} ${it.id}: ${g.verdict ? `accept=${g.verdict.accept} f${g.verdict.fidelity}` : 'unparsed'}`);
      }
    }
  }));
  console.log(`${calls} Opus calls this run; ${stop ? `STOPPED: ${stop}` : 'queue done'}`);
  if (stop && /quota|pace/.test(stop)) process.exit(3);
}

// ── analyze + router evidence ──
async function analyze() {
  const P = J('plan.json');
  const last = new Map(); for (const r of jsonl(path.join(OUT, 'verdicts.jsonl')).filter((x) => x.verdict && x.opened)) last.set(r.id, r);
  const lastG = new Map(); for (const r of jsonl(path.join(OUT, 'verdicts-gemini.jsonl')).filter((x) => x.verdict)) lastG.set(r.id, r);
  const its = items();
  const res = { at: new Date().toISOString(), seed: SEED, judge: 'claude -p --model opus, sealed, Read only, stream-json transcript (page.jpg opened checked); route-judge judgePrompt OCR form; second judge (manuscript): correction-pass-7818 judgeAgy, gemini-3.8-flash-low on agy', cells: {} };
  const whole = { generated_by: 'scripts/eval/router-queue-7263/run.mjs analyze (job eu-agy-translate-cell-7263, #7263: the live table tests[] ranks 1-3)', judge: res.judge, cells: {} };
  const bys = { generated_by: whole.generated_by, cells: {} };
  for (const [cid, c] of Object.entries(P.cells)) {
    const served = new Map(fs.existsSync(path.join(OUT, slug(cid), 'served.json')) ? J(`${slug(cid)}/served.json`).map((r) => [r.key, r]) : []);
    const per = c.selected.map((s) => {
      const it = its.find((x) => x.set === 'abs' && x.key === s.key), o = it && last.get(it.id), g = it && lastG.get(it.id);
      return { key: s.key, book_id: s.book_id, page_id: s.page_id, page_number: s.page_number, words: s.words, han: s.han, served: served.get(s.key)?.why ?? null, changed: served.get(s.key)?.changed ?? null,
        opus: o ? { accept: !!o.verdict.accept, wrong: wrongText(o.verdict), fidelity: o.verdict.fidelity, defects: (o.verdict.defects || []).map((d) => ({ class: d.class, severity: d.severity })) } : null,
        gemini: g ? { accept: !!g.verdict.accept, wrong: wrongText(g.verdict), fidelity: g.verdict.fidelity } : null };
    });
    const ok = per.filter((p) => p.opus), n = ok.length, k = ok.filter((p) => p.opus.accept).length, w = ok.filter((p) => p.opus.wrong).length;
    const cl = {}; for (const p of ok) for (const x of new Set(p.opus.defects.map((d) => d.class))) cl[x] = (cl[x] ?? 0) + 1;
    const sev = { cosmetic: 0, misleads: 0, wrong_text: 0 }; for (const p of ok) for (const d of p.opus.defects) sev[d.severity] = (sev[d.severity] ?? 0) + 1;
    const unit = c.lang === 'Chinese' ? ok.reduce((a, p) => a + p.han, 0) / 1.5 : ok.reduce((a, p) => a + p.words, 0);   // Chinese: Han / 1.5 ~ words (#7892 convention: ~1.5 characters a word)
    const gOk = per.filter((p) => p.gemini), ctl = its.filter((x) => x.cell === cid && x.set === 'wrong_page').map((x) => ({ id: x.id, opus: last.get(x.id)?.verdict?.accept ?? null, gemini: lastG.get(x.id)?.verdict?.accept ?? null }));
    const r = { n, books: new Set(ok.map((p) => p.book_id)).size, accept: `${k}/${n}`, ci95: n ? wilson(k, n).map((x) => +x.toFixed(3)) : null, wrong_text_pages: `${w}/${n}`,
      classes_k_of_n: Object.fromEntries(Object.entries(cl).sort((a, b) => b[1] - a[1]).map(([x, v]) => [x, `${v}/${n}`])),
      severe_per_1k_words: unit ? +((sev.misleads + sev.wrong_text) * 1000 / unit).toFixed(2) : null, defects_by_severity: sev, words_judged: Math.round(unit),
      ...(gOk.length ? { second_judge: { judge: 'gemini-3.8-flash-low (agy)', family: 'gemini', accept: `${gOk.filter((p) => p.gemini.accept).length}/${gOk.length}`, wrong_text_pages: `${gOk.filter((p) => p.gemini.wrong).length}/${gOk.length}`, both_accept: per.filter((p) => p.opus?.accept && p.gemini?.accept).length } } : {}),
      served_outcomes: per.reduce((a, p) => { const x = String(p.served).replace(/[:(].*$/, '').trim(); a[x] = (a[x] ?? 0) + 1; return a; }, {}), unchanged_pages: per.filter((p) => p.changed === false).length,
      note: 'the drawn pages, each as the route would serve it (a page the apply guards refuse serves the stored draft)' };
    res.cells[cid] = { ...c, selected: undefined, tally: c.tally, route_result: r, controls: ctl, per_page: per };
    whole.cells[`${cid.split('/')[0]}-q7263`] = { task: 'ocr', lang: c.lang, routes: { [c.route]: r } };
    bys.cells[`${cid.split('/')[0]}-q7263|${c.script}`] = { routes: { [c.route]: r } };
    console.log(`${cid} ${c.route}: ${k}/${n} accepted ${JSON.stringify(r.ci95)}, wrong text ${w}/${n}, severe/1k ${r.severe_per_1k_words}; controls ${JSON.stringify(ctl)}${r.second_judge ? `; gemini ${r.second_judge.accept}` : ''}; served ${JSON.stringify(r.served_outcomes)}`);
  }
  fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
  fs.writeFileSync(path.join(HERE, 'results', 'score.json'), JSON.stringify(res, null, 1) + '\n');
  if (process.argv.includes('--evidence')) {
    const RT = path.join(ROOT, 'scripts/eval/estimator/router-table/evidence');
    fs.writeFileSync(path.join(RT, 'router-queue-7263.score.json'), JSON.stringify(whole, null, 1) + '\n');
    fs.writeFileSync(path.join(RT, 'by-script', 'router-queue-7263.score.json'), JSON.stringify(bys, null, 1) + '\n');
  }
}

const stages = { plan, read, judge, analyze, serve: () => { const P = J('plan.json'); for (const [cid, c] of Object.entries(P.cells)) serve(cid, c); } };
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}

#!/usr/bin/env node
// PRIOR ART: scripts/eval/siku-percall-5600/draw.mjs — the lane's cohort (rankBooks, the residue / seal / #7090 exclusions,
// imported the same way); it draws a 4-page block for a per-call test, here the unit is one page read 1 a call as the
// lane reads it. scripts/eval/siku-error-types-5600/judge.mjs — judgePrompt, KINDS, RISKS, parseVerdict, imported
// unchanged (the error kinds this test must score with). scripts/eval/eu-agy-translate-7263/run.mjs — opusJudgeCall (a
// transcript that shows the image opened) and doorVerdict (translate-core's door against a write-dropping db).
/**
 * #5600 Siku translator fix, paired router test on cell zh-siku-first-tr (dispatcher note 2026-11-01 23:50Z: "Derek said
 * do it"). 30 untranslated pages, one per book, from the Siku lane's cohort; both arms on the same page:
 *   A  the live lane: cli-translate.mjs read, gemini-3.8-flash-low, 1 page a call, the lane's LEAF_LINES (instructions-file)
 *   B  A + FIX_LINES: the fix 2026-10-30-siku-translation-error-types-5600.md names (polarity and attribution checks, no
 *      glosses that add names or dates; 6 of 7 HIGH errors there were of these kinds)
 * Judge: Opus (claude -p, page image) with the error-types study's prompt, blind (packets shuffled, no arm in the prompt);
 * the same prompt through agy Gemini 3.8 Flash-low as the second, non-Claude judge (paper decision 8: manuscripts).
 * 2 wrong-page controls (one page's English against another page's image).
 *
 * THE RULE (set before any read): B wins when, on the Opus judge,
 *   (INVENTED errors + HIGH-risk errors) of B < those of A, AND pages verdict "show" of B >= those of A - 1,
 *   AND the Gemini judge moves INVENTED + HIGH the same way (B < A). Then: PR the FIX_LINES into siku-translate-lane.mjs.
 *
 * Every stage takes --scratch=DIR: siku-error-types-5600/judge.mjs reads it (and makes DIR/out-pass1) when imported.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/siku-fix-5600/run.mjs plan --scratch=$JOB_SCRATCH/siku-fix-5600
 *   AGY_HOME=/root/.agy-james node ... run.mjs read      both arms, then a dry apply and the dry door
 *   node ... run.mjs judge [--concurrency=3]               Opus + Gemini
 *   node ... run.mjs analyze                               results/score.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { makeRng, resetSeed, bootstrapCI } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
import { isTranslatablePage } from '../../lib/translate-core.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { bookHand, loadOcrProfile } from '../../lib/ocr-trust-gate.mjs';
import { agyCall, installToolGate, unwrapRead, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';
import { UNTRANSLATED } from '../../batch/cli-translate-lane.mjs';
import { HOLD_REASONS, RUNGS, ISSUE_7090_BOOKS, CHAT_REPLY_RE, LEAF_LINES, rankBooks, isDupeSibling } from '../../batch/siku-translate-lane.mjs';
import { judgePrompt, parseVerdict, KINDS, RISKS } from '../siku-error-types-5600/judge.mjs';
import { opusJudgeCall, doorVerdict } from '../eu-agy-translate-7263/run.mjs';
import { tagOf } from '../router-next-7263/script-type.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const PRELOAD = path.join(ROOT, 'scripts/eval/router-confirm/readonly-mongo.mjs');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'siku-fix-5600'));
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1)); };
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const shuffle = (xs, rnd) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const UA = { 'User-Agent': 'SourceLibrary-eval/5600 (https://sourcelibrary.org)' };
export const SEED = 5600_1102;
const MODEL = 'gemini-3.8-flash-low';
const JOB = 'siku-lane-5600-fix-test';   // prefixed siku-lane-5600: the lane does not treat these books as another job's
export const FIX_LINES = [
  'Keep polarity: every negation, prohibition, condition and question (不, 非, 無, 勿, 莫, 未, 豈) stays as the source has it; never turn a statement into its opposite.',
  'Keep attribution: who says, does, gives or receives each thing stays as in the source; keep each title exactly (天子 is the Son of Heaven, not the Crown Prince); keep each item of a list or count against its own source item.',
  'Add no name, surname, date, reign year, place or identification the source does not state, in the translation or in any note or gloss; a person named only by a title or a style stays named that way.',
].join('\n');
export const ARMS = { A: LEAF_LINES, B: `${LEAF_LINES}\n${FIX_LINES}` };
async function withDb(fn) { const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 }); await c.connect(); try { return await fn(c.db('bookstore')); } finally { await c.close(); } }
const CLASS = { printed: 'print', mixed: 'print', handwritten: 'manuscript' };

async function plan() {
  const n = Number(arg('n') || 30);
  const res = await withDb(async (db) => {
    const rows = await db.collection('books').find({ 'pipeline_auto.status': 'held', 'pipeline_auto.hold.reason': { $in: [...HOLD_REASONS] }, 'translation_state.rung': { $in: [...RUNGS] }, pages_count: { $gt: 0 } },
      { projection: { id: 1, title: 1, language: 1, visible: 1, pages_count: 1, work_id: 1, translation_state: 1, pipeline_auto: 1 } }).toArray();
    const classes = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/zh-residue-refs-6871/classes.json'), 'utf8'));
    const exclude = new Set(ISSUE_7090_BOOKS);
    for (const k of ['table', 'mixed', 'seal']) for (const id of classes[k]?.bids || []) exclude.add(id);
    // the books earlier Siku studies drew: this is new evidence
    for (const f of ['scripts/eval/siku-percall-5600/draw.json', 'scripts/eval/siku-error-types-5600/draw.json']) for (const x of fs.readFileSync(path.join(ROOT, f), 'utf8').match(/[0-9a-f]{24}/g) || []) exclude.add(x);
    const sealRe = classes.seal?.pattern ? new RegExp(classes.seal.pattern) : null;
    const frame = rankBooks(rows, { exclude, sealRe }).sort((a, b) => (a.id < b.id ? -1 : 1));
    const sel = [], tally = { frame_books: frame.length, dupe: 0, no_page: 0, image: 0 };
    for (const b of shuffle(frame, makeRng(SEED))) {
      if (sel.length >= n) break;
      if (b.work_id) { const sibs = await db.collection('books').find({ work_id: b.work_id, id: { $ne: b.id } }, { projection: { id: 1, title: 1, language: 1, pages_translated: 1, translation_state: 1, 'pipeline_auto.hold.reason': 1 } }).toArray(); if (sibs.some((s) => isDupeSibling(b, s))) { tally.dupe++; continue; } }
      const ps = (await db.collection('pages').find({ book_id: b.id, ...UNTRANSLATED }, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, script_type: 1, ocr: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } }).sort({ page_number: 1 }).toArray())
        .filter((p) => p.page_number > Math.floor(0.15 * b.pages_count) && p.page_number <= Math.ceil(0.95 * b.pages_count) && isTranslatablePage(p).ok && !CHAT_REPLY_RE.test(p.ocr?.data || '') && ((p.ocr?.data || '').match(/\p{Script=Han}/gu) || []).length >= 40);
      if (!ps.length) { tally.no_page++; continue; }
      const p = ps[Math.floor(makeRng(SEED + parseInt(b.id.slice(-6), 16))() * ps.length)];
      const image = getPageSource(p);
      let bytes = 0; try { const r = await fetch(image, { headers: UA }); bytes = r.ok ? (await r.arrayBuffer()).byteLength : 0; } catch { bytes = 0; }
      if (bytes < 2000) { tally.image++; continue; }
      const hand = CLASS[tagOf(p.ocr.data)] ?? CLASS[p.script_type] ?? bookHand(await loadOcrProfile(db, b.id, []));
      const near = await db.collection('pages').find({ book_id: b.id, page_number: { $in: [p.page_number - 1, p.page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
      const prev = near.find((x) => x.page_number === p.page_number - 1), next = near.find((x) => x.page_number === p.page_number + 1);
      const tail = (s, k) => (s ? String(s).trim().slice(-k) : null);
      sel.push({ key: `zh-${p.id}`, book_id: b.id, title: String(b.title || '').slice(0, 80), hold: b.pipeline_auto.hold.reason, page_id: p.id, page_number: p.page_number, image, ocr: p.ocr.data, ocr_model: p.ocr.model ?? null,
        script: ['print', 'manuscript'].includes(hand) ? hand : 'unknown', prev_ocr_tail: tail(prev?.ocr?.data, 200), prev_english_tail: tail(prev?.translation?.data, 300), next_ocr_head: next?.ocr?.data ? String(next.ocr.data).trim().slice(0, 120) : null });
      console.log(`  ${sel.length}/${n} ${b.id} p.${p.page_number} ${hand} ${String(b.title || '').slice(0, 40)}`);
    }
    return { tally, sel };
  });
  W('plan.json', { at: new Date().toISOString(), seed: SEED, rule: 'see run.mjs header', fix_lines: FIX_LINES, leaf_lines: LEAF_LINES, ...res.tally, selected: res.sel });
  console.log(JSON.stringify(res.tally), 'drawn', res.sel.length);
}

function node(args, log) {
  return new Promise((resolve) => {
    const fd = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [`--import=${PRELOAD}`, ...args], { stdio: ['ignore', fd, fd], env: { ...process.env, CLI_JOB_NAME: JOB } });
    child.on('close', (code) => { fs.closeSync(fd); resolve(code); });
  });
}
async function read() {
  const P = J('plan.json');
  for (const arm of Object.keys(ARMS)) {
    if (arg('arm') && arg('arm') !== arm) continue;
    const d = path.join(OUT, arm); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'ids.json'), JSON.stringify(P.selected.map((s) => s.page_id)));
    fs.writeFileSync(path.join(d, 'instructions.json'), JSON.stringify(Object.fromEntries(P.selected.map((s) => [s.page_id, ARMS[arm]]))));
    console.log(`arm ${arm}: cli-translate.mjs read, ${P.selected.length} pages`);
    const code = await node([path.join(ROOT, 'scripts/batch/cli-translate.mjs'), 'read', `--page-ids-file=${path.join(d, 'ids.json')}`, `--out=${d}`, `--model=${MODEL}`, `--instructions-file=${path.join(d, 'instructions.json')}`, '--fresh'], path.join(d, 'read.log'));
    if (code === 3) { console.log('agy quota: stopped'); process.exit(3); }
    const ap = path.join(d, 'apply.log'); fs.rmSync(ap, { force: true });
    await node([path.join(ROOT, 'scripts/batch/cli-translate.mjs'), 'apply', `--out=${d}`, `--reason=#5600 Siku fix test arm ${arm} (dry run, never applied)`], ap);
    const log = fs.readFileSync(ap, 'utf8');
    const rows = [];
    await withDb(async (db) => {
      for (const s of P.selected) {
        const f = path.join(d, `${s.page_id}.txt`), text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
        const skip = new RegExp(`skip p\\.${s.page_number}: (.*)`).exec(log)?.[1] ?? null, would = new RegExp(`would write p\\.${s.page_number} `).test(log);
        let served = null, why;
        if (!text) why = 'not read'; else if (skip) why = `apply: ${skip}`; else if (!would) why = 'apply: no line';
        else { const v = await doorVerdict(db, s.page_id, text, { model: MODEL }); if (v.ok) { served = v.text; why = 'written'; } else why = `door: ${v.why}`; }
        if (served != null) fs.writeFileSync(path.join(d, `${s.page_id}.served.txt`), served);
        rows.push({ key: s.key, written: served != null, why });
      }
    });
    W(`${arm}/served.json`, rows);
    console.log(`arm ${arm}: written ${rows.filter((r) => r.written).length}/${rows.length}; ${JSON.stringify(rows.filter((r) => !r.written).map((r) => r.why))}`);
  }
}

const servedText = (arm, s) => { const f = path.join(OUT, arm, `${s.page_id}.served.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
function items() {
  const P = J('plan.json'), out = [];
  for (const s of P.selected) for (const arm of Object.keys(ARMS)) if (servedText(arm, s) != null) out.push({ id: `${s.key}:${arm}`, set: 'abs', key: s.key, arm, text_of: s.key });
  const pool = shuffle(P.selected.filter((s) => servedText('A', s) != null), makeRng(SEED + 7));
  for (let j = 0; j + 1 < pool.length && j < 4; j += 2) out.push({ id: `wp-${pool[j].key}-${pool[j + 1].key}`, set: 'wrong_page', key: pool[j].key, arm: 'A', text_of: pool[j + 1].key });
  return shuffle(out, makeRng(SEED + 8));
}
const valid = (v) => v && Array.isArray(v.errors) && ['show', 'caveat', 'dont'].includes(v.verdict) && v.errors.every((e) => KINDS.includes(e.kind) && RISKS.includes(e.risk));
const packet = (s, english) => ({ book_title: s.title, page_number: s.page_number, image: 'page.jpg', ocr: s.ocr, prev_ocr_tail: s.prev_ocr_tail, prev_english_tail: s.prev_english_tail, next_ocr_head: s.next_ocr_head, english });
async function judge() {
  const P = J('plan.json'), by = new Map(P.selected.map((s) => [s.key, s]));
  const VO = path.join(OUT, 'verdicts-opus.jsonl'), VG = path.join(OUT, 'verdicts-gemini.jsonl');
  const doneO = new Set(jsonl(VO).filter((r) => r.verdict && r.opened).map((r) => r.id)), doneG = new Set(jsonl(VG).filter((r) => r.verdict).map((r) => r.id));
  const triesO = new Map(); for (const r of jsonl(VO).filter((x) => !(x.verdict && x.opened))) triesO.set(r.id, (triesO.get(r.id) ?? 0) + 1);
  const todo = items().filter((it) => (!doneO.has(it.id) && (triesO.get(it.id) ?? 0) < 2) || !doneG.has(it.id));
  console.log(`judge: ${todo.length} items to do`);
  const limits = await import('../../lib/model-limits.mjs');
  const { paceCheck } = await import('../correction-pass-7818/lib.mjs');
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'transcripts'), { recursive: true });
  const state = {}; let i = 0, stop = null;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, Number(arg('concurrency') || 3))) }, async () => {
    while (!stop && i < todo.length) {
      const it = todo[i++], s = by.get(it.key), english = servedText(it.arm, by.get(it.text_of));
      const imgF = path.join(OUT, 'img', `${s.key}.jpg`);
      if (!fs.existsSync(imgF)) { const r = await fetch(s.image, { headers: UA }); fs.writeFileSync(imgF, Buffer.from(await r.arrayBuffer())); }
      const prompt = judgePrompt(packet(s, english));
      if (!doneO.has(it.id)) {
        const why = await paceCheck(limits, state); if (why) { stop = `pace: ${why}`; break; }
        const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'sf5600-'));
        try {
          fs.copyFileSync(imgF, path.join(ws, 'page.jpg'));
          const t0 = Date.now(); const r = await opusJudgeCall(prompt, ws);
          if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); stop = 'quota reply'; break; }
          let v = parseVerdict(r.text); if (!valid(v)) v = null;
          const tf = path.join(OUT, 'transcripts', `${it.id.replace(/[^a-z0-9-]/gi, '_')}.${Date.now()}.jsonl.gz`); fs.writeFileSync(tf, zlib.gzipSync(r.transcript));
          fs.appendFileSync(VO, JSON.stringify({ ...it, verdict: v, opened: r.opened, model: r.model, usage: r.usage, list_usd: r.cost, prompt_sha: sha(prompt).slice(0, 16), transcript: path.relative(OUT, tf), secs: Math.round((Date.now() - t0) / 1000), raw: v ? undefined : r.text.slice(0, 300), at: new Date().toISOString() }) + '\n');
          console.log(`  opus ${it.id}: ${v ? `${v.verdict} ${v.errors.length} err (${v.errors.filter((e) => e.risk === 'HIGH').length} HIGH)` : 'unparsed'}${r.opened ? '' : ' (IMAGE NOT OPENED)'}`);
        } finally { fs.rmSync(ws, { recursive: true, force: true }); }
      }
      if (!doneG.has(it.id)) {
        const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'sf5600g-'));
        try {
          fs.copyFileSync(imgF, path.join(ws, 'page.jpg')); installToolGate(ws);
          const gp = prompt.replace(/First open the page image with the Read tool: page\.jpg \(in the current directory\)\./, 'The page image is attached: @./page.jpg.') + '\n\nWrite the JSON object between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary.';
          let v = null, r = null, calls = 0;
          for (let k = 0; k < 2 && !v; k++) { r = await agyCall(['-p', gp, '--model', MODEL, ...CLI_SAFE_ARGS], ws); if (r.not_called || r.cls === 'quota') { stop = `agy quota (${r.err ?? r.cls})`; break; } calls++; v = parseVerdict(unwrapRead(r.text).text || r.text); if (!valid(v)) v = null; }
          if (stop) break;
          fs.appendFileSync(VG, JSON.stringify({ ...it, verdict: v, calls, model: MODEL, raw: v ? undefined : String(r?.text || '').slice(0, 300), at: new Date().toISOString() }) + '\n');
          console.log(`  gemini ${it.id}: ${v ? `${v.verdict} ${v.errors.length} err` : 'unparsed'}`);
        } finally { fs.rmSync(ws, { recursive: true, force: true }); }
      }
    }
  }));
  console.log(stop ? `STOPPED: ${stop}` : 'queue done');
  if (stop) process.exit(3);
}

// ── analyze: the study's kinds, risks and severe errors per 1,000 English words ──
const SEVERE = (e) => e.kind !== 'STYLE' && e.kind !== 'JUNK' && (e.risk === 'HIGH' || e.risk === 'MEDIUM');
const words = (t) => String(t || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => /\p{L}|\d/u.test(w)).length;
async function analyze() {
  const P = J('plan.json');
  const out = { at: new Date().toISOString(), seed: SEED, rule: 'B wins: (INVENTED + HIGH) B < A on Opus, show B >= show A - 1, and Gemini (INVENTED + HIGH) B < A', judges: {} };
  for (const [jn, file] of [['opus', 'verdicts-opus.jsonl'], ['gemini', 'verdicts-gemini.jsonl']]) {
    const last = new Map(); for (const r of jsonl(path.join(OUT, file)).filter((x) => x.verdict && (jn === 'gemini' || x.opened))) last.set(r.id, r);
    const arms = {}, per = [];
    for (const arm of Object.keys(ARMS)) {
      const served = J(`${arm}/served.json`);
      const rows = P.selected.map((s) => { const v = last.get(`${s.key}:${arm}`)?.verdict; const t = servedText(arm, s); return { key: s.key, script: s.script, written: t != null, v, w: words(t) }; });
      const judged = rows.filter((r) => r.v), errs = judged.flatMap((r) => r.v.errors);
      const kinds = Object.fromEntries(KINDS.map((k) => [k, errs.filter((e) => e.kind === k).length]));
      const show = rows.filter((r) => r.v?.verdict === 'show').length, n = rows.length;
      arms[arm] = { n, written: served.filter((r) => r.written).length, judged: judged.length, show, show_ci95: wilson(show, n).map((x) => +x.toFixed(3)), caveat: judged.filter((r) => r.v.verdict === 'caveat').length, dont: judged.filter((r) => r.v.verdict === 'dont').length,
        errors: errs.length, per_page: +(errs.length / Math.max(1, judged.length)).toFixed(2), kinds, high: errs.filter((e) => e.risk === 'HIGH').length, pages_high: judged.filter((r) => r.v.errors.some((e) => e.risk === 'HIGH')).length,
        invented: kinds.INVENTED, pages_invented: judged.filter((r) => r.v.errors.some((e) => e.kind === 'INVENTED')).length, inv_plus_high: kinds.INVENTED + errs.filter((e) => e.risk === 'HIGH').length,
        severe_per_1k_words: +(errs.filter(SEVERE).length * 1000 / Math.max(1, judged.reduce((a, r) => a + r.w, 0))).toFixed(2), english_words: judged.reduce((a, r) => a + r.w, 0),
        ocr_carried: kinds['OCR-CARRIED'], by_script: Object.fromEntries(['print', 'manuscript', 'unknown'].map((sc) => [sc, { n: rows.filter((r) => r.script === sc).length, show: rows.filter((r) => r.script === sc && r.v?.verdict === 'show').length }])) };
      per.push(...rows.map((r) => ({ key: r.key, arm, verdict: r.v?.verdict ?? null, errors: r.v?.errors?.map((e) => `${e.kind}:${e.risk}`) ?? null })));
    }
    resetSeed(SEED);
    const both = P.selected.filter((s) => last.get(`${s.key}:A`) && last.get(`${s.key}:B`));
    const ih = (s, a) => { const v = last.get(`${s.key}:${a}`).verdict; return v.errors.filter((e) => e.kind === 'INVENTED' || e.risk === 'HIGH').length; };
    const d = both.map((s) => ih(s, 'B') - ih(s, 'A'));
    const ctl = jsonl(path.join(OUT, file)).filter((r) => r.set === 'wrong_page' && r.verdict).map((r) => ({ id: r.id, verdict: r.verdict.verdict }));
    out.judges[jn] = { arms, paired_pages: both.length, inv_high_diff_B_minus_A: d.reduce((a, x) => a + x, 0), inv_high_diff_ci95_per_page: both.length > 1 ? bootstrapCI(d).map((x) => +x.toFixed(3)) : null, controls: ctl, per_page: per };
    console.log(`${jn}: A show ${arms.A.show}/${arms.A.n} INV+HIGH ${arms.A.inv_plus_high} severe/1k ${arms.A.severe_per_1k_words} | B show ${arms.B.show}/${arms.B.n} INV+HIGH ${arms.B.inv_plus_high} severe/1k ${arms.B.severe_per_1k_words} | controls ${JSON.stringify(ctl.map((c) => c.verdict))}`);
  }
  const o = out.judges.opus.arms, g = out.judges.gemini.arms;
  out.b_wins = o.B.inv_plus_high < o.A.inv_plus_high && o.B.show >= o.A.show - 1 && g.B.inv_plus_high < g.A.inv_plus_high;
  console.log(`B wins by the rule: ${out.b_wins}`);
  fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
  fs.writeFileSync(path.join(HERE, 'results', 'score.json'), JSON.stringify(out, null, 1) + '\n');
}

const stages = { plan, read, judge, analyze };
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}

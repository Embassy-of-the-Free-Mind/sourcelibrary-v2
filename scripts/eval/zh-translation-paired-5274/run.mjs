#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs — its judgePrompt (one candidate against the page image and the
// source transcription, 44-class defects with severity), opusCall, parseVerdict and claudeBlocked pacing are reused
// unchanged; its draw / packet / score stages do not fit (cells of OCR routes, wrong-page controls per route, no
// paired arm on the same translation page). scripts/maintenance/wrong-leaf-fix-5021.mjs: the pool floors (weekly 35%
// or the lane reserve, 5-hour 25%) and agyEnv. The paired-arm-judge skill (#8063) had not merged on 2026-11-04.
/**
 * The #5274 paired translation test (PREREGISTRATION.md). DIR holds draw.mjs's sample.json.
 *
 *   node --env-file=... run.mjs arms   --out=DIR --arm=F|N|M --home=/root/.agy-james
 *   node --env-file=... run.mjs packet --out=DIR
 *   node                run.mjs judge  --out=DIR [--concurrency=3] [--limit=N]
 *   node                run.mjs score  --out=DIR
 *   node --env-file=... run.mjs write  --out=DIR [--apply]
 *
 * arms: cli-translate.mjs read --fresh (CANDIDATE_READS=off, nothing kept in R2) in chunks of 10 pages, the pool's
 * floors checked before each chunk; F = the live prompt, N = --no-previous-translation, M = flash-medium.
 * write: the useful-page rule (PREREGISTRATION.md): the best accepted, not-wrong-text arm read that the judge prefers to
 * the stored English, on a page whose English is unchanged since the draw, through cli-translate.mjs apply.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../lib/paired-stats.mjs';
import { judgePrompt, opusCall, parseVerdict } from '../route-judge-6740/judge.mjs';
import { words7824 } from '../correction-pass-7818/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const STAGE = process.argv[2];
const OUT = arg('out') && path.resolve(arg('out'));
const SEED = 20261104;
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const ARMS = { F: { model: 'gemini-3.8-flash-low', flags: [] }, N: { model: 'gemini-3.8-flash-low', flags: ['--no-previous-translation'] }, M: { model: 'gemini-3.8-flash-medium', flags: [] } };
const SEV = { cosmetic: 1, misleads: 5, wrong_text: 25 };   // #7824 MQM weights
const JOB = 'zh-translation-paired-5274';

async function arms() {
  const { readPool, agyEnv, weeklyReserve } = await import('../../lib/agy-pools.mjs');
  const name = arg('arm'), a = ARMS[name], home = arg('home') || null;
  if (!a) throw new Error('--arm=F|N|M');
  const ids = J('sample.json').pages.map((p) => p.page_id);
  const dir = path.join(OUT, `arm-${name}`); fs.mkdirSync(dir, { recursive: true });
  const meter = path.join(OUT, 'quota.jsonl');
  const reading = () => readPool(home);
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10).filter((id) => !fs.existsSync(path.join(dir, `${id}.meta.json`)));
    if (!chunk.length) continue;
    const r = reading();
    fs.appendFileSync(meter, JSON.stringify({ at: new Date().toISOString(), arm: name, home, before_chunk: i, reading: r }) + '\n');
    const line = Math.max(0.35, weeklyReserve({ resetTime: r?.weeklyReset, lane: null }));
    if (!r || r.weekly < line || (r.fiveHour ?? 0) < 0.25) { console.error(`pool ${home} under its floor (${JSON.stringify(r)}): stopping`); process.exit(3); }
    const f = path.join(dir, `chunk-${i}.json`); fs.writeFileSync(f, JSON.stringify(chunk));
    const res = spawnSync('node', [path.join(ROOT, 'scripts/batch/cli-translate.mjs'), 'read', `--page-ids-file=${f}`, `--out=${dir}`, `--model=${a.model}`, '--fresh', ...a.flags],
      { cwd: ROOT, stdio: 'inherit', env: agyEnv(home, process.env, { CANDIDATE_READS: 'off', TRANSLATE_FOLIO_MARKERS_CLI: '0', CLI_JOB_NAME: JOB, AGY_JOB: JOB }) });
    if (res.status !== 0) { console.error(`cli-translate exit ${res.status}: stopping`); process.exit(res.status === 3 ? 3 : 1); }
  }
  fs.appendFileSync(meter, JSON.stringify({ at: new Date().toISOString(), arm: name, home, after: true, reading: reading() }) + '\n');
}

const readArm = (name, id) => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(OUT, `arm-${name}`, `${id}.meta.json`), 'utf8'));
    const t = fs.readFileSync(path.join(OUT, `arm-${name}`, `${id}.txt`), 'utf8');
    return m.exit === 0 && !m.error_class && !m.wrapper && t.trim().length > 5 ? { text: t, meta: m } : null;
  } catch { return null; }
};

async function packet() {
  const { MongoClient } = await import('mongodb');
  const { contentHash } = await import('../../lib/write-provenance.mjs');
  const s = J('sample.json');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const all = [...s.pages, ...s.spare];
  const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: all.map((p) => p.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  const armNames = Object.keys(ARMS).filter((n) => fs.existsSync(path.join(OUT, `arm-${n}`)));
  const items = new Map(), key = [], missing = [];
  const add = (sp, arm, kind, text, extra = {}) => {
    const id = kind === 'item' ? `j${h(`${sp.page_id}:${h(text.trim())}`).slice(0, 10)}` : `j${h(`${kind}:${sp.page_id}:${extra.other ?? ''}`).slice(0, 10)}`;
    if (!items.has(id)) items.set(id, { id, task: 'translation', lang: 'Chinese', image_url: sp.image_url, source: pages.get(sp.page_id).ocr.data, text });
    key.push({ judged_as: id, arm, kind, page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, kind_of_text: sp.kind, ...extra });
  };
  for (const sp of s.pages) {
    const p = pages.get(sp.page_id);
    if (contentHash(p.ocr.data) !== sp.ocr_hash) { missing.push({ page_id: sp.page_id, why: 'OCR changed since the draw' }); continue; }
    if (contentHash(p.translation?.data || '') !== sp.translation_hash) { missing.push({ page_id: sp.page_id, why: 'stored English changed since the draw' }); continue; }
    add(sp, 'S', 'item', p.translation.data);
    for (const a of armNames) { const r = readArm(a, sp.page_id); if (r) add(sp, a, 'item', r.text); else missing.push({ page_id: sp.page_id, arm: a, why: 'no usable read' }); }
  }
  const rng = makeRng(SEED);
  // Swaps: this page's image and transcription, a spare book's stored English (same kind of text).
  const targets = s.pages.map((p) => [rng(), p]).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  let nSwap = 0;
  for (const kind of ['reference', 'prose']) {
    const spares = s.spare.filter((x) => x.kind === kind).slice(0, 5), tg = targets.filter((x) => x.kind === kind).slice(0, 5);
    tg.forEach((sp, i) => { add(sp, 'S', 'swap', pages.get(spares[i].page_id).translation.data, { other: spares[i].page_id }); nSwap++; });
  }
  // Retests: 10 judged items again under a new id (the text gets a trailing newline: same content, a new call).
  const arm = [...new Set(key.filter((k) => k.kind === 'item').map((k) => k.judged_as))].map((id) => [rng(), id]).sort((a, b) => a[0] - b[0]).slice(0, 10).map(([, id]) => id);
  for (const id of arm) {
    const it = items.get(id), k = key.find((x) => x.judged_as === id), nid = `j${h(`retest:${id}`).slice(0, 10)}`;
    items.set(nid, { ...it, id: nid, text: `${it.text.trimEnd()}\n` });
    key.push({ ...k, judged_as: nid, kind: 'retest', of: id });
  }
  const order = [...items.values()].map((it) => [h(`order:${SEED}:${it.id}`), it]).sort((a, b) => a[0].localeCompare(b[0])).map(([, it]) => it);
  W('packet.json', { items: order }); W('key.json', key); W('packet-missing.json', missing);
  console.log(`packet: ${order.length} judge calls (${nSwap} swaps, ${arm.length} retests); arms ${['S', ...armNames].join(',')}; missing ${missing.length}`);
}

// Two questions appended to judge.mjs's translation prompt, for this test (PREREGISTRATION.md).
export function prompt(it, imageRef) {
  const base = judgePrompt(it, imageRef);
  const add = `- source_misread: does the TRANSCRIPTION itself misread the image somewhere in a way that changes the sense (a wrong character that changes a word, a dropped or added line, another leaf's text)? true or false; "misread_quote": a short span of the transcription where it does, else "".
- for each defect also give "origin": "translation" when the translator made it, or "transcription" when the English faithfully renders a transcription error.

Tags such as`;
  return base.replace('\n\nTags such as', `\n${add}`)
    .replace(/Answer with one JSON object only: .*$/s, 'Answer with one JSON object only: {"accept": bool, "fidelity": n, "defects": [{"class": "T8", "quote": "...", "severity": "misleads", "origin": "translation", "what": "a few words"}], "source_misread": bool, "misread_quote": "...", "reader_note": "..."}');
}

async function judge() {
  const limits = await import('../../lib/model-limits.mjs');
  const limit = Number(arg('limit', Infinity));
  const file = path.join(OUT, 'verdicts-opus.jsonl');
  const prev = jsonl(file), done = new Set(prev.filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of prev) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const todo = J('packet.json').items.filter((it) => !done.has(it.id) && (tries.get(it.id) ?? 0) < 3);
  const total = prev.length;
  if (total + todo.length > 400) console.log(`warning: ${total} calls made, ${todo.length} to go; the ceiling is 400`);
  let stop = null, calls = 0, i = 0;
  console.log(`opus: ${todo.length} items to judge`);
  const one = async (it) => {
    if (stop || calls >= limit || total + calls >= 400) return;
    const b = limits.claudeBlocked({ weeklyMax: 85, sessionMax: 95 });
    if (b) { stop = b; return; }
    calls++;
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'zhp-opus-'));
    try {
      const res = await fetch(it.image_url);
      if (!res.ok) { fs.appendFileSync(file, JSON.stringify({ id: it.id, verdict: null, raw: `image HTTP ${res.status}` }) + '\n'); return; }
      fs.writeFileSync(path.join(ws, 'page.jpg'), Buffer.from(await res.arrayBuffer()));
      const t0 = Date.now();
      const r = await opusCall(prompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws);
      if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); stop = { reason: 'quota reply' }; return; }
      const v = parseVerdict(r.text);
      fs.appendFileSync(file, JSON.stringify({ id: it.id, judge: 'opus', model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 500), usage: r.usage, list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.id}: ${v ? `accept=${v.accept} ${v.fidelity} (${(v.defects || []).length} defects) misread=${v.source_misread}` : `unparsed ${r.cls ?? ''}`}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency', 3))));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`BLOCKED (${JSON.stringify(stop)})`); process.exit(3); }
}

// ── score ──
const wt = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text');
const major = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text' || d.severity === 'misleads');
const weighted = (v, origin = null) => (v.defects || []).filter((d) => !origin || (d.origin || 'translation') === origin).reduce((s, d) => s + (SEV[d.severity] ?? 0), 0);
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
/** Exact two-sided McNemar on b gained, c lost. */
export function mcnemar(b, c) {
  const n = b + c; if (!n) return 1;
  const k = Math.min(b, c); let p = 0; for (let i = 0; i <= k; i++) p += binom(n, i);
  return Math.min(1, (2 * p) / 2 ** n);
}
const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, w = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [+(c - w).toFixed(3), +(c + w).toFixed(3)]; };
const better = (a, b) => (a.accept !== b.accept ? a.accept : a.fidelity !== b.fidelity ? a.fidelity > b.fidelity : weighted(a) < weighted(b));

function rowsOf() {
  const vs = new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const items = new Map(J('packet.json').items.map((it) => [it.id, it]));
  return J('key.json').map((k) => ({ ...k, v: vs.get(k.judged_as) ?? null, words: words7824(items.get(k.judged_as)?.text) }));
}

export function score() {
  const rows = rowsOf();
  const arms = [...new Set(rows.filter((r) => r.kind === 'item').map((r) => r.arm))];
  const item = (arm, pid) => rows.find((r) => r.kind === 'item' && r.arm === arm && r.page_id === pid && r.v);
  const pagesAll = [...new Set(rows.filter((r) => r.kind === 'item').map((r) => r.page_id))];
  const paired = pagesAll.filter((pid) => arms.every((a) => item(a, pid)));   // pages every arm has a verdict on
  const per = (arm, sel) => {
    const xs = paired.filter(sel).map((pid) => item(arm, pid));
    const n = xs.length, acc = xs.filter((r) => r.v.accept).length, words = xs.reduce((s, r) => s + r.words, 0);
    return { n, accepted: acc, accept_rate: n ? +(acc / n).toFixed(3) : null, accept_ci95: wilson(acc, n), wrong_text_pages: xs.filter((r) => wt(r.v)).length, major_pages: xs.filter((r) => major(r.v)).length,
      major_rate: n ? +(xs.filter((r) => major(r.v)).length / n).toFixed(3) : null, words, weighted_per_1k: words ? +((1000 * xs.reduce((s, r) => s + weighted(r.v), 0)) / words).toFixed(2) : null,
      weighted_per_1k_translator: words ? +((1000 * xs.reduce((s, r) => s + weighted(r.v, 'translation'), 0)) / words).toFixed(2) : null,
      transcription_defect_share: (() => { const d = xs.flatMap((r) => r.v.defects || []).filter((x) => x.severity !== 'cosmetic'); return d.length ? +(d.filter((x) => x.origin === 'transcription').length / d.length).toFixed(3) : null; })(),
      misread_flagged: xs.filter((r) => r.v.source_misread).length, fidelity_mean: n ? +(xs.reduce((s, r) => s + r.v.fidelity, 0) / n).toFixed(2) : null,
      fidelity: [1, 2, 3, 4, 5].map((f) => xs.filter((r) => r.v.fidelity === f).length) };
  };
  const kinds = { all: () => true, reference: (pid) => rows.find((r) => r.page_id === pid).kind_of_text === 'reference', prose: (pid) => rows.find((r) => r.page_id === pid).kind_of_text === 'prose' };
  const out = { at: new Date().toISOString(), paired_pages: paired.length, pages_with_any_verdict: pagesAll.length, arms: {}, pairs: {}, controls: {}, misread: {} };
  for (const a of arms) out.arms[a] = Object.fromEntries(Object.entries(kinds).map(([k, f]) => [k, per(a, f)]));
  const pair = (a, b) => Object.fromEntries(Object.entries(kinds).map(([k, f]) => {
    const ps = paired.filter(f);
    const gained = ps.filter((p) => item(a, p).v.accept && !item(b, p).v.accept), lost = ps.filter((p) => !item(a, p).v.accept && item(b, p).v.accept);
    const fb = ps.filter((p) => item(a, p).v.fidelity > item(b, p).v.fidelity).length, fw = ps.filter((p) => item(a, p).v.fidelity < item(b, p).v.fidelity).length;
    return [k, { n: ps.length, gained: gained.length, lost: lost.length, mcnemar_p: +mcnemar(gained.length, lost.length).toFixed(4), fidelity_better: fb, fidelity_worse: fw,
      wrong_text_added: ps.filter((p) => wt(item(a, p).v) && !wt(item(b, p).v)).length, wrong_text_removed: ps.filter((p) => !wt(item(a, p).v) && wt(item(b, p).v)).length, lost_pages: lost.map((p) => p) }];
  }));
  for (const a of arms.filter((x) => x !== 'S')) out.pairs[`${a}_vs_S`] = pair(a, 'S');
  if (arms.includes('F') && arms.includes('N')) out.pairs.N_vs_F = pair('N', 'F');
  if (arms.includes('M') && arms.includes('F')) out.pairs.M_vs_F = pair('M', 'F');
  // The OCR misread share: pages any verdict on the page flags (the transcription is one text for every arm).
  const flagged = paired.filter((p) => arms.some((a) => item(a, p).v.source_misread)), byMaj = paired.filter((p) => arms.filter((a) => item(a, p).v.source_misread).length * 2 > arms.length);
  out.misread = { pages_any_verdict_flags: flagged.length, pages_majority_flags: byMaj.length, n: paired.length, share_majority: +(byMaj.length / Math.max(1, paired.length)).toFixed(3) };
  // Controls.
  const sw = rows.filter((r) => r.kind === 'swap' && r.v), caught = sw.filter((r) => !r.v.accept && r.v.fidelity <= 2);
  const rt = rows.filter((r) => r.kind === 'retest' && r.v).map((r) => ({ r, o: rows.find((x) => x.judged_as === r.of && x.v) })).filter((x) => x.o);
  out.controls = { swap: { caught: caught.length, n: sw.length, need: 9, pass: caught.length >= 9 }, retest: { within_one: rt.filter((x) => Math.abs(x.r.v.fidelity - x.o.v.fidelity) <= 1).length, exact: rt.filter((x) => x.r.v.fidelity === x.o.v.fidelity).length, accept_agree: rt.filter((x) => x.r.v.accept === x.o.v.accept).length, n: rt.length, need: 9 } };
  out.controls.retest.pass = out.controls.retest.within_one >= 9;
  out.gate = out.controls.swap.pass && out.controls.retest.pass ? 'PASS' : 'FAIL';
  // Decision rule (PREREGISTRATION.md).
  const passes = (a) => out.pairs[`${a}_vs_S`] && out.pairs[`${a}_vs_S`].all.gained > out.pairs[`${a}_vs_S`].all.lost && out.pairs[`${a}_vs_S`].all.mcnemar_p < 0.05 && out.arms[a].all.wrong_text_pages <= out.arms.S.all.wrong_text_pages;
  const pf = arms.includes('F') && passes('F'), pn = arms.includes('N') && passes('N');
  let chosen = null;
  if (pf && pn) chosen = out.arms.N.all.accepted >= out.arms.F.all.accepted - 2 && out.arms.N.all.wrong_text_pages <= out.arms.F.all.wrong_text_pages + 1 ? 'N' : 'F';
  else if (pf) chosen = 'F'; else if (pn) chosen = 'N';
  const mNeeded = !chosen || out.arms[chosen].reference.accepted < 21;
  out.decision = { F_passes: pf, N_passes: pn, chosen, M_needed: mNeeded, M_passes: arms.includes('M') ? passes('M') : null };
  // Cost: agy tokens a read reports (call_usage), per arm.
  out.tokens = {};
  for (const a of arms.filter((x) => x !== 'S')) {
    const ms = J('sample.json').pages.map((p) => readArm(a, p.page_id)?.meta).filter(Boolean);
    const sum = (f) => ms.reduce((s, m) => s + (Number(m.call_usage?.[f]) || 0), 0);
    out.tokens[a] = { reads: ms.length, input: sum('input'), output: sum('output'), thinking: sum('thinking'), cache_read: sum('cache_read'), total: sum('total'), attempts: ms.reduce((s, m) => s + (m.attempts || 1), 0), prompt_chars: ms.reduce((s, m) => s + (m.prompt_sent_chars || 0), 0) };
  }
  out.verdict_calls = jsonl(path.join(OUT, 'verdicts-opus.jsonl')).length;
  out.list_usd_judge = +jsonl(path.join(OUT, 'verdicts-opus.jsonl')).reduce((s, r) => s + (r.list_usd || 0), 0).toFixed(2);
  W('score.json', out);
  for (const [a, x] of Object.entries(out.arms)) console.log(`${a}: accept ${x.all.accepted}/${x.all.n} (ref ${x.reference.accepted}/${x.reference.n}, prose ${x.prose.accepted}/${x.prose.n}) wrong_text ${x.all.wrong_text_pages} major ${x.all.major_pages} w/1k ${x.all.weighted_per_1k} fid ${x.all.fidelity_mean}`);
  for (const [p, x] of Object.entries(out.pairs)) console.log(`${p}: +${x.all.gained} -${x.all.lost} p=${x.all.mcnemar_p} (ref +${x.reference.gained} -${x.reference.lost}; prose +${x.prose.gained} -${x.prose.lost}) wt added ${x.all.wrong_text_added} removed ${x.all.wrong_text_removed}`);
  console.log('controls', JSON.stringify(out.controls), 'gate', out.gate); console.log('decision', JSON.stringify(out.decision)); console.log('misread', JSON.stringify(out.misread));
}

// ── write (the useful-page rule) ──
async function write() {
  const { MongoClient } = await import('mongodb');
  const { contentHash } = await import('../../lib/write-provenance.mjs');
  const rows = rowsOf(), s = J('sample.json');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const now = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: s.pages.map((p) => p.page_id) } }, { projection: { id: 1, 'translation.data': 1, 'translation.edited_by': 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  const dir = path.join(OUT, 'apply'); fs.mkdirSync(dir, { recursive: true });
  const picks = [];
  for (const sp of s.pages) {
    const S = rows.find((r) => r.kind === 'item' && r.arm === 'S' && r.page_id === sp.page_id && r.v);
    if (!S) continue;
    const cands = rows.filter((r) => r.kind === 'item' && r.arm !== 'S' && r.page_id === sp.page_id && r.v && r.v.accept && !wt(r.v)
      && (r.v.fidelity > S.v.fidelity || (r.v.fidelity === S.v.fidelity && weighted(r.v) < weighted(S.v))));
    if (!cands.length) continue;
    cands.sort((a, b) => (better(a.v, b.v) ? -1 : better(b.v, a.v) ? 1 : a.arm === 'N' ? -1 : b.arm === 'N' ? 1 : 0));
    const best = cands[0], p = now.get(sp.page_id);
    if (!p?.translation?.data || contentHash(p.translation.data) !== sp.translation_hash || p.translation.edited_by) { picks.push({ page_id: sp.page_id, arm: best.arm, skipped: 'stored English changed or edited' }); continue; }
    for (const ext of ['txt', 'meta.json', 'raw.txt']) { const f = path.join(OUT, `arm-${best.arm}`, `${sp.page_id}.${ext}`); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dir, `${sp.page_id}.${ext}`)); }
    picks.push({ page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, arm: best.arm, fid: best.v.fidelity, stored_fid: S.v.fidelity, stored_accept: S.v.accept });
  }
  W('write-picks.json', picks);
  console.log(`${picks.filter((p) => !p.skipped).length} pages to write (${JSON.stringify(picks.reduce((o, p) => ((o[p.arm] = (o[p.arm] || 0) + 1), o), {}))})`);
  const res = spawnSync('node', [path.join(ROOT, 'scripts/batch/cli-translate.mjs'), 'apply', `--out=${dir}`, '--reason=#5274 paired test: judged better than the stored 3 Flash English (blind Opus with the scan)', ...(process.argv.includes('--apply') ? ['--apply'] : [])], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CLI_JOB_NAME: JOB } });
  process.exit(res.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!OUT) { console.error('--out=DIR required'); process.exit(2); }
  await ({ arms, packet, judge, score, write }[STAGE] ?? (() => { console.error('stages: arms | packet | judge | score | write'); process.exit(2); }))();
}

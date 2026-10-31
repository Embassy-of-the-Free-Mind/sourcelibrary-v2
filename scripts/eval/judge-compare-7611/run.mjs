#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (judgePrompt / parseVerdict / opusCall, IMPORTED unchanged: the
// router's judge) and scripts/eval/judge-planted-7611/run.mjs (the 144 planted controls and their scorer, reused as
// items). scripts/eval/lane-judge-sampler.mjs is the store of Opus verdicts on lane output. None of them runs a GEMINI
// judge against the page image: translate-cli-lane-7075/sample.mjs has a Gemini judge but text-only and pairwise, so
// the agy call here is agy-cli.mjs agyCall in a gated workspace with the image, as gatedImageCall does it.
/**
 * Gemini vs Opus as the end-of-lane QA judge, on items Opus has ALREADY judged (#7611).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/judge-compare-7611/run.mjs frame --out=DIR
 *   AGY_HOME=/root/.agy-james ... run.mjs judge --judge=flash --out=DIR [--concurrency=4] [--repeat]
 *   AGY_ALLOW_HEAVY=7611 ... run.mjs judge --judge=argon --out=DIR
 *   ... run.mjs judge --judge=opus --out=DIR --repeat      (the Opus-vs-Opus noise floor, 30 items)
 *   ... run.mjs adjudicate --out=DIR [--max=150]           (Opus sees the image and both verdicts, blind)
 *   ... run.mjs score --out=DIR
 *
 * ITEMS. (a) the 180 planted-control items of judge-planted-7611 (36 A, 144 B-E) with their stored Opus verdicts;
 * (b) real lane output with a stored Opus verdict whose EXACT judged text is recovered: lane_judge_verdicts (text_hash
 * re-checked), and the route-judge packets kept in job scratch, matched to the committed key by the item id, which is a
 * hash of the text (judge.mjs packet()). Grouped by WHO WROTE the text (authorOf). One page per book per group.
 * Read-only on production: nothing is written to Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { judgePrompt, opusCall, parseVerdict } from '../route-judge-6740/judge.mjs';
import { parseJson } from '../translate-cli-lane-7075/sample.mjs';
import { scorePlant } from '../lib/plant-ocr-errors.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const flag = (n) => process.argv.includes(`--${n}`);
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'judge-compare-7611'));
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1) + '\n');
const readJsonl = (f) => (fs.existsSync(f) ? (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString() : fs.readFileSync(f, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const SEED = 7611;
const SCRATCH = '/mnt/HC_Volume_105839809/jobs';
const RJ = path.join(ROOT, 'scripts/eval/route-judge-6740/results');
const PLANTED = path.join(ROOT, 'scripts/eval/judge-planted-7611/results/2026-10-29');

export const JUDGES = {
  flash: { model: 'gemini-3.8-flash-low', by: 'agy' },
  argon: { model: 'gemini-4-argon-low', by: 'agy' },
  opus: { model: 'claude-opus-5-5', by: 'claude -p --model opus' },
};
// Group targets (preregistered): one page per book; GEM and GPU>GEM capped, GPU and TR take every book there is.
export const TARGET = { GEM: 90, GPU: 90, 'GPU>GEM': 90, TR: 90 };
export const NOISE_N = 30;

const GPU = /^(paddle|yigdzin|gpu|pero|lighton)$/;
/** Who wrote the text the judge read: GEM (Gemini read or Gemini-corrected Gemini), GPU (a GPU engine's raw draft),
 *  GPU>GEM (a GPU draft corrected by agy Flash: the GPU lanes as served), TR (a Gemini translation), null = left out
 *  (Opus-written, diff-QA variants, routes that are not one writer). */
export function authorOf(route, task) {
  const r = String(route);
  if (/opus|diffqa/.test(r)) return null;
  if (task === 'translation') return /^(agy-flash-low@1|flash3|flash-lite)$/.test(r) ? 'TR' : null;
  if (GPU.test(r)) return 'GPU';
  const [draft, ...rest] = r.split('>');
  if (GPU.test(draft) && rest.length) return /agy-flash|flash-low-correct/.test(rest.join('>')) ? 'GPU>GEM' : null;
  if (/^(lite|3flash|flash3|flash-lite|agy-flash-low)/.test(draft)) return 'GEM';
  return null;
}

async function mongo() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  return { c, db: c.db('bookstore') };
}

/** Packet sources: [scratch packet dir, committed key, committed verdicts]. A key row counts only if its judged_as id is
 *  in the packet AND has an Opus verdict; the id is j + h(cell:page:h(text.trim())), so a match pins the exact text. */
const PACKETS = [
  { name: 'router-tests-2026-10-28', packet: `${SCRATCH}/agy-shift-7263/rt-2026-10-28/packet.json`, key: `${RJ}/router-tests-2026-10-28/key.json`, verdicts: `${RJ}/router-tests-2026-10-28/verdicts-opus.jsonl.gz` },
  { name: 'latin-diffqa-7591-rt-conf', packet: `${SCRATCH}/latin-diffqa-7591/rt-conf/packet.json`, key: `${SCRATCH}/latin-diffqa-7591/rt-conf/key.json`, verdicts: `${SCRATCH}/latin-diffqa-7591/rt-conf/verdicts-opus.jsonl` },
  { name: 'latin-diffqa-7591-rt-dq', packet: `${SCRATCH}/latin-diffqa-7591/rt-dq/packet.json`, key: `${SCRATCH}/latin-diffqa-7591/rt-dq/key.json`, verdicts: `${SCRATCH}/latin-diffqa-7591/rt-dq/verdicts-opus.jsonl` },
  // The pilot's scratch packet predates its final ids: its texts are re-keyed by the id formula and matched.
  { name: 'pilot-2026-10-26', packet: `${SCRATCH}/route-judge-6740/pilot/packet.json`, scratchKey: `${SCRATCH}/route-judge-6740/pilot/key.json`, key: `${RJ}/pilot-2026-10-26/key.json`, verdicts: `${RJ}/pilot-2026-10-26/verdicts-opus.jsonl.gz` },
];
/** Committed key rows with no packet: the text is looked for in Mongo (the page's OCR, then its revision rows) and kept
 *  only where the id formula reproduces judged_as. */
const MONGO_RECOVER = [
  { name: 'tibetan-30-2026-10-27', dir: `${RJ}/tibetan-30-2026-10-27`, routes: ['yigdzin'], lang: 'Tibetan' },
  { name: 'router-tests-2026-10-26', dir: `${RJ}/router-tests-2026-10-26`, routes: ['paddle'], lang: 'Chinese' },
  { name: 'pilot-2026-10-26', dir: `${RJ}/pilot-2026-10-26`, routes: ['yigdzin'], lang: 'Tibetan' },
];
const itemId = (cell, pageId, text) => `j${h(`${cell}:${pageId}:${h(String(text).trim())}`).slice(0, 10)}`;

async function frame() {
  fs.mkdirSync(OUT, { recursive: true });
  const cands = [], log = {};
  const verdictMap = (f) => new Map(readJsonl(f).filter((r) => r.verdict).map((r) => [r.id, r]));
  // (b1) route-judge packets.
  for (const P of PACKETS) {
    const L = log[P.name] = { key_items: 0, matched: 0 };
    if (!fs.existsSync(P.packet)) { L.missing = true; continue; }
    const key = JSON.parse(fs.readFileSync(P.key, 'utf8')), vs = verdictMap(P.verdicts);
    const pk = JSON.parse(fs.readFileSync(P.packet, 'utf8')); const items = pk.items ?? pk;
    let byId = new Map(items.map((i) => [i.id, i]));
    if (P.scratchKey) {   // re-key the old packet by the id formula
      const sk = JSON.parse(fs.readFileSync(P.scratchKey, 'utf8')); const old = new Map(items.map((i) => [i.id, i]));
      byId = new Map(sk.filter((x) => x.kind === 'item' && old.has(x.id)).map((x) => [itemId(x.cell, x.page_id, old.get(x.id).text), old.get(x.id)]));
    }
    for (const k of key.filter((x) => x.kind === 'item')) {
      L.key_items++;
      const it = byId.get(k.judged_as), v = vs.get(k.judged_as);
      if (!it || !v) continue;
      if (itemId(k.cell, k.page_id, it.text) !== k.judged_as) continue;
      L.matched++;
      cands.push({ source: P.name, cell: k.cell, route: k.route, task: it.task, lang: it.lang, page_id: k.page_id, book_id: k.book_id, page_number: k.page_number, image_url: it.image_url,
        text: it.text, src_text: it.source, reference: it.reference, opus: v.verdict, opus_model: v.model, opus_id: k.judged_as });
    }
  }
  const { c, db } = await mongo();
  try {
    // (b2) committed key rows recovered from Mongo by the id formula.
    for (const M of MONGO_RECOVER) {
      const L = log[`mongo:${M.name}`] = { key_items: 0, matched: 0 };
      const key = JSON.parse(fs.readFileSync(path.join(M.dir, 'key.json'), 'utf8')).filter((x) => x.kind === 'item' && M.routes.includes(x.route));
      const vs = verdictMap(path.join(M.dir, 'verdicts-opus.jsonl.gz'));
      const ids = [...new Set(key.map((k) => k.page_id))];
      const pages = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p]));
      const revs = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr' }, { projection: { page_id: 1, data: 1, prev_data: 1 } }).toArray();
      const texts = new Map(ids.map((id) => [id, [pages.get(id)?.ocr?.data]]));
      for (const r of revs) texts.get(r.page_id)?.push(r.data, r.prev_data);
      const { getPageSource } = await import('../../lib/page-image-url.mjs');
      const full = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } }).toArray()).map((p) => [p.id, p]));
      for (const k of key) {
        L.key_items++;
        const v = vs.get(k.judged_as); if (!v) continue;
        const t = (texts.get(k.page_id) || []).find((x) => typeof x === 'string' && x.trim() && itemId(k.cell, k.page_id, x) === k.judged_as);
        if (!t) continue;
        L.matched++;
        cands.push({ source: `mongo:${M.name}`, cell: k.cell, route: k.route, task: 'ocr', lang: M.lang, page_id: k.page_id, book_id: k.book_id, page_number: k.page_number,
          image_url: full.get(k.page_id) ? getPageSource(full.get(k.page_id)) : null, text: t, opus: v.verdict, opus_model: v.model, opus_id: k.judged_as, image_note: 'image re-resolved from the page (the packet is gone)' });
      }
    }
    // (b3) lane_judge_verdicts: items and drafts the sampler's Opus judged; the text it saw, re-hashed.
    const L = log.lane_judge_verdicts = { records: 0, matched: 0, text_changed: 0 };
    const recs = await db.collection('lane_judge_verdicts').find({ kind: { $in: ['item', 'draft'] }, 'verdict.accept': { $in: [true, false] } }).toArray();
    L.records = recs.length;
    const pages = new Map((await db.collection('pages').find({ id: { $in: [...new Set(recs.map((r) => r.page_id))] } }, { projection: { id: 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'translation.data': 1 } }).toArray()).map((p) => [p.id, p]));
    const drafts = new Map((await db.collection('page_revisions').find({ id: { $in: recs.map((r) => r.write?.revision_id).filter(Boolean) } }, { projection: { id: 1, data: 1 } }).toArray()).map((r) => [r.id, r.data]));
    const { laneTask } = await import('../lane-judge-sampler.mjs');
    for (const r of recs) {
      const task = laneTask(r.lane), p = pages.get(r.page_id);
      const text = r.kind === 'draft' ? drafts.get(r.write?.revision_id) : p?.[task === 'translation' ? 'translation' : 'ocr']?.data;
      if (typeof text !== 'string' || h(text.trim()).slice(0, 16) !== r.text_hash) { L.text_changed++; continue; }
      // A translation's source is the page's OCR as it is now: it must not be newer than the verdict.
      if (task === 'translation' && !(new Date(p.ocr?.updated_at) <= new Date(r.judged_at))) { L.text_changed++; continue; }
      L.matched++;
      cands.push({ source: 'lane_judge_verdicts', cell: r.cell, route: r.route, task, lang: r.lang, page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, image_url: r.image_url,
        text, src_text: task === 'translation' ? p.ocr.data : undefined, opus: r.verdict, opus_model: r.judge?.model_reported, opus_id: r._id, script_type: r.script_type });
    }
  } finally { await c.close(); }

  // Groups, one page per book per group; seeded; GEM round-robins across languages so one language does not fill it.
  const rnd = makeRng(SEED);
  const groups = {};
  for (const x of cands) { x.author = authorOf(x.route, x.task); if (x.author && x.image_url) (groups[x.author] ??= []).push(x); }
  const real = [];
  for (const [g, xs] of Object.entries(groups)) {
    const byBook = new Map();
    for (const x of xs.map((y) => [h(`${SEED}:${y.opus_id}`), y]).sort((a, b) => a[0].localeCompare(b[0])).map(([, y]) => y)) if (!byBook.has(x.book_id)) byBook.set(x.book_id, x);
    const byLang = new Map();
    for (const x of byBook.values()) (byLang.get(x.lang) ?? byLang.set(x.lang, []).get(x.lang)).push(x);
    const langs = [...byLang.keys()].sort(); const picked = [];
    while (picked.length < TARGET[g] && langs.some((l) => byLang.get(l).length)) for (const l of langs) if (byLang.get(l).length && picked.length < TARGET[g]) picked.push(byLang.get(l).shift());
    log[`group:${g}`] = { candidates: xs.length, books: byBook.size, picked: picked.length };
    real.push(...picked.map((x) => ({ ...x, id: `r${h(`${g}:${x.opus_id}`).slice(0, 12)}`, set: 'real' })));
  }
  // (a) planted controls.
  const pf = JSON.parse(fs.readFileSync(path.join(PLANTED, 'frame.json'), 'utf8'));
  const ptexts = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(PLANTED, 'texts.json.gz'))));
  const pv = new Map(readJsonl(path.join(PLANTED, 'verdicts-opus.jsonl.gz')).filter((v) => v.verdict).map((v) => [v.id, v]));
  const pages = new Map(pf.pages.map((p) => [p.page_id, p]));
  const planted = JSON.parse(fs.readFileSync(path.join(PLANTED, 'items.json'), 'utf8')).map((it) => {
    const p = pages.get(it.page_id);
    return { id: it.id, set: 'planted', kind: it.kind, task: 'ocr', lang: it.lang, cell: p.cell, route: p.route, author: 'planted', page_id: it.page_id, book_id: p.book_id, page_number: p.page_number,
      image_url: p.image_url, text: ptexts[it.page_id][it.kind], opus: pv.get(it.id)?.verdict ?? null, opus_model: pv.get(it.id)?.model };
  });
  // One stream, seeded: any prefix is a balanced subset (a quota stop leaves a coherent sample).
  const all = [...planted, ...real].map((x) => [h(`order:${SEED}:${x.id}`), x]).sort((a, b) => a[0].localeCompare(b[0])).map(([, x]) => x);
  // The noise-floor subset: 30 real items, stratified (GEM 8, GPU 8, GPU>GEM 8, TR 6), first in stream order.
  const quota = { GEM: 8, GPU: 8, 'GPU>GEM': 8, TR: 6 }, noise = [];
  for (const x of all) if (x.set === 'real' && quota[x.author] > 0) { quota[x.author]--; noise.push(x.id); }
  W('items.json', all.map(({ text, src_text, reference, opus, ...rest }) => ({ ...rest, text_hash: h(String(text).trim()).slice(0, 16), opus_accept: opus?.accept ?? null, opus_fidelity: opus?.fidelity ?? null })));
  fs.writeFileSync(path.join(OUT, 'texts.json.gz'), zlib.gzipSync(JSON.stringify(Object.fromEntries(all.map((x) => [x.id, { text: x.text, source: x.src_text, reference: x.reference, opus: x.opus }])))));
  W('frame.json', { seed: SEED, built_at: new Date().toISOString(), log, n: all.length, noise, by: Object.fromEntries(Object.entries(Object.groupBy(all, (x) => `${x.set}/${x.author}`)).map(([k, v]) => [k, v.length])),
    by_lang: Object.fromEntries(Object.entries(Object.groupBy(real, (x) => `${x.author}/${x.lang}`)).map(([k, v]) => [k, v.length])) });
  console.log(JSON.stringify(J('frame.json'), null, 1));
}

// ---------------------------------------------------------------------------------------------------------------------
// Judging
const IMG_AGY = 'the file ./page.jpg in your working directory. Open it with read_file (or view_file) before you answer: that is the only tool available here, and running commands, cropping or any other tool is disabled';
const IMG_OPUS = 'the file ./page.jpg in your working directory (open it with Read before you answer)';

/** A pool's Gemini quota, read for free (`agy -p /quota`): { weekly, fiveHour } remaining fractions, or null. */
async function poolQuota() {
  const { parseQuota } = await import('../../lib/agy-pools.mjs');
  for (let i = 0; i < 6; i++) {   // a reading can come back empty (timeout): try again before giving up
    const q = parseQuota(spawnSync('agy', ['-p', '/quota', '--output-format', 'json'], { encoding: 'utf8', timeout: 90e3, env: process.env }).stdout || '');
    if (q) return q;
  }
  return null;
}

async function geminiCall(prompt, jpeg, model) {
  const agy = await import('../../lib/agy-cli.mjs');
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'jc-agy-'));
  try {
    fs.writeFileSync(path.join(ws, 'page.jpg'), jpeg);
    const log = agy.installToolGate(ws, { task: 'ocr' });
    const r = await agy.agyCall(['-p', prompt, '--model', model, ...agy.CLI_SAFE_ARGS], ws);
    return { ...r, tools: agy.gateCalls(log) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

async function judge() {
  const who = arg('judge'); const J0 = JUDGES[who];
  if (!J0) { console.error('--judge=flash|argon|opus'); process.exit(2); }
  const repeat = flag('repeat');
  const items = J('items.json'), fr = J('frame.json');
  const texts = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'texts.json.gz'))));
  const todoBase = repeat ? items.filter((x) => fr.noise.includes(x.id)) : items;
  if (who === 'opus' && !repeat) { console.error('opus verdicts are stored; only --repeat (noise floor) calls Opus'); process.exit(2); }
  const vf = path.join(OUT, `verdicts-${who}${repeat ? '-repeat' : ''}.jsonl`);
  const prior = readJsonl(vf);
  const done = new Set(prior.filter((v) => v.verdict).map((v) => v.id));
  const tries = new Map(); for (const v of prior) if (!v.verdict) tries.set(v.id, (tries.get(v.id) ?? 0) + 1);
  const todo = todoBase.filter((x) => !done.has(x.id) && (tries.get(x.id) ?? 0) < 3).slice(0, Number(arg('limit') || Infinity));
  const conc = Math.max(1, Math.min(6, Number(arg('concurrency') || 4)));
  // Stop rules (preregistered): a Gemini pool stops this judge when its weekly remaining falls MAX_WEEK_DROP below the
  // reading at start, or its 5-hour bucket under MIN_5H; Opus stops at the box's Claude weekly 85%.
  const MAX_WEEK_DROP = Number(arg('max-week-drop') ?? 0.10), MIN_5H = Number(arg('min-5h') ?? 0.30);
  const limits = await import('../../lib/model-limits.mjs');
  const q0 = J0.by === 'agy' ? await poolQuota() : null;
  if (J0.by === 'agy' && !q0) { console.error('no quota reading for this pool: the stop rule cannot run, so the judge does not start'); process.exit(3); }
  console.log(`${who}${repeat ? ' repeat' : ''}: ${todo.length} of ${todoBase.length} to judge; AGY_HOME=${process.env.AGY_HOME || '(default)'} quota ${JSON.stringify(q0 && { weekly: q0.weekly, fiveHour: q0.fiveHour })}`);
  let stop = null, next = 0, calls = 0;
  const one = async (it) => {
    const T = texts[it.id];
    const input = { task: it.task, lang: it.lang, text: T.text, source: T.source, reference: T.reference };
    const res = await fetch(it.image_url);
    if (!res.ok) { fs.appendFileSync(vf, JSON.stringify({ id: it.id, judge: who, verdict: null, cls: `image_${res.status}` }) + '\n'); return; }
    const jpeg = Buffer.from(await res.arrayBuffer());
    const t0 = Date.now(); calls++;
    let r, row;
    if (J0.by === 'agy') {
      const prompt = judgePrompt(input, IMG_AGY);
      r = await geminiCall(prompt, jpeg, J0.model);
      if (r.cls === 'quota') { stop = `quota: ${String(r.err || r.text).slice(0, 160)}`; return; }
      const v = parseVerdict(r.text);
      const opened = (r.tools || []).some((t) => /^(view_file|read_file)$/.test(t));
      row = { id: it.id, judge: who, model: J0.model, verdict: opened ? v : null, cls: !opened ? 'image_not_opened' : v ? null : (r.cls || 'unparsed'), tools: r.tools, raw: v && opened ? undefined : String(r.text).slice(0, 400),
        usage: r.usage, prompt_sha: h(prompt).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString(), agy_home: process.env.AGY_HOME || 'default' };
    } else {
      const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'jc-opus-'));
      try {
        fs.writeFileSync(path.join(ws, 'page.jpg'), jpeg);
        const prompt = judgePrompt(input, IMG_OPUS);
        r = await opusCall(prompt, ws);
        if (r.cls === 'quota') { stop = 'claude quota reply'; limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); return; }
        const v = parseVerdict(r.text);
        row = { id: it.id, judge: who, model: r.model, verdict: v, cls: v ? null : (r.cls || 'unparsed'), raw: v ? undefined : String(r.text).slice(0, 400), usage: r.usage, list_usd: r.cost, prompt_sha: h(prompt).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() };
      } finally { fs.rmSync(ws, { recursive: true, force: true }); }
    }
    fs.appendFileSync(vf, JSON.stringify(row) + '\n');
    console.log(`  ${it.set}/${it.author} ${it.kind ?? ''} ${it.lang}: ${row.verdict ? `accept=${row.verdict.accept} ${row.verdict.fidelity} (${(row.verdict.defects || []).length})` : row.cls} opus=${it.opus_accept} ${row.secs}s`);
  };
  let checkAt = 0;
  const worker = async () => {
    while (!stop && next < todo.length) {
      if (J0.by === 'agy' && calls - checkAt >= 25) {
        checkAt = calls; const q = await poolQuota();
        if (q && q0 && (q0.weekly - q.weekly > MAX_WEEK_DROP || (q.fiveHour ?? 1) < MIN_5H)) { stop = `pool guard: weekly ${q0.weekly} -> ${q.weekly}, 5h ${q.fiveHour}`; break; }
        console.log(`  [quota after ${calls}: weekly ${q?.weekly}, 5h ${q?.fiveHour}]`);
      }
      if (J0.by !== 'agy') { const b = limits.claudeBlocked({ weeklyMax: 85, sessionMax: 95 }); if (b) { stop = b.reason; break; } }
      await one(todo[next++]);
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  const q1 = J0.by === 'agy' ? await poolQuota() : null;
  const runs = fs.existsSync(path.join(OUT, 'runs.json')) ? J('runs.json') : [];
  runs.push({ at: new Date().toISOString(), judge: who, repeat, calls, stop, agy_home: process.env.AGY_HOME || 'default', quota_before: q0 && { weekly: q0.weekly, fiveHour: q0.fiveHour }, quota_after: q1 && { weekly: q1.weekly, fiveHour: q1.fiveHour }, claude: (({ weekly, session } = limits.claudeUsage?.() ?? {}) => ({ weekly, session }))() });   // never the login
  W('runs.json', runs);
  console.log(`${who}: ${calls} calls; ${stop ? `STOPPED: ${stop}` : 'done'}; quota ${JSON.stringify(q0?.weekly)} -> ${JSON.stringify(q1?.weekly)}`);
  if (stop) process.exit(3);
}

// ---------------------------------------------------------------------------------------------------------------------
// Adjudication: Opus, blind to who wrote either verdict, sees the image, the candidate and the two verdicts.
export function adjudicatePrompt(it, T, a, b, imageRef) {
  const show = (v) => JSON.stringify({ accept: v.accept, fidelity: v.fidelity, defects: (v.defects || []).map((d) => ({ class: d.class, quote: d.quote, severity: d.severity, what: d.what })) }, null, 1);
  return `Two reviewers checked the same candidate ${it.task === 'ocr' ? 'transcription' : 'English translation'} of one page of a historical ${it.lang} book against the page image, and they disagree on whether it can be published. You decide, from the image.

The page image is attached: ${imageRef}
${it.task === 'translation' ? `\nTRANSCRIPTION (${it.lang}, may contain recognition errors):\n"""\n${T.source}\n"""\n` : ''}
CANDIDATE ${it.task === 'ocr' ? 'TRANSCRIPTION' : 'TRANSLATION'}:
"""
${T.text}
"""

REVIEW 1:
${show(a)}

REVIEW 2:
${show(b)}

The publishing bar: ${it.task === 'ocr' ? "every line of the page, in order, the right words and numerals (spelling conventions and markup aside)" : "the page's statements, negations, names and numbers (style aside)"}, with nothing that matters lost, added or changed.
Check each defect either review names against the image: is it really there, and does it matter? Then answer with one JSON object only:
{"accept": bool (your own verdict on the candidate), "right": "1" | "2" | "neither", "real_defects": [{"from": "1"|"2"|"new", "class": "O6", "quote": "...", "matters": bool}], "false_defects": [{"from": "1"|"2", "quote": "...", "why": "a few words"}], "note": "one line"}`;
}
const parseAdj = (t) => parseJson(t, (v) => typeof v.accept === 'boolean' && ['1', '2', 'neither'].includes(String(v.right)));

async function adjudicate() {
  const items = new Map(J('items.json').map((x) => [x.id, x]));
  const texts = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'texts.json.gz'))));
  const vf = path.join(OUT, 'adjudications.jsonl');
  const done = new Set(readJsonl(vf).filter((r) => r.adj).map((r) => r.key));
  // Every real item where a Gemini judge's accept differs from Opus's stored one: one adjudication per (item, judge).
  const todo = [];
  // --judge=X: one judge's disagreements (the 150 are split 75 per judge, so a judge run later is not crowded out).
  for (const who of arg('judge') ? [arg('judge')] : ['flash', 'argon']) for (const v of firstVerdicts(path.join(OUT, `verdicts-${who}.jsonl`))) {
    const it = items.get(v.id); const op = texts[v.id]?.opus;
    if (!it || it.set !== 'real' || !op || op.accept === v.verdict.accept) continue;
    const key = `${who}:${v.id}`; if (!done.has(key)) todo.push({ key, who, it, g: v.verdict, op });
  }
  const order = todo.map((t) => [h(`adj:${t.key}`), t]).sort((a, b) => a[0].localeCompare(b[0])).map(([, t]) => t).slice(0, Number(arg('max') || 150));
  const limits = await import('../../lib/model-limits.mjs');
  console.log(`adjudicate: ${order.length} of ${todo.length} disagreements to go`);
  let next = 0, stop = null;
  const worker = async () => {
    while (!stop && next < order.length) {
      const b = limits.claudeBlocked({ weeklyMax: 85, sessionMax: 95 }); if (b) { stop = b.reason; break; }
      const t = order[next++];
      const flip = parseInt(h(`side:${t.key}`).slice(0, 2), 16) % 2 === 1;   // which review is "1": seeded, blind
      const [a, bb] = flip ? [t.op, t.g] : [t.g, t.op];
      const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'jc-adj-'));
      try {
        const res = await fetch(t.it.image_url); fs.writeFileSync(path.join(ws, 'page.jpg'), Buffer.from(await res.arrayBuffer()));
        const r = await opusCall(adjudicatePrompt(t.it, texts[t.it.id], a, bb, IMG_OPUS), ws);
        if (r.cls === 'quota') { stop = 'claude quota'; break; }
        const v = parseAdj(r.text);
        const opusSide = flip ? '1' : '2';
        fs.appendFileSync(vf, JSON.stringify({ key: t.key, id: t.it.id, judge: t.who, author: t.it.author, lang: t.it.lang, book_id: t.it.book_id, opus_side: opusSide, opus_accept: t.op.accept, gemini_accept: t.g.accept,
          adj: v, winner: v ? (String(v.right) === 'neither' ? 'neither' : String(v.right) === opusSide ? 'opus' : 'gemini') : null, raw: v ? undefined : String(r.text).slice(0, 400), model: r.model, list_usd: r.cost, at: new Date().toISOString() }) + '\n');
        console.log(`  ${t.key} ${t.it.author}: ${v ? `accept=${v.accept} right=${v.right} (opus is ${opusSide})` : 'unparsed'}`);
      } finally { fs.rmSync(ws, { recursive: true, force: true }); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, Number(arg('concurrency') || 3))) }, worker));
  if (stop) { console.log(`STOPPED: ${stop}`); process.exit(3); }
}

/** The first parsed verdict per item (a retry after a failed parse counts; a second good verdict does not replace it). */
function firstVerdicts(f) {
  const seen = new Map();
  for (const r of readJsonl(f)) if (r.verdict && !seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
}

// ---------------------------------------------------------------------------------------------------------------------
// Scoring
const kn = (k, n) => ({ k, n, rate: n ? +(k / n).toFixed(3) : null, wilson95: n ? wilson(k, n).map((x) => +x.toFixed(3)) : null });
/** Book-cluster bootstrap of a statistic over rows ({book, ...}); 95% percentile interval. */
function bookCI(rows, stat, seed = SEED, iters = 4000) {
  const books = [...new Set(rows.map((r) => r.book))]; if (books.length < 3) return null;
  const by = new Map(books.map((b) => [b, rows.filter((r) => r.book === b)]));
  const rnd = makeRng(seed); const xs = [];
  for (let i = 0; i < iters; i++) { const s = []; for (let j = 0; j < books.length; j++) s.push(...by.get(books[Math.floor(rnd() * books.length)])); const v = stat(s); if (v != null && !Number.isNaN(v)) xs.push(v); }
  xs.sort((a, b) => a - b);
  return [+xs[Math.floor(xs.length * 0.025)].toFixed(3), +xs[Math.floor(xs.length * 0.975) - 1].toFixed(3)];
}
const rate = (rows, f) => (rows.length ? rows.filter(f).length / rows.length : null);
const kappa = (pairs) => {
  const n = pairs.length; if (!n) return null;
  const po = pairs.filter(([a, b]) => a === b).length / n, pa = pairs.filter(([a]) => a).length / n, pb = pairs.filter(([, b]) => b).length / n;
  const pe = pa * pb + (1 - pa) * (1 - pb); return pe === 1 ? null : +((po - pe) / (1 - pe)).toFixed(3);
};
const serious = (v) => new Set((v?.defects || []).filter((d) => d.severity !== 'cosmetic').map((d) => String(d.class || '').toUpperCase().slice(0, 3)));

function score() {
  const items = J('items.json'); const byId = new Map(items.map((x) => [x.id, x]));
  const texts = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'texts.json.gz'))));
  const plants = JSON.parse(fs.readFileSync(path.join(PLANTED, 'plants.json'), 'utf8'));
  const V = Object.fromEntries(['flash', 'argon'].map((w) => [w, new Map(firstVerdicts(path.join(OUT, `verdicts-${w}.jsonl`)).map((r) => [r.id, r.verdict]))]));
  const R = Object.fromEntries(['flash', 'argon', 'opus'].map((w) => [w, new Map(firstVerdicts(path.join(OUT, `verdicts-${w}-repeat.jsonl`)).map((r) => [r.id, r.verdict]))]));
  const opusOf = (id) => texts[id]?.opus;
  const out = { generated_at: new Date().toISOString(), calls: {}, planted: {}, real: {}, noise: {}, adjudication: {}, screen: {} };
  for (const w of ['flash', 'argon']) {
    const rows = readJsonl(path.join(OUT, `verdicts-${w}.jsonl`)), rep = readJsonl(path.join(OUT, `verdicts-${w}-repeat.jsonl`));
    out.calls[w] = { calls: rows.length + rep.length, parsed: V[w].size, failed: Object.fromEntries(Object.entries(Object.groupBy(rows.filter((r) => !r.verdict), (r) => r.cls || 'x')).map(([k, v]) => [k, v.length])) };
  }
  // 1. Planted recall.
  for (const w of ['opus', 'flash', 'argon']) {
    const P = items.filter((x) => x.set === 'planted').map((x) => ({ x, v: w === 'opus' ? opusOf(x.id) : V[w].get(x.id) })).filter((r) => r.v);
    const rows = P.map(({ x, v }) => ({ book: x.book_id, lang: x.lang, kind: x.kind, ...(x.kind === 'A' ? { accepted: !!v.accept } : scorePlant(v, plants[x.page_id][x.kind])) }));
    const E = rows.filter((r) => r.kind !== 'A'), A = rows.filter((r) => r.kind === 'A');
    out.planted[w] = { caught: kn(E.filter((r) => r.caught).length, E.length), caught_ci_book: bookCI(E, (s) => rate(s, (r) => r.caught)), named: kn(E.filter((r) => r.named).length, E.length),
      clean_reaccepted: kn(A.filter((r) => r.accepted).length, A.length), clean_false_alarm: kn(A.filter((r) => !r.accepted).length, A.length),
      by_kind: Object.fromEntries(['B', 'C', 'D', 'E'].map((k) => { const g = E.filter((r) => r.kind === k); return [k, kn(g.filter((r) => r.caught).length, g.length)]; })),
      by_lang: Object.fromEntries([...new Set(E.map((r) => r.lang))].sort().map((l) => { const g = E.filter((r) => r.lang === l); return [l, kn(g.filter((r) => r.caught).length, g.length)]; })) };
  }
  // 2. Agreement with Opus on real items, by author group; self-preference.
  const groups = ['GEM', 'GPU', 'GPU>GEM', 'TR', 'ALL'];
  for (const w of ['flash', 'argon']) {
    out.real[w] = {};
    const base = items.filter((x) => x.set === 'real' && V[w].has(x.id) && opusOf(x.id)).map((x) => {
      const g = V[w].get(x.id), o = opusOf(x.id); const sg = serious(g), so = serious(o);
      return { id: x.id, book: x.book_id, author: x.author, lang: x.lang, g: g.accept, o: o.accept, gf: Number(g.fidelity), of: Number(o.fidelity),
        class_overlap: !g.accept && !o.accept ? [...sg].some((c) => so.has(c)) : null, gWrong: (g.defects || []).some((d) => d.severity === 'wrong_text'), oWrong: (o.defects || []).some((d) => d.severity === 'wrong_text') };
    });
    for (const grp of groups) {
      const rows = grp === 'ALL' ? base : base.filter((r) => r.author === grp); if (!rows.length) continue;
      const both = rows.filter((r) => r.class_overlap !== null);
      out.real[w][grp] = { n: rows.length, books: new Set(rows.map((r) => r.book)).size,
        pass_gemini: kn(rows.filter((r) => r.g).length, rows.length), pass_opus: kn(rows.filter((r) => r.o).length, rows.length),
        pass_diff: +(rate(rows, (r) => r.g) - rate(rows, (r) => r.o)).toFixed(3), pass_diff_ci_book: bookCI(rows, (s) => rate(s, (r) => r.g) - rate(s, (r) => r.o)),
        agree: kn(rows.filter((r) => r.g === r.o).length, rows.length), agree_ci_book: bookCI(rows, (s) => rate(s, (r) => r.g === r.o)), kappa: kappa(rows.map((r) => [r.g, r.o])),
        gemini_pass_opus_fail: rows.filter((r) => r.g && !r.o).length, gemini_fail_opus_pass: rows.filter((r) => !r.g && r.o).length,
        both_fail_class_overlap: kn(both.filter((r) => r.class_overlap).length, both.length),
        wrong_text: { gemini: rows.filter((r) => r.gWrong).length, opus: rows.filter((r) => r.oWrong).length },
        fidelity_mean: { gemini: +(rows.reduce((s, r) => s + r.gf, 0) / rows.length).toFixed(2), opus: +(rows.reduce((s, r) => s + r.of, 0) / rows.length).toFixed(2) },
        by_lang: Object.fromEntries(Object.entries(Object.groupBy(rows, (r) => r.lang)).map(([l, g]) => [l, { n: g.length, pass_gemini: g.filter((r) => r.g).length, pass_opus: g.filter((r) => r.o).length, agree: g.filter((r) => r.g === r.o).length }])) };
    }
    // Self-preference: (Gemini - Opus pass) on GEM minus the same on GPU, book bootstrap over both groups at once.
    const gg = base.filter((r) => r.author === 'GEM'), gp = base.filter((r) => r.author === 'GPU');
    if (gg.length && gp.length) {
      const d = (s) => { const a = s.filter((r) => r.author === 'GEM'), b = s.filter((r) => r.author === 'GPU'); return a.length && b.length ? (rate(a, (r) => r.g) - rate(a, (r) => r.o)) - (rate(b, (r) => r.g) - rate(b, (r) => r.o)) : null; };
      out.real[w].self_preference_GEM_minus_GPU = { diff: +d([...gg, ...gp]).toFixed(3), ci_book: bookCI([...gg, ...gp], d) };
      const gx = base.filter((r) => r.author === 'GPU>GEM');
      const d2 = (s) => { const a = s.filter((r) => r.author === 'GPU>GEM'), b = s.filter((r) => r.author === 'GPU'); return a.length && b.length ? (rate(a, (r) => r.g) - rate(a, (r) => r.o)) - (rate(b, (r) => r.g) - rate(b, (r) => r.o)) : null; };
      if (gx.length) out.real[w].self_preference_GPUGEM_minus_GPU = { diff: +d2([...gx, ...gp]).toFixed(3), ci_book: bookCI([...gx, ...gp], d2) };
      // The declared confound: GPU is Chinese and Tibetan only, so the contrast is read again inside Chinese.
      const zh = (s) => s.filter((r) => r.lang === 'Chinese');
      out.real[w].self_preference_within_Chinese = { n: { GEM: zh(gg).length, GPU: zh(gp).length, 'GPU>GEM': zh(gx).length },
        GEM_minus_GPU: { diff: d([...zh(gg), ...zh(gp)]) == null ? null : +d([...zh(gg), ...zh(gp)]).toFixed(3), ci_book: bookCI([...zh(gg), ...zh(gp)], d) },
        GPUGEM_minus_GPU: { diff: d2([...zh(gx), ...zh(gp)]) == null ? null : +d2([...zh(gx), ...zh(gp)]).toFixed(3), ci_book: bookCI([...zh(gx), ...zh(gp)], d2) } };
    }
  }
  // Noise floor: the same judge twice on the 30-item subset.
  for (const w of ['opus', 'flash', 'argon']) {
    const pairs = [...R[w].entries()].map(([id, v]) => { const first = w === 'opus' ? opusOf(id) : V[w].get(id); return first ? { book: byId.get(id).book_id, a: !!first.accept, b: !!v.accept, fa: Number(first.fidelity), fb: Number(v.fidelity) } : null; }).filter(Boolean);
    if (pairs.length) out.noise[w] = { n: pairs.length, agree: kn(pairs.filter((p) => p.a === p.b).length, pairs.length), agree_ci_book: bookCI(pairs, (s) => rate(s, (p) => p.a === p.b)), kappa: kappa(pairs.map((p) => [p.a, p.b])), fidelity_same: pairs.filter((p) => p.fa === p.fb).length };
  }
  // The cross-judge agreement on the SAME 30 items, so the floor and the comparison read on one set.
  const noiseIds = J('frame.json').noise;
  for (const w of ['flash', 'argon']) {
    const pr = noiseIds.map((id) => [V[w].get(id), opusOf(id), byId.get(id)]).filter(([g, o]) => g && o);
    if (pr.length) out.noise[`${w}_vs_opus_same30`] = { n: pr.length, agree: kn(pr.filter(([g, o]) => g.accept === o.accept).length, pr.length) };
  }
  // 3. Adjudication tallies.
  const adj = readJsonl(path.join(OUT, 'adjudications.jsonl')).filter((r) => r.adj);
  for (const w of ['flash', 'argon']) {
    const a = adj.filter((r) => r.judge === w); if (!a.length) continue;
    const kind = (r) => `${r.gemini_accept ? 'gemini passed, opus failed' : 'gemini failed, opus passed'} -> ${r.winner} right`;
    out.adjudication[w] = { n: a.length, winner: Object.fromEntries(Object.entries(Object.groupBy(a, (r) => r.winner)).map(([k, v]) => [k, v.length])),
      by_kind: Object.fromEntries(Object.entries(Object.groupBy(a, kind)).map(([k, v]) => [k, v.length])),
      by_author: Object.fromEntries(Object.entries(Object.groupBy(a, (r) => r.author)).map(([g, v]) => [g, Object.fromEntries(Object.entries(Object.groupBy(v, kind)).map(([k, x]) => [k, x.length]))])) };
  }
  // 4. The screen: Gemini flags go to Opus; Gemini passes go to Opus at 20%. "Opus-confirmed failure" = Opus rejects
  // (after adjudication where one ran: the adjudicator's accept replaces Opus's on that item).
  for (const w of ['flash', 'argon']) {
    const adjOf = new Map(adj.filter((r) => r.judge === w).map((r) => [r.id, r.adj.accept]));
    out.screen[w] = {};
    for (const grp of groups) {
      const rows = items.filter((x) => x.set === 'real' && V[w].has(x.id) && opusOf(x.id) && (grp === 'ALL' || x.author === grp)).map((x) => ({ book: x.book_id, g: V[w].get(x.id).accept, fail: !(adjOf.has(x.id) ? adjOf.get(x.id) : opusOf(x.id).accept) }));
      if (!rows.length) continue;
      const F = rows.filter((r) => r.fail), missed = F.filter((r) => r.g).length * 0.8, flagged = rows.filter((r) => !r.g).length, passed = rows.length - flagged;
      out.screen[w][grp] = { n: rows.length, opus_confirmed_failures: F.length, gemini_passed_failures: F.filter((r) => r.g).length,
        missed_share: F.length ? +(missed / F.length).toFixed(3) : null, missed_share_ci_book: bookCI(rows, (s) => { const f = s.filter((r) => r.fail); return f.length ? f.filter((r) => r.g).length * 0.8 / f.length : null; }),
        opus_calls_per_100: +(100 * (flagged + 0.2 * passed) / rows.length).toFixed(1), saved_per_100: +(100 - 100 * (flagged + 0.2 * passed) / rows.length).toFixed(1),
        gemini_alone_missed_share: F.length ? +(F.filter((r) => r.g).length / F.length).toFixed(3) : null, gemini_alone_false_alarms: rows.filter((r) => !r.g && !r.fail).length };
    }
  }
  // Against the adjudicated verdict (the adjudicator's accept where one ran, else the two agree or Opus's stands):
  // each judge's miss rate (passed a failing page) and false alarms (failed a passing page), by group. A judge that goes
  // easy on its own family misses more on GEM than on GPU, relative to the other judge.
  out.vs_adjudicated = {};
  for (const w of ['flash', 'argon']) {
    const adjOf = new Map(adj.filter((r) => r.judge === w).map((r) => [r.id, r.adj.accept]));
    out.vs_adjudicated[w] = {};
    for (const grp of groups) {
      const rows = items.filter((x) => x.set === 'real' && V[w].has(x.id) && opusOf(x.id) && (grp === 'ALL' || x.author === grp)).map((x) => {
        const g = V[w].get(x.id).accept, o = opusOf(x.id).accept; return { book: x.book_id, g, o, t: adjOf.has(x.id) ? adjOf.get(x.id) : o, unadj: g !== o && !adjOf.has(x.id) };
      });
      if (!rows.length) continue;
      const F = rows.filter((r) => !r.t), P = rows.filter((r) => r.t);
      out.vs_adjudicated[w][grp] = { n: rows.length, fails: F.length, unadjudicated_disagreements: rows.filter((r) => r.unadj).length,
        gemini_miss: kn(F.filter((r) => r.g).length, F.length), opus_miss: kn(F.filter((r) => r.o).length, F.length),
        gemini_false_alarm: kn(P.filter((r) => !r.g).length, P.length), opus_false_alarm: kn(P.filter((r) => !r.o).length, P.length) };
    }
    const sp = (s, who) => { const a = s.filter((r) => r.author === 'GEM' && !r.t), b = s.filter((r) => r.author === 'GPU' && !r.t); return a.length && b.length ? rate(a, (r) => r[who]) - rate(b, (r) => r[who]) : null; };
    const rows = items.filter((x) => x.set === 'real' && V[w].has(x.id) && opusOf(x.id) && ['GEM', 'GPU'].includes(x.author)).map((x) => ({ book: x.book_id, author: x.author, g: V[w].get(x.id).accept, o: opusOf(x.id).accept, t: adjOf.has(x.id) ? adjOf.get(x.id) : opusOf(x.id).accept }));
    out.vs_adjudicated[w].miss_GEM_minus_GPU = { gemini: { diff: sp(rows, 'g') == null ? null : +sp(rows, 'g').toFixed(3), ci_book: bookCI(rows, (s) => sp(s, 'g')) }, opus: { diff: sp(rows, 'o') == null ? null : +sp(rows, 'o').toFixed(3), ci_book: bookCI(rows, (s) => sp(s, 'o')) } };
  }
  W('score.json', out);
  console.log(JSON.stringify(out, null, 1));
}

const STAGES = { frame, judge, adjudicate, score };
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const s = STAGES[process.argv[2]];
  if (!s) { console.error(`stages: ${Object.keys(STAGES).join(', ')}`); process.exit(2); }
  await s();
}

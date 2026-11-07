#!/usr/bin/env node
// PRIOR ART: ./judge.mjs (#7866's runQueue over its own frame files) and scripts/eval/severity-cal-7263/judge.mjs (#8136,
// not on main): runCalls with the study ledger, the wrong-page control rule, SECOND_PROMPT and cropFor — restated here
// because that branch is not merged and its stages are keyed to its two languages. The instrument is
// route-judge-6740/judge.mjs judgePrompt / parseVerdict / opusCall, imported unchanged.
/**
 * #7263 judged-expand (scripts/eval/experiments/2026-11-04-judged-expand-7263.md): every Opus call, and the store.
 * Blind: a call sees the language, the image and the text, never the cell, route, engine or study.
 *
 *   node scripts/eval/confidence-7866/expand-judge.mjs packet     items + wrong-page controls, shuffled → OUT/packet.json, key.json
 *   node scripts/eval/confidence-7866/expand-judge.mjs judge      the route judge, one call a page → OUT/route.jsonl
 *   node scripts/eval/confidence-7866/expand-judge.mjs second     second reader on a seeded 20% of serious spans → OUT/second.jsonl
 *   node --env-file=... expand-judge.mjs store [--apply]          lane_judge_verdicts origin:'test' rows (dry run by default)
 * Every call is one row of OUT/opus-calls.jsonl; a stage stops at OPUS_CAP or when claudeBlocked (weekly 85%, 5-hour 95%).
 * [--concurrency=4] [--limit=N]. A reply that does not parse is retried, at most 3 tries an item.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { judgePrompt, parseVerdict, opusCall } from '../route-judge-6740/judge.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { testRow, ROUTE_JUDGE, COLLECTION } from '../lib/judge-rows.mjs';
import { routeOf } from './lib.mjs';
import { EX_OUT as OUT, EX_SEED, OPUS_CAP, PAGE_CAP, SECOND_SHARE, TEST_ID, RECORD, sha, jsonl, shuffle, opusUsed, noteOpus } from './expand-lib.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const STAGE = process.argv[2];
const WEEKLY = Number(process.env.ROUTE_JUDGE_WEEKLY_MAX || 85), SESSION = Number(process.env.ROUTE_JUDGE_SESSION_MAX || 95);
export const SERIOUS = new Set(['misleads', 'wrong_text']);
const IMG_REF = 'the file ./page.jpg in your working directory (open it with Read before you answer)';
export const first = (f) => { const m = new Map(); for (const r of jsonl(path.join(OUT, f))) if (r.verdict && !m.has(r.id)) m.set(r.id, r); return m; };
const bodyOf = (t) => String(t || '').replace(/<(vocab|meta|note|summary|keywords|image-desc|warning)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
/** Han columns run vertically: the crop band is vertical for these. */
const VERTICAL = /^(Chinese|Japanese)$/;

/** The page image, fetched once into OUT/img; over 4 MB it is resized to 3000 px on the long side (as severity-cal). */
async function imageFor(pageId, url) {
  const f = path.join(OUT, 'img', `${pageId}.jpg`);
  if (fs.existsSync(f)) return f;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  let res = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/7263 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(90e3) });
  // A provider that refuses this box (e-rara answers 403 here) is fetched through the site's own image proxy, as a
  // reader's browser gets it.
  if (!res.ok && !/images\.sourcelibrary\.org/.test(url)) {
    const key = fs.readFileSync('/root/.sl-internal-key', 'utf8').trim();
    res = await fetch(`https://sourcelibrary.org/api/image?url=${encodeURIComponent(url)}&w=2400&q=90`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(120e3) });
  }
  if (!res.ok) throw new Error(`image HTTP ${res.status} for ${pageId}`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 4e6) {
    const { default: sharp } = await import('sharp');
    buf = await sharp(buf).resize({ width: 3000, height: 3000, fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
  }
  fs.writeFileSync(f, buf);
  return f;
}

async function runCalls(stage, file, todo, prompt, parse, setup) {
  const limits = await import('../../lib/model-limits.mjs');
  const tries = new Map(); for (const r of jsonl(file)) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const done = new Set(jsonl(file).filter((r) => r.verdict).map((r) => r.id));
  const left = todo.filter((it) => !done.has(it.id) && (tries.get(it.id) ?? 0) < 3);
  const limit = Number(arg('limit') || Infinity);
  console.log(`${stage}: ${left.length} of ${todo.length} to call (study total so far ${opusUsed()} of ${OPUS_CAP})`);
  let stop = null, calls = 0, i = 0;
  const one = async (it) => {
    if (opusUsed() >= OPUS_CAP) { stop = { reason: `OPUS_CAP ${OPUS_CAP}` }; return; }
    const b = limits.claudeBlocked({ weeklyMax: WEEKLY, sessionMax: SESSION });
    if (b) { stop = b; return; }
    calls++;
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'jx-'));
    try {
      await setup(it, ws);
      const t0 = Date.now();
      const r = await opusCall(prompt(it), ws);
      noteOpus(stage, it.id, r);
      if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); stop = { reason: 'quota reply' }; return; }
      const v = parse(r.text);
      fs.appendFileSync(file, JSON.stringify({ id: it.id, stage, model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 600), list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${stage} ${it.id}: ${v ? (v.accept != null ? `accept=${v.accept} f${v.fidelity} d${(v.defects || []).length}` : 'ok') : `unparsed ${r.cls ?? ''}`}`);
    } catch (e) {
      fs.appendFileSync(file, JSON.stringify({ id: it.id, stage, verdict: null, raw: `error: ${e.message}`.slice(0, 300), at: new Date().toISOString() }) + '\n');
      console.log(`  ${stage} ${it.id}: error ${String(e.message).slice(0, 120)}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 4)));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < left.length && calls < limit) await one(left[i++]); }));
  if (stop) { console.log(`STOPPED: ${JSON.stringify(stop)}`); process.exit(3); }
  console.log(`${stage}: ${calls} calls, queue done`);
}

// ── packet: the items and the wrong-page controls, one shuffled queue; the key stays out of every call ──
function packet() {
  if (fs.existsSync(path.join(OUT, 'packet.json'))) throw new Error('packet.json exists — refusing to rebuild a judged packet');
  const s = J('sample.json');
  const items = [], key = [];
  const add = (x, kind, text, extra = {}) => {
    const id = `x${sha(`${kind}:${x.page_id}:${extra.other ?? ''}:${sha(text)}`).slice(0, 10)}`;
    items.push({ id, task: 'ocr', lang: x.language, script: x.script, image_url: x.image, page_id: x.page_id, text });
    key.push({ id, kind, cell: x.cell, language: x.language, script: x.script, book_id: x.book_id, page_id: x.page_id, page_number: x.page_number, text_sha: sha(text), ...extra });
  };
  for (const x of s) add(x, 'item', x.stored);
  for (const cell of [...new Set(s.map((x) => x.cell))]) {
    const ok = shuffle(s.filter((x) => x.cell === cell && x.stored.trim().length >= 200), makeRng(EX_SEED + 7 + cell.length));
    if (ok.length < 3) continue;
    for (let i = 0; i < 2; i++) {
      const x = ok[i], other = ok.find((o, j) => j >= Math.floor(ok.length / 2) + i && o.book_id !== x.book_id) ?? ok.find((o) => o.book_id !== x.book_id);
      add(x, 'wrong_page', other.stored, { other: other.page_id });
    }
  }
  if (items.length > PAGE_CAP) throw new Error(`${items.length} items > PAGE_CAP ${PAGE_CAP}`);
  const order = shuffle(items, makeRng(EX_SEED + 1));
  W('packet.json', order); W('key.json', key);
  console.log(`packet: ${items.length} items (${key.filter((k) => k.kind === 'wrong_page').length} controls)`);
}

async function judge() {
  await runCalls('route', path.join(OUT, 'route.jsonl'), J('packet.json'), (it) => judgePrompt(it, IMG_REF), parseVerdict,
    async (it, ws) => fs.copyFileSync(await imageFor(it.page_id, it.image_url), path.join(ws, 'page.jpg')));
}

// ── second reader: a seeded 20% of the serious spans, by language; the first severity is never shown ──
async function cropFor(file, text, quote, vertical, out) {
  const { default: sharp } = await import('sharp');
  const b = bodyOf(text).replace(/\s+/g, ''), q = String(quote || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  const at = q.length >= 2 ? b.indexOf(q.slice(0, Math.min(12, q.length))) : -1;
  if (at < 0) return 'whole';
  const f = (at + Math.min(q.length, 12) / 2) / Math.max(1, b.length), m = await sharp(file).metadata();
  if (vertical) {   // vertical columns, right to left: offset f sits at x = (1 − f) of the width
    const w = Math.ceil(0.35 * m.width), left = Math.max(0, Math.min(m.width - w, Math.floor((1 - f) * m.width - w / 2)));
    await sharp(file).extract({ left, top: 0, width: w, height: m.height }).jpeg({ quality: 90 }).toFile(out);
    return [+(left / m.width).toFixed(3), +((left + w) / m.width).toFixed(3)];
  }
  const hgt = Math.ceil(0.3 * m.height), top = Math.max(0, Math.min(m.height - hgt, Math.floor(f * m.height - hgt / 2)));
  await sharp(file).extract({ left: 0, top, width: m.width, height: hgt }).jpeg({ quality: 90 }).toFile(out);
  return [+(top / m.height).toFixed(3), +((top + hgt) / m.height).toFixed(3)];
}
/** severity-cal-7263's SECOND_PROMPT, with the book's hand named ("printed" / "handwritten") instead of always printed. */
export const SECOND_PROMPT = (it) => `You are checking points that another reader raised about a transcription of one page of a ${it.script === 'manuscript' ? 'handwritten' : 'printed'} ${it.lang} book. The page image is ./page.jpg in your working directory. For each point, ./crop-<n>.jpg shows the part of the page where the point should be; it is placed by estimate and may miss, so use the full page when it does. Open the images with Read; zoom with the crops.

TRANSCRIPTION (the whole page, for context):
"""
${it.text}
"""

POINTS (the words as transcribed, and what the other reader said about them):
${it.points.map((p, k) => `${k + 1}. "${p.quote}" — ${p.what || 'no reason given'}`).join('\n')}

For each point, look at the page yourself and answer:
- different: "yes" when the transcription's words there are not what the page ${it.script === 'manuscript' ? 'has' : 'prints'} (a different, added or missing character, word, number, name or line), "no" when the page has what the transcription has, "cannot_tell" when the image does not let you decide.
- page_prints: what the page has there, briefly.
- changes_sense: only when different is "yes": "yes" when a reader of the transcription would take the sentence to say something other than what the page says (another word, name or number, a negation, a phrase or line lost, added or repeated); "no" when the difference is spelling, a variant or simplified form of the same character, punctuation, layout or markup, and the sentence still says the same thing. null when different is not "yes".

Answer with JSON only: {"points":[{"n":1,"different":"yes|no|cannot_tell","page_prints":"...","changes_sense":"yes|no|null","why":"a few words"}]}`;

/** The second reader's sample: every serious span of the judged items, then round(20%) of them per language, seeded. */
export function secondSample(items, key, route) {
  const spans = [];
  for (const it of items) {
    const k = key.get(it.id);
    if (k.kind !== 'item') continue;
    const v = route.get(it.id)?.verdict;
    (v?.defects || []).forEach((d, i) => { if (SERIOUS.has(d.severity)) spans.push({ item: it.id, i, lang: k.language, quote: String(d.quote ?? '').slice(0, 300), what: String(d.what ?? '').slice(0, 200) }); });
  }
  const pick = [];
  for (const L of [...new Set(spans.map((s) => s.lang))].sort()) {
    const all = spans.filter((s) => s.lang === L).sort((a, b) => (`${a.item}:${a.i}` < `${b.item}:${b.i}` ? -1 : 1));
    const n = Math.max(1, Math.round(SECOND_SHARE * all.length));
    pick.push(...shuffle(all, makeRng(EX_SEED + 50 + [...L].reduce((a, ch) => a + ch.codePointAt(0), 0))).slice(0, n));
  }
  return { spans: spans.length, picked: pick };
}

async function second() {
  const items = J('packet.json'), key = new Map(J('key.json').map((k) => [k.id, k])), route = first('route.jsonl');
  const { spans, picked } = secondSample(items, key, route);
  const byItem = new Map(); for (const p of picked) (byItem.get(p.item) ?? byItem.set(p.item, []).get(p.item)).push(p);
  const todo = items.filter((it) => byItem.has(it.id)).map((it) => ({ ...it, id: `s${it.id.slice(1)}`, item: it.id, points: byItem.get(it.id).sort((a, b) => a.i - b.i) }));
  W('second-items.json', { serious_spans: spans, sampled: picked.length, calls: todo.map(({ text, ...k }) => ({ ...k, text_sha: sha(text) })) });
  console.log(`second: ${picked.length} of ${spans} serious spans sampled, ${todo.length} pages`);
  await runCalls('second', path.join(OUT, 'second.jsonl'), todo, SECOND_PROMPT, (t) => { try { const v = JSON.parse(String(t).match(/\{[\s\S]*\}/)[0]); return Array.isArray(v.points) ? v : null; } catch { return null; } }, async (it, ws) => {
    const f = await imageFor(it.page_id, it.image_url); fs.copyFileSync(f, path.join(ws, 'page.jpg'));
    it.crops = [];
    for (const [k, p] of it.points.entries()) { const band = await cropFor(f, it.text, p.quote, VERTICAL.test(it.lang), path.join(ws, `crop-${k + 1}.jpg`)); if (band === 'whole') fs.copyFileSync(f, path.join(ws, `crop-${k + 1}.jpg`)); it.crops.push(band); }
  });
}

// ── store: one origin:'test' row per judged item and control (testRow); additive, insert by deterministic _id ──
async function store() {
  const { MongoClient } = await import('mongodb');
  const key = new Map(J('key.json').map((k) => [k.id, k])), sample = new Map(J('sample.json').map((s) => [s.page_id, s]));
  const route = first('route.jsonl'), PROMPT_SHA = sha(judgePrompt({ task: 'ocr', lang: '<LANG>', text: '<TEXT>' }, IMG_REF)).slice(0, 16);
  const rows = [];
  for (const [id, r] of route) {
    const k = key.get(id), s = sample.get(k.page_id);
    const served = routeOf({ model: s.model, pipeline: s.pipeline, source: s.source, at4: false }, s.language);
    rows.push(testRow({
      book_id: k.book_id, page_id: k.page_id, page_number: k.page_number, selection: 'random', kind: k.kind,
      cell: `study:${k.language}/${k.script}`, route: served.route, lang: k.language, task: 'ocr',
      script_type: k.script === 'manuscript' ? 'handwritten' : 'printed', script_source: 'book_class, else page script_type majority (expand-draw.mjs)',
      test: { id: TEST_ID, issue: 7263, record: RECORD, arm: k.kind === 'item' ? 'stored' : `wrong_page:${k.other}`, evidence: null, stratum: k.cell },
      settings: { pages_per_call: 1, prev_page_context: false, draft_source: 'stored text as served', draft_hash: k.text_sha.slice(0, 16), prompt_version: 'route-judge-6740 judgePrompt p1', model: 'claude-opus-5-5' },
      judge: { instrument: ROUTE_JUDGE, model: r.model ?? 'claude-opus-5-5', prompt_sha: PROMPT_SHA },
      verdict: r.verdict, text_hash: k.text_sha.slice(0, 16), judged_at: r.at, cost: { judge_list_usd: r.list_usd ?? null },
    }));
  }
  console.log(`store: ${rows.length} rows (${rows.filter((r) => r.kind === 'item').length} items, ${rows.filter((r) => r.kind === 'wrong_page').length} controls); router hint none`);
  if (!process.argv.includes('--apply')) { console.log('dry run: nothing written (--apply to insert)'); return; }
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const col = c.db('bookstore').collection(COLLECTION);
  let ins = 0, had = 0;
  for (const r of rows) { const res = await col.updateOne({ _id: r._id }, { $setOnInsert: r }, { upsert: true }); if (res.upsertedCount) ins++; else had++; }
  const back = await col.countDocuments({ origin: 'test', 'test.id': TEST_ID });
  await c.close();
  console.log(`store: inserted ${ins}, already there ${had}; read back ${back} rows with test.id ${TEST_ID}`);
}

const stages = { packet, judge, second, store };
if (process.argv[1]?.endsWith('confidence-7866/expand-judge.mjs')) {
  if (!stages[STAGE]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[STAGE]();
}

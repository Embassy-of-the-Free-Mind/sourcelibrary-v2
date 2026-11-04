#!/usr/bin/env node
// PRIOR ART: ../zh-translation-paired-5274/run.mjs (this job's first test: packet, Opus judge loop, McNemar, words,
// severity) and ../route-judge-6740/judge.mjs (judgePrompt, opusCall, parseVerdict); scripts/lib/agy-cli.mjs
// gatedTextCall / gatedImageCall for the agy translations and the Flash judge. Those translate a page's STORED OCR
// (cli-translate.mjs); here three stored transcriptions of one page are each translated, so the prompt is built here
// from translate-core's buildTranslationPrompt with the given text.
/**
 * Second #5274 test (PREREGISTRATION.md). DIR holds fetch.mjs's reads-raw.json.
 *
 *   node --env-file=... run.mjs draw      --out=DIR
 *   node --env-file=... run.mjs translate --out=DIR --home=/root/.agy-james
 *   node                run.mjs packet    --out=DIR
 *   node                run.mjs judge     --out=DIR --judge=opus|flash [--home=...] [--concurrency=3]
 *   node --env-file=... run.mjs trace     --out=DIR --home=... --kr=DIR
 *   node                run.mjs score     --out=DIR
 *
 * Another set of arms (zh-siku-route-matrix-7263): --arms=tS=S,tF=F,... names the arms and sample.json's text fields. Then a
 * source text a page already has from another arm is translated once; the packet carries one wrong-page swap and one repeat per
 * arm with paired-arm.mjs's kind names and key fields; --floor=0.20 --max-calls=N --what=TEXT --shard=i/n apply. Without --arms nothing changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../lib/paired-stats.mjs';
import { judgePrompt, opusCall, parseVerdict } from '../route-judge-6740/judge.mjs';
import { words7824 } from '../correction-pass-7818/lib.mjs';
import { mcnemar } from '../zh-translation-paired-5274/run.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const STAGE = process.argv[2];
const OUT = arg('out') && path.resolve(arg('out'));
const SEED = 52741;
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const SOURCES = arg('arms') ? Object.fromEntries(arg('arms').split(',').map((x) => x.split('='))) : { tP: 'P', tO: 'O', tFl: 'Fl' };
const CUSTOM = !!arg('arms'), FLOOR = Number(arg('floor', 0.35)), MAX_CALLS = Number(arg('max-calls', Infinity));
const MODEL = 'gemini-3.8-flash-low';

function draw() {
  const raw = J('reads-raw.json');
  const pick = (r, job) => r._reads.filter((x) => x.job === job).sort((a, b) => String(b.read_at).localeCompare(String(a.read_at)))[0]?.text ?? null;
  const rows = raw.filter((r) => r.kind.startsWith('zero')).map((r) => ({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, slug: r.slug, family: r.family, percall: r.percall, pb: r.pb,
    P: r.P, O: pick(r, 'zh-ditto-5274-pilot'), Fl: pick(r, 'zh-ditto-5274-pilot-flash-low') }));
  const ok = rows.filter((r) => r.P && r.O && r.Fl);
  const rng = makeRng(SEED);
  const take = (pc) => ok.filter((r) => r.percall === pc).map((r) => [rng(), r]).sort((a, b) => a[0] - b[0]).slice(0, 20).map(([, r]) => r);
  const pages = [...take(1), ...take(10)];
  W('sample.json', { seed: SEED, drawn_at: new Date().toISOString(), pool: ok.length, left_out: rows.filter((r) => !(r.P && r.O && r.Fl)).map((r) => r.slug), pages });
  console.log(`drawn ${pages.length} of ${ok.length} zero-丨 pages with P, O and Fl`);
}

async function translate() {
  const home = arg('home');
  if (home) { process.env.AGY_HOME = home; process.env.AGY_POOL_SHARED = '1'; }
  const { readPool, weeklyReserve } = await import('../../lib/agy-pools.mjs');
  const { MongoClient } = await import('mongodb');
  const { buildTranslationPrompt, loadTranslationPrompts } = await import('../../lib/translate-core.mjs');
  const { gatedTextCall, TRANSLATE_SUFFIX, agyUsage } = await import('../../lib/agy-cli.mjs');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const prompts = await loadTranslationPrompts(db);
  const s = J('sample.json'), file = path.join(OUT, 'translations.jsonl');
  const done = new Set(jsonl(file).filter((r) => r.text).map((r) => `${r.arm}:${r.page_id}`));
  const books = new Map();
  const bySource = new Map(CUSTOM ? jsonl(file).filter((r) => r.text && !r.same_as).map((r) => [`${r.page_id}:${h(s.pages.find((p) => p.page_id === r.page_id)?.[SOURCES[r.arm]] ?? '')}`, r]) : []);
  let n = 0;
  const [shard, shards] = String(arg('shard', '0/1')).split('/').map(Number);   // --shard=i/n: two pools share the pages, each page wholly in one
  for (const [pi, p] of s.pages.entries()) for (const [arm, src] of Object.entries(SOURCES)) {
    if (pi % shards !== shard) continue;
    if (done.has(`${arm}:${p.page_id}`)) continue;
    if (CUSTOM && p[src] == null) continue;   // an arm that served no text there: no English, counted not accepted
    const twin = CUSTOM ? bySource.get(`${p.page_id}:${h(p[src])}`) : null;
    if (twin) { fs.appendFileSync(file, JSON.stringify({ arm, page_id: p.page_id, text: twin.text, same_as: twin.arm, calls: 0 }) + '\n'); continue; }
    if (n >= MAX_CALLS) { console.error(`--max-calls ${MAX_CALLS}: stopping`); process.exit(3); }
    if (n++ % 10 === 0) {
      const r = readPool(home || null);
      const line = Math.max(FLOOR, weeklyReserve({ resetTime: r?.weeklyReset, lane: null }));
      if (!r || r.weekly < line || (r.fiveHour ?? 0) < 0.25) { console.error(`pool under its floor ${JSON.stringify(r)}: stopping`); process.exit(3); }
      fs.appendFileSync(path.join(OUT, 'quota.jsonl'), JSON.stringify({ at: new Date().toISOString(), stage: 'translate', home, n, reading: r }) + '\n');
    }
    if (!books.has(p.book_id)) books.set(p.book_id, await db.collection('books').findOne({ id: p.book_id }));
    const built = buildTranslationPrompt({ prompts, book: books.get(p.book_id), ocrText: p[src], previousTranslation: null });
    const sent = built.prompt + TRANSLATE_SUFFIX;
    const t0 = Date.now();
    const r = await gatedTextCall(sent, { model: MODEL, task: 'translate' });
    if (r.cls === 'quota') { console.error('quota reply: stopping'); process.exit(3); }
    if (CUSTOM && !(r.cls || r.problem)) bySource.set(`${p.page_id}:${h(p[src])}`, { arm, text: r.answer });
    fs.appendFileSync(file, JSON.stringify({ arm, page_id: p.page_id, text: r.cls || r.problem ? null : r.answer, cls: r.cls ?? null, problem: r.problem ?? null, calls: r.calls, usage: agyUsage(r.usage), prompt_sent_chars: sent.length, prompt_ref: built.promptRef, secs: Math.round((Date.now() - t0) / 1000) }) + '\n');
    console.log(`  ${arm} ${p.slug}: ${r.cls || r.problem || 'ok'} ${String(r.answer || '').length} chars`);
  }
  await c.close();
}

function packet() {
  const s = J('sample.json');
  const tr = new Map(jsonl(path.join(OUT, 'translations.jsonl')).filter((r) => r.text).map((r) => [`${r.arm}:${r.page_id}`, r.text]));
  const items = new Map(), key = [];
  const add = (p, arm, kind, text, extra = {}) => {
    const id = `g${h(`${kind}:${p.page_id}:${kind === 'item' ? h(text.trim()) : extra.other ?? extra.of ?? ''}`).slice(0, 10)}`;
    if (!items.has(id)) items.set(id, { id, page_id: p.page_id, text });
    key.push({ judged_as: id, arm, kind, page_id: p.page_id, slug: p.slug, percall: p.percall, ...(CUSTOM && { id: `${kind}:${arm}:${p.page_id}`, route: arm, cell: 'zh-siku-route-matrix', book_id: p.book_id, set: p.set }), ...extra });
  };
  for (const p of s.pages) for (const arm of Object.keys(SOURCES)) { const t = tr.get(`${arm}:${p.page_id}`); if (t) add(p, arm, 'item', t); }
  const rng = makeRng(SEED + 1);
  const shuffled = s.pages.map((p) => [rng(), p]).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  if (CUSTOM) {
    Object.keys(SOURCES).forEach((arm, i) => {
      const pairs = shuffled.map((p, j) => [p, shuffled[(j + 20) % shuffled.length]]);
      const [p, o] = pairs[i * 2], t = tr.get(`${arm}:${o.page_id}`); if (t) add(p, arm, 'wrong_page', t, { other: o.page_id });
      const k = key.filter((x) => x.kind === 'item' && x.arm === arm)[(i * 7 + 3) % 30]; const it = k && items.get(k.judged_as);
      if (it) { const nid = `g${h(`retest:${arm}:${it.id}`).slice(0, 10)}`; items.set(nid, { ...it, id: nid, text: `${it.text.trimEnd()}\n` }); key.push({ ...k, id: `repeat:${arm}:${k.page_id}`, judged_as: nid, kind: 'repeat', of: k.judged_as }); }
    });
    const order = [...items.values()].map((it) => [h(`order:${SEED}:${it.id}`), it]).sort((a, b) => a[0].localeCompare(b[0])).map(([, it]) => it);
    W('packet.json', { items: order }); W('key.json', key);
    console.log(`packet: ${order.length} items (${key.filter((k) => k.kind === 'wrong_page').length} wrong-page, ${key.filter((k) => k.kind === 'repeat').length} repeats)`);
    return;
  }
  for (let i = 0; i < 10; i++) { const p = shuffled[i], o = shuffled[(i + 20) % shuffled.length]; const t = tr.get(`tO:${o.page_id}`); if (t) add(p, 'tO', 'swap', t, { other: o.page_id }); }
  const ids = [...new Set(key.filter((k) => k.kind === 'item').map((k) => k.judged_as))].map((id) => [rng(), id]).sort((a, b) => a[0] - b[0]).slice(0, 10).map(([, id]) => id);
  for (const id of ids) { const it = items.get(id), k = key.find((x) => x.judged_as === id); const nid = `g${h(`retest:${id}`).slice(0, 10)}`; items.set(nid, { ...it, id: nid, text: `${it.text.trimEnd()}\n` }); key.push({ ...k, judged_as: nid, kind: 'retest', of: id }); }
  const order = [...items.values()].map((it) => [h(`order:${SEED}:${it.id}`), it]).sort((a, b) => a[0].localeCompare(b[0])).map(([, it]) => it);
  W('packet.json', { items: order }); W('key.json', key);
  console.log(`packet: ${order.length} items (${key.filter((k) => k.kind === 'swap').length} swaps, ${ids.length} retests)`);
}

/** judge.mjs's translation prompt with the transcription replaced by the image (blinding: PREREGISTRATION.md). */
export function prompt(text, imageRef) {
  const base = judgePrompt({ task: 'translation', lang: 'Chinese', source: '@@SRC@@', text }, imageRef);
  return base
    .replace(/The transcription below may contain recognition errors; the image is the authority for what the page says\.\n\nThe page image is attached: (.*)\n\nTRANSCRIPTION \(Chinese\):\n"""\n@@SRC@@\n"""/, 'No transcription is given: read the page image yourself, closely, column by column; the image is the authority for what the page says. A 丨 or 〻 mark on the page repeats the entry\'s headword.\n\nThe page image is attached: $1')
    .replace('\n\nTags such as', '\n- for each defect also give "kind": "meaning", "name" (a person, place, book or title wrong), "number" (a numeral, date or count wrong) or "other".\n\nTags such as')
    .replace(/Answer with one JSON object only: .*$/s, 'Answer with one JSON object only: {"accept": bool, "fidelity": n, "defects": [{"class": "T8", "quote": "...", "severity": "misleads", "kind": "meaning", "what": "a few words"}], "reader_note": "..."}');
}

async function judge() {
  const which = arg('judge');
  const home = arg('home');
  if (home) { process.env.AGY_HOME = home; process.env.AGY_POOL_SHARED = '1'; }
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const ids = J('sample.json').pages.map((p) => p.page_id);
  const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  const file = path.join(OUT, `verdicts-${which}.jsonl`);
  const prev = jsonl(file), done = new Set(prev.filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of prev) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const todo = J('packet.json').items.filter((it) => !done.has(it.id) && (tries.get(it.id) ?? 0) < 3);
  console.log(`${which}: ${todo.length} items`);
  const limits = await import('../../lib/model-limits.mjs');
  const agy = which === 'flash' ? await import('../../lib/agy-cli.mjs') : null;
  const pools = which === 'flash' ? await import('../../lib/agy-pools.mjs') : null;
  let stop = null, i = 0, n = 0;
  const one = async (it) => {
    if (which === 'opus') { const b = limits.claudeBlocked({ weeklyMax: 85, sessionMax: 95 }); if (b) { stop = b; return; } }
    if (which === 'flash' && n++ % 20 === 0) {
      const r = pools.readPool(home || null), line = Math.max(0.35, pools.weeklyReserve({ resetTime: r?.weeklyReset, lane: null }));
      if (!r || r.weekly < line || (r.fiveHour ?? 0) < 0.25) { stop = { reason: `pool under floor ${JSON.stringify(r)}` }; return; }
    }
    const url = getPageSource(pages.get(it.page_id));
    const res = await fetch(url);
    if (!res.ok) { fs.appendFileSync(file, JSON.stringify({ id: it.id, verdict: null, raw: `image HTTP ${res.status}` }) + '\n'); return; }
    const buf = Buffer.from(await res.arrayBuffer());
    const t0 = Date.now();
    let r;
    if (which === 'opus') {
      const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'zhg-opus-'));
      try { fs.writeFileSync(path.join(ws, 'page.jpg'), buf); r = await opusCall(prompt(it.text, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws); } finally { fs.rmSync(ws, { recursive: true, force: true }); }
    } else {
      r = await agy.gatedImageCall((name) => prompt(it.text, `@./${name}`), buf, { model: MODEL });
      r = { ...r, usage: agy.agyUsage(r.usage) };
    }
    if (r.cls === 'quota') { stop = { reason: 'quota reply' }; return; }
    const v = parseVerdict(r.text);
    fs.appendFileSync(file, JSON.stringify({ id: it.id, judge: which, model: r.model ?? MODEL, cls: r.cls ?? null, verdict: v, raw: v ? undefined : String(r.text).slice(0, 500), usage: r.usage, list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000), image_url: url, at: new Date().toISOString() }) + '\n');
    console.log(`  ${it.id}: ${v ? `accept=${v.accept} ${v.fidelity} (${(v.defects || []).length})` : `unparsed ${r.cls ?? ''}`}`);
  };
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency', 3))));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`BLOCKED ${JSON.stringify(stop)}`); process.exit(3); }
}

/** The Kanripo WYG leaf text for a pb (KR3k0059_WYG_524-16a): between its <pb:> and the next. */
export function kanripoLeaf(kr, pb) {
  const m = String(pb || '').match(/^(KR\w+?)_WYG_(\d+)-/); if (!m) return null;
  const f = path.join(kr, m[1], `${m[1]}_${m[2].padStart(3, '0')}.txt`); if (!fs.existsSync(f)) return null;
  const parts = fs.readFileSync(f, 'utf8').replace(/^#.*$/gm, '').split(/<pb:([^>]+)>/);
  for (let i = 1; i < parts.length; i += 2) if (parts[i] === pb) return parts[i + 1].replace(/¶/g, '').replace(/\n+/g, '\n').trim();
  return null;
}

async function trace() {
  const home = arg('home');
  if (home) { process.env.AGY_HOME = home; process.env.AGY_POOL_SHARED = '1'; }
  const { gatedTextCall } = await import('../../lib/agy-cli.mjs');
  const kr = arg('kr');
  const s = J('sample.json'), byPage = new Map(s.pages.map((p) => [p.page_id, p]));
  const vs = new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const file = path.join(OUT, 'trace.jsonl'), done = new Set(jsonl(file).map((r) => r.tid));
  const todo = [];
  for (const k of J('key.json').filter((x) => x.kind === 'item')) {
    const v = vs.get(k.judged_as); if (!v) continue;
    (v.defects || []).forEach((d, j) => { if (d.severity === 'misleads' || d.severity === 'wrong_text') todo.push({ tid: `${k.judged_as}:${j}`, k, d }); });
  }
  console.log(`${todo.length} major defects to trace; ${done.size} done`);
  let traced = 0;
  const seen = new Set(done);   // arms with one identical English share a judged_as, so the defect is traced once and matrix.mjs joins by tid
  for (const t of todo.filter((x) => !done.has(x.tid))) {
    if (CUSTOM) { if (seen.has(t.tid)) continue; seen.add(t.tid); }
    if (traced >= MAX_CALLS) { console.log(`--max-calls ${MAX_CALLS}: stopping`); break; }
    const p = byPage.get(t.k.page_id), leaf = p.leaf ?? (kr && p.pb ? kanripoLeaf(kr, p.pb) : null), src = p[SOURCES[t.k.arm]];
    if (!leaf) { fs.appendFileSync(file, JSON.stringify({ tid: t.tid, arm: t.k.arm, page_id: p.page_id, cause: 'no-leaf' }) + '\n'); continue; }
    const q = `An English translation of one page of ${arg('what', 'a Chinese rhyme dictionary (佩文韻府 family)')} has a defect. Find where it comes from.

DEFECT in the English: "${t.d.quote}" (${t.d.what || t.d.class})

SOURCE: the transcription the translator was given:
"""
${src}
"""

REFERENCE: the Kanripo e-text of the same leaf (another digitisation of this edition; 丨 marks repeat the headword):
"""
${leaf}
"""

1. "source_span": copy the characters of the SOURCE that this English renders (empty if the English renders nothing there).
2. "reference_span": copy the characters of the REFERENCE at the same place.
3. "cause": "source" if the SOURCE differs from the REFERENCE there in a way that explains the defect (a wrong, missing, extra or misplaced character or 丨 mark), "translator" if the SOURCE agrees with the REFERENCE there (allowing variant character forms) and the English still gets it wrong, "unclear" if you cannot place it.
Answer with one JSON object only: {"source_span": "...", "reference_span": "...", "cause": "source|translator|unclear", "why": "a few words"}`;
    traced++;
    const r = await gatedTextCall(q + '\n\nDo not open, read or write any file and do not use any tool. Put the JSON between <<<BEGIN>>> and <<<END>>>.\n', { model: MODEL, task: 'translate' });
    if (r.cls === 'quota') { console.error('quota: stop'); process.exit(3); }
    let j = null; try { j = JSON.parse(String(r.answer || r.text).match(/\{[\s\S]*\}/)?.[0]); } catch { /* unparsed */ }
    fs.appendFileSync(file, JSON.stringify({ tid: t.tid, arm: t.k.arm, page_id: p.page_id, slug: p.slug, quote: t.d.quote, kind: t.d.kind, severity: t.d.severity, ...(j || { cause: 'unparsed', raw: String(r.text).slice(0, 300) }) }) + '\n');
    console.log(`  ${t.tid} ${t.k.arm}: ${j?.cause ?? 'unparsed'}`);
  }
}

function score() {
  const key = J('key.json'), items = new Map(J('packet.json').items.map((it) => [it.id, it]));
  const out = { at: new Date().toISOString(), judges: {}, agreement: {}, trace: {} };
  const major = (d) => d.severity === 'misleads' || d.severity === 'wrong_text';
  const per = {};
  for (const j of ['opus', 'flash']) {
    const vs = new Map(jsonl(path.join(OUT, `verdicts-${j}.jsonl`)).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
    if (!vs.size) continue;
    const it = (arm, pid) => { const k = key.find((x) => x.kind === 'item' && x.arm === arm && x.page_id === pid); return k && vs.get(k.judged_as) ? { v: vs.get(k.judged_as), w: words7824(items.get(k.judged_as).text) } : null; };
    const pids = [...new Set(key.filter((k) => k.kind === 'item').map((k) => k.page_id))].filter((pid) => Object.keys(SOURCES).every((a) => it(a, pid)));
    per[j] = { it, pids };
    const arms = {};
    for (const a of Object.keys(SOURCES)) {
      const xs = pids.map((pid) => it(a, pid)), words = xs.reduce((s, x) => s + x.w, 0);
      arms[a] = { n: xs.length, accepted: xs.filter((x) => x.v.accept).length, wrong_meaning_pages: xs.filter((x) => (x.v.defects || []).some((d) => d.severity === 'wrong_text')).length,
        name_or_number_pages: xs.filter((x) => (x.v.defects || []).some((d) => major(d) && /name|number/.test(d.kind || ''))).length,
        major_per_1k: words ? +((1000 * xs.reduce((s, x) => s + (x.v.defects || []).filter(major).length, 0)) / words).toFixed(2) : null, words, fidelity_mean: +(xs.reduce((s, x) => s + x.v.fidelity, 0) / Math.max(1, xs.length)).toFixed(2),
        by_percall: Object.fromEntries([1, 10].map((pc) => { const ps = pids.filter((pid) => J('sample.json').pages.find((p) => p.page_id === pid).percall === pc).map((pid) => it(a, pid)); return [pc, `${ps.filter((x) => x.v.accept).length}/${ps.length}`]; })) };
    }
    const pair = (a, b) => { const g = pids.filter((p) => it(a, p).v.accept && !it(b, p).v.accept).length, l = pids.filter((p) => !it(a, p).v.accept && it(b, p).v.accept).length; return { gained: g, lost: l, mcnemar_p: +mcnemar(g, l).toFixed(4) }; };
    const sw = key.filter((k) => k.kind === 'swap').map((k) => vs.get(k.judged_as)).filter(Boolean), rt = key.filter((k) => k.kind === 'retest').map((k) => [vs.get(k.judged_as), vs.get(k.of)]).filter(([a, b]) => a && b);
    out.judges[j] = { pages: pids.length, arms, pairs: { tO_vs_tFl: pair('tO', 'tFl'), tO_vs_tP: pair('tO', 'tP'), tFl_vs_tP: pair('tFl', 'tP') },
      controls: { swap: `${sw.filter((v) => !v.accept && v.fidelity <= 2).length}/${sw.length}`, retest_within_one: `${rt.filter(([a, b]) => Math.abs(a.fidelity - b.fidelity) <= 1).length}/${rt.length}`, retest_accept_agree: `${rt.filter(([a, b]) => a.accept === b.accept).length}/${rt.length}` } };
  }
  if (per.opus && per.flash) {
    const pids = per.opus.pids.filter((p) => per.flash.pids.includes(p));
    const kappa = (pairs) => { const n = pairs.length, a = pairs.filter(([x, y]) => x === y).length / n, p1 = pairs.filter(([x]) => x).length / n, p2 = pairs.filter(([, y]) => y).length / n, e = p1 * p2 + (1 - p1) * (1 - p2); return e === 1 ? null : +((a - e) / (1 - e)).toFixed(3); };
    for (const a of [...Object.keys(SOURCES), 'all']) {
      const pairs = (a === 'all' ? Object.keys(SOURCES) : [a]).flatMap((arm) => pids.map((p) => [per.opus.it(arm, p).v.accept, per.flash.it(arm, p).v.accept]));
      out.agreement[a] = { n: pairs.length, agree: pairs.filter(([x, y]) => x === y).length, kappa: kappa(pairs) };
    }
  }
  const tr = jsonl(path.join(OUT, 'trace.jsonl'));
  for (const a of Object.keys(SOURCES)) { const xs = tr.filter((t) => t.arm === a); out.trace[a] = xs.reduce((o, t) => ((o[t.cause] = (o[t.cause] || 0) + 1), o), { n: xs.length }); }
  W('score.json', out);
  console.log(JSON.stringify(out, null, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!OUT) { console.error('--out=DIR required'); process.exit(2); }
  await ({ draw, translate, packet, judge, trace, score }[STAGE] ?? (() => { console.error('stages: draw | translate | packet | judge | trace | score'); process.exit(2); }))();
}

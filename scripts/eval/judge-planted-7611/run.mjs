#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (judgePrompt / opusCall / parseVerdict: the router's judge,
// IMPORTED unchanged; its `planted` items are Tibetan only) and scripts/eval/lane-judge-sampler.mjs (the store of
// verdicts this draws its frame from, its image fetch and meter guard). scripts/eval/lib/plant-ocr-errors.mjs plants.
/**
 * Planted-error controls for the router's Opus judge on Latin / German / French print (#7611, "test the test").
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/judge-planted-7611/run.mjs frame --out=DIR
 *   ... run.mjs judge --out=DIR [--concurrency=4] [--weekly-max=92]
 *   ... run.mjs score --out=DIR
 *
 * FRAME. Pages the judge ACCEPTED in `lane_judge_verdicts` (kind item or draft, print), cells german-lite, french-lite,
 * latin-lite, latin-gpu-7263; the exact text it accepted (its text_hash re-checked); one page per book; books in a
 * seeded order, each book's first page on which every variant B-E finds a site; 12 pages per language.
 * VARIANTS. A unchanged, B number, C noun swap, D line dropped, E sentence inserted (plant-ocr-errors.mjs), each a
 * separate blind item: the judge sees one candidate and the image, never the variant or a sibling.
 * SCORE. caught = not accepted OR the plant named in a defect; per language x variant, k/n with a Wilson 95% CI; the
 * bar: B-E pooled per language >= 0.80. A: the re-accept rate of a text the judge accepted before.
 * Read-only on production: nothing is written to Mongo (not even the verdict store).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { judgePrompt, opusCall, parseVerdict } from '../route-judge-6740/judge.mjs';
import { claudeMeter, paceBlock } from '../lane-judge-sampler.mjs';
import { plantError, unplant, scorePlant, bodyLines, PLANT_KINDS, ERROR_KINDS } from '../lib/plant-ocr-errors.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'judge-planted-7611'));
const SEED = 7611;
const CELLS = { 'german-lite': 'German', 'french-lite': 'French', 'latin-lite': 'Latin', 'latin-gpu-7263': 'Latin' };
const PER_LANG = Number(arg('per-lang') ?? 12);
export const BAR = 0.8;
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1) + '\n');
const seedOf = (s) => parseInt(h(s).slice(0, 8), 16);

// The page's language by function words (a book's catalogue language does not make every leaf Latin: e-rara licence pages).
const FUNC = { Latin: /^(et|est|non|ad|quod|cum|ut|sed|ex|enim|autem|vel|atque|quae|sunt|ab|nec)$/, German: /^(und|der|die|das|ist|nicht|mit|den|zu|vnd|von|sich|auch|ein|dem|des)$/,
  French: /^(le|la|les|des|est|que|qui|dans|une|du|pour|par|pas|sont|au|ce|il|elle)$/ };
export function langOf(text) {
  const w = String(text).replace(/<[^>]+>/g, ' ').toLowerCase().replace(/ſ/g, 's').match(/\p{L}+/gu) || [];
  const n = Object.fromEntries(Object.entries(FUNC).map(([l, re]) => [l, w.filter((x) => re.test(x)).length]));
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0][0];
}

async function mongo() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  return { c, db: c.db('bookstore') };
}

async function frame() {
  fs.mkdirSync(OUT, { recursive: true });
  const { c, db } = await mongo();
  try {
    const recs = await db.collection('lane_judge_verdicts').find({ cell: { $in: Object.keys(CELLS) }, kind: { $in: ['item', 'draft'] }, script_type: 'print', 'verdict.accept': true },
      { projection: { _id: 1, kind: 1, page_id: 1, book_id: 1, page_number: 1, cell: 1, route: 1, text_hash: 1, write: 1, image_url: 1, verdict: 1 } }).toArray();
    // The route-judge router tests (2026-10-26): pages whose STORED draft the judge accepted (fr-lite, de-lite, route lite).
    // No text hash was kept there, so a page counts only while its OCR is older than the verdict (unchanged since).
    const RT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../route-judge-6740/results/router-tests-2026-10-26');
    const rtv = new Map(zlib.gunzipSync(fs.readFileSync(path.join(RT, 'verdicts-opus.jsonl.gz'))).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((v) => [v.id, v]));
    const RT_CELLS = { 'fr-lite': 'french-lite', 'de-lite': 'german-lite' };
    for (const k of JSON.parse(fs.readFileSync(path.join(RT, 'key.json'), 'utf8'))) {
      const v = rtv.get(k.judged_as);
      if (k.kind === 'item' && RT_CELLS[k.cell] && k.route === 'lite' && /^served/.test(k.served) && v?.verdict?.accept)
        recs.push({ _id: `rt26:${k.id}`, kind: 'router-test', page_id: k.page_id, book_id: k.book_id, page_number: k.page_number, cell: RT_CELLS[k.cell], route: 'lite', judged_at: v.at, source: 'router-tests-2026-10-26' });
    }
    const pages = new Map((await db.collection('pages').find({ id: { $in: [...new Set(recs.map((r) => r.page_id))] } }, { projection: { id: 1, book_id: 1, page_number: 1, script_type: 1, 'ocr.data': 1, 'ocr.updated_at': 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } }).toArray()).map((p) => [p.id, p]));
    const { getPageSource } = await import('../../lib/page-image-url.mjs');
    const { scriptClass } = await import('../lane-judge-sampler.mjs');
    for (const r of recs.filter((x) => x.kind === 'router-test')) {
      const p = pages.get(r.page_id), t = p?.ocr?.data;
      if (typeof t !== 'string' || !(new Date(p.ocr.updated_at) <= new Date(r.judged_at)) || scriptClass(t, p.script_type, null).script_type !== 'print') { r.text_hash = null; continue; }
      r.text_hash = h(t.trim()).slice(0, 16); r.image_url = getPageSource(p);
    }
    const revs = new Map((await db.collection('page_revisions').find({ id: { $in: recs.filter((r) => r.kind === 'draft').map((r) => r.write?.revision_id).filter(Boolean) } }, { projection: { id: 1, data: 1 } }).toArray()).map((r) => [r.id, r.data]));
    const R = makeRng(SEED);
    const log = { records: recs.length, text_moved: 0, no_site: { B: 0, C: 0, D: 0, E: 0 }, books_tried: {} };
    const chosen = [];
    for (const lang of ['Latin', 'German', 'French']) {
      const mine = recs.filter((r) => CELLS[r.cell] === lang);
      const books = [...new Set(mine.map((r) => r.book_id))].sort().map((b) => ({ b, k: R() })).sort((x, y) => x.k - y.k).map((x) => x.b);
      let got = 0; log.books_tried[lang] = 0;
      for (const b of books) {
        if (got >= PER_LANG) break;
        log.books_tried[lang]++;
        const cand = mine.filter((r) => r.book_id === b).sort((x, y) => (x._id < y._id ? -1 : 1)).map((r) => ({ r, k: R() })).sort((x, y) => x.k - y.k).map((x) => x.r);
        for (const r of cand) {
          const text = r.kind === 'draft' ? revs.get(r.write?.revision_id) : pages.get(r.page_id)?.ocr?.data;
          if (typeof text !== 'string' || !r.text_hash || h(text.trim()).slice(0, 16) !== r.text_hash) { log.text_moved++; continue; }
          if (langOf(bodyLines(text).map((i) => text.split('\n')[i]).join('\n')) !== lang) { log.not_the_language = (log.not_the_language ?? 0) + 1; continue; }   // e.g. a library's licence page
          const plants = {};
          for (const kind of PLANT_KINDS) plants[kind] = plantError(text, { kind, lang, seed: seedOf(`${r.page_id}:${kind}`) });
          const miss = ERROR_KINDS.filter((k) => !plants[k]);
          if (miss.length) { for (const k of miss) log.no_site[k]++; continue; }
          for (const k of ERROR_KINDS) if (unplant(plants[k].text, plants[k].plant) !== text) throw new Error(`plant ${k} on ${r.page_id} does not reverse`);
          chosen.push({ lang, cell: r.cell, route: r.route, kind_judged: r.kind, source: r.source ?? 'lane_judge_verdicts', verdict_id: r._id, page_id: r.page_id, book_id: b, page_number: r.page_number, image_url: r.image_url, text_hash: r.text_hash, text, plants });
          got++; break;
        }
      }
    }
    // Items: page by page, languages round-robin, the five variants of a page in a seeded order (a stop leaves a balanced set).
    const byLang = ['Latin', 'German', 'French'].map((l) => chosen.filter((x) => x.lang === l));
    const items = [];
    for (let i = 0; i < PER_LANG; i++) for (const g of byLang) {
      const p = g[i]; if (!p) continue;
      const kinds = [...PLANT_KINDS].map((k) => ({ k, u: R() })).sort((a, b) => a.u - b.u).map((x) => x.k);
      for (const kind of kinds) items.push({ id: `jp${h(`${p.page_id}:${kind}`).slice(0, 12)}`, page_id: p.page_id, kind, lang: p.lang });
    }
    W('frame.json', { seed: SEED, per_lang: PER_LANG, cells: CELLS, log, pages: chosen.map(({ text, plants, ...x }) => x) });
    W('plants.json', Object.fromEntries(chosen.map((p) => [p.page_id, Object.fromEntries(PLANT_KINDS.map((k) => [k, p.plants[k].plant]))])));
    fs.writeFileSync(path.join(OUT, 'texts.json.gz'), zlib.gzipSync(JSON.stringify(Object.fromEntries(chosen.map((p) => [p.page_id, { original: p.text, ...Object.fromEntries(PLANT_KINDS.map((k) => [k, p.plants[k].text])) }])))));
    W('items.json', items);
    console.log(`frame: ${chosen.length} pages (${byLang.map((g) => `${g[0]?.lang} ${g.length}`).join(', ')}), ${items.length} items; ${JSON.stringify(log)}`);
  } finally { await c.close(); }
}

async function judge() {
  const items = J('items.json'), frame = J('frame.json');
  const texts = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'texts.json.gz'))));
  const pages = new Map(frame.pages.map((p) => [p.page_id, p]));
  const vf = path.join(OUT, 'verdicts.jsonl');
  const done = new Set(fs.existsSync(vf) ? fs.readFileSync(vf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((v) => v.verdict).map((v) => v.id) : []);
  const todo = items.filter((it) => !done.has(it.id));
  const limits = await import('../../lib/model-limits.mjs');
  const weeklyMax = Number(arg('weekly-max') ?? 92), conc = Number(arg('concurrency') ?? 4);
  const meter0 = await claudeMeter(limits);
  console.log(`judge: ${todo.length} of ${items.length} to go; meter ${meter0 && `${meter0.weekly}% weekly, ${meter0.session}% 5h`}`);
  let stop = null, next = 0, calls = 0;
  const one = async (it) => {
    const p = pages.get(it.page_id), text = texts[it.page_id][it.kind];
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'jp-opus-'));
    try {
      const img = await fetch(p.image_url);
      if (!img.ok) { console.log(`  skip ${it.id}: image HTTP ${img.status}`); return; }
      fs.writeFileSync(path.join(ws, 'page.jpg'), Buffer.from(await img.arrayBuffer()));
      const prompt = judgePrompt({ task: 'ocr', lang: it.lang, text }, 'the file ./page.jpg in your working directory (open it with Read before you answer)');
      const t0 = Date.now(); calls++;
      const res = await opusCall(prompt, ws);
      if (res.cls === 'quota') { stop = 'quota reply'; limits.noteLimitHit('claude', { reason: res.text.slice(0, 200) }); return; }
      const v = parseVerdict(res.text);
      fs.appendFileSync(vf, JSON.stringify({ id: it.id, page_id: it.page_id, kind: it.kind, lang: it.lang, verdict: v, raw: v ? undefined : String(res.text).slice(0, 400), model: res.model, usage: res.usage, list_usd: res.cost,
        prompt_sha: h(prompt).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.lang} ${it.kind} ${p.book_id}:${p.page_number}: ${v ? `accept=${v.accept} ${v.fidelity} (${(v.defects || []).length} defects)` : `unparsed ${res.cls ?? ''}`}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  let meter = meter0, meterAt = Date.now();
  const worker = async () => {
    while (!stop && next < todo.length) {
      if (Date.now() - meterAt > 3 * 60e3) { meterAt = Date.now(); meter = await claudeMeter(limits); }
      const why = paceBlock(meter, { weeklyMax, sessionMax: 95 });
      if (why) { stop = why; break; }
      await one(todo[next++]);
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  const meter1 = await claudeMeter(limits);
  const runs = fs.existsSync(path.join(OUT, 'runs.json')) ? J('runs.json') : [];
  runs.push({ at: new Date().toISOString(), calls, stop, meter_before: meter0, meter_after: meter1 });
  W('runs.json', runs);
  console.log(`judge: ${calls} calls; ${stop ? `STOPPED: ${stop}` : 'done'}; meter ${meter0?.weekly}% -> ${meter1?.weekly}%`);
}

/** k/n with a Wilson 95% interval. */
export const kn = (k, n) => ({ k, n, rate: n ? +(k / n).toFixed(3) : null, ci95: n ? wilson(k, n).map((x) => +x.toFixed(3)) : null });

export function scoreRows(rows) {
  const out = { by_lang: {}, pooled_by_kind: {} };
  for (const lang of [...new Set(rows.map((r) => r.lang))].sort()) {
    const L = out.by_lang[lang] = {};
    for (const kind of PLANT_KINDS) {
      const g = rows.filter((r) => r.lang === lang && r.kind === kind);
      L[kind] = kind === 'A' ? { reaccept: kn(g.filter((r) => r.accepted).length, g.length) }
        : { caught: kn(g.filter((r) => r.caught).length, g.length), named: kn(g.filter((r) => r.named).length, g.length), rejected: kn(g.filter((r) => !r.accepted).length, g.length) };
    }
    const e = rows.filter((r) => r.lang === lang && r.kind !== 'A');
    L.B_E = { caught: kn(e.filter((r) => r.caught).length, e.length), named: kn(e.filter((r) => r.named).length, e.length) };
    L.B_E.passes_bar = e.length ? e.filter((r) => r.caught).length / e.length >= BAR : null;
  }
  for (const kind of PLANT_KINDS) {
    const g = rows.filter((r) => r.kind === kind);
    out.pooled_by_kind[kind] = kind === 'A' ? { reaccept: kn(g.filter((r) => r.accepted).length, g.length) } : { caught: kn(g.filter((r) => r.caught).length, g.length), named: kn(g.filter((r) => r.named).length, g.length) };
  }
  return out;
}

function score() {
  const plants = J('plants.json'), frame = J('frame.json');
  const pages = new Map(frame.pages.map((p) => [p.page_id, p]));
  const vs = fs.readFileSync(path.join(OUT, 'verdicts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((v) => v.verdict);
  const seen = new Set(); const rows = [];
  for (const v of vs) {
    if (seen.has(v.id)) continue; seen.add(v.id);
    const pl = plants[v.page_id][v.kind];
    rows.push({ id: v.id, page_id: v.page_id, book_id: pages.get(v.page_id).book_id, cell: pages.get(v.page_id).cell, lang: v.lang, kind: v.kind, ...scorePlant(v.verdict, pl),
      fidelity: v.verdict.fidelity, model: v.model, plant: { before: pl.before?.slice(0, 160), after: pl.after?.slice(0, 160), mode: pl.mode },
      defects: (v.verdict.defects || []).map((d) => ({ class: d.class, severity: d.severity, quote: String(d.quote || '').slice(0, 120), what: d.what })) });
  }
  const s = { generated_at: new Date().toISOString(), judge: 'claude -p --model opus, route-judge-6740 judgePrompt (unchanged), against the page image', bar: `caught >= ${BAR} on B-E pooled per language`,
    models: [...new Set(rows.map((r) => r.model))], n: rows.length, ...scoreRows(rows), rows };
  W('score.json', s);
  const fmt = (x) => `${x.k}/${x.n} ${x.rate ?? ''} [${x.ci95?.join(', ') ?? ''}]`;
  for (const [lang, L] of Object.entries(s.by_lang)) {
    console.log(`${lang}: A reaccept ${fmt(L.A.reaccept)}; ${ERROR_KINDS.map((k) => `${k} ${fmt(L[k].caught)} (named ${L[k].named.k})`).join('; ')}; B-E ${fmt(L.B_E.caught)} -> ${L.B_E.passes_bar ? 'PASS' : 'FAIL'}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const stages = { frame, judge, score };
  const st = stages[process.argv[2]];
  if (!st) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await st();
}

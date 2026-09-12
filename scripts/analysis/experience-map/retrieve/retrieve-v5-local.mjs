#!/usr/bin/env node
/**
 * Retrieval v5 — the v4 semantic retrieval re-run against the LOCAL corpus mirror instead of Supabase.
 *
 * PRIOR ART: retrieve/retrieve-v4.mjs — same probes, same stratified-slice plan (global / per-language /
 * language×era / tail), same 0.45 threshold and 50-per-slice cap; it does not fit because it queries the
 * `match_semantic` RPC over the network at concurrency 5 with retry/backoff and a 50%-failure abort. Here
 * every probe is ONE exact pass over all 4.5M page vectors on disk (~/sl-corpus/emb, int8, worker threads —
 * ~/sourcelibrary-atlas/scripts/local-corpus/semantic-lib.mjs), and every stratum's top-50 is selected from
 * that single pass, so 144 probes × ~80 strata costs 144 scans, not 9,936 queries, and no rate limit exists.
 * Only the 144 probe embeddings touch Gemini (cached in OUT/probe-vectors-v5.json; cents).
 *
 * Languages are not a hardcoded list: every edition language with ≥ MIN_ROWS embedded rows gets a stratum.
 * Output is classify-v3's input schema (hits-v5.jsonl); page_id is `${book_id}#${page}` so semantic and
 * lexical (retrieve-v5-lexical.mjs) hits dedupe against each other. Pages whose translation is missing from
 * the mirror go to hits-v5-untranslated.jsonl (a count, not a passage — the classifier reads English).
 *
 *   node scripts/analysis/experience-map/retrieve/retrieve-v5-local.mjs [--probes probes/probes-v2.json]
 */
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';

const HOME = process.env.HOME;
const ATLAS = path.join(HOME, 'sourcelibrary-atlas', 'scripts', 'local-corpus');
const CORPUS = process.env.SL_CORPUS || path.join(HOME, 'sl-corpus');
const SL = path.join(HOME, 'sourcelibrary');
const OUT = process.env.V5_OUT || path.join(SL, 'scripts', 'output', 'experience-map', 'v5');
const DIM = 768, THRESHOLD = 0.45, K = 50, MIN_ROWS = 200, ERA_LANGS = 6, TAIL_EXCLUDE = 10;

// ---------------- worker: score [from,to) into the shared score buffer ----------------
if (!isMainThread) {
  const { vec, scale, scores } = workerData;
  parentPort.on('message', ({ qi, qs, from, to }) => {
    for (let r = from; r < to; r++) { const o = r * DIM; let d = 0; for (let i = 0; i < DIM; i += 4) d += qi[i] * vec[o + i] + qi[i + 1] * vec[o + i + 1] + qi[i + 2] * vec[o + i + 2] + qi[i + 3] * vec[o + i + 3]; scores[r] = d * qs * scale[r]; }
    parentPort.postMessage(1);
  });
} else {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const { SemanticIndex, loadEnvKey } = await import(path.join(ATLAS, 'semantic-lib.mjs'));
  const { stripEditorialWrappers } = await import(path.join(SL, 'scripts', 'lib', 'strip-editorial-wrappers.mjs'));
  const Database = createRequire(path.join(HOME, 'sourcelibrary-atlas', 'package.json'))('better-sqlite3');
  fs.mkdirSync(OUT, { recursive: true });
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

  // probes + vectors
  const probesPath = arg('--probes', path.join(SL, 'scripts', 'analysis', 'experience-map', 'probes', 'probes-v2.json'));
  const { dimensions } = JSON.parse(fs.readFileSync(probesPath, 'utf8'));
  const probes = dimensions.flatMap((d) => d.probes.map((p) => ({ dim: d.id, probe: p })));
  const sem = new SemanticIndex(CORPUS); sem.load(); log(`index: ${sem.n.toLocaleString()} vectors`);
  const CACHE = path.join(OUT, 'probe-vectors-v5.json'); const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const key = loadEnvKey(); let newly = 0;
  for (const { probe } of probes) { if (cache[probe]) continue; if (!key) throw new Error('no GEMINI_API_KEY for probe embedding'); cache[probe] = Array.from(await sem.embedQuery(probe, key)); newly++; await new Promise((r) => setTimeout(r, 60)); }
  fs.writeFileSync(CACHE, JSON.stringify(cache)); log(`${dimensions.length} dimensions, ${probes.length} probes (${newly} newly embedded)`);

  // catalogue: language + year per book → per row
  const db = new Database(path.join(CORPUS, 'corpus.sqlite'), { readonly: true });
  const cat = new Map(); for (const r of db.prepare('SELECT id, display_title, title, author, language, year_num, visible FROM catalog').iterate()) cat.set(r.id, r);
  const langIdx = new Map(); const langNames = ['?']; langIdx.set('?', 0);
  const rowLang = new Uint16Array(sem.n); const rowYear = new Int16Array(sem.n).fill(-32768); const langRows = new Map();
  for (let r = 0; r < sem.n; r++) { const b = cat.get(sem.book[r]); const L = (b && b.language) || '?'; let li = langIdx.get(L); if (li === undefined) { li = langNames.length; langNames.push(L); langIdx.set(L, li); } rowLang[r] = li; if (b && Number.isFinite(b.year_num)) rowYear[r] = Math.max(-32000, Math.min(32000, b.year_num)); langRows.set(L, (langRows.get(L) || 0) + 1); }
  const langsByRows = [...langRows.entries()].filter(([L, n]) => L !== '?' && n >= MIN_ROWS).sort((a, b) => b[1] - a[1]);
  log(`${langsByRows.length} languages with ≥${MIN_ROWS} embedded rows; top: ${langsByRows.slice(0, 8).map(([L, n]) => `${L}:${n}`).join(' ')}`);

  // strata: index → {id, test}
  const ERAS = [{ id: 'pre1600', min: -3000, max: 1599 }, { id: '1600-1799', min: 1600, max: 1799 }];
  const strata = [{ id: 'global' }]; const langStratum = new Int32Array(langNames.length).fill(-1); const eraStrata = new Map(); const tailExcl = new Set(langsByRows.slice(0, TAIL_EXCLUDE).map(([L]) => langIdx.get(L)));
  for (const [L] of langsByRows) { langStratum[langIdx.get(L)] = strata.length; strata.push({ id: `lang:${L}` }); }
  for (const [L] of langsByRows.slice(0, ERA_LANGS)) for (const e of ERAS) { eraStrata.set(`${langIdx.get(L)}:${e.id}`, strata.length); strata.push({ id: `${L}/${e.id}`, ...e }); }
  const TAIL = strata.length; strata.push({ id: 'tail' });
  log(`${strata.length} strata`);

  // worker pool over the shared matrix
  const scores = new Float32Array(new SharedArrayBuffer(sem.n * 4));
  const threads = Math.max(2, Math.min(12, os.cpus().length - 1));
  const pool = Array.from({ length: threads }, () => new Worker(new URL(import.meta.url), { workerData: { vec: sem.vec, scale: sem.scale, scores } }));
  const per = Math.ceil(sem.n / threads);
  const scoreAll = (q) => { const mx = Math.max(...q.map(Math.abs)); const qs = mx / 127 || 1; const qi = new Int32Array(DIM); for (let i = 0; i < DIM; i++) qi[i] = Math.round(q[i] / qs); return Promise.all(pool.map((w, t) => new Promise((res, rej) => { w.once('message', res); w.once('error', rej); w.postMessage({ qi, qs, from: t * per, to: Math.min(sem.n, (t + 1) * per) }); }))); };

  // top-K per stratum from one scored pass
  function select() {
    const tops = strata.map(() => ({ s: new Float32Array(K), r: new Int32Array(K), n: 0, min: THRESHOLD }));
    const push = (t, s, r) => { if (t.n < K) { t.s[t.n] = s; t.r[t.n] = r; t.n++; if (t.n === K) { let m = Infinity; for (let i = 0; i < K; i++) if (t.s[i] < m) m = t.s[i]; t.min = m; } return; } if (s <= t.min) return; let mi = 0; for (let i = 1; i < K; i++) if (t.s[i] < t.s[mi]) mi = i; t.s[mi] = s; t.r[mi] = r; let m = Infinity; for (let i = 0; i < K; i++) if (t.s[i] < m) m = t.s[i]; t.min = m; };
    for (let r = 0; r < sem.n; r++) { const s = scores[r]; if (s < THRESHOLD) continue; push(tops[0], s, r); const li = rowLang[r]; const ls = langStratum[li]; if (ls >= 0) push(tops[ls], s, r); const y = rowYear[r]; if (y !== -32768) for (const e of ERAS) { if (y >= e.min && y <= e.max) { const es = eraStrata.get(`${li}:${e.id}`); if (es !== undefined) push(tops[es], s, r); } } if (!tailExcl.has(li)) push(tops[TAIL], s, r); }
    return tops;
  }

  // phase 1: score + select, collect hits keyed by book#page (first probe wins, as v4's `seen` did)
  const hits = new Map(); const perSlice = {}; const t0 = Date.now(); let np = 0;
  for (const p of probes) {
    await scoreAll(cache[p.probe]); const tops = select(); np++;
    tops.forEach((t, si) => { for (let i = 0; i < t.n; i++) { const r = t.r[i]; const id = `${sem.book[r]}#${sem.pn[r]}`; if (hits.has(id)) continue; hits.set(id, { row: r, dim: p.dim, probe: p.probe, slice: strata[si].id, similarity: t.s[i] }); perSlice[strata[si].id] = (perSlice[strata[si].id] || 0) + 1; } });
    if (np % 12 === 0) log(`${np}/${probes.length} probes · ${hits.size.toLocaleString()} candidate pages · ${((Date.now() - t0) / 1000 / np).toFixed(1)} s/probe`);
  }
  pool.forEach((w) => w.terminate());
  log(`phase 1 done: ${hits.size.toLocaleString()} candidate pages`);

  // phase 2: read each book's mirror file once, attach translation text
  const byBook = new Map(); for (const [id, h] of hits) { const b = sem.book[h.row]; if (!byBook.has(b)) byBook.set(b, []); byBook.get(b).push([id, h]); }
  const out = fs.createWriteStream(path.join(OUT, 'hits-v5.jsonl')); const untr = fs.createWriteStream(path.join(OUT, 'hits-v5-untranslated.jsonl'));
  const perLang = {}; let kept = 0, missing = 0, short = 0, nofile = 0;
  for (const [b, list] of byBook) {
    const f = path.join(CORPUS, 'books', `${b}.jsonl`); if (!fs.existsSync(f)) { nofile += list.length; continue; }
    const want = new Map(list.map(([id, h]) => [sem.pn[h.row], [id, h]])); const c = cat.get(b) || {};
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (!line) continue; const pg = JSON.parse(line); const w = want.get(pg.p); if (!w) continue; const [id, h] = w;
      const base = { page_id: id, emb_page_id: sem.page[h.row], book_id: b, page_number: pg.p, book_title: c.display_title || c.title || '', book_author: c.author || '', book_language: c.language || '', book_year: c.year_num ?? null, visible: !!c.visible, dim: h.dim, probe: h.probe, slice: h.slice, similarity: h.similarity, lane: 'semantic' };
      if (!pg.tr) { missing++; untr.write(JSON.stringify({ ...base, has_ocr: !!pg.ocr }) + '\n'); continue; }
      const text = stripEditorialWrappers(pg.tr).trim(); if (text.length < 150) { short++; continue; }
      kept++; perLang[base.book_language || '?'] = (perLang[base.book_language || '?'] || 0) + 1; out.write(JSON.stringify({ ...base, text: text.slice(0, 3000) }) + '\n'); }
  }
  out.end(); untr.end();
  const summary = { built: new Date().toISOString(), vectors: sem.n, probes: probes.length, dimensions: dimensions.length, strata: strata.length, threshold: THRESHOLD, k: K, candidates: hits.size, kept, untranslated: missing, short, nofile, seconds: Math.round((Date.now() - t0) / 1000), languages: Object.fromEntries(langsByRows), perSlice, perLang };
  fs.writeFileSync(path.join(OUT, 'v5-summary.json'), JSON.stringify(summary, null, 2));
  log(`kept ${kept.toLocaleString()} passages (untranslated ${missing}, short ${short}, no mirror file ${nofile})`);
  log('top languages retrieved:', Object.entries(perLang).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([l, n]) => `${l}:${n}`).join('  '));
}

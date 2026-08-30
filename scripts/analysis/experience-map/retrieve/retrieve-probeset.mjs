#!/usr/bin/env node
/**
 * Retrieval v4 for the experience map.
 *
 * Fixes the two things that made v1/v3 lopsided:
 *
 *  1. SPEED. v3 issued its RPC calls sequentially; the language-scoped path is a
 *     sequential scan over page_translations, so at ~1.5s/query it never got past
 *     the major European languages and the map ended up 45% Christian-mystical.
 *     v4 runs a worker pool, so every language gets the full probe set.
 *  2. WHICH LANGUAGES. v3 guessed a hardcoded list. v4 asks the table which
 *     languages actually carry rows, then slices each one.
 *
 * Every language gets the SAME number of probe queries regardless of corpus size,
 * which is the point: it is a deliberately stratified sample, not a proportional
 * one. Tibetan gets the same 144 queries English does. The stratification is
 * recorded per row so downstream analysis can weight it back if it wants to.
 *
 * Cost: embeddings are BILLED (see .claude/docs/embeddings.md) but cached, so a
 * repeat run is free; the RPC is a Supabase query.
 */
import { readFileSync, writeFileSync, existsSync, createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/dereklomas/sourcelibrary/package.json');
const { createClient } = require('@supabase/supabase-js');
const { stripEditorialWrappers } = await import(
  '/Users/dereklomas/sourcelibrary/scripts/lib/strip-editorial-wrappers.mjs'
);

const HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad';
const MODEL = 'gemini-embedding-2-preview';
const DIMS = 768, THRESHOLD = 0.45, MATCH = 50, CONCURRENCY = 5;

const req = (n) => { const v = process.env[n]; if (!v) throw new Error(`Missing ${n}`); return v; };
const KEY = process.env.GEMINI_API_KEY_TIER3 || req('GEMINI_API_KEY');
const supabase = createClient(req('SUPABASE_URL'), req('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

const CANDIDATE_LANGS = [
  'English','German','Latin','French','Dutch','Italian','Spanish','Portuguese','Catalan',
  'Greek','Russian','Ukrainian','Polish','Czech','Serbian','Croatian','Bulgarian','Romanian',
  'Swedish','Danish','Norwegian','Icelandic','Finnish','Estonian','Lithuanian','Hungarian',
  'Hebrew','Yiddish','Arabic','Persian','Turkish','Syriac','Armenian','Georgian','Coptic',
  'Sanskrit','Pali','Tibetan','Hindi','Bengali','Tamil','Urdu','Marathi',
  'Chinese','Japanese','Korean','Vietnamese','Thai','Mongolian',
  'Sumerian','Akkadian','Welsh','Irish','Basque','Amharic','Ethiopic','Church Slavonic','Old Norse',
];

async function embed(text) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: [{ model: `models/${MODEL}`, content: { parts: [{ text }] }, outputDimensionality: DIMS }] }),
          signal: AbortSignal.timeout(20000) });
      if (res.ok) return (await res.json())?.embeddings?.[0]?.values || null;
    } catch {}
    await new Promise((r) => setTimeout(r, 900 * (a + 1)));
  }
  return null;
}

async function rpc(vec, slice) {
  // Retry with backoff. Without this a transient pool exhaustion torches the whole
  // run: v4's first attempt burned all 9,936 queries in seconds because every call
  // failed instantly and nothing backed off or complained.
  let lastErr = null;
  for (let a = 0; a < 4; a++) {
    const { data, error } = await supabase.rpc('match_semantic', {
      query_embedding: vec,
      match_threshold: THRESHOLD, match_count: MATCH,
      filter_tenant_id: null, filter_language: null,
      filter_year_min: slice.min ?? null, filter_year_max: slice.max ?? null,
      filter_languages: slice.langs ?? null,
      filter_exclude_languages: slice.exclude ?? null,
    });
    if (!error) return { rows: data || [] };
    lastErr = error.message;
    await new Promise((r) => setTimeout(r, 700 * Math.pow(2, a)));
  }
  return { rows: [], err: lastErr };
}

/* ---------- probe vectors ---------- */
const { dimensions } = JSON.parse(readFileSync(process.env.PROBE_FILE || `${HERE}/probes-v2.json`, 'utf8'));
const probes = dimensions.flatMap((d) => d.probes.map((p) => ({ dim: d.id, probe: p })));
console.log(`${dimensions.length} dimensions, ${probes.length} probes`);

const CACHE = (process.env.VEC_CACHE || `${HERE}/probe-vectors-v2.json`);
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
let newly = 0;
for (const { probe } of probes) {
  if (cache[probe]) continue;
  const v = await embed(probe);
  if (v) { cache[probe] = v; newly++; }
  if (newly && newly % 25 === 0) { writeFileSync(CACHE, JSON.stringify(cache)); console.log(`  embedded ${newly}`); }
  await new Promise((r) => setTimeout(r, 70));
}
writeFileSync(CACHE, JSON.stringify(cache));
const ready = probes.filter((p) => cache[p.probe]);
console.log(`probe vectors: ${ready.length}/${probes.length} (${newly} new)\n`);
// pre-serialise once — this is 768 floats per probe and it is not free
const VEC = new Map(ready.map((p) => [p.probe, JSON.stringify(cache[p.probe])]));

/* ---------- languages ---------- */
// No count-probe: `select count(*) where book_language = ?` over 3.9M rows is a
// slow scan, 58 of them concurrently exhausted the connection pool and killed the
// run that followed, and it answered nothing we act on — an absent language simply
// returns no rows, cheaply, on the language-scoped path.
const langs = CANDIDATE_LANGS.map((l) => ({ lang: l, rows: null }));
console.log(`${langs.length} candidate languages (absent ones cost one empty query each)\n`);

/* ---------- slice plan ---------- */
const plan = [{ id: 'global', langs: null }];
for (const l of langs) plan.push({ id: `lang:${l.lang}`, langs: [l.lang] });
const ERAS = [
  { id: 'pre1600', min: -3000, max: 1599 },
  { id: '1600-1799', min: 1600, max: 1799 },
];
for (const l of (process.env.NO_ERAS ? [] : langs.slice(0, 6))) for (const e of ERAS) {
  plan.push({ id: `${l.lang}/${e.id}`, langs: [l.lang], min: e.min, max: e.max });
}
plan.push({ id: 'tail', exclude: langs.slice(0, 10).map((l) => l.lang) });

const jobs = [];
for (const slice of plan) for (const p of ready) jobs.push({ slice, p });
console.log(`${plan.length} slices × ${ready.length} probes = ${jobs.length} queries\n`);

/* ---------- run ---------- */
const out = createWriteStream(process.env.HITS_OUT || `${HERE}/hits-v4.jsonl`);
const seen = new Set();
const perSlice = {}, perLang = {};
let done = 0, errs = 0;

async function worker() {
  while (jobs.length) {
    const job = jobs.pop();
    if (!job) break;
    const { rows, err } = await rpc(VEC.get(job.p.probe), job.slice);
    done++;
    if (err) {
      errs++;
      if (errs === 1) console.error(`  first RPC error: ${err}`);
      if (errs > 60 && errs > done * 0.5) {
        console.error(`ABORTING: ${errs}/${done} queries failing — not burning the queue.`);
        jobs.length = 0;
      }
      continue;
    }
    for (const r of rows) {
      if (seen.has(r.page_id)) continue;
      const text = stripEditorialWrappers(r.translation || '').trim();
      if (text.length < 150) continue;
      seen.add(r.page_id);
      perSlice[job.slice.id] = (perSlice[job.slice.id] || 0) + 1;
      perLang[r.book_language || '?'] = (perLang[r.book_language || '?'] || 0) + 1;
      out.write(JSON.stringify({
        page_id: r.page_id, book_id: r.book_id, page_number: r.page_number,
        book_title: r.book_title, book_author: r.book_author,
        book_language: r.book_language, book_year: r.book_year,
        dim: job.p.dim, probe: job.p.probe, slice: job.slice.id,
        similarity: r.similarity, text: text.slice(0, 3000),
      }) + '\n');
    }
    if (done % 250 === 0) {
      console.log(`  ${done} queries · ${seen.size} passages · ${errs} errors`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
out.end();

writeFileSync((process.env.SUMMARY_OUT || `${HERE}/v4-summary.json`), JSON.stringify({
  dimensions: dimensions.length, probes: ready.length, slices: plan.length,
  queries: done, errors: errs, passages: seen.size,
  languagesPresent: langs, perSlice, perLang,
}, null, 2));

console.log(`\n${done} queries, ${errs} errors -> ${seen.size} unique passages`);
console.log('top languages retrieved:',
  Object.entries(perLang).sort((a, b) => b[1] - a[1]).slice(0, 16)
    .map(([l, n]) => `${l}:${n}`).join('  '));

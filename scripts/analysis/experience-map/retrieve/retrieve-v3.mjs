#!/usr/bin/env node
/**
 * Retrieval v3 — breaks the match_semantic 50-row ceiling the right way.
 *
 * WHY NOT CENTURY SLICES: match_semantic only branches to its sequential-scan
 * path when a LANGUAGE filter is set (see has_language_filter in
 * add-match-semantic-rpc.sql). A year-only filter falls through to the HNSW
 * path, where the year predicate is a POST-filter on the globally-nearest
 * candidates — so a year-sliced query returns a subset of the unfiltered top-50
 * and can never surface anything new. Measured: 7 century slices, 0 new rows.
 *
 * WHAT WORKS: with a language filter set, the seq-scan path applies language
 * AND year predicates BEFORE the distance sort. So slicing by language gives
 * each language its own genuine top-50 per probe — which simultaneously fixes
 * the English/German skew of the unsliced pass. For the largest languages we
 * additionally slice by era, which is correct on this path.
 *
 * Cost: embeddings are BILLED (see .claude/docs/embeddings.md) but cached to disk,
 * so a repeat run is free; the RPC is a Supabase query.
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
const DIMS = 768;
const THRESHOLD = 0.45;
const OUT_PATH = `${HERE}/hits-v3.jsonl`;

const req = (n) => { const v = process.env[n]; if (!v) throw new Error(`Missing ${n}`); return v; };
const KEY = process.env.GEMINI_API_KEY_TIER3 || req('GEMINI_API_KEY');
const supabase = createClient(req('SUPABASE_URL'), req('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

// Languages present in page_translations. The long tail is swept with an
// exclude-filter pass so nothing is silently unreachable.
const LANGS = [
  'English', 'German', 'Latin', 'French', 'Dutch', 'Italian', 'Spanish', 'Greek',
  'Russian', 'Chinese', 'Tibetan', 'Sanskrit', 'Arabic', 'Hebrew', 'Syriac',
  'Armenian', 'Portuguese', 'Swedish', 'Danish', 'Polish', 'Czech', 'Japanese',
  'Korean', 'Persian', 'Turkish', 'Hungarian', 'Norwegian', 'Finnish', 'Welsh', 'Irish',
];
const ERA_LANGS = ['English', 'German', 'Latin', 'French'];
const ERAS = [
  { id: 'early', min: -1000, max: 1699 },
  { id: 'mid', min: 1700, max: 1849 },
  { id: 'late', min: 1850, max: 2100 },
];

async function embed(text) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${KEY}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{ model: `models/${MODEL}`, content: { parts: [{ text }] }, outputDimensionality: DIMS }],
          }),
          signal: AbortSignal.timeout(20000),
        });
      if (res.ok) return (await res.json())?.embeddings?.[0]?.values || null;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
  }
  return null;
}

async function search(vec, { langs, exclude, min, max }) {
  const { data, error } = await supabase.rpc('match_semantic', {
    query_embedding: JSON.stringify(vec),
    match_threshold: THRESHOLD,
    match_count: 50,
    filter_tenant_id: null,
    filter_language: null,
    filter_year_min: min ?? null,
    filter_year_max: max ?? null,
    filter_languages: langs ?? null,
    filter_exclude_languages: exclude ?? null,
  });
  if (error) return { rows: [], err: error.message };
  return { rows: data || [] };
}

const { dimensions } = JSON.parse(readFileSync(`${HERE}/probes.json`, 'utf8'));
const probes = dimensions.flatMap((d) => d.probes.map((p) => ({ dim: d.id, probe: p })));

// cached probe embeddings
const CACHE = `${HERE}/probe-vectors.json`;
let cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
let embedded = 0;
for (const { probe } of probes) {
  if (cache[probe]) continue;
  const v = await embed(probe);
  if (v) { cache[probe] = v; embedded++; }
  await new Promise((r) => setTimeout(r, 80));
}
if (embedded) writeFileSync(CACHE, JSON.stringify(cache));
console.log(`probe vectors ready (${Object.keys(cache).length}, ${embedded} newly embedded)\n`);

// build the slice plan
const plan = [];
for (const l of LANGS) plan.push({ id: `lang:${l}`, langs: [l] });
for (const l of ERA_LANGS) for (const e of ERAS) plan.push({ id: `${l}/${e.id}`, langs: [l], min: e.min, max: e.max });
plan.push({ id: 'tail(exclude-major)', exclude: LANGS.slice(0, 12) });

const out = createWriteStream(OUT_PATH);
const seen = new Set();
const perSlice = {};
let queries = 0;

for (const slice of plan) {
  let added = 0, errs = 0;
  for (const { dim, probe } of probes) {
    const vec = cache[probe];
    if (!vec) continue;
    const { rows, err } = await search(vec, slice);
    queries++;
    if (err) { errs++; continue; }
    for (const r of rows) {
      if (seen.has(r.page_id)) continue;
      const text = stripEditorialWrappers(r.translation || '').trim();
      if (text.length < 150) continue;
      seen.add(r.page_id);
      added++;
      out.write(JSON.stringify({
        page_id: r.page_id, book_id: r.book_id, page_number: r.page_number,
        book_title: r.book_title, book_author: r.book_author,
        book_language: r.book_language, book_year: r.book_year,
        dim, probe, slice: slice.id, similarity: r.similarity,
        text: text.slice(0, 3000),
      }) + '\n');
    }
  }
  perSlice[slice.id] = added;
  console.log(`${slice.id.padEnd(24)} +${String(added).padStart(4)} new   total=${seen.size}${errs ? `  (${errs} errors)` : ''}`);
}

out.end();
writeFileSync(`${HERE}/v3-summary.json`, JSON.stringify({ queries, total: seen.size, perSlice }, null, 2));
console.log(`\n${queries} queries -> ${seen.size} unique passages`);

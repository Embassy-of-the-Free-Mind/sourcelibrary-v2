#!/usr/bin/env node
// PRIOR ART: scripts/analysis/experience-map/retrieve/retrieve-probeset.mjs (#6652) — the same probe → match_semantic
//   retrieval with language slices, but it embeds through its own fetch (unmetered) and hard-codes laptop paths. This
//   one embeds through scripts/lib/page-embedding-text.mjs embedTexts (the page vectors' own model and dims) and records
//   the spend with embedding-usage.mjs, and reports per probe what Derek asked for on #7129 (2026-10-22 19:58Z).
// Semantic retrieval for the Map of Harmony (#7129): embed each probe sentence (probes.json) with gemini-embedding-2
// (768 dims, the model the page_translations vectors use; realtime, 48 probes, about $0.001), query match_semantic over
// page_translations globally and per language, and report per probe: hits, how many never say harmony/sympathy (or a
// cognate), and the five best with sourcelibrary.org/q links.
// CAVEAT carried into every report: page vectors exist only for TRANSLATED pages, so untranslated books are invisible.
//   node --no-warnings --experimental-strip-types --env-file=/root/sourcelibrary/.env.production.local \
//     scripts/eval/harmony-semantic/retrieve.mjs --out <dir>
import fs from 'node:fs'; import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { embedTexts, EMBED_MODEL } from '../../lib/page-embedding-text.mjs';
import { newEmbedUsage, logEmbeddingUsage } from '../../lib/embedding-usage.mjs';
import { encodeShortlink } from '../../../src/lib/shortlinks.ts';
import { stripEditorialWrappers } from '../../lib/strip-editorial-wrappers.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out'); if (!OUT) { console.error('usage: retrieve.mjs --out <dir>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const HERE = path.dirname(new URL(import.meta.url).pathname);
const { dimensions } = JSON.parse(fs.readFileSync(path.join(HERE, 'probes.json'), 'utf8'));
const probes = dimensions.flatMap((d) => d.probes.map((p) => ({ dim: d.id, probe: p })));
const THRESHOLD = +arg('--threshold', 0.45), MATCH = 50, CONC = 4;
// the word the map is about, and its cognates in the library's translations
const NAMES = /harmon|sympath|concord|consonan|accord|resonan|attune|symphon/i;
const LANGS = ['Latin', 'Greek', 'Chinese', 'Sanskrit', 'Arabic', 'Hebrew', 'Persian', 'German', 'French', 'Italian', 'Japanese', 'Tibetan', 'Pali', 'Spanish', 'Dutch'];

// 1. probe vectors (cached: a rerun costs nothing)
const CACHE = path.join(OUT, 'probe-vectors.json'); const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const need = probes.filter((p) => !cache[p.probe]).map((p) => p.probe);
if (need.length) { const usage = newEmbedUsage(); const v = await embedTexts(need, process.env.GEMINI_API_KEY, { usage }); need.forEach((t, i) => { cache[t] = v[i]; });
  await logEmbeddingUsage(usage, { model: EMBED_MODEL, endpoint: 'eval/harmony-semantic/probes' }); fs.writeFileSync(CACHE, JSON.stringify(cache)); }
console.log(`${probes.length} probes, ${need.length} newly embedded (${EMBED_MODEL})`);

// 2. retrieval: global, then one slice per language so English does not crowd out the rest
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function rpc(vec, langs) {
  for (let a = 0; a < 4; a++) {
    const { data, error } = await sb.rpc('match_semantic', { query_embedding: vec, match_threshold: THRESHOLD, match_count: MATCH, filter_tenant_id: null, filter_language: null,
      filter_year_min: null, filter_year_max: null, filter_languages: langs, filter_exclude_languages: null });
    if (!error) return data || [];
    await new Promise((r) => setTimeout(r, 700 * 2 ** a));
  }
  return [];
}
const jobs = []; for (const p of probes) for (const s of [null, ...LANGS]) jobs.push({ p, s });
const hits = new Map(); let done = 0;
async function worker() { while (jobs.length) { const { p, s } = jobs.pop(); const rows = await rpc(cache[p.probe], s ? [s] : null);
  for (const r of rows) { const k = `${p.probe}|${r.book_id}|${r.page_number}`; if (hits.has(k)) continue;
    hits.set(k, { dim: p.dim, probe: p.probe, b: r.book_id, p: r.page_number, sim: +r.similarity.toFixed(4), lang: r.book_language, year: r.book_year, title: r.book_title, author: r.book_author, slice: s || 'global', text: stripEditorialWrappers(r.translation || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }); }
  if (++done % 100 === 0) console.log(`  ${done} queries`); } }
await Promise.all(Array.from({ length: CONC }, worker));
const rows = [...hits.values()].map((h) => ({ ...h, names: NAMES.test(h.text), q: `https://sourcelibrary.org/q/${encodeShortlink(h.b, h.p)}` }));
fs.writeFileSync(path.join(OUT, 'hits.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

// 3. the report: per probe, hits, how many never name harmony, the five best
const rep = probes.map(({ dim, probe }) => { const rs = rows.filter((r) => r.probe === probe).sort((a, b) => b.sim - a.sim);
  const best = rs.slice(0, 5).map((r) => ({ sim: r.sim, title: r.title, lang: r.lang, year: r.year, names: r.names, q: r.q, text: r.text.slice(0, 220) }));
  return { dim, probe, hits: rs.length, books: new Set(rs.map((r) => r.b)).size, never_name: rs.filter((r) => !r.names).length, langs: [...new Set(rs.map((r) => r.lang))].length, best }; });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), model: EMBED_MODEL, threshold: THRESHOLD,
  caveat: 'Page vectors exist only for translated pages: untranslated books are invisible to this lane.', probes: rep }, null, 1));
console.log(`hits ${rows.length} (distinct pages ${new Set(rows.map((r) => r.b + ':' + r.p)).size}), never naming harmony ${rows.filter((r) => !r.names).length}`);

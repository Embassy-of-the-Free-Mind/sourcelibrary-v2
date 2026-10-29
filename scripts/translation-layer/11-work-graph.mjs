#!/usr/bin/env node
/**
 * Phase 11 — one WORK graph over USTC Latin editions AND Source Library books
 * (issue #7751). Replaces the cluster unit for the gap arithmetic.
 *
 * Why: `ustc_editions.work_cluster_id` is NOT USTC's grouping — build.mjs mints
 * it as `surname::first-6-title-words`, so every variant title page is a new
 * "work" (Imitatio Christi: 255 editions in 69 clusters; Aeneid 322 in 144).
 * books.work_id is no better for Latin (145K of 160K ids are singletons). The
 * most-printed works — the translated ones — fragment most, so cluster counts
 * mis-state both sides of the gap.
 *
 * PRIOR ART: scripts/catalog-coverage/build.mjs `workClusterId` (prefix key —
 * the thing being replaced); scripts/maintenance/merge-work-clusters.mjs (merges
 * books.work_id via canon seeds + identical titles, writes Mongo — too strict for
 * title-page variance, and USTC-blind); 10-sl-coverage.mjs (best-cluster links,
 * inherits the fragmentation). This phase is read-only and free.
 *
 * Method. Nodes = USTC Latin 1400-1700 editions + SL Latin books (with pages).
 *   - direct: an SL book with books.ustc_id = sn (or named by
 *     ustc_editions.source_library_id) takes that edition's work.
 *   - anonymous nodes join only on an identical first-6-token key.
 *   - everything else: LEADER clustering within an author (surname-stem anchor).
 *     Titles are compared on their first K distinctive tokens (u/v, i/j folded,
 *     author-name tokens stripped). Visited lightest first, each title joins the
 *     best leader it matches directly — IDF-weighted containment
 *         shared_weight / min(weight_leader, weight_title) ≥ CONTAIN
 *     plus the specificity gate (≥1 STRONG or ≥2 MID shared tokens) — or
 *     becomes a leader. Single-linkage union-find was tried first and chained
 *     whole oeuvres through omnibus title pages (all of Cicero became one work);
 *     a two-pass density merge and a hub guard did not stop it. Leader membership
 *     cannot chain.
 * Works = the resulting components. A component's external prior and
 * SL status are carried over from its members (phase-3 cluster priors; book
 * translation status), never mixed: the external channel stays external.
 *
 * Reads:  Supabase ustc_editions (cached to scripts/output/ustc-latin-editions.jsonl),
 *         scripts/output/cluster-external-priors.jsonl, Mongo books
 * Writes: scripts/output/work-graph.jsonl, scripts/output/work-graph-report.json
 *
 * --lang <name> (#7769): build the graph over USTC editions whose language_1 is
 * that language (latin, german, french, italian, dutch, spanish, greek,
 * portuguese) and SL books in it. Non-Latin outputs carry the language in the
 * file name; Latin keeps the original names.
 *
 * External works as x NODES (#7769): every work in the external-works file
 * (default external-translation-works-staging.jsonl, from `01 --staging`;
 * override --external <file>) whose orig_lang is this language is matched AFTER
 * the leader pass, against the leaders, by the same containment + specificity
 * rule. An x node never becomes a leader and never joins two works, so the
 * external side cannot change the clustering it is measured against. A work's
 * external prior is then (phase-3 cluster prior, Latin only) ∪ (an attached x
 * node), and the report counts, per source, x works landing on a USTC work and
 * USTC works carrying a prior — before (non-staged sources) vs after (all).
 *
 * Usage: node --env-file=.env.production.local scripts/translation-layer/11-work-graph.mjs [--refresh] [--lang german] [--external <file>]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { surnameStems, distinctiveTokens, extractSurname, normTitle, supa } from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const LANG = (argOf('--lang') || 'latin').toLowerCase();
const LANG_NAME = LANG[0].toUpperCase() + LANG.slice(1); // ustc_editions.language_1 and books.language
const SUFFIX = LANG === 'latin' ? '' : `-${LANG}`;
const EDITIONS = path.join(OUT, `ustc-${LANG}-editions.jsonl`);
const EXTERNAL = argOf('--external') || path.join(OUT, 'external-translation-works-staging.jsonl');
// sources written by `01 --staging` (#7769); everything else in the file is the pre-existing external side
const STAGED_SOURCES = new Set(['loc_marc_041', 'openlibrary_translated_from', 'wikidata_p629']);
const readJsonl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const orth = (s) => (s || '').replace(/[vV]/g, 'u').replace(/[jJ]/g, 'i');

const K = 10;            // leading distinctive tokens compared (title pages run on; the head names the work)
const CONTAIN = Number(process.env.WG_CONTAIN ?? 0.6); // IDF-weighted containment needed to join a leader (shared / lighter title)
const STRONG_IDF = 6.0, MID_IDF = 5.0, FLOOR_IDF = 3.0;

async function pullEditions() {
  if (fs.existsSync(EDITIONS) && !process.argv.includes('--refresh')) return readJsonl(EDITIONS);
  const sb = supa();
  const out = [];
  let last = 0;
  while (true) {
    const { data, error } = await sb.from('ustc_editions')
      .select('id,sn,work_cluster_id,author_1,title,year,source_library_id')
      .eq('language_1', LANG_NAME).gte('year', 1400).lte('year', 1700)
      .gt('id', last).order('id', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    out.push(...data);
    last = data[data.length - 1].id;
    if (out.length % 50000 < 1000) console.log(`  editions ${out.length}…`);
    if (data.length < 1000) break;
  }
  fs.writeFileSync(EDITIONS, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return out;
}

function bookStatus(b) {
  const translatable = Math.max(1, (b.pages_count || 0) - (b.pages_blank || 0));
  const t = b.pages_translated || 0;
  return t >= 0.9 * translatable ? 'readable' : t > 0 ? 'partial' : 'none';
}

async function main() {
  console.log(`Loading USTC ${LANG_NAME} editions…`);
  const eds = await pullEditions();
  console.log(`  ${eds.length} editions`);
  // phase-3 priors are matched against the LATIN cluster denominator only
  const priorFile = path.join(OUT, 'cluster-external-priors.jsonl');
  const priorClusters = new Set(LANG === 'latin' && fs.existsSync(priorFile) ? readJsonl(priorFile).map((r) => r.work_cluster_id) : []);
  if (LANG === 'latin' && !priorClusters.size) console.warn('⚠️  no cluster-external-priors.jsonl: phase-3 priors absent, x nodes only');
  const extWorks = fs.existsSync(EXTERNAL) ? readJsonl(EXTERNAL).filter((w) => (w.orig_lang || '').toLowerCase() === LANG) : [];
  console.log(`  ${extWorks.length} external works in ${LANG} from ${path.basename(EXTERNAL)}${fs.existsSync(EXTERNAL) ? '' : ' (file absent)'}`);

  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const books = await c.db('bookstore').collection('books').find(
    { $or: [{ language: LANG_NAME }, { languages: LANG_NAME }], pages_count: { $gt: 0 } },
    { projection: { id: 1, slug: 1, title: 1, author: 1, ustc_id: 1, visible: 1, pages_count: 1, pages_blank: 1, pages_translated: 1 } },
  ).toArray();
  await c.close();
  console.log(`  ${books.length} SL ${LANG_NAME} books`);

  // --- nodes ---
  const nodes = [];
  for (const e of eds) nodes.push({ k: 'u', ref: e, author: e.author_1 || '', title: e.title || '' });
  for (const b of books) nodes.push({ k: 's', ref: b, author: b.author || '', title: b.title || '' });
  for (const w of extWorks) nodes.push({ k: 'x', ref: w, author: w.author || w.surname || '', title: w.title || '' });

  // IDF over USTC edition titles only (the population whose works we count)
  const df = new Map();
  const U = eds.length;
  for (const n of nodes) {
    n.stems = surnameStems(orth(n.k === 'u' ? (extractSurname(n.author) || n.author) : n.author));
    const toks = [...new Set(distinctiveTokens(orth(n.title)))]
      .filter((t) => !n.stems.some((s) => s.length >= 3 && t.startsWith(s)));
    n.toks = toks;
    if (n.k === 'u') for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = (t) => Math.log((U + 1) / ((df.get(t) || 0) + 1));
  for (const n of nodes) {
    n.head = n.toks.slice(0, K).filter((t) => idf(t) >= FLOOR_IDF);
    n.w = n.head.reduce((s, t) => s + idf(t), 0);
    n.set = new Set(n.head);
  }

  // --- union-find (direct links, anonymous keys, leader membership) ---
  const parent = new Int32Array(nodes.length).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a < b ? b : a] = a < b ? a : b; };

  // direct edges: an SL book with a USTC link takes that edition's work, and is
  // kept out of title clustering so it cannot pull a second work in.
  const bySn = new Map(), bySl = new Map();
  nodes.forEach((n, i) => { if (n.k === 'u') { if (n.ref.sn) bySn.set(String(n.ref.sn), i); if (n.ref.source_library_id) bySl.set(String(n.ref.source_library_id), i); } });
  let direct = 0;
  const linked = new Set();
  nodes.forEach((n, i) => {
    if (n.k !== 's') return;
    const j = [bySn.get(String(n.ref.ustc_id)), bySl.get(String(n.ref.id)), bySl.get(String(n.ref._id))].find((x) => x !== undefined);
    if (j !== undefined) { union(i, j); linked.add(i); direct++; }
  });

  // anonymous: identical first-6 key
  const anonKey = new Map();
  let anon = 0;
  nodes.forEach((n, i) => {
    if (n.stems.length || linked.has(i) || n.k === 'x') return;
    const key = normTitle(orth(n.title)).split(' ').slice(0, 6).join(' ');
    if (key.split(' ').length < 3) return;
    anon++;
    if (anonKey.has(key)) union(i, anonKey.get(key)); else anonKey.set(key, i);
  });

  // LEADER clustering, within an author. Titles are visited lightest first (the
  // bare work name — "De officiis libri tres" — before the omnibus page that
  // contains it); each joins the best existing leader it matches DIRECTLY, or
  // becomes a leader. Membership needs similarity to the leader itself, so no
  // chain can form: single-linkage union-find fused all 4,772 Aquinas editions,
  // and all of Cicero, through omnibus title pages — do not revert to it. An
  // omnibus edition joins ONE of its works (the best-scoring), never bridges two.
  const order = nodes.map((n, i) => i).filter((i) => nodes[i].k !== 'x' && nodes[i].w > 0 && nodes[i].stems.length && !linked.has(i));
  order.sort((a, b) => nodes[a].w - nodes[b].w || nodes[b].k.localeCompare(nodes[a].k));
  const leaderIdx = new Map(); // "stem|token" → leader node ids
  let leaders = 0, joins = 0, scored = 0;
  function bestLeader(a) {
    let best = -1, bestScore = 0, bestSw = 0;
    const seen = new Set();
    for (const s of a.stems) for (const t of a.head) {
      const lst = leaderIdx.get(s + '|' + t); if (!lst) continue;
      for (const L of lst) {
        if (seen.has(L)) continue;
        seen.add(L); scored++;
        const l = nodes[L];
        let sw = 0, nS = 0, nM = 0;
        for (const x of l.head) if (a.set.has(x)) { const v = idf(x); sw += v; if (v >= STRONG_IDF) nS++; if (v >= MID_IDF) nM++; }
        if (!(nS >= 1 || nM >= 2)) continue;
        const score = sw / Math.min(l.w, a.w);
        if (score < CONTAIN) continue;
        if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) < 1e-9 && sw > bestSw)) { best = L; bestScore = score; bestSw = sw; }
      }
    }
    return best;
  }
  for (let o = 0; o < order.length; o++) {
    if (o % 100000 === 0 && o) console.log(`  leader pass ${o}/${order.length}…`);
    const i = order[o], a = nodes[i];
    const best = bestLeader(a);
    if (best >= 0) { union(i, best); joins++; continue; }
    leaders++;
    for (const s of a.stems) for (const t of a.head) if (idf(t) >= MID_IDF) {
      const key = s + '|' + t;
      if (!leaderIdx.has(key)) leaderIdx.set(key, []);
      leaderIdx.get(key).push(i);
    }
  }
  // x pass: external works attach to ONE leader each, after the graph is fixed
  let xJoined = 0;
  const xUnmatched = { no_author: 0, no_title_tokens: 0, no_leader: 0 };
  nodes.forEach((n, i) => {
    if (n.k !== 'x') return;
    if (!n.stems.length) { xUnmatched.no_author++; return; }
    if (!(n.w > 0)) { xUnmatched.no_title_tokens++; return; }
    const L = bestLeader(n);
    if (L < 0) { xUnmatched.no_leader++; return; }
    union(i, L); xJoined++;
  });
  console.log(`direct ${direct} | anon nodes ${anon} | leaders ${leaders} | joins ${joins} | x joined ${xJoined} ${JSON.stringify(xUnmatched)} | leader comparisons ${scored}`);
  const root = (i) => find(i);

  // --- components ---
  const comp = new Map();
  nodes.forEach((n, i) => { const r = root(i); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(i); });
  const rank = { readable: 2, partial: 1, none: 0 };
  const works = [];
  for (const [r, mem] of comp) {
    const u = mem.filter((i) => nodes[i].k === 'u'), s = mem.filter((i) => nodes[i].k === 's');
    const x = mem.filter((i) => nodes[i].k === 'x');
    const xSources = new Set(x.flatMap((i) => nodes[i].ref.sources || []));
    const extBefore = u.some((i) => priorClusters.has(nodes[i].ref.work_cluster_id)) || [...xSources].some((src) => !STAGED_SOURCES.has(src));
    const ext = extBefore || xSources.size > 0;
    const sl = s.reduce((a, i) => (rank[bookStatus(nodes[i].ref)] > rank[a] ? bookStatus(nodes[i].ref) : a), s.length ? 'none' : null);
    const years = u.map((i) => nodes[i].ref.year).filter(Boolean);
    works.push({ r, u: u.length, s: s.length, x, xSources, extBefore, ext, sl, year_min: years.length ? Math.min(...years) : null,
      old_clusters: new Set(u.map((i) => nodes[i].ref.work_cluster_id)).size,
      title: nodes[(u[0] ?? s[0])].title.slice(0, 140), author: nodes[(u[0] ?? s[0])].author, mem });
  }
  const ustcWorks = works.filter((w) => w.u > 0);

  // --- external landing (#7769): per source, x works on a USTC work; USTC works with a prior ---
  const xLanding = {};
  const bump = (src, key) => { xLanding[src] ??= { x_works: 0, landed_on_ustc_work: 0, ustc_works_with_prior: 0, ustc_works_only_this_source: 0 }; xLanding[src][key]++; };
  nodes.forEach((n) => { if (n.k === 'x') for (const src of new Set(n.ref.sources || [])) bump(src, 'x_works'); });
  for (const w of ustcWorks) {
    for (const i of w.x) for (const src of new Set(nodes[i].ref.sources || [])) bump(src, 'landed_on_ustc_work');
    for (const src of w.xSources) bump(src, 'ustc_works_with_prior');
    if (w.xSources.size === 1 && !w.extBefore) bump([...w.xSources][0], 'ustc_works_only_this_source');
  }
  const staged = [...STAGED_SOURCES];
  const external_landing = {
    ustc_works: ustcWorks.length,
    with_prior_before: ustcWorks.filter((w) => w.extBefore).length,
    with_prior_after: ustcWorks.filter((w) => w.ext).length,
    with_staged_prior: ustcWorks.filter((w) => staged.some((src) => w.xSources.has(src))).length,
    by_source: xLanding,
  };
  console.log('external landing:', JSON.stringify(external_landing));
  console.log(`works with ≥1 USTC edition: ${ustcWorks.length} (was ${new Set(eds.map((e) => e.work_cluster_id)).size} clusters) | SL-only works: ${works.length - ustcWorks.length}`);

  // --- gold fragmentation tests ---
  const gold = [
    ['Imitatio Christi', /kempis/i, /imitat/i], ['Moriae encomium', /erasm/i, /mori|stultit/i], ['Adagia', /erasm/i, /adag/i],
    ['Consolatio', /boet/i, /consolat/i], ['De occulta philosophia', /agrippa/i, /occult/i], ['Aeneid', /vergil|virgil/i, /aene/i],
    ['Pimander', /trismeg|mercur|hermes/i, /pimand|poemand/i], ['Utopia', /morus|more/i, /utopi/i],
  ];
  const goldOut = {};
  for (const [label, ar, tr] of gold) {
    const hit = eds.map((e, i) => i).filter((i) => ar.test(nodes[i].author) && tr.test(nodes[i].title));
    const comps = new Map(); for (const i of hit) { const r = root(i); comps.set(r, (comps.get(r) || 0) + 1); }
    const top = [...comps.values()].sort((a, b) => b - a);
    goldOut[label] = { editions: hit.length, old_clusters: new Set(hit.map((i) => eds[i].work_cluster_id)).size, works: comps.size, largest_work_share: hit.length ? Number((top[0] / hit.length).toFixed(2)) : null };
  }
  console.log('gold fragmentation:', goldOut);

  // --- the 2x2 at WORK level ---
  const grid = (subset, min) => {
    const ok = (w) => w.sl && rank[w.sl] >= rank[min];
    let both = 0, slFirst = 0, extOnly = 0, gap = 0;
    for (const w of subset) { const s = ok(w); if (s && w.ext) both++; else if (s) slFirst++; else if (w.ext) extOnly++; else gap++; }
    const n = subset.length, pc = (x) => Number((100 * x / n).toFixed(2));
    return { works: n, sl: both + slFirst, sl_pct: pc(both + slFirst), external: both + extOnly, external_pct: pc(both + extOnly),
      grid: { sl_and_external: both, sl_first: slFirst, external_only: extOnly, open_gap: gap } };
  };
  const byCentury = (min) => Object.fromEntries([[1400, 1499], [1500, 1599], [1600, 1700]].map(([a, z]) => [`${a}s`, grid(ustcWorks.filter((w) => w.year_min >= a && w.year_min <= z), min)]));
  const sizes = { 1: 0, '2-5': 0, '6-20': 0, '21-100': 0, '101+': 0 };
  for (const w of ustcWorks) { const n = w.u; sizes[n === 1 ? 1 : n <= 5 ? '2-5' : n <= 20 ? '6-20' : n <= 100 ? '21-100' : '101+']++; }
  const biggest = [...ustcWorks].sort((a, b) => b.u - a.u).slice(0, 25).map((w) => ({ editions: w.u, sl: w.s, old_clusters: w.old_clusters, author: w.author, title: w.title }));

  // over-merge audit sample: random multi-edition works, two member titles each
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const multi = ustcWorks.filter((w) => w.old_clusters >= 2);
  const sample = [];
  for (let k = 0; k < 40 && multi.length; k++) {
    const w = multi[Math.floor(rnd() * multi.length)];
    const tt = [...new Set(w.mem.filter((i) => nodes[i].k !== 'x').map((i) => nodes[i].title.slice(0, 110)))];
    sample.push({ author: w.author, editions: w.u, titles: [tt[0], tt[Math.floor(rnd() * tt.length)]] });
  }

  const report = {
    generated: new Date().toISOString().slice(0, 10), issue: '#7751',
    params: { K, CONTAIN, STRONG_IDF, MID_IDF, FLOOR_IDF },
    nodes: { ustc_editions: eds.length, sl_books: books.length },
    edges: { direct, leaders, joins, anon_nodes: anon },
    works_with_ustc: ustcWorks.length, old_clusters: new Set(eds.map((e) => e.work_cluster_id)).size,
    sl_only_works: works.length - ustcWorks.length,
    editions_per_work: sizes, gold: goldOut,
    lang: LANG, external_file: path.basename(EXTERNAL), external_landing,
    held: grid(ustcWorks, 'none'), translated_any: grid(ustcWorks, 'partial'), readable: grid(ustcWorks, 'readable'),
    readable_by_century: byCentury('readable'),
    biggest_works: biggest, over_merge_sample: sample,
  };
  fs.writeFileSync(path.join(OUT, `work-graph-report${SUFFIX}.json`), JSON.stringify(report, null, 2));
  const w1 = fs.createWriteStream(path.join(OUT, `work-graph${SUFFIX}.jsonl`));
  for (const w of works) w1.write(JSON.stringify({ work: w.r, ustc_sns: w.mem.filter((i) => nodes[i].k === 'u').map((i) => nodes[i].ref.sn), sl_books: w.mem.filter((i) => nodes[i].k === 's').map((i) => nodes[i].ref.id), ext_refs: w.x.flatMap((i) => nodes[i].ref.staged_refs || nodes[i].ref.sources || []).slice(0, 10), ext_before: w.extBefore, ext: w.ext, sl: w.sl, year_min: w.year_min, author: w.author, title: w.title }) + '\n');
  w1.end();
  for (const [k, g] of Object.entries({ held: report.held, translated_any: report.translated_any, readable: report.readable, ...Object.fromEntries(Object.entries(report.readable_by_century).map(([a, b]) => [`readable ${a}`, b])) })) {
    console.log(`${k}: of ${g.works} works — SL ${g.sl} (${g.sl_pct}%), external ${g.external} (${g.external_pct}%), grid ${JSON.stringify(g.grid)}`);
  }
  console.log('editions/work:', sizes);
  console.log(`wrote work-graph${SUFFIX}.jsonl + work-graph-report${SUFFIX}.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });

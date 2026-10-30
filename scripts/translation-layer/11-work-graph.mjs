#!/usr/bin/env node
/**
 * Phase 11 — one WORK graph over USTC editions, Source Library books AND
 * external English translations, for one language (--lang, default Latin;
 * USTC language_1 spelling). Issue #7751. Replaces the cluster unit for the
 * gap arithmetic.
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
 * Method. Nodes = USTC 1400-1700 editions in LANG (u) + SL books in LANG with
 * pages (s) + external translated works whose original is LANG, from phase 1 (x).
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
 *     cannot chain. K=6, not 10: author epithets and dedicatees sit late in
 *     early-modern titles (Javelli "Canapicii"), and at K=10 they merged distinct
 *     works (7/40 sampled multi-edition works wrong; 2-3/40 at K=6). An
 *     author-frequency epithet rule (WG_EPITHETS=1) was tried and shattered
 *     single-work authors (Consolatio 9 → 88 works) — off by default.
 * Works = the resulting components. External prior = the work holds an x node,
 * or (Latin) a phase-3 prior cluster; SL status = best member book status. The
 * external channel never takes SL evidence.
 *
 * Reads:  Supabase ustc_editions (cached to scripts/output/ustc-<lang>-editions.jsonl),
 *         scripts/output/external-translation-works.jsonl,
 *         scripts/output/cluster-external-priors.jsonl (Latin), Mongo books
 * Writes: scripts/output/work-graph[-<lang>].jsonl, work-graph-report[-<lang>].json
 *
 * Usage: node --env-file=.env.production.local scripts/translation-layer/11-work-graph.mjs [--lang German] [--refresh]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { surnameStems, distinctiveTokens, extractSurname, normTitle, supa } from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const argv = process.argv.slice(2);
const LANG = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : 'Latin'; // USTC language_1 spelling
const LANG_CODES = { Latin: ['la'], German: ['de'], French: ['fr'], Italian: ['it'], Dutch: ['nl'], Spanish: ['es'], Greek: ['el', 'grc'], Portuguese: ['pt'] };
const SUFFIX = LANG === 'Latin' ? '' : `-${LANG.toLowerCase()}`;
const EDITIONS = path.join(OUT, `ustc-${LANG.toLowerCase()}-editions.jsonl`);
const EPI_MIN = process.env.WG_EPITHETS === "1" ? 10 : Infinity, EPI_SHARE = 0.3, EPI_OWN = 0.5; // epithet = in ≥30% of a ≥10-node author's titles AND ≥50% of the token's corpus occurrences
const readJsonl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const orth = (s) => (s || '').replace(/[vV]/g, 'u').replace(/[jJ]/g, 'i');

const K = Number(process.env.WG_K ?? 6);            // leading distinctive tokens compared (title pages run on; the head names the work)
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
      .eq('language_1', LANG).gte('year', 1400).lte('year', 1700)
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
  console.log(`Loading USTC ${LANG} editions…`);
  const eds = await pullEditions();
  console.log(`  ${eds.length} editions`);
  // external translated works (phase 1, external sources only) whose ORIGINAL is in LANG
  const extWorks = readJsonl(path.join(OUT, 'external-translation-works.jsonl')).filter((w) => w.orig_lang === LANG.toLowerCase());
  // Latin only: phase-3 cluster priors (one external work → every cluster its title fits;
  // n=1000-validated at 79% precision). Kept beside the x-node signal, which is
  // one-to-one and so lower-recall; the report gives both and their union.
  const priorFile = path.join(OUT, 'cluster-external-priors.jsonl');
  const priorClusters = LANG === 'Latin' && fs.existsSync(priorFile) ? new Set(readJsonl(priorFile).map((r) => r.work_cluster_id)) : new Set();

  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const langs = [LANG, ...(LANG_CODES[LANG] || [])];
  const books = await c.db('bookstore').collection('books').find(
    { $or: [{ language: { $in: langs } }, { languages: { $in: langs } }], pages_count: { $gt: 0 } },
    { projection: { id: 1, slug: 1, title: 1, author: 1, ustc_id: 1, visible: 1, pages_count: 1, pages_blank: 1, pages_translated: 1 } },
  ).toArray();
  await c.close();
  console.log(`  ${books.length} SL ${LANG} books | ${extWorks.length} external translated works`);

  // --- nodes: u = USTC edition, s = SL book, x = external English translation ---
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
  // EPITHETS: a token in most of a prolific author's titles that hardly occurs
  // elsewhere names the AUTHOR, not a work (Javelli's "Canapicii", "Abelii
  // Sammarthani Scaevolae filii") — it merged distinct works. Dropped from that
  // author's comparisons. Authors with < EPI_MIN nodes are untouched, so
  // single-work authors still merge.
  const bucket = new Map(); // stem → { n, cnt: Map(token → nodes) }
  for (const n of nodes) for (const s of n.stems) {
    if (!bucket.has(s)) bucket.set(s, { n: 0, cnt: new Map() });
    const b = bucket.get(s); b.n++;
    for (const t of n.toks.slice(0, K)) b.cnt.set(t, (b.cnt.get(t) || 0) + 1);
  }
  let epithets = 0;
  const epi = new Map(); // stem → Set(token)
  for (const [s, b] of bucket) {
    if (b.n < EPI_MIN) continue;
    for (const [t, c] of b.cnt) if (c / b.n >= EPI_SHARE && c / Math.max(1, df.get(t) || 0) >= EPI_OWN) {
      if (!epi.has(s)) epi.set(s, new Set());
      epi.get(s).add(t); epithets++;
    }
  }
  for (const n of nodes) {
    const drop = (t) => n.stems.some((s) => epi.get(s)?.has(t));
    n.head = n.toks.slice(0, K).filter((t) => idf(t) >= FLOOR_IDF && !drop(t));
    n.w = n.head.reduce((s, t) => s + idf(t), 0);
    n.set = new Set(n.head);
  }
  console.log(`  epithet tokens suppressed: ${epithets}`);

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
    if (n.stems.length || linked.has(i)) return;
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
  const order = nodes.map((n, i) => i).filter((i) => nodes[i].w > 0 && nodes[i].stems.length && !linked.has(i));
  order.sort((a, b) => nodes[a].w - nodes[b].w || nodes[b].k.localeCompare(nodes[a].k));
  const leaderIdx = new Map(); // "stem|token" → leader node ids
  let leaders = 0, joins = 0, scored = 0;
  for (let o = 0; o < order.length; o++) {
    if (o % 100000 === 0 && o) console.log(`  leader pass ${o}/${order.length}…`);
    const i = order[o], a = nodes[i];
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
    if (best >= 0) { union(i, best); joins++; continue; }
    leaders++;
    for (const s of a.stems) for (const t of a.head) if (idf(t) >= MID_IDF) {
      const key = s + '|' + t;
      if (!leaderIdx.has(key)) leaderIdx.set(key, []);
      leaderIdx.get(key).push(i);
    }
  }
  console.log(`direct ${direct} | anon nodes ${anon} | leaders ${leaders} | joins ${joins} | leader comparisons ${scored}`);
  const root = (i) => find(i);

  // --- components ---
  const comp = new Map();
  nodes.forEach((n, i) => { const r = root(i); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(i); });
  const rank = { readable: 2, partial: 1, none: 0 };
  const works = [];
  for (const [r, mem] of comp) {
    const u = mem.filter((i) => nodes[i].k === 'u'), s = mem.filter((i) => nodes[i].k === 's');
    const extNode = mem.some((i) => nodes[i].k === 'x');
    const extCluster = u.some((i) => priorClusters.has(nodes[i].ref.work_cluster_id));
    const ext = extNode || extCluster;
    const sl = s.reduce((a, i) => (rank[bookStatus(nodes[i].ref)] > rank[a] ? bookStatus(nodes[i].ref) : a), s.length ? 'none' : null);
    const years = u.map((i) => nodes[i].ref.year).filter(Boolean);
    works.push({ r, u: u.length, s: s.length, ext, extNode, extCluster, sl, year_min: years.length ? Math.min(...years) : null,
      old_clusters: new Set(u.map((i) => nodes[i].ref.work_cluster_id)).size,
      title: nodes[u[0] ?? s[0] ?? mem[0]].title.slice(0, 140), author: nodes[u[0] ?? s[0] ?? mem[0]].author, mem });
  }
  const ustcWorks = works.filter((w) => w.u > 0);
  const extMatched = ustcWorks.reduce((s, w) => s + w.mem.filter((i) => nodes[i].k === 'x').length, 0);
  console.log(`external translated works that landed on a USTC work: ${extMatched}/${extWorks.length} | works with ext via node ${ustcWorks.filter((w) => w.extNode).length}, via cluster prior ${ustcWorks.filter((w) => w.extCluster).length}, either ${ustcWorks.filter((w) => w.ext).length}`);
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
    const tt = [...new Set(w.mem.map((i) => nodes[i].title.slice(0, 110)))];
    sample.push({ author: w.author, editions: w.u, titles: [tt[0], tt[Math.floor(rnd() * tt.length)]] });
  }

  const report = {
    generated: new Date().toISOString().slice(0, 10), issue: '#7751',
    params: { K, CONTAIN, STRONG_IDF, MID_IDF, FLOOR_IDF },
    lang: LANG, nodes: { ustc_editions: eds.length, sl_books: books.length, external_works: extWorks.length, external_matched: extMatched },
    edges: { direct, leaders, joins, anon_nodes: anon },
    works_with_ustc: ustcWorks.length, old_clusters: new Set(eds.map((e) => e.work_cluster_id)).size,
    sl_only_works: works.length - ustcWorks.length,
    editions_per_work: sizes, gold: goldOut,
    held: grid(ustcWorks, 'none'), translated_any: grid(ustcWorks, 'partial'), readable: grid(ustcWorks, 'readable'),
    readable_by_century: byCentury('readable'),
    biggest_works: biggest, over_merge_sample: sample,
  };
  fs.writeFileSync(path.join(OUT, `work-graph-report${SUFFIX}.json`), JSON.stringify(report, null, 2));
  const w1 = fs.createWriteStream(path.join(OUT, `work-graph${SUFFIX}.jsonl`));
  for (const w of works) w1.write(JSON.stringify({ work: w.r, ustc_sns: w.mem.filter((i) => nodes[i].k === 'u').map((i) => nodes[i].ref.sn), sl_books: w.mem.filter((i) => nodes[i].k === 's').map((i) => nodes[i].ref.id), ext: w.ext, sl: w.sl, year_min: w.year_min, author: w.author, title: w.title }) + '\n');
  w1.end();
  for (const [k, g] of Object.entries({ held: report.held, translated_any: report.translated_any, readable: report.readable, ...Object.fromEntries(Object.entries(report.readable_by_century).map(([a, b]) => [`readable ${a}`, b])) })) {
    console.log(`${k}: of ${g.works} works — SL ${g.sl} (${g.sl_pct}%), external ${g.external} (${g.external_pct}%), grid ${JSON.stringify(g.grid)}`);
  }
  console.log('editions/work:', sizes);
  console.log('wrote work-graph.jsonl + work-graph-report.json');
}

main().catch((e) => { console.error(e); process.exit(1); });

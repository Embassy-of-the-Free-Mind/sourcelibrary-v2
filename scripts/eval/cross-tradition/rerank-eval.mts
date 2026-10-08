/**
 * PRIOR ART: scripts/eval/embed-granularity/run-arms.mjs + score.mjs (#6173) — rank the
 * 12K-page pilot pool under each arm with an inline `quota`/`mmr` and score against the
 * by-eye judgments; scripts/eval/embed-format/score.mjs (#6170) — recall@10 on the two
 * known-item gold sets. Neither runs the PRODUCTION re-ranker (src/lib/search/diversity.ts)
 * with the stored `books.tradition` labels, and neither asks both questions of one setting.
 *
 * rerank-eval — does the shipped diversity re-rank raise traditions in the top 10 on the
 * pilot's 25 concept queries without losing known items?
 *
 *   concept     the #6173 pool, stored page vectors (arm `a`), the top K by cosine (K = 40 is
 *               what `match_semantic` returns at ef_search 40), re-ranked, scored with the
 *               pilot's gold + judgments. A top-10 page no judge read counts as not relevant
 *               and is reported as `unjudged`.
 *   known-item  the #6170 pools: A = the 40 #5729 queries (one gold page), B = the Librarian
 *               golden set (a page of any expected book), stored vectors, `covered` view.
 *
 * Free: stored vectors and stored query vectors only.
 *
 *   node --env-file=.env.production.local node_modules/.bin/tsx scripts/eval/cross-tradition/rerank-eval.mts \
 *     --pilot /data/scratch/sl/claude-jobs/embed-granularity-research-work \
 *     --format /data/scratch/sl/claude-jobs/embed-format-eval-work [--json results/<date>-rerank.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { diversify, defaultDiversity, traditionFamily, type BookFacets, type DiversityMode } from '../../../src/lib/search/diversity';

/** Mirrors DIVERSITY_MARGIN in src/lib/search/concept-search.ts (that file imports the database clients). */
const DIVERSITY_MARGIN = 0.02;

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(k); return i === -1 ? d : argv[i + 1]; };
const PILOT = arg('--pilot')!, FORMAT = arg('--format')!, OUT = arg('--json');
const here = path.dirname(fileURLToPath(import.meta.url));
const DIMS = 768;
const readJsonl = (f: string) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const f32 = (f: string) => { const b = fs.readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

function cosineAll(vecs: Float32Array, q: ArrayLike<number>): Float32Array {
  const n = vecs.length / DIMS; const out = new Float32Array(n);
  let qn = 0; for (let d = 0; d < DIMS; d++) qn += q[d] * q[d]; qn = Math.sqrt(qn) || 1;
  for (let i = 0; i < n; i++) {
    let s = 0, m = 0; const o = i * DIMS;
    for (let d = 0; d < DIMS; d++) { const x = vecs[o + d]; s += x * q[d]; m += x * x; }
    out[i] = m ? s / (Math.sqrt(m) * qn) : -2;
  }
  return out;
}
const topK = (sc: Float32Array, cand: number[], k: number) => [...cand].sort((x, y) => sc[y] - sc[x]).slice(0, k);

// ── data ────────────────────────────────────────────────────────────────
const pilotPool = readJsonl(path.join(PILOT, 'pool.jsonl'));
const va = f32(path.join(PILOT, 'vec-a.f32'));
const qv = JSON.parse(fs.readFileSync(path.join(PILOT, 'q-vecs.json'), 'utf8'));
const pilotLabels = JSON.parse(fs.readFileSync(path.join(PILOT, 'labels.json'), 'utf8'));
const gold = JSON.parse(fs.readFileSync(path.join(here, '../embed-granularity/gold.json'), 'utf8')).queries;
const judged = JSON.parse(fs.readFileSync(path.join(here, '../embed-granularity/results/judgments.json'), 'utf8'));

const Q = JSON.parse(fs.readFileSync(path.join(FORMAT, 'queries.json'), 'utf8'));
function loadKnown(pool: 'A' | 'B') {
  const rows = readJsonl(path.join(FORMAT, pool, 'pool.jsonl'));
  const mask: number[] = JSON.parse(fs.readFileSync(path.join(FORMAT, pool, 'stored-mask.json'), 'utf8'));
  const cand = rows.map((_: unknown, i: number) => i).filter((i: number) => mask[i] === 1);
  const covered = new Set(cand);
  let queries: { id: string; text: string; gold: Set<number> }[];
  if (pool === 'A') {
    const index = new Map(rows.map((r: any, i: number) => [`${r.book_id}:${r.page_number}`, i]));
    queries = JSON.parse(fs.readFileSync(path.join(here, '../orig-lang-recall/gold.json'), 'utf8')).queries
      .map((q: any) => ({ id: q.qid, text: q.query, gold: new Set([index.get(`${q.book_id}:${q.page_number}`) as number]) }));
  } else {
    queries = JSON.parse(fs.readFileSync(path.join(here, '../librarian-search/golden-set.json'), 'utf8')).queries.map((q: any) => {
      const slugs = new Set(q.expected.map((e: any) => e.book_slug));
      return { id: q.id, text: q.query ?? q.question, gold: new Set(rows.map((r: any, i: number) => (slugs.has(r.slug) ? i : -1)).filter((i: number) => i >= 0)) };
    });
  }
  queries = queries.map((q) => ({ ...q, gold: new Set([...q.gold].filter((i) => covered.has(i))) })).filter((q) => q.gold.size);
  return { rows, cand, queries, vecs: f32(path.join(FORMAT, pool, 'stored.f32')), qvecs: Q[pool]['preview-plain'] };
}
const known = { A: loadKnown('A'), B: loadKnown('B') };

// Facets as production reads them: books.tradition, work_id, author_id, author.
const bookIds = [...new Set([...pilotPool, ...known.A.rows, ...known.B.rows].map((r: any) => r.book_id))];
const client = new MongoClient(process.env.MONGODB_URI!); await client.connect();
const facets = new Map<string, BookFacets>();
for (let i = 0; i < bookIds.length; i += 500) {
  const docs = await client.db(process.env.MONGODB_DB || 'bookstore').collection('books')
    .find({ id: { $in: bookIds.slice(i, i + 500) } }, { projection: { _id: 0, id: 1, tradition: 1, work_id: 1, author_id: 1, author: 1 } }).toArray();
  for (const d of docs) facets.set(d.id, d as BookFacets);
}
await client.close();
const labelled = bookIds.filter((b) => (facets.get(b)?.tradition?.length ?? 0) > 0).length;
console.log(`books in the three pools: ${bookIds.length}; with books.tradition: ${labelled}`);
console.log(`default policy leaves the re-rank on for ${gold.filter((q: any) => defaultDiversity(q.query) !== 'off').length} of ${gold.length} pilot concept queries; off for: ${gold.filter((q: any) => defaultDiversity(q.query) === 'off').map((q: any) => q.query).join(' | ') || '—'}`);

// ── settings ────────────────────────────────────────────────────────────
type Setting = { name: string; mode: DiversityMode; perTradition?: number; margin?: number; policy?: boolean };
const SETTINGS: Setting[] = [
  { name: 'off (today)', mode: 'off' },
  { name: 'quota 2, no margin', mode: 'tradition', perTradition: 2 },
  { name: 'quota 3, no margin', mode: 'tradition', perTradition: 3 },
  { name: 'quota 2, margin 0.005', mode: 'tradition', perTradition: 2, margin: 0.005 },
  { name: 'quota 2, margin 0.01', mode: 'tradition', perTradition: 2, margin: 0.01 },
  { name: 'quota 2, margin 0.015', mode: 'tradition', perTradition: 2, margin: 0.015 },
  { name: 'quota 2, margin 0.02', mode: 'tradition', perTradition: 2, margin: 0.02 },
  { name: 'quota 2, margin 0.03', mode: 'tradition', perTradition: 2, margin: 0.03 },
  { name: 'quota 3, margin 0.02', mode: 'tradition', perTradition: 3, margin: 0.02 },
  { name: 'author, margin 0.01', mode: 'author', margin: 0.01 },
  { name: 'default policy, quota 2, no margin', mode: 'tradition', perTradition: 2, policy: true },
  { name: 'default policy, quota 2, margin 0.03', mode: 'tradition', perTradition: 2, margin: 0.03, policy: true },
  { name: 'SHIPPED: default policy, quota 2, margin 0.02', mode: 'tradition', perTradition: 2, margin: DIVERSITY_MARGIN, policy: true },
];
function rerank(list: number[], sc: Float32Array, rows: any[], s: Setting, query: string): number[] {
  const mode = s.policy ? defaultDiversity(query) : s.mode;
  return diversify(list, { mode, bookId: (i) => rows[i].book_id, facets, perTradition: s.perTradition, score: (i) => sc[i], margin: s.margin });
}

// ── concept: the pilot ──────────────────────────────────────────────────
function scoreConcept(K: number, s: Setting) {
  const m = { rel_trad: [] as number[], p10: [] as number[], fam10: [] as number[], share: [] as number[], books10: [] as number[], works_over2: 0, unjudged: 0, le1: 0 };
  for (const q of gold) {
    const sc = cosineAll(va, qv[q.qid][0]);
    const base = topK(sc, pilotPool.map((_: unknown, i: number) => i), K);
    const top10 = rerank(base, sc, pilotPool, s, q.query).slice(0, 10);
    const g = new Map<number, string>(q.passages.map((p: any) => [p.i, p.tradition]));
    const j = judged[q.qid] || {};
    const relTrad = new Set<string>(); let rel = 0;
    for (const i of top10) {
      let t: string | null = null;
      if (g.has(i)) t = g.get(i)!; else if (j[i]) { if (j[i].g === 2) t = j[i].t; } else m.unjudged++;
      if (t) { rel++; if (t !== 'other') relTrad.add(t); }
    }
    const fams = top10.map((i) => traditionFamily(facets.get(pilotPool[i].book_id)?.tradition) ?? 'unlabelled');
    const counts: Record<string, number> = {}; for (const f of fams) counts[f] = (counts[f] || 0) + 1;
    m.rel_trad.push(relTrad.size); m.p10.push(rel / 10); m.fam10.push(Object.keys(counts).length);
    m.share.push(Math.max(...Object.values(counts)) / 10); m.books10.push(new Set(top10.map((i) => pilotPool[i].book_id)).size);
    if (relTrad.size <= 1) m.le1++;
  }
  return m;
}
// Sensitivity: the same re-rank keyed on the pilot's by-eye shelf labels instead of books.tradition.
function relTradWithPilotLabels(K: number, cap: number) {
  const out: number[] = [];
  for (const q of gold) {
    const sc = cosineAll(va, qv[q.qid][0]);
    const base = topK(sc, pilotPool.map((_: unknown, i: number) => i), K);
    const n: Record<string, number> = {}; const head: number[] = [];
    for (const i of base) { const t = pilotLabels[pilotPool[i].book_id]; if ((n[t] || 0) < cap) { n[t] = (n[t] || 0) + 1; head.push(i); } }
    const g = new Map<number, string>(q.passages.map((p: any) => [p.i, p.tradition])); const j = judged[q.qid] || {};
    const rt = new Set<string>();
    for (const i of head.slice(0, 10)) { const t = g.has(i) ? g.get(i)! : j[i]?.g === 2 ? j[i].t : null; if (t && t !== 'other') rt.add(t); }
    out.push(rt.size);
  }
  return mean(out);
}

// ── known-item ──────────────────────────────────────────────────────────
function scoreKnown(set: typeof known.A, K: number, s: Setting) {
  let hits = 0, top1 = 0, offByPolicy = 0;
  const lost: string[] = [], gained: string[] = [];
  for (const q of set.queries) {
    const sc = cosineAll(set.vecs, set.qvecs[q.id]);
    const base = topK(sc, set.cand, K);
    if (s.policy && defaultDiversity(q.text) === 'off') offByPolicy++;
    const out = rerank(base, sc, set.rows, s, q.text);
    const rank = out.findIndex((i) => q.gold.has(i)) + 1;
    const rank0 = base.findIndex((i) => q.gold.has(i)) + 1;
    if (rank > 0 && rank <= 10) hits++;
    if (rank === 1) top1++;
    if (rank0 > 0 && rank0 <= 10 && !(rank > 0 && rank <= 10)) lost.push(q.id);
    if (!(rank0 > 0 && rank0 <= 10) && rank > 0 && rank <= 10) gained.push(q.id);
  }
  return { n: set.queries.length, hits, recall: hits / set.queries.length, top1, lost, gained, offByPolicy };
}

const result: any = { date: new Date().toISOString().slice(0, 10), books: bookIds.length, labelled, concept: {}, known: {} };
for (const K of [40, 100]) {
  console.log(`\n### concept, 25 pilot queries, candidates = top ${K} by cosine`);
  console.log('| setting | rel_trad@10 | P@10 | queries with ≤ 1 relevant tradition | families@10 (any page) | largest family share | books@10 | unjudged slots |\n|---|---|---|---|---|---|---|---|');
  result.concept[K] = {};
  for (const s of SETTINGS) {
    const m = scoreConcept(K, s);
    const row = { rel_trad: +mean(m.rel_trad).toFixed(2), p10: +mean(m.p10).toFixed(3), le1: m.le1, fam10: +mean(m.fam10).toFixed(2), share: +mean(m.share).toFixed(2), books10: +mean(m.books10).toFixed(1), unjudged: m.unjudged, per_query_rel_trad: m.rel_trad };
    result.concept[K][s.name] = row;
    console.log(`| ${s.name} | ${row.rel_trad.toFixed(2)} | ${row.p10.toFixed(2)} | ${row.le1} | ${row.fam10.toFixed(2)} | ${row.share.toFixed(2)} | ${row.books10} | ${row.unjudged} of 250 |`);
  }
  // Paired by query against today's order, 95% bootstrap interval (seed 3514).
  const base = result.concept[K]['off (today)'].per_query_rel_trad as number[];
  const rng = makeRng(3514);
  console.log('\n| setting − off | rel_trad@10 diff | 95% CI | queries better / worse |\n|---|---|---|---|');
  for (const s of SETTINGS.slice(1)) {
    const d = (result.concept[K][s.name].per_query_rel_trad as number[]).map((v, k) => v - base[k]);
    const boots: number[] = [];
    for (let b = 0; b < 10000; b++) { let sum = 0; for (let k = 0; k < d.length; k++) sum += d[Math.floor(rng() * d.length)]; boots.push(sum / d.length); }
    boots.sort((x, y) => x - y);
    const ci = { diff: +mean(d).toFixed(2), lo: +boots[250].toFixed(2), hi: +boots[9750].toFixed(2), better: d.filter((v) => v > 0).length, worse: d.filter((v) => v < 0).length };
    result.concept[K][s.name].vs_off = ci;
    console.log(`| ${s.name} | ${ci.diff >= 0 ? '+' : ''}${ci.diff.toFixed(2)} | [${ci.lo.toFixed(2)}, ${ci.hi.toFixed(2)}] | ${ci.better} / ${ci.worse} |`);
  }
  result.concept[K].pilot_label_quota2 = +relTradWithPilotLabels(K, 2).toFixed(2);
  console.log(`(same candidates, quota 2 on the pilot's by-eye shelf labels: rel_trad@10 ${result.concept[K].pilot_label_quota2})`);
}
for (const [name, set] of Object.entries(known)) {
  console.log(`\n### known-item ${name}: ${set.queries.length} queries, ${set.cand.length} pages, candidates = top 40`);
  console.log('| setting | recall@10 | Δ vs off | top-1 | lost | gained |\n|---|---|---|---|---|---|');
  result.known[name] = {};
  let base = 0;
  for (const s of SETTINGS) {
    const r = scoreKnown(set, 40, s);
    if (s.mode === 'off') base = r.recall;
    result.known[name][s.name] = r;
    console.log(`| ${s.name} | ${r.recall.toFixed(3)} (${r.hits}/${r.n}) | ${(r.recall - base >= 0 ? '+' : '') + (r.recall - base).toFixed(3)} | ${r.top1} | ${r.lost.join(' ') || '—'} | ${r.gained.join(' ') || '—'}${s.policy ? ` (policy: off for ${r.offByPolicy} of ${r.n})` : ''} |`);
  }
}
if (OUT) fs.writeFileSync(path.resolve(here, OUT), JSON.stringify(result, null, 1) + '\n');

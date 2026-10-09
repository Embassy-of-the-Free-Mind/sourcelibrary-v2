/**
 * PRIOR ART: live-spread.mts in this directory — the 25 pilot queries through
 * production's page lane, counting label families, with no relevance judging and no
 * concept lane. scripts/eval/embed-granularity/run-arms.mjs + score.mjs — the #6173
 * pilot, judged, but over a 12K-page scratch pool with in-memory vectors, not the
 * stores. Neither can score the stage-1 `page_concepts` lane as production reads it.
 *
 * concept-lane-stage1 — the #6173 stage-1 re-test. The pilot's 25 concept queries
 * through the production code path (`conceptPageSearch`), five lists of ten each:
 *   page_all      page vectors, whole library, tradition spread on (search today)
 *   page_s1       page vectors, only the 1,216 stage-1 books, spread off
 *   page_s1_div   the same, spread on
 *   concept       concept-abstract lane (the same 1,216 books), spread off
 *   concept_div   the same, spread on
 * `page_s1` is the like-for-like control: the same books, the other index. Production
 * has no exact search inside 1,216 books (`match_pages_in_scope` is bounded work with
 * 67–84% recall), so the control reads `page_translations` directly: the HNSW index
 * with pgvector's iterative scan and a `book_id = ANY(...)` filter, 40 candidates,
 * then the same steps `conceptPageSearch` applies (live books only, `diversify` with
 * DIVERSITY_MARGIN).
 *
 *   retrieve  → results/<date>-concept-lane-stage1-lists.json and a judging queue
 *               (pages in book order, no arm and no rank)
 *   score     → reads the judgments, prints the table, writes …-score.json
 *
 * Relevant = a gold passage (gold.json) or by-eye grade 2. Tradition = the family of
 * `books.tradition` (`traditionFamily`), the label production's re-rank uses. These
 * are NOT the pilot's eight by-eye shelf labels, so the numbers do not line up with
 * the pilot's 1.68 / 2.80; the comparison is between the lists here.
 *
 * Cost: 25 query embeddings per run (a fraction of a cent, the app's own metered path).
 *
 *   node --env-file=.env.production.local node_modules/.bin/tsx scripts/eval/cross-tradition/concept-lane-stage1.mts retrieve --dir D
 *   node --env-file=.env.production.local node_modules/.bin/tsx scripts/eval/cross-tradition/concept-lane-stage1.mts score --dir D
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { conceptPageSearch, DIVERSITY_MARGIN } from '../../../src/lib/search/concept-search';
import { GLOBAL_SCOPE } from '../../../src/lib/tenant-search-scope';
import { diversify, traditionFamily } from '../../../src/lib/search/diversity';
import { loadBookFacets } from '../../../src/lib/search/diversity-facets';
import { getQueryEmbedding } from '../../../src/lib/semantic-search';
import { getDb } from '../../../src/lib/mongodb';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const CMD = argv[0];
const arg = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const DIR = arg('--dir')!;
const DATE = arg('--date', new Date().toISOString().slice(0, 10))!;
const OUT = path.join(here, 'results');
const gold = JSON.parse(fs.readFileSync(path.join(here, '../embed-granularity/gold.json'), 'utf8')).queries as any[];
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const ARMS = ['page_all', 'page_s1', 'page_s1_div', 'concept', 'concept_div'] as const;
type Arm = typeof ARMS[number];
const pk = (r: { book_id: string; page_number: number }) => `${r.book_id}:${r.page_number}`;

async function retrieve() {
  const db = await getDb();
  const s1 = [...new Set((await db.collection('concept_abstract_jobs').find({ run: 'concept-abstract-6173-s1', kind: 'generate' }).project({ book_ids: 1 }).toArray()).flatMap((j: any) => j.book_ids || []))] as string[];
  console.log(`${s1.length} stage-1 books`);
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const call = async (q: string, o: Parameters<typeof conceptPageSearch>[2]) => {
    let last: unknown;
    for (let k = 0; k < 4; k++) { try { return await conceptPageSearch(q, 10, o); } catch (e) { last = e; } }
    throw last;
  };
  const shape = (r: any) => ({ book_id: r.book_id, page_number: r.page_number, page_id: r.page_id, score: +Number(r.score).toFixed(4), family: traditionFamily(r.tradition) ?? 'unlabelled', title: r.book_title });
  /** The 40 nearest page vectors inside the stage-1 books, then conceptPageSearch's own steps. */
  const pageS1 = async (q: string) => {
    const emb = await getQueryEmbedding(q);
    if (!emb) throw new Error('no query embedding');
    await client.query('BEGIN');
    await client.query("SET LOCAL hnsw.iterative_scan = 'relaxed_order'; SET LOCAL hnsw.max_scan_tuples = 200000; SET LOCAL hnsw.ef_search = 200; SET LOCAL enable_bitmapscan = off; SET LOCAL enable_sort = off; SET LOCAL statement_timeout = 120000");
    const res = await client.query(
      `SELECT page_id, book_id, page_number, book_title, 1 - (embedding <=> $1::vector) AS score
       FROM page_translations WHERE embedding IS NOT NULL AND book_id = ANY($2::text[])
       ORDER BY embedding <=> $1::vector LIMIT 40`, [JSON.stringify(emb), s1]);
    await client.query('COMMIT');
    let rows = res.rows.map((r) => ({ ...r, score: Number(r.score) })).sort((x, y) => y.score - x.score);
    const lookup = await loadBookFacets(rows.map((r) => r.book_id));
    if (!lookup.ok) throw new Error('book facts unreadable');
    rows = rows.filter((r) => lookup.facets.get(r.book_id)?.live === true).map((r) => ({ ...r, tradition: lookup.facets.get(r.book_id)?.tradition }));
    const div = diversify(rows, { mode: 'tradition', bookId: (r) => r.book_id, facets: lookup.facets, score: (r) => r.score, margin: DIVERSITY_MARGIN });
    return { off: rows.slice(0, 10).map(shape), div: div.slice(0, 10).map(shape), candidates: rows.length };
  };
  const lists: any[] = [];
  for (const q of gold) {
    const per: Record<string, any[]> = {};
    const s = await pageS1(q.query);
    per.page_s1 = s.off; per.page_s1_div = s.div;
    const runs: Partial<Record<Arm, Parameters<typeof conceptPageSearch>[2]>> = {
      page_all: { scope: GLOBAL_SCOPE, diversity: 'tradition' },
      concept: { scope: GLOBAL_SCOPE, diversity: 'off', abstractLane: true },
      concept_div: { scope: GLOBAL_SCOPE, diversity: 'tradition', abstractLane: true },
    };
    for (const arm of ['page_all', 'concept', 'concept_div'] as const) per[arm] = (await call(q.query, runs[arm]!)).rows.map(shape);
    lists.push({ qid: q.qid, query: q.query, s1_candidates: s.candidates, arms: per });
    console.log(`${q.qid} ${ARMS.map((a) => `${a} ${per[a].length}/${new Set(per[a].map((r) => r.family)).size}f`).join(' | ')}`);
  }
  await client.end();
  fs.writeFileSync(path.join(OUT, `${DATE}-concept-lane-stage1-lists.json`), JSON.stringify({ date: DATE, stage1_books: s1.length, arms: ARMS, lists }, null, 1) + '\n');

  // The judging queue: every non-gold page of any list, per query, in book order.
  const queue: any[] = [];
  for (const l of lists) {
    const goldKeys = new Set(gold.find((g) => g.qid === l.qid).passages.map(pk));
    const seen = new Map<string, any>();
    for (const arm of ARMS) for (const r of l.arms[arm]) if (!goldKeys.has(pk(r)) && !seen.has(pk(r))) seen.set(pk(r), r);
    const pages = [...seen.values()].sort((a, b) => pk(a).localeCompare(pk(b)));
    const texts = new Map<string, string>();
    const { pageEmbeddingInput } = await import('../../lib/page-embedding-text.mjs' as string);
    for (const p of await db.collection('pages').find({ id: { $in: pages.map((r) => r.page_id) } }).project({ id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 }).toArray()) {
      texts.set(String(p.id), pageEmbeddingInput(p)?.text ?? '');
    }
    queue.push({ qid: l.qid, query: l.query, pages: pages.map((r) => ({ key: pk(r), title: r.title, page_number: r.page_number, text: (texts.get(r.page_id) || '').slice(0, 2500) })) });
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'judge-queue.json'), JSON.stringify(queue));
  console.log(`queue: ${queue.reduce((s, q) => s + q.pages.length, 0)} pages to judge → ${DIR}/judge-queue.json`);
}

function score() {
  const { lists, stage1_books } = JSON.parse(fs.readFileSync(path.join(OUT, `${DATE}-concept-lane-stage1-lists.json`), 'utf8'));
  // judgments: { "<qid>": { "<book_id>:<page_number>": 0|1|2 } }
  const judged = JSON.parse(fs.readFileSync(path.join(OUT, `${DATE}-concept-lane-stage1-judgments.json`), 'utf8')).judgments as Record<string, Record<string, number>>;
  let unjudged = 0;
  const per = lists.map((l: any) => {
    const goldKeys = new Set(gold.find((g) => g.qid === l.qid).passages.map(pk));
    const rel = (r: any) => { if (goldKeys.has(pk(r))) return true; const g = judged[l.qid]?.[pk(r)]; if (g == null) unjudged++; return g === 2; };
    const m: Record<string, any> = {};
    for (const arm of ARMS) {
      const rows = l.arms[arm] as any[];
      const relRows = rows.filter(rel);
      m[arm] = {
        rel_trad: new Set(relRows.map((r) => r.family).filter((f) => f !== 'unlabelled')).size,
        p10: relRows.length / 10,
        trad: new Set(rows.map((r) => r.family).filter((f: string) => f !== 'unlabelled')).size,
        books: new Set(rows.map((r) => r.book_id)).size,
        gold: rows.filter((r) => goldKeys.has(pk(r))).length,
      };
    }
    return { qid: l.qid, query: l.query, ...m };
  });
  // Paired bootstrap over the 25 queries, 10,000 resamples, seed 6173 (the pilot's).
  let seed = 6173; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const ci = (d: number[]) => { const ms: number[] = []; for (let b = 0; b < 10000; b++) { let s = 0; for (let k = 0; k < d.length; k++) s += d[Math.floor(rnd() * d.length)]; ms.push(s / d.length); } ms.sort((a, b) => a - b); return [+ms[250].toFixed(2), +ms[9750].toFixed(2)]; };
  const summary: Record<string, any> = {};
  for (const arm of ARMS) summary[arm] = { rel_trad_at_10: +mean(per.map((p: any) => p[arm].rel_trad)).toFixed(2), p_at_10: +mean(per.map((p: any) => p[arm].p10)).toFixed(3), trad_at_10_any_page: +mean(per.map((p: any) => p[arm].trad)).toFixed(2), books_at_10: +mean(per.map((p: any) => p[arm].books)).toFixed(1), queries_le1_rel_trad: per.filter((p: any) => p[arm].rel_trad <= 1).length, gold_in_top10: +mean(per.map((p: any) => p[arm].gold)).toFixed(2) };
  const diff = (a: Arm, b: Arm, k: 'rel_trad' | 'p10') => { const d = per.map((p: any) => p[a][k] - p[b][k]); return { mean: +mean(d).toFixed(k === 'p10' ? 3 : 2), ci95: ci(d), better: d.filter((x: number) => x > 0).length, worse: d.filter((x: number) => x < 0).length }; };
  const diffs = {
    'concept − page_s1 (rel_trad)': diff('concept', 'page_s1', 'rel_trad'), 'concept − page_s1 (P@10)': diff('concept', 'page_s1', 'p10'),
    'concept_div − page_s1_div (rel_trad)': diff('concept_div', 'page_s1_div', 'rel_trad'), 'concept_div − page_s1_div (P@10)': diff('concept_div', 'page_s1_div', 'p10'),
    'concept_div − page_all (rel_trad)': diff('concept_div', 'page_all', 'rel_trad'), 'concept_div − page_all (P@10)': diff('concept_div', 'page_all', 'p10'),
  };
  console.log(JSON.stringify({ summary, diffs, unjudged_slots: unjudged }, null, 1));
  fs.writeFileSync(path.join(OUT, `${DATE}-concept-lane-stage1-score.json`), JSON.stringify({ date: DATE, stage1_books, queries: per.length, relevant: 'gold passage or by-eye grade 2', tradition: 'traditionFamily(books.tradition)', unjudged_slots: unjudged, summary, diffs, per_query: per }, null, 1) + '\n');
}

if (CMD === 'retrieve') await retrieve();
else if (CMD === 'score') score();
else { console.error('retrieve | score  --dir D [--date YYYY-MM-DD]'); process.exit(1); }
process.exit(0);

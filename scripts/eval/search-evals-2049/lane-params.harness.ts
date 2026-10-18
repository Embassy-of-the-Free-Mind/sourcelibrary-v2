/**
 * Builds the keyword service's `/lane` request bodies for real logged queries (#2049, eval check 3):
 * the last DAYS of unfiltered English site searches from `search_queries`, distinct, seeded sample of
 * N, each turned into exactly what the route sends (`expandNameQuery`, `rollupTerms`, k 25,
 * variant_k 10, 200 buckets, 30 books). burst.mjs replays them. The queries stay in OUT (scratch).
 *
 * PRIOR ART: scripts/eval/keyword-lane-parity/parity.harness.ts — draws the same kind of sample by
 * stratum and builds the same body inline, then runs Atlas beside it; for a load test only the
 * bodies are wanted, built once, so the load is not paced by Mongo.
 *
 *   OUT=$JOB_SCRATCH/lane-params.jsonl node --env-file=/root/sourcelibrary/.env.production.local \
 *     node_modules/.bin/vitest run --config scripts/eval/search-evals-2049/vitest.config.mts lane-params
 */
import { test } from 'vitest';
import { writeFileSync } from 'node:fs';

test('lane params', async () => {
  const OUT = process.env.OUT;
  if (!OUT) throw new Error('set OUT=<file>');
  const N = +(process.env.N || 200);
  const { expandNameQuery } = await import('@/lib/search/name-variants');
  const { rollupTerms, ROLLUP_BUCKETS } = await import('@/lib/search/page-rollup');
  const { getReadDb } = await import('@/lib/mongodb');
  const db = await getReadDb();
  const since = new Date(Date.now() - (+(process.env.DAYS || 14)) * 86400000);
  const pool = await db.collection('search_queries').aggregate([
    { $match: { ts: { $gte: since }, route: 'search', ok: true, tenant_slug: null, 'filters.book_id': null, 'filters.pages_only': { $ne: true }, 'filters.language': null, 'filters.lang': { $in: ['en', null] } } },
    { $project: { q: { $trim: { input: '$query' } } } },
    { $match: { q: { $regex: /^.{2,200}$/s, $ne: 'undefined' } } },
    { $group: { _id: { $toLower: '$q' }, q: { $first: '$q' } } },
  ], { allowDiskUse: true, maxTimeMS: 120000 }).toArray();
  let a = +(process.env.SEED || 2049) >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const picked = pool.map((p) => ({ p, r: rnd() })).sort((x, y) => x.r - y.r).slice(0, N).map((x) => x.p.q as string);
  const lines: string[] = [];
  for (const query of picked) {
    const { variants, topicWords } = await expandNameQuery(query);
    const terms = rollupTerms(query);
    lines.push(JSON.stringify({ query, k: 25, book_ids: null, variants, topic_words: topicWords, variant_k: 10, rollup: terms ? { terms, buckets: ROLLUP_BUCKETS, max_books: 30 } : null }));
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`pool ${pool.length}; wrote ${lines.length}`);
});

/**
 * Parity of the keyword page service with the Atlas page lane (#6852), on real queries from
 * `search_queries`, against production data. For each query it runs the `/api/search` page lane's
 * Atlas sequence with the route's own building blocks — expandNameQuery, buildPageSearchStage (main,
 * then the name-variant query), rollupTerms → countMatchingPagesByBook → the liveness check →
 * bestPagePerBook — timing each step, and asks the service (`POST /lane` on its local port) the
 * same question. Writes one JSON line per query for score.mjs.
 *
 * PRIOR ART: scripts/eval/search-word-forms/lanes.harness.ts — reads the Atlas page lane on this
 * checkout's code (its stage, its top 25), for word forms; it does not run the variant query or
 * the roll-up and has no second engine. scripts/eval/search-recall/local/route.harness.ts runs the
 * whole handler for 30 fixed queries scored on books. Neither samples logged queries by stratum.
 *
 *   OUT=$JOB_SCRATCH/parity.jsonl KEYWORD_SEARCH_LOCAL=http://127.0.0.1:3461 \
 *     node --env-file=/root/sourcelibrary/.env.production.local node_modules/.bin/vitest run \
 *     --config scripts/eval/keyword-lane-parity/vitest.config.mts parity.harness
 *
 * Env: OUT (required), KEYWORD_SEARCH_LOCAL (the service's local listener), SEED (default 6852),
 * DAYS (default 60), QUOTAS (JSON, default names 50 / phrases 40 / single 50 / non_latin 30 / multi 30).
 * The query sample is drawn here, from unfiltered English `/api/search` rows on the main site, so it
 * is reproducible from the log at a date; the queries themselves stay in OUT (scratch), not in the repo.
 * Reads prod Mongo; writes nothing to any store.
 */
import { test } from 'vitest';
import { writeFileSync, appendFileSync } from 'node:fs';

const QUOTAS: Record<string, number> = JSON.parse(process.env.QUOTAS || '{"names":50,"phrases":40,"single":50,"non_latin":30,"multi":30}');
/** A letter in any script but Latin. */
const NON_LATIN = /[^\P{L}\p{Script=Latin}]/u;

/** Deterministic shuffle (mulberry32), so the same seed draws the same sample from the same pool. */
function shuffle<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

test('keyword lane parity', async () => {
  const OUT = process.env.OUT;
  if (!OUT) throw new Error('set OUT=<file>');
  const LOCAL = process.env.KEYWORD_SEARCH_LOCAL || 'http://127.0.0.1:3461';
  const { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } = await import('@/lib/atlas-search');
  const { expandNameQuery } = await import('@/lib/search/name-variants');
  const { rollupTerms, countMatchingPagesByBook, bestPagePerBook, ROLLUP_BUCKETS } = await import('@/lib/search/page-rollup');
  const { getReadDb } = await import('@/lib/mongodb');
  const db = await getReadDb();

  // ---- the sample ----------------------------------------------------------------------------
  const since = new Date(Date.now() - (+(process.env.DAYS || 60)) * 86400000);
  const pool = await db.collection('search_queries').aggregate([
    { $match: { ts: { $gte: since }, route: 'search', ok: true, tenant_slug: null, 'filters.book_id': null, 'filters.pages_only': { $ne: true },
      'filters.language': null, 'filters.languages.0': { $exists: false }, 'filters.lang': { $in: ['en', null] } } },
    { $project: { q: { $trim: { input: '$query' } }, page: '$stage_ms.page' } },
    { $match: { q: { $regex: /^.{2,200}$/s } } },
    { $group: { _id: { $toLower: '$q' }, q: { $first: '$q' }, n: { $sum: 1 }, page_ms: { $push: '$page' } } },
  ], { allowDiskUse: true, maxTimeMS: 120000 }).toArray();
  const stratumOf = async (q: string) => {
    if (/^".*"$/.test(q)) return 'phrases';
    if (NON_LATIN.test(q)) return 'non_latin';
    if ((await expandNameQuery(q)).variants.length > 0) return 'names';
    return q.trim().split(/\s+/).length === 1 ? 'single' : 'multi';
  };
  const want = { ...QUOTAS };
  const chosen: { q: string; stratum: string; n: number; prod_page_ms: number[] }[] = [];
  for (const row of shuffle(pool, +(process.env.SEED || 6852))) {
    if (Object.values(want).every(v => v <= 0)) break;
    const s = await stratumOf(row.q);
    if ((want[s] ?? 0) <= 0) continue;
    want[s]--;
    chosen.push({ q: row.q, stratum: s, n: row.n, prod_page_ms: (row.page_ms || []).filter((x: unknown) => typeof x === 'number') });
  }
  console.log(`pool ${pool.length} distinct queries since ${since.toISOString()}; drew ${chosen.length}; short: ${JSON.stringify(want)}`);
  writeFileSync(OUT, '');

  // ---- the Atlas lane, as src/app/api/search/route.ts runs it (unfiltered, global, not pages_only) ----
  const PAGE_LIMIT = 25, NAME_VARIANT_PAGE_RESULTS = 10, MAX_ROLLUP_BOOKS = 30;
  const pipeline = (stage: any, max: number) => [
    stage,
    { $match: { page_number: { $gt: 0 }, page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
    { $limit: max },
    { $project: { _id: 0, id: 1, page_number: 1, book_id: 1 } },
  ];
  const timedAt = async <T,>(fn: () => Promise<T>) => { const t = performance.now(); const v = await fn(); return { v, ms: Math.round(performance.now() - t) }; };

  for (const [i, c] of chosen.entries()) {
    const query = c.q;
    const t0 = performance.now();
    const terms = rollupTerms(query);
    const countsP = timedAt(() => terms ? countMatchingPagesByBook(db as any, terms).catch(() => null) : Promise.resolve([] as any[]));
    const exp = await timedAt(() => expandNameQuery(query));
    const { variants, topicWords } = exp.v;
    const [main, vpages, counts] = await Promise.all([
      timedAt(() => db.collection('pages').aggregate(pipeline(buildPageSearchStage(query), PAGE_LIMIT), { maxTimeMS: 30000 }).toArray()),
      timedAt(() => variants.length > 0
        ? db.collection('pages').aggregate(pipeline(buildPageSearchStage(query, undefined, { nameVariants: variants, requireNameVariant: true, requireWords: topicWords }), NAME_VARIANT_PAGE_RESULTS), { maxTimeMS: 30000 }).toArray().catch(() => [])
        : Promise.resolve([] as any[])),
      countsP,
    ]);
    const seen = new Set(main.v.map((p: any) => `${p.book_id}:${p.page_number}`));
    const variantPages = vpages.v.filter((p: any) => !seen.has(`${p.book_id}:${p.page_number}`));
    let extra: any[] = [], liveMs = 0, extraMs = 0, liveCounted: { book_id: string; pages: number }[] = [];
    if (terms && counts.v && counts.v.length) {
      const live = await timedAt(() => db.collection('books').find({ id: { $in: counts.v!.map((x: any) => x.book_id) }, visible: true, pages_count: { $gt: 0 }, hidden: { $ne: true } }).project({ id: 1 }).toArray());
      liveMs = live.ms;
      const liveIds = new Set(live.v.map((b: any) => b.id));
      liveCounted = counts.v.filter((x: any) => liveIds.has(x.book_id));
      const reached = new Set([...main.v, ...variantPages].map((p: any) => p.book_id));
      const toAdd = liveCounted.filter(x => !reached.has(x.book_id)).slice(0, MAX_ROLLUP_BOOKS).map(x => x.book_id);
      const ex = await timedAt(() => bestPagePerBook(db as any, terms, toAdd));
      extra = ex.v.map((p: any) => ({ id: p.id, book_id: p.book_id, page_number: p.page_number })); extraMs = ex.ms;
    }
    const atlasMs = Math.round(performance.now() - t0);

    // ---- the service, same question ----
    const params = {
      query, k: PAGE_LIMIT, book_ids: null, variants, topic_words: topicWords, variant_k: NAME_VARIANT_PAGE_RESULTS,
      rollup: terms ? { terms, buckets: ROLLUP_BUCKETS, max_books: MAX_ROLLUP_BOOKS } : null,
    };
    const s0 = performance.now();
    let svc: any;
    try {
      const r = await fetch(`${LOCAL}/lane`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(30000) });
      svc = r.ok ? await r.json() : { error: `HTTP ${r.status} ${await r.text()}` };
    } catch (e) { svc = { error: String(e) }; }
    const svcHttpMs = Math.round(performance.now() - s0);
    // What serve mode adds after the call: one find by page id for the text (src/lib/keyword-search.ts).
    let hydrateMs: number | null = null;
    if (!svc.error) {
      const ids = [...svc.main, ...svc.variants, ...svc.extra].map((x: any) => x.page_id);
      const h = await timedAt(() => db.collection('pages').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'translation.data': 1, 'ocr.data': 1 } }).toArray());
      hydrateMs = h.ms;
    }

    // Live set for the Atlas side's books (the route drops the rest at its join).
    const atlasBooks = [...new Set([...main.v, ...variantPages, ...extra].map((p: any) => p.book_id as string))];
    const liveAtlas = (await db.collection('books').find({ id: { $in: atlasBooks }, visible: true, pages_count: { $gt: 0 }, hidden: { $ne: true } }).project({ _id: 0, id: 1 }).toArray()).map((b: any) => b.id);

    const key = (p: any) => [p.book_id, p.page_number];
    appendFileSync(OUT, JSON.stringify({
      i, q: query, stratum: c.stratum, n_logged: c.n, prod_page_ms: c.prod_page_ms, variants: variants.length, terms,
      atlas: {
        main: main.v.map(key), variants: variantPages.map(key), extra: extra.map(key), counts: liveCounted.slice(0, 200).map(x => [x.book_id, x.pages]),
        counts_raw_n: counts.v ? counts.v.length : null,
        ms: { total: atlasMs, expand: exp.ms, main: main.ms, variants: vpages.ms, counts: counts.ms, live: liveMs, extra: extraMs },
      },
      live_atlas_books: liveAtlas,
      svc: svc.error ? { error: svc.error, http_ms: svcHttpMs } : {
        main: svc.main.map(key), variants: svc.variants.map(key), extra: svc.extra.map(key), counts: (svc.counts || []).map((x: any) => [x.book_id, x.pages]),
        tokens: svc.tokens, fuzzy: svc.fuzzy_terms, ms: svc.ms, server_ms: svc.server_ms, http_ms: svcHttpMs, hydrate_ms: hydrateMs,
      },
    }) + '\n');
    if (i % 10 === 0) console.log(`${i + 1}/${chosen.length} ${c.stratum} atlas ${atlasMs} ms · svc ${svcHttpMs} ms`);
  }
});

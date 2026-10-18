/**
 * Name-variant panel (#2049, eval check 5; #5888): a reader types one spelling of a person's name
 * ("Drebelius"); do the pages that print the canonical form ("Drebbel") come back? Service against
 * Atlas, both asked the page lane's question the way `src/app/api/search/route.ts` asks it:
 * `expandNameQuery` (shared, app-side) → the main stage (top 25) + the name-variant stage (10,
 * `requireNameVariant`), then the route's live-book drop. The service gets the same variants and
 * topic words in one `POST /lane`.
 *
 * Panel: `entities` persons with the most books whose aliases carry a spelling of the canonical
 * surname (`isSpellingOf`, the same test the expansion uses), one (canonical, variant) pair each,
 * seeded. The query is the variant; a returned page "names the canonical form" when its OCR or
 * translation prints the canonical surname as a whole word (`indexOfWord`).
 *
 * PRIOR ART: scripts/eval/search-recall/ (#5905) — 30 fixed queries, 5 of them spelling variants,
 * scored on BOOKS through the whole route; scripts/eval/keyword-lane-parity/parity.harness.ts — the
 * two lanes compared to each other on logged queries. Neither builds a variant panel from
 * `entities` nor checks that the canonical spelling is on the returned pages.
 *
 *   OUT=$JOB_SCRATCH/name-variants.jsonl KEYWORD_SEARCH_URL=… KEYWORD_SEARCH_TOKEN=… \
 *     node --env-file=/root/sourcelibrary/.env.production.local node_modules/.bin/vitest run \
 *     --config scripts/eval/search-evals-2049/vitest.config.mts name-variants
 *
 * Env: OUT (required), N (default 40), SEED (default 2049). Reads prod Mongo and the service; writes
 * nothing to any store.
 */
import { test } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('name variants', async () => {
  const OUT = process.env.OUT;
  if (!OUT) throw new Error('set OUT=<file>');
  const URL_ = process.env.KEYWORD_SEARCH_URL, TOKEN = process.env.KEYWORD_SEARCH_TOKEN;
  if (!URL_ || !TOKEN) throw new Error('set KEYWORD_SEARCH_URL / KEYWORD_SEARCH_TOKEN');
  const N = +(process.env.N || 40);
  const { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } = await import('@/lib/atlas-search');
  const { expandNameQuery, isSpellingOf, foldName } = await import('@/lib/search/name-variants');
  const { indexOfWord } = await import('@/lib/keyword-search');
  const { getReadDb } = await import('@/lib/mongodb');
  const db = await getReadDb();
  const rnd = mulberry(+(process.env.SEED || 2049));
  writeFileSync(OUT, '');

  // ---- the panel ----
  const people = await db.collection('entities').find(
    { type: 'person', 'aliases.0': { $exists: true }, book_count: { $gte: 3 } },
    { projection: { _id: 0, name: 1, aliases: 1, book_count: 1 } },
  ).sort({ book_count: -1 }).limit(3000).toArray();
  const panel: { canonical: string; surname: string; variant: string; book_count: number; name: string }[] = [];
  const seenSurname = new Set<string>();
  for (const p of people) {
    if (panel.length >= N) break;
    const toks = String(p.name).split(/[\s,]+/).filter((t) => /^\p{L}{5,}$/u.test(t));
    const surname = toks[toks.length - 1];
    if (!surname || seenSurname.has(foldName(surname))) continue;
    const variants = [...new Set((p.aliases as string[]).flatMap((a) => String(a).split(/[\s,]+/)))]
      .filter((t) => /^\p{L}{4,}$/u.test(t) && foldName(t) !== foldName(surname) && isSpellingOf(surname, t));
    if (variants.length === 0) continue;
    seenSurname.add(foldName(surname));
    panel.push({ canonical: p.name, surname, variant: variants[Math.floor(rnd() * variants.length)], book_count: p.book_count, name: p.name });
  }
  console.log(`panel ${panel.length} from ${people.length} persons`);

  const LIVE = { visible: true, pages_count: { $gt: 0 }, hidden: { $ne: true } };
  const pipe = (stage: unknown, max: number) => [
    stage,
    { $match: { page_number: { $gt: 0 }, page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
    { $limit: max },
    { $project: { _id: 0, id: 1, book_id: 1, page_number: 1 } },
  ];

  for (const [i, c] of panel.entries()) {
    const query = c.variant;
    const { variants, topicWords } = await expandNameQuery(query);

    const a0 = performance.now();
    const [main, vpages] = await Promise.all([
      db.collection('pages').aggregate(pipe(buildPageSearchStage(query), 25), { maxTimeMS: 8000 }).toArray(),
      variants.length > 0
        ? db.collection('pages').aggregate(pipe(buildPageSearchStage(query, undefined, { nameVariants: variants, requireNameVariant: true, requireWords: topicWords }), 10), { maxTimeMS: 8000 }).toArray().catch(() => [])
        : Promise.resolve([]),
    ]);
    const atlasMs = Math.round(performance.now() - a0);
    const seen = new Set(main.map((p) => `${p.book_id}:${p.page_number}`));
    const atlasLane = [...main, ...vpages.filter((p) => !seen.has(`${p.book_id}:${p.page_number}`))];
    const live = new Set((await db.collection('books').find({ id: { $in: [...new Set(atlasLane.map((p) => p.book_id))] }, ...LIVE }).project({ _id: 0, id: 1 }).toArray()).map((b) => b.id));
    const atlas = atlasLane.filter((p) => live.has(p.book_id)).map((p) => ({ id: p.id as string, book_id: p.book_id as string, page_number: p.page_number as number, src: seen.has(`${p.book_id}:${p.page_number}`) ? 'main' : 'variant' }));

    const s0 = performance.now();
    let svc: { id: string; book_id: string; page_number: number; src: string }[] = [];
    let svcErr: string | null = null, serverMs: number | null = null;
    try {
      const r = await fetch(`${URL_.replace(/\/+$/, '')}/lane`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ query, k: 25, book_ids: null, variants, topic_words: topicWords, variant_k: 10, rollup: null }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) svcErr = `HTTP ${r.status}`;
      else {
        const j = await r.json(); serverMs = j.server_ms ?? null;
        const sm = new Set(j.main.map((p: any) => `${p.book_id}:${p.page_number}`));
        svc = [...j.main, ...j.variants.filter((p: any) => !sm.has(`${p.book_id}:${p.page_number}`))].map((p: any) => ({ id: p.page_id, book_id: p.book_id, page_number: p.page_number, src: p.src }));
      }
    } catch (e) { svcErr = String((e as Error).message).slice(0, 120); }
    const svcMs = Math.round(performance.now() - s0);

    const docs = await db.collection('pages').find({ id: { $in: [...new Set([...atlas, ...svc].map((p) => p.id))] } }, { projection: { _id: 0, id: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
    const printsCanon = new Set(docs.filter((d) => indexOfWord(d.ocr?.data || '', c.surname) >= 0 || indexOfWord(d.translation?.data || '', c.surname) >= 0).map((d) => d.id));
    const printsVariant = new Set(docs.filter((d) => indexOfWord(d.ocr?.data || '', query) >= 0 || indexOfWord(d.translation?.data || '', query) >= 0).map((d) => d.id));
    const score = (xs: typeof atlas) => ({
      n: xs.length,
      n_variant_src: xs.filter((p) => p.src === 'variant').length,
      canon_pages: xs.filter((p) => printsCanon.has(p.id)).length,
      canon_in_top10: xs.slice(0, 10).some((p) => printsCanon.has(p.id)),
      canon_any: xs.some((p) => printsCanon.has(p.id)),
      variant_pages: xs.filter((p) => printsVariant.has(p.id)).length,
      books: new Set(xs.map((p) => p.book_id)).size,
    });
    const keys = (xs: typeof atlas) => xs.map((p) => `${p.book_id}:${p.page_number}`);
    const sk = new Set(keys(svc));
    appendFileSync(OUT, JSON.stringify({
      i, canonical: c.canonical, surname: c.surname, variant: query, book_count: c.book_count, expanded: variants.length, variants_sample: variants.slice(0, 8), topic_words: topicWords,
      atlas: { ...score(atlas), ms: atlasMs }, svc: { ...score(svc), ms: svcMs, server_ms: serverMs, error: svcErr },
      overlap_lane: atlas.length ? keys(atlas).filter((k) => sk.has(k)).length / atlas.length : null,
    }) + '\n');
    if (i % 10 === 0) console.log(`${i + 1}/${panel.length} ${c.surname}/${query}`);
  }
});

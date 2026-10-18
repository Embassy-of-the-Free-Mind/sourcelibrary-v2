/**
 * The /api/search book lane, part by part (#2049, job book-lane-speed). Samples real site
 * queries from `search_queries` (route `search`, last N days, one row per distinct query,
 * stratified by the logged stage_ms.book) and times each part of the lane as the route runs it:
 *   typed   — Supabase books_catalog with the query as typed
 *   related — the same with word forms folded (#5517), in parallel with typed
 *   ids     — searchBookIds as a whole (max of the two)
 *   mongo   — books.find({ id: { $in } }) with the route's filters and projection
 *   fallback— the regex metadata fallback, when the first two found nothing
 *   snapshot— the same fallback matched in memory (src/lib/search/book-metadata-snapshot.ts),
 *             run beside the Mongo one on every query where it fires; ids compared in order
 * Read-only. No model calls.
 *
 * PRIOR ART: scripts/eval/search-evals-2049/burst.mjs and fallback-latency.mjs time the page
 * services and whole routes; neither splits the book lane. scripts/eval/search-quality-eval.mjs
 * scores result quality, not latency.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local --import tsx \
 *     scripts/eval/search-evals-2049/book-lane.ts --n 40 --out $JOB_SCRATCH/book-lane-before.json
 *   … --queries $JOB_SCRATCH/book-lane-before.json   # re-run the same queries
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { supabase } from '@/lib/supabase';
import { catalogOrFilter } from '@/lib/books-catalog';
import { stemmedQueryRegex } from '@/lib/search/word-forms';
import { matchBookMetadata } from '@/lib/search/book-metadata-snapshot';
// @ts-expect-error — plain-JS module, no declarations
import { makeRng } from '../lib/paired-stats.mjs';

const argv = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const N = +(opt('n', '40') as string);
const DAYS = +(opt('days', '7') as string);
const OUT = opt('out');
const QUERIES = opt('queries');
const LIMIT = 20; // the route's default `limit`; searchBookIds gets limit * 2

const STOPWORDS = new Set(['a', 'an', 'and', 'at', 'by', 'de', 'der', 'des', 'di', 'du', 'el', 'en', 'et', 'for', 'from', 'in', 'la', 'le', 'les', 'of', 'on', 'or', 'the', 'to', 'und', 'von', 'with']);
const PROJECTION = { id: 1, title: 1 };

async function t<T>(fn: () => Promise<T>): Promise<{ v: T; ms: number }> {
  const s = performance.now();
  const v = await fn();
  return { v, ms: Math.round(performance.now() - s) };
}

async function catalogIds(orFilter: string, limit: number): Promise<string[]> {
  const { data, error } = await supabase.from('books_catalog').select('id')
    .gt('pages_count', 0).or(orFilter).limit(limit).eq('visible', true);
  if (error) throw new Error(error.message);
  return (data || []).map((r: { id: string }) => r.id);
}

async function main() {
  const client = await new MongoClient(process.env.MONGODB_URI as string).connect();
  const db = client.db(process.env.MONGODB_DB);

  let sample: Array<{ q: string; logged_book_ms: number }>;
  if (QUERIES) {
    sample = JSON.parse(readFileSync(QUERIES, 'utf8')).rows.map((r: any) => ({ q: r.q, logged_book_ms: r.logged_book_ms }));
  } else {
    // Global, unfiltered searches only: those are the ones where the book lane runs as measured.
    const rows = await db.collection('search_queries').aggregate([
      { $match: {
        route: 'search', ok: true, ts: { $gte: new Date(Date.now() - DAYS * 86400e3) },
        'stage_ms.book': { $gt: 0 },
        'filters.book_id': null, 'filters.pages_only': { $ne: true }, 'filters.language': null,
        'filters.category': null, 'filters.library': null, tenant_id: null,
      } },
      { $group: { _id: { $toLower: { $trim: { input: '$query' } } }, q: { $first: '$query' }, book_ms: { $max: '$stage_ms.book' } } },
      { $match: { _id: { $regex: /^.{2,80}$/ } } },
    ], { maxTimeMS: 60000 }).toArray();
    rows.sort((a, b) => a.book_ms - b.book_ms);
    // Stratify: N/4 from each quartile of the logged book time, seeded pick.
    const rnd = makeRng(2049);
    sample = [];
    for (let k = 0; k < 4; k++) {
      const strat = rows.slice(Math.floor((k * rows.length) / 4), Math.floor(((k + 1) * rows.length) / 4));
      const picked = new Set<number>();
      while (picked.size < Math.min(N / 4, strat.length)) picked.add(Math.floor(rnd() * strat.length));
      for (const i of picked) sample.push({ q: strat[i].q, logged_book_ms: strat[i].book_ms });
    }
    console.error(`pool ${rows.length} distinct queries; sampled ${sample.length}`);
  }

  const bookFilters = { visible: true, pages_count: { $gt: 0 } };
  const load = await t(() => matchBookMetadata(db as any, [/^$/], 1));
  console.error(`snapshot load ${load.ms} ms`);
  const out: any[] = [];
  for (const { q, logged_book_ms } of sample) {
    const isPhrase = /^".*"$/.test(q.trim());
    const searchText = isPhrase ? q.trim().slice(1, -1) : q;
    const typedF = catalogOrFilter(searchText, { isPhrase, authors: false, fold: false });
    const foldedF = catalogOrFilter(searchText, { isPhrase, authors: false, fold: true });
    const lane = await t(async () => {
      const [typed, related] = await Promise.all([
        t(() => catalogIds(typedF, LIMIT * 2)),
        foldedF === typedF ? Promise.resolve(null) : t(() => catalogIds(foldedF, LIMIT * 2).catch(() => [] as string[])),
      ]);
      const seen = new Set(typed.v);
      const ids = [...typed.v, ...(related?.v || []).filter(id => !seen.has(id))].slice(0, LIMIT * 2);
      const mongo = ids.length ? await t(() => db.collection('books').find({ id: { $in: ids }, ...bookFilters })
        .project(PROJECTION).limit(LIMIT).maxTimeMS(5000).toArray()) : { v: [] as any[], ms: 0 };
      let books = mongo.v;
      let fallback: { ms: number; fired: boolean; n: number; error?: string; snapshot_ms?: number; snapshot_ids?: string[]; same?: boolean } = { ms: 0, fired: false, n: 0 };
      if (books.length === 0) {
        const mq = searchText;
        const words = mq.trim().split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()));
        if (words.length >= 2) {
          const rx = words.map(w => stemmedQueryRegex(w));
          try {
            const f = await t(() => db.collection('books').find({
              $and: rx.map(r => ({ $or: [{ categories: r }, { subject_keywords: r }, { language: r }, { title: r }, { display_title: r }] })),
              ...bookFilters,
            }).project(PROJECTION).limit(LIMIT).maxTimeMS(3000).toArray());
            books = f.v;
            const sn = await t(async () => {
              const m = await matchBookMetadata(db as any, rx, LIMIT * 2);
              const rank = new Map((m?.ids || []).map((id, i) => [id, i]));
              return (await db.collection('books').find({ id: { $in: m?.ids || [] }, ...bookFilters }).project(PROJECTION).maxTimeMS(5000).toArray())
                .sort((a: any, b: any) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)).slice(0, LIMIT).map((b: any) => b.id);
            });
            fallback = { ms: f.ms, fired: true, n: f.v.length, snapshot_ms: sn.ms, snapshot_ids: sn.v, same: JSON.stringify(sn.v) === JSON.stringify(f.v.map((b: any) => b.id)) } as any;
          } catch (err) {
            fallback = { ms: 3000, fired: true, n: 0, error: err instanceof Error ? err.message.slice(0, 80) : String(err) };
          }
        }
      }
      const ids_ms = Math.max(typed.ms, related?.ms ?? 0);
      const new_ms = ids_ms + mongo.ms + (fallback.fired ? (fallback.snapshot_ms ?? 0) : 0);
      return { new_ms, typed_ms: typed.ms, related_ms: related?.ms ?? null, n_ids: ids.length, mongo_ms: mongo.ms, fallback, ids: books.map((b: any) => b.id) };
    });
    const row = { q, logged_book_ms, total_ms: lane.ms, ...lane.v };
    out.push(row);
    console.error(`${String(row.total_ms).padStart(5)} typed ${row.typed_ms} related ${row.related_ms} mongo ${row.mongo_ms} fb ${row.fallback.fired ? `${row.fallback.ms} snap ${row.fallback.snapshot_ms} ${row.fallback.same ? 'same' : 'DIFF'}` : '-'} | new ${row.new_ms} | logged ${logged_book_ms} | ${q}`);
  }

  const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
  const summ = (xs: number[]) => ({ n: xs.length, p50: pct(xs, 0.5), p90: pct(xs, 0.9), max: pct(xs, 1) });
  const summary = {
    total: summ(out.map(r => r.total_ms)),
    new_total: summ(out.map(r => r.new_ms)),
    snapshot: summ(out.filter(r => r.fallback.fired).map(r => r.fallback.snapshot_ms)),
    snapshot_load_ms: load.ms,
    fallback_same_ids: out.filter(r => r.fallback.fired && r.fallback.same).length,
    typed: summ(out.map(r => r.typed_ms)),
    related: summ(out.filter(r => r.related_ms != null).map(r => r.related_ms)),
    ids: summ(out.map(r => Math.max(r.typed_ms, r.related_ms ?? 0))),
    mongo: summ(out.filter(r => r.n_ids > 0).map(r => r.mongo_ms)),
    fallback: summ(out.filter(r => r.fallback.fired).map(r => r.fallback.ms)),
    fallback_fired: out.filter(r => r.fallback.fired).length,
    logged: summ(out.map(r => r.logged_book_ms)),
  };
  console.log(JSON.stringify(summary, null, 1));
  if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), summary, rows: out }, null, 1));
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });

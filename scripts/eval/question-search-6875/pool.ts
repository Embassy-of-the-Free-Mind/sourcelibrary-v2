/**
 * Question-shaped search (#6875), step 1: for each question, record the two production baselines and build the
 * candidate pool a re-ranker would read. Read-only (Mongo, Supabase RPC, two public GETs); $0 apart from one
 * query embedding per question.
 *
 *   A  search_translations as served: GET /api/search?pages_only=true (what the MCP tool calls), first 10 non-empty.
 *   B  search_concept as served: GET /api/search/semantic?level=page, first 10 non-empty.
 *   pool  the production keyword lane (buildPageSearchStage, the same Atlas stage /api/search runs) read to POOL_KW
 *         pages instead of its 500 cap, plus the production semantic page lane (semanticPageSearchGlobal) read as deep
 *         as it goes (~90 rows: the RPC stops there whatever k is asked), plus A and B. Visible books with pages only.
 *
 * PRIOR ART: src/app/api/search/route.ts (the lanes themselves, called not copied); scripts/eval/jev/clef-corpus-screen.mjs
 *   (page text loading for a screen). Neither builds a deep pool for one question.
 *
 *   node --env-file=<.env.production.local> node_modules/.bin/tsx scripts/eval/question-search-6875/pool.ts <outdir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@/lib/mongodb';
import { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } from '@/lib/atlas-search';
import { semanticPageSearchGlobal } from '@/lib/semantic-search';
import { stripProvenanceMarks } from '@/lib/provenance';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { stripAiAnnotations } from '@/lib/notes-off';

const POOL_KW = Number(process.env.POOL_KW || 1900);
const TEXT_CHARS = 4000;
// Page text as a reader sees it: the AI continuity note (<meta>Continuity: …</meta>), quality headers and translator's
// notes are cut, so neither the ranker nor the judge is reading our own summary of the page.
const BASE = 'https://sourcelibrary.org';
const OUT = process.argv[2];
if (!OUT) throw new Error('usage: pool.ts <outdir>');
fs.mkdirSync(OUT, { recursive: true });
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8')) as { id: string; q: string }[];

type Hit = { book_id: string; page_number: number };
const key = (h: Hit) => `${h.book_id}:${h.page_number}`;

// The served route marks a response `partial` when a lane timed out (for a long question the keyword page lane often
// does, at ~8 s). A degraded list is not the search at its best, so ask again (up to 4 times) and record every try.
async function served(url: string, pick: (j: any) => Hit[]) {
  const tries: { ms: number; partial: boolean; n: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const t = performance.now();
    const r = await fetch(url, { headers: { 'user-agent': 'SourceLibrary-eval/6875' } });
    const j = await r.json();
    const hits = pick(j);
    tries.push({ ms: Math.round(performance.now() - t), partial: !!j.partial, n: hits.length });
    if (!j.partial || i === 3) return { ms: tries[0].ms, tries, hits };
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error('unreachable');
}

const pickPages = (j: any) => (j.results || []).filter((r: any) => r.snippet?.trim() && r.page_number).slice(0, 10)
  .map((r: any) => ({ book_id: r.book_id, page_number: r.page_number }));

// REFRESH_A=1: re-ask the served keyword search for each built pool and add any new pages to the pool.
async function refreshA(db: Awaited<ReturnType<typeof getDb>>, id: string, q: string) {
  const file = path.join(OUT, `${id}.json`);
  const P = JSON.parse(fs.readFileSync(file, 'utf8'));
  const A = await served(`${BASE}/api/search?q=${encodeURIComponent(q)}&pages_only=true&limit=60`, pickPages);
  for (const p of P.pool) p.lanes = p.lanes.filter((l: string) => l !== 'A');
  const have = new Map(P.pool.map((p: any) => [p.key, p]));
  const add = A.hits.filter((h) => !have.has(key(h)));
  const rows = add.length ? await db.collection('pages').find({ $or: add.map((h) => ({ book_id: h.book_id, page_number: h.page_number })) },
    { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 } }).toArray() : [];
  const books = new Map((await db.collection('books').find({ id: { $in: add.map((h) => h.book_id) } },
    { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, language: 1 } }).toArray()).map((b) => [b.id as string, b]));
  for (const r of rows) {
    const b = books.get(r.book_id) as any; const tr = clean(r.translation?.data || ''); const ocr = clean(r.ocr?.data || '');
    const p = { key: key(r as any), page_id: r.id, book_id: r.book_id, page_number: r.page_number, rank: P.pool.length, lanes: [] as string[],
      title: b?.display_title || b?.title || '', author: b?.author || '', year: b?.published || b?.year || null, language: b?.language || null,
      text_kind: tr.length >= 200 ? 'translation' : 'ocr', text: (tr.length >= 200 ? tr : ocr || tr).slice(0, TEXT_CHARS) };
    if (p.text) { P.pool.push(p); have.set(p.key, p); }
  }
  for (const h of A.hits) (have.get(key(h)) as any)?.lanes.push('A');
  P.A_first = P.A_first || P.A;
  P.A = A;
  fs.writeFileSync(file, JSON.stringify(P));
  console.log(id, 'A refreshed', A.tries.map((t) => `${t.n}${t.partial ? 'p' : ''}/${t.ms}ms`).join(' '), `+${rows.length} pages`);
}

function clean(s: string) {
  return stripAiAnnotations(stripEditorialWrappers(stripProvenanceMarks(s))).replace(/<[^>]{1,80}>/g, ' ').replace(/\[\[[^\]]{0,200}\]\]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

(async () => {
  const db = await getDb();
  const only = process.env.ONLY?.split(',');
  for (const { id, q } of questions) {
    if (only && !only.includes(id)) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await (process.env.REFRESH_A ? refreshA(db, id, q) : buildOne(db, id, q)); break; } catch (e) { console.error(id, 'attempt', attempt, (e as Error).message); await new Promise((r) => setTimeout(r, 30000)); }
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

async function buildOne(db: Awaited<ReturnType<typeof getDb>>, id: string, q: string) {
  {
    const file = path.join(OUT, `${id}.json`);
    if (fs.existsSync(file)) { console.log(id, 'done'); return; }
    const enc = encodeURIComponent(q);
    const A = await served(`${BASE}/api/search?q=${enc}&pages_only=true&limit=60`, pickPages);
    const B = await served(`${BASE}/api/search/semantic?q=${enc}&level=page&limit=45`, pickPages);

    const t0 = performance.now();
    // The production stage minus its highlight block (this read needs no snippets, and highlighting 1,900 pages is
    // most of the cost on a shared cluster), with the page text projected in the same read.
    const stage = buildPageSearchStage(q);
    delete stage.$search.highlight;
    const kwRows = await db.collection('pages').aggregate([
      stage,
      { $match: { page_number: { $gt: 0 }, page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
      { $limit: POOL_KW },
      { $project: { _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 } },
    ], { maxTimeMS: 180000 }).toArray();
    const kw = kwRows as unknown as Hit[];
    const kwMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    const sem = (await semanticPageSearchGlobal(q, 2000, { scope: { kind: 'global' } } as any)).map((r) => ({ book_id: r.book_id, page_number: r.page_number }));
    const semMs = Math.round(performance.now() - t1);

    // Pool order: interleave the lanes the way a reader of either list would meet them (rank i of kw, rank i of sem).
    const order: Hit[] = [];
    const lane = new Map<string, Set<string>>();
    const add = (h: Hit, l: string) => { const k = key(h); if (!lane.has(k)) { lane.set(k, new Set()); order.push(h); } lane.get(k)!.add(l); };
    for (let i = 0; i < Math.max(kw.length, sem.length); i++) { if (kw[i]) add(kw[i], 'kw'); if (sem[i]) add(sem[i], 'sem'); }
    for (const h of A.hits) add(h, 'A');
    for (const h of B.hits) add(h, 'B');

    const bookIds = [...new Set(order.map((h) => h.book_id))];
    const books = new Map((await db.collection('books').find({ id: { $in: bookIds }, visible: true, pages_count: { $gt: 0 } },
      { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, language: 1 } }).toArray()).map((b) => [b.id as string, b]));
    const kept = order.filter((h) => books.has(h.book_id) || lane.get(key(h))!.has('A') || lane.get(key(h))!.has('B'));
    const pages = new Map<string, any>(kwRows.map((r) => [key(r as any), r]));
    const missing = kept.filter((h) => !pages.has(key(h)));
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50);
      const rows = await db.collection('pages').find({ $or: chunk.map((h) => ({ book_id: h.book_id, page_number: h.page_number })) },
        { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 } }).toArray();
      for (const r of rows) pages.set(key(r as any), r);
    }
    const pool = kept.map((h, rank) => {
      const p = pages.get(key(h)); const b = books.get(h.book_id) as any;
      const tr = clean(p?.translation?.data || ''); const ocr = clean(p?.ocr?.data || '');
      return {
        key: key(h), page_id: p?.id, book_id: h.book_id, page_number: h.page_number, rank, lanes: [...lane.get(key(h))!],
        title: b?.display_title || b?.title || '', author: b?.author || '', year: b?.published || b?.year || null, language: b?.language || null,
        text_kind: tr.length >= 200 ? 'translation' : 'ocr', text: (tr.length >= 200 ? tr : ocr || tr).slice(0, TEXT_CHARS),
      };
    }).filter((r) => r.text.length > 0);
    fs.writeFileSync(file, JSON.stringify({ id, q, A, B, kw_n: kw.length, sem_n: sem.length, kw_ms: kwMs, sem_ms: semMs, pool }));
    console.log(id, `A=${A.hits.length}/${A.ms}ms B=${B.hits.length}/${B.ms}ms kw=${kw.length}/${kwMs}ms sem=${sem.length}/${semMs}ms pool=${pool.length}`);
  }
}

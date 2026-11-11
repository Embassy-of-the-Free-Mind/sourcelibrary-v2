/**
 * search_within_book, part by part (#2049, job within-book-speed). Samples real calls from
 * `mcp_tool_calls` (tool search_within_book, English, one row per distinct args, seeded) and
 * times each part of `/api/books/[id]/search` as the route runs it:
 *   gate      — books.findOne for the readable gate
 *   names     — expandPersonNames (#5888)
 *   atlas     — the keyword leg's $search aggregate (top 400, full ocr/translation text)
 *   embed     — the Gemini query embedding (one call per distinct query; cached in-process)
 *   rpc       — Supabase match_pages_in_books for the one book
 *   types     — pages.find for the semantic hits' page_type / OCR
 *   coverage  — semanticCoverage, only when the semantic leg found nothing
 *   path      — gate + max(names + atlas, embed + rpc + types) + coverage: the route's critical path
 *   http      — the whole route over HTTPS from this box, as the MCP tool's self-call reaches it
 *               (--http; off by default: each one also embeds on production)
 * Read-only. No writes; `--http` calls production, which logs its own search event.
 *
 * PRIOR ART: scripts/eval/search-evals-2049/book-lane.ts (the same part-by-part shape for the
 * /api/search book lane); burst.mjs and fallback-latency.mjs time the page services and whole
 * routes. None of them times the within-book route.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local --import tsx \
 *     scripts/eval/search-evals-2049/within-book-parts.ts --n 30 --out $JOB_SCRATCH/wb-before.json [--http]
 *   … --calls $JOB_SCRATCH/wb-before.json   # re-run the same calls
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { getDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } from '@/lib/atlas-search';
import { expandPersonNames } from '@/lib/search/name-variants';
import { getQueryEmbedding } from '@/lib/semantic-search';
import { semanticCoverage } from '@/lib/semantic-coverage';
// @ts-expect-error — plain-JS module, no declarations
import { makeRng } from '../lib/paired-stats.mjs';

const argv = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const N = +(opt('n', '30') as string);
const OUT = opt('out');
const CALLS = opt('calls');
const HTTP = argv.includes('--http');

interface Call { book_id: string; query: string }

async function sample(): Promise<Call[]> {
  if (CALLS) return (JSON.parse(readFileSync(CALLS, 'utf8')).rows as Array<Call>).map(({ book_id, query }) => ({ book_id, query }));
  const db = await getDb();
  const rows = await db.collection('mcp_tool_calls')
    .find({ tool: 'search_within_book', ok: true, ts: { $gte: new Date(Date.now() - 14 * 864e5) } })
    .project({ args: 1 }).toArray();
  const seen = new Set<string>();
  const calls: Call[] = [];
  for (const r of rows) {
    const a = r.args as Record<string, unknown>;
    if (a.lang && a.lang !== 'en') continue;
    if (!a.book_id || !a.query) continue;
    const c = { book_id: String(a.book_id), query: String(a.query).trim() };
    const k = `${c.book_id}\u0000${c.query}`;
    if (seen.has(k)) continue;
    seen.add(k);
    calls.push(c);
  }
  const rng = makeRng(2049);
  for (let i = calls.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [calls[i], calls[j]] = [calls[j], calls[i]]; }
  return calls.slice(0, N);
}

async function timed<T>(f: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const v = await f();
  return [v, Math.round(performance.now() - t)];
}

async function main() {
  const db = await getDb();
  const calls = await sample();
  const rows = [];
  for (const c of calls) {
    const isPhrase = /^".*"$/.test(c.query);
    const [gate, gateMs] = await timed(() => db.collection('books').findOne(
      { $or: [{ id: c.book_id }, { slug: c.book_id }] },
      { projection: { id: 1, visible: 1, hidden: 1, pages_count: 1, pages_translated: 1 } }));
    const [variants, namesMs] = await timed(() => expandPersonNames(c.query));
    const [atlasPages, atlasMs] = await timed(() => db.collection('pages').aggregate([
      buildPageSearchStage(c.query, c.book_id, { nameVariants: variants }),
      { $match: { page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
      { $limit: 400 },
      { $project: { id: 1, page_number: 1, book_id: 1, 'ocr.data': 1, 'translation.data': 1, highlights: { $meta: 'searchHighlights' }, searchScore: { $meta: 'searchScore' } } },
    ], { maxTimeMS: 10000 }).toArray());
    const atlasBytes = atlasPages.reduce((s, p) => s + ((p.ocr as { data?: string })?.data?.length || 0) + ((p.translation as { data?: string })?.data?.length || 0), 0);
    const [emb, embedMs] = await timed(() => getQueryEmbedding(c.query));
    let rpcMs = 0, typesMs = 0, semHits = 0;
    let semRows: Array<{ page_id: string; page_number: number; similarity: number }> = [];
    if (emb) {
      const [r, ms] = await timed(async () => supabase.rpc('match_pages_in_books', {
        query_embedding: JSON.stringify(emb), book_ids: [c.book_id], match_threshold: 0.3, match_count: 10,
      }));
      rpcMs = ms;
      semRows = (r.data || []) as typeof semRows;
      semHits = semRows.length;
      if (semHits) {
        [, typesMs] = await timed(() => db.collection('pages').find({ id: { $in: semRows.map((s) => s.page_id) } }, { projection: { id: 1, page_type: 1, 'ocr.data': 1 } }).toArray());
      }
    }
    let coverageMs = 0;
    if (semHits === 0) [, coverageMs] = await timed(() => semanticCoverage(String(gate?.id || c.book_id), Number(gate?.pages_translated) || 0));
    const path = gateMs + Math.max(namesMs + atlasMs, embedMs + rpcMs + typesMs) + coverageMs;
    let httpMs: number | null = null;
    if (HTTP) {
      [, httpMs] = await timed(async () => {
        const res = await fetch(`https://sourcelibrary.org/api/books/${c.book_id}/search?q=${encodeURIComponent(c.query)}`, { headers: { 'User-Agent': 'SourceLibrary-eval/2049-within-book' } });
        await res.text();
      });
    }
    const live = !!gate && gate.visible === true && (gate.pages_count as number) > 0 && gate.hidden !== true;
    const row = { ...c, phrase: isPhrase, live, atlas_hits: atlasPages.length, atlas_kb: Math.round(atlasBytes / 1024), sem_hits: semHits, gateMs, namesMs, atlasMs, embedMs, rpcMs, typesMs, coverageMs, path, httpMs };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const parts = ['gateMs', 'namesMs', 'atlasMs', 'embedMs', 'rpcMs', 'typesMs', 'coverageMs', 'path', ...(HTTP ? ['httpMs'] : [])] as const;
  const summary: Record<string, { p50: number; p90: number; max: number }> = {};
  for (const k of parts) {
    const xs = rows.map((r) => (r as Record<string, unknown>)[k] as number);
    summary[k] = { p50: pct(xs, 0.5), p90: pct(xs, 0.9), max: Math.max(...xs) };
  }
  console.table(summary);
  if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 1));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Client for the page-vector service on l7a (#6821): the `page_translations`
 * vectors in an in-RAM HNSW, answering `match_semantic`'s question in ~10 ms
 * instead of Supabase's ~1.1 s cold read. Service code and contract:
 * scripts/workers/vector-search/ (README.md).
 *
 * Three modes, from VECTOR_SEARCH_MODE, and only when VECTOR_SEARCH_URL and
 * VECTOR_SEARCH_TOKEN are both set:
 *   off     (default) the service is never called.
 *   shadow  `semanticPageSearchGlobal` runs the RPC exactly as before and
 *           returns ITS rows; the service is called beside it and the
 *           comparison (`VectorShadow`) is logged on the search_queries row.
 *   serve   the service's rows, text hydrated by primary key, with the RPC as
 *           the fallback on any error, timeout or `complete: false`.
 *
 * Global scope only. Tenant scope and the language-keyed `page_texts` store
 * stay on Supabase: the service holds neither a tenant's book set nor those
 * vectors. Only `semanticPageSearchGlobal` calls this, after its scope branch.
 *
 * Transport: HTTPS to https://vectors.sourcelibrary.org (Caddy on l7a in front
 * of the service's loopback listener, #6843) with a Bearer token.
 *
 * Text: serve mode asks for `with_text`, and the service returns
 * match_semantic's text and book columns from its own store, so a served
 * search costs no Supabase round trip (#6843: hydrating 45 rows was ~100 ms
 * warm, ~350 ms cold, against ~10 ms of search). A row the service sends
 * without them is hydrated by primary key, as before.
 *
 * PRIOR ART: src/lib/clip.ts — the self-hosted-service shape (env URL, auth
 * header, no fallback secret). Its callers have no RPC to fall back to and no
 * shadow comparison, which is what this module adds.
 */
import { supabase } from '@/lib/supabase';

export type VectorSearchMode = 'off' | 'shadow' | 'serve';

/** The service call's budget, network included. The RPC it stands beside takes ~1.1 s. */
export const VECTOR_SEARCH_TIMEOUT_MS = 400;

export function vectorSearchMode(): VectorSearchMode {
  if (!process.env.VECTOR_SEARCH_URL || !process.env.VECTOR_SEARCH_TOKEN) return 'off';
  const m = process.env.VECTOR_SEARCH_MODE;
  return m === 'shadow' || m === 'serve' ? m : 'off';
}

/** `match_semantic`'s arguments, minus the vector, in the service's names. */
export interface VectorMatchFilters {
  threshold: number;
  language: string | null;
  languages: string[] | null;
  excludeLanguages: string[] | null;
  yearMin: number | null;
  yearMax: number | null;
}

export interface VectorServiceRow {
  page_id: string;
  book_id: string;
  page_number: number;
  similarity: number;
  /** With `with_text`: match_semantic's other columns (null where the row's column is null). */
  translation?: string | null;
  book_title?: string | null;
  book_author?: string | null;
  book_language?: string | null;
  book_year?: number | null;
}

export interface VectorServiceResult {
  rows: VectorServiceRow[];
  /** Server-side milliseconds. */
  ms: number;
  /** `hnsw`, `exact`, `hnsw+exact` or `empty` — which planner path ran (filtered queries). */
  path?: string;
  /** False: fewer than k rows, and rows above the threshold may exist that were not looked at. */
  complete?: boolean;
}

export class VectorServiceError extends Error {
  constructor(message: string) {
    super(`[vector-search] ${message}`);
    this.name = 'VectorServiceError';
  }
}

/** POST /match. Throws VectorServiceError on a timeout, a non-200 or a malformed body. */
export async function matchVectorService(
  embedding: number[],
  k: number,
  f: VectorMatchFilters,
  timeoutMs = VECTOR_SEARCH_TIMEOUT_MS,
  withText = false,
): Promise<VectorServiceResult> {
  const url = process.env.VECTOR_SEARCH_URL;
  const token = process.env.VECTOR_SEARCH_TOKEN;
  if (!url || !token) throw new VectorServiceError('VECTOR_SEARCH_URL / VECTOR_SEARCH_TOKEN not set');
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/+$/, '')}/match`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        vector: embedding,
        k,
        threshold: f.threshold,
        filter_language: f.language,
        filter_languages: f.languages,
        filter_exclude_languages: f.excludeLanguages,
        year_min: f.yearMin,
        year_max: f.yearMax,
        ...(withText ? { with_text: true } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    throw new VectorServiceError(name === 'TimeoutError' || name === 'AbortError' ? `timeout after ${timeoutMs} ms` : `fetch failed: ${(e as Error).message}`);
  }
  if (!res.ok) throw new VectorServiceError(`HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as VectorServiceResult | null;
  if (!body || !Array.isArray(body.rows)) throw new VectorServiceError('malformed response');
  return body;
}

/**
 * What one shadow comparison records (`search_queries.vector_shadow`).
 * `overlap_at_k` is |service top-k ∩ RPC top-k| / max(|service|, |RPC|) on
 * page_id, so a list that is merely shorter counts against it; null when both
 * are empty.
 */
export interface VectorShadow {
  rpc_ms: number;
  svc_ms: number | null;
  /** Server-side ms reported by the service (svc_ms minus the network). */
  svc_server_ms?: number;
  k: number;
  rpc_n: number;
  svc_n: number | null;
  overlap_at_k: number | null;
  filtered: boolean;
  svc_path?: string;
  svc_complete?: boolean;
  svc_error?: string;
  /** The RPC itself failed (the search threw); the comparison has no reference rows. */
  rpc_failed?: boolean;
}

export function overlapAtK(a: readonly { page_id: string }[], b: readonly { page_id: string }[], k: number): number | null {
  const ta = a.slice(0, k), tb = b.slice(0, k);
  const denom = Math.max(ta.length, tb.length);
  if (denom === 0) return null;
  const sb = new Set(tb.map((r) => r.page_id));
  return ta.filter((r) => sb.has(r.page_id)).length / denom;
}

/**
 * Where a route collects the shadow comparison so it can log it with the query.
 * `semanticPageSearchGlobal` sets `result`; the route hands it to
 * `logSearchQuery`, which awaits it after the response has gone.
 */
export interface VectorShadowSink {
  result?: Promise<VectorShadow | null>;
}

/** The columns `match_semantic` returns. */
const HYDRATE_COLUMNS = 'page_id, book_id, page_number, translation, book_title, book_author, book_language, book_year';

/** The service sent every column match_semantic returns (`with_text`), so the row needs no hydration. */
export function hasServiceColumns(r: VectorServiceRow): boolean {
  return r.translation !== undefined && r.book_title !== undefined && r.book_author !== undefined
    && r.book_language !== undefined && r.book_year !== undefined;
}

/**
 * The service's rows in `match_semantic`'s shape, service order and scores
 * kept. A row that carries the columns itself (`with_text`) is used as is; the
 * rest are hydrated with one primary-key `in()` on page_translations, and a row
 * gone from there since the service last synced is dropped. With every row
 * complete, Supabase is not called at all. Throws on a hydration error, so the
 * caller falls back to the RPC. k ≤ 50, far under supabase-js's 1,000-row cap.
 */
export async function hydrateServiceRows(rows: VectorServiceRow[]): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const missing = rows.filter((r) => !hasServiceColumns(r)).map((r) => r.page_id);
  let byId = new Map<string, Record<string, unknown>>();
  if (missing.length) {
    const { data, error } = await supabase
      .from('page_translations')
      .select(HYDRATE_COLUMNS)
      .in('page_id', missing);
    if (error) throw new VectorServiceError(`hydration failed: ${error.message}`);
    byId = new Map(((data || []) as unknown as Record<string, unknown>[]).map((r) => [r.page_id as string, r]));
  }
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (hasServiceColumns(r)) {
      out.push({
        page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, translation: r.translation,
        book_title: r.book_title, book_author: r.book_author, book_language: r.book_language, book_year: r.book_year,
        similarity: r.similarity,
      });
      continue;
    }
    const t = byId.get(r.page_id);
    if (t) out.push({ ...t, similarity: r.similarity });
  }
  return out;
}

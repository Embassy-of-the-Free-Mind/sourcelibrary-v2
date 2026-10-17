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
 * Transport: plain HTTP to the box's IP with a Bearer token, as CLIP does
 * (src/lib/clip.ts). The token crosses the network unencrypted; TLS is a
 * follow-up (Caddy + a DNS name), see the PR.
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

/**
 * The service's rows in `match_semantic`'s shape: one primary-key `in()` on
 * page_translations for the text and book columns, service order and scores
 * kept. A row gone since the service last synced is dropped. Throws on a
 * hydration error, so the caller falls back to the RPC. k ≤ 50, far under
 * supabase-js's 1,000-row cap.
 */
export async function hydrateServiceRows(rows: VectorServiceRow[]): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase
    .from('page_translations')
    .select(HYDRATE_COLUMNS)
    .in('page_id', rows.map((r) => r.page_id));
  if (error) throw new VectorServiceError(`hydration failed: ${error.message}`);
  const byId = new Map(((data || []) as unknown as Record<string, unknown>[]).map((r) => [r.page_id as string, r]));
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const t = byId.get(r.page_id);
    if (t) out.push({ ...t, similarity: r.similarity });
  }
  return out;
}

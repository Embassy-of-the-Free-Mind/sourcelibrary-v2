/**
 * The book set a search request may see, and the only doors to the vector RPCs.
 *
 * PRIOR ART: src/lib/tenant-context.ts — reads the proxy's `x-tenant-*` headers
 * and resolves slug → id, but stops at the id. src/lib/tenant-catalog-books.ts —
 * answers "may this ONE book render for this tenant", a per-book admission, not
 * a set a ranker can be confined to. Neither can scope a vector search, which is
 * why each lane grew its own after-the-fact Mongo filter and one grew none.
 *
 * WHY THIS FILE EXISTS (#4330, #2753). A partner reading room
 * (bph.sourcelibrary.org) must show only its own shelf. No embedding table has
 * a tenant column, and `match_semantic` accepts `filter_tenant_id` and ignores
 * it, so every vector lane ranked the whole library. `/api/search/semantic`
 * returned that ranking as it came (the leak); the lanes that filtered
 * afterwards in Mongo were pure but starved, because a filter applied to an
 * index's top-N keeps only what happened to be in it.
 *
 * So the scope is decided ONCE, here, from the request, and handed to the
 * ranker as a list of book ids:
 *
 *   global  no tenant on the request — the whole library, as before
 *   tenant  the tenant's visible books (`books.tenantId`, the same truth the
 *           keyword lanes filter on)
 *   closed  the request carries a tenant signal that could not be turned into
 *           a book set (unknown slug, Mongo down). Returns nothing. Never
 *           global: an unresolvable scope is not an absent one.
 *
 * `semanticBookSearch` and its siblings REQUIRE a scope, so a new caller cannot
 * forget one — it has to write `GLOBAL_SCOPE` and mean it. Raw `.rpc('match_*')`
 * calls outside this file and semantic-search.ts fail
 * tests/unit/embedding-rpc-scope-guard.test.ts.
 *
 * Catalogue-admitted global books (a partner catalogue linking an external
 * scan, tenant-catalog-books.ts) are NOT in the set: the keyword lanes do not
 * return them either, and a scope narrower than admission is safe.
 */
import type { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/mongodb';
import { getTenantContextFromRequest, resolveTenantId } from '@/lib/tenant-context';

export type SearchScope =
  | { kind: 'global' }
  | { kind: 'tenant'; tenantId: string; bookIds: string[]; has: (bookId: string | null | undefined) => boolean }
  | { kind: 'closed'; reason: string };

/** The whole library. Writing this is a statement that the surface is main-site only. */
export const GLOBAL_SCOPE: SearchScope = { kind: 'global' };

export function closedScope(reason: string): SearchScope {
  return { kind: 'closed', reason };
}

export function bookSetScope(tenantId: string, bookIds: string[]): SearchScope {
  const set = new Set(bookIds);
  return { kind: 'tenant', tenantId, bookIds, has: (id) => !!id && set.has(id) };
}

/** True when results must be confined (or withheld) — i.e. the response is not the global one. */
export function isScoped(scope: SearchScope): boolean {
  return scope.kind !== 'global';
}

/** Does this scope admit the book? Global admits everything, closed nothing. */
export function scopeAdmits(scope: SearchScope, bookId: string | null | undefined): boolean {
  if (scope.kind === 'global') return true;
  if (scope.kind === 'closed') return false;
  return scope.has(bookId);
}

// A tenant's shelf changes when a librarian assigns a book, not per request.
// Five minutes matches resolveTenantId's cache. Failures are never cached.
const SCOPE_TTL_MS = 5 * 60_000;
const scopeCache = new Map<string, { value: Promise<SearchScope>; expiresAt: number }>();

/** Test hook. */
export function clearSearchScopeCache(): void {
  scopeCache.clear();
}

/**
 * The scope for a known tenant id. Fails closed: a Mongo error is a closed
 * scope, not a global one and not an empty shelf that gets cached.
 */
export function tenantSearchScope(tenantId: string): Promise<SearchScope> {
  const now = Date.now();
  const hit = scopeCache.get(tenantId);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = (async (): Promise<SearchScope> => {
    try {
      const db = await getDb();
      const docs = await db.collection('books')
        .find(
          { tenantId, visible: true, hidden: { $ne: true } },
          { projection: { _id: 0, id: 1 }, maxTimeMS: 5000 },
        )
        .toArray();
      return bookSetScope(tenantId, docs.map((d) => d.id as string).filter(Boolean));
    } catch (e) {
      scopeCache.delete(tenantId);
      console.error('[tenant-search-scope] book set lookup failed — scope closed:', e instanceof Error ? e.message : String(e));
      return closedScope('tenant book set unavailable');
    }
  })();
  scopeCache.set(tenantId, { value, expiresAt: now + SCOPE_TTL_MS });
  return value;
}

/**
 * The scope for a request. ANY tenant signal — an id, a slug, or the embedded
 * flag — takes the request out of `global`; if that signal cannot be resolved
 * to a tenant the scope is closed.
 */
export async function resolveSearchScope(requestOrHeaders: NextRequest | Headers): Promise<SearchScope> {
  const ctx = getTenantContextFromRequest(requestOrHeaders);
  if (!ctx.id && !ctx.slug && !ctx.isEmbedded) return GLOBAL_SCOPE;
  let tenantId = ctx.id;
  if (!tenantId && ctx.slug) {
    try {
      tenantId = await resolveTenantId(ctx.slug);
    } catch {
      return closedScope('tenant lookup failed');
    }
  }
  if (!tenantId) return closedScope('unresolved tenant');
  return tenantSearchScope(tenantId);
}

// ── The scoped RPC runner ────────────────────────────────────────────────

export interface ScopedMatchSpec {
  /** RPC + args for the whole library. Must carry `match_count`. */
  global: { fn: string; args: Record<string, unknown> };
  /**
   * RPC + args for a book set; `book_ids` is added here. The functions live in
   * scripts/migration/add-scoped-embedding-rpcs.sql and rank INSIDE the set, so
   * a small shelf is not starved by the rest of the library.
   */
  scoped: { fn: string; args: Record<string, unknown> };
  /** Ceiling for `match_count` when falling back to the global RPC. */
  fallbackMaxCount?: number;
  timeoutMs?: number;
}

export interface ScopedMatchResult<T> {
  rows: T[];
  /** Null on success. An error is not an empty answer — see SemanticSearchError. */
  error: string | null;
  /** The RPC that actually answered (or failed). */
  rpc: string;
}

/**
 * Errors after which the filtered global RPC is the right answer rather than
 * no answer:
 *  - PGRST202: the scoped function is not deployed yet.
 *  - 57014: statement timeout. The page function reads every vector of its
 *    probe books, which took 1.5–5 s on a cold cache against the anon role's
 *    3 s limit (measured 2026-10-06); the repeat call is ~150 ms.
 * Both fall back to the same thing: the global ranking cut to the book set —
 * always closed, possibly starved.
 */
function shouldFallBack(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '57014'
    || /could not find the function|statement timeout/i.test(error.message || '');
}

async function callRpc(fn: string, args: Record<string, unknown>, timeoutMs?: number) {
  const q = supabase.rpc(fn, args);
  return timeoutMs ? q.abortSignal(AbortSignal.timeout(timeoutMs)) : q;
}

/**
 * Run a vector match under a scope.
 *
 * - global: the global RPC, untouched.
 * - closed, or a tenant with no books: no rows, and NO query — there is nothing
 *   a ranker could return that this request may see.
 * - tenant: the scoped RPC. If it is not deployed, or times out, the global
 *   RPC over-fetched and filtered (pure, starved) — so the code is safe to ship
 *   before the migration, and applying the migration is what restores recall.
 *
 * Every tenant row is re-checked against the set on the way out, whichever RPC
 * produced it. The check is cheap and the SQL is not the only thing that can be
 * wrong.
 */
export async function scopedMatch<T extends { book_id: string }>(
  scope: SearchScope,
  spec: ScopedMatchSpec,
): Promise<ScopedMatchResult<T>> {
  if (scope.kind === 'closed') return { rows: [], error: null, rpc: 'none:closed' };
  if (scope.kind === 'global') {
    const { data, error } = await callRpc(spec.global.fn, spec.global.args, spec.timeoutMs);
    return { rows: (data || []) as T[], error: error ? error.message : null, rpc: spec.global.fn };
  }
  if (scope.bookIds.length === 0) return { rows: [], error: null, rpc: 'none:empty' };

  const scoped = await callRpc(spec.scoped.fn, { ...spec.scoped.args, book_ids: scope.bookIds }, spec.timeoutMs);
  if (!scoped.error) {
    return { rows: ((scoped.data || []) as T[]).filter((r) => scope.has(r.book_id)), error: null, rpc: spec.scoped.fn };
  }
  if (!shouldFallBack(scoped.error)) {
    return { rows: [], error: scoped.error.message, rpc: spec.scoped.fn };
  }

  const want = Number(spec.global.args.match_count) || 20;
  const fallback = await callRpc(
    spec.global.fn,
    { ...spec.global.args, match_count: Math.min(want * 10, spec.fallbackMaxCount ?? 500) },
    spec.timeoutMs,
  );
  if (fallback.error) return { rows: [], error: fallback.error.message, rpc: spec.global.fn };
  return {
    rows: ((fallback.data || []) as T[]).filter((r) => scope.has(r.book_id)).slice(0, want),
    error: null,
    rpc: `${spec.global.fn}:filtered`,
  };
}

// ── CLIP and gallery-description matches ─────────────────────────────────

export interface ClipMatchRow {
  id: string;
  source_type: string;
  book_id: string;
  image_url: string;
  title: string;
  author: string;
  resource_type: string;
  thumbnail_url: string;
  similarity: number;
}

/**
 * Nearest images in `clip_embeddings` to a CLIP vector (from text or an image).
 *
 * `clip_embeddings.book_id` is denormalised and drifts (embeddings.md, "CLIP
 * index truth"), so a caller that hydrates the gallery row must still check the
 * hydrated book against the scope — `scopeAdmits`.
 */
export function matchClip(
  embedding: number[] | string,
  opts: { scope: SearchScope; threshold: number; count: number; rpc?: 'match_clip_text' | 'match_clip_images'; timeoutMs?: number },
): Promise<ScopedMatchResult<ClipMatchRow>> {
  const args = { query_embedding: embedding, match_threshold: opts.threshold, match_count: opts.count };
  return scopedMatch<ClipMatchRow>(opts.scope, {
    global: { fn: opts.rpc ?? 'match_clip_images', args },
    scoped: { fn: 'match_clip_in_books', args },
    fallbackMaxCount: 1000,
    timeoutMs: opts.timeoutMs,
  });
}

export interface GalleryTextMatchRow {
  id: string;
  page_id: string;
  book_id: string;
  detection_index: number;
  similarity: number;
}

/** Nearest gallery images by their museum-description embedding (`gallery_text_embeddings`). */
export function matchGalleryText(
  embedding: number[] | string,
  opts: { scope: SearchScope; threshold: number; count: number; excludeBookId?: string | null; timeoutMs?: number },
): Promise<ScopedMatchResult<GalleryTextMatchRow>> {
  const args: Record<string, unknown> = {
    query_embedding: typeof embedding === 'string' ? embedding : JSON.stringify(embedding),
    match_threshold: opts.threshold,
    match_count: opts.count,
  };
  // The existing callers omit the argument rather than send null; keep the
  // global call byte-identical to what it was.
  if (opts.excludeBookId !== undefined) args.exclude_book_id = opts.excludeBookId;
  return scopedMatch<GalleryTextMatchRow>(opts.scope, {
    global: { fn: 'match_gallery_text', args },
    scoped: { fn: 'match_gallery_text_in_books', args },
    fallbackMaxCount: 1000,
    timeoutMs: opts.timeoutMs,
  });
}

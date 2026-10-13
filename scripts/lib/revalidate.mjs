/**
 * PRIOR ART: none — checked `scripts/lib/` (no cache/purge/revalidate helper) and
 * the five scripts that already do this: `create-proposed-collections-2026-08.mjs`,
 * `import/create-slime-moulds-collection.mjs`, `import/publish-slime-moulds.mjs`,
 * `import/rewrite-book-summaries.mjs`, `maintenance/cleanup-orphan-gallery-images.mjs`.
 * Each hand-rolls the same fetch with its own auth header and error handling, and
 * most of them ignore the response. That copy-paste IS the bug this file fixes;
 * `src/lib/cloudflare-cache.ts` is server-side TS and not importable from a script.
 *
 * Revalidate public pages after a script writes to Mongo.
 *
 * WHY THIS EXISTS
 * ---------------
 * A collection page is ISR-cached and CDN-cached. Before a collection exists,
 * `/collections/<slug>` renders as missing — and THAT is what gets cached. A
 * script then writes the document and flips `visible`, which changes the
 * database and nothing else, so the reader keeps getting the cached miss. There
 * is no API write path to hook: collections are created by scripts writing
 * straight to Mongo, so the purge has to be something the script calls.
 *
 * Corollary worth stating, because it is the trap: **a write that changes what a
 * page should show is not finished until the cache is told.** The write
 * succeeding is not evidence the page changed.
 *
 * READ THE RESPONSE. `/api/admin/revalidate` returns `{ revalidated: N }`; a 200
 * with `revalidated: 0` means the paths were rejected (they must start with "/")
 * and the page is still stale. Every caller here checks it, because a discarded
 * purge response is how a dead Cloudflare token hid for weeks.
 */

const BASE = process.env.SITE_URL || 'https://sourcelibrary.org';

function authHeader() {
  const secret = process.env.REVALIDATE_SECRET || process.env.CRON_SECRET;
  if (!secret) {
    throw new Error(
      'revalidate: no REVALIDATE_SECRET or CRON_SECRET in env — refusing to call silently. ' +
      'Run with --env-file=.env.production.local.',
    );
  }
  return { 'x-revalidate-secret': secret, 'Content-Type': 'application/json' };
}

/**
 * Revalidate explicit paths (and purge them at the edge — the route does both).
 * Returns the parsed result; throws on a non-200 or on an empty revalidation,
 * so a caller cannot mistake "nothing happened" for success.
 */
export async function revalidatePaths(paths, { quiet = false, type } = {}) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return { revalidated: 0, paths: [] };

  const bad = list.filter((p) => !String(p).startsWith('/'));
  if (bad.length) throw new Error(`revalidate: paths must start with "/" — got ${bad.join(', ')}`);

  const res = await fetch(`${BASE}/api/admin/revalidate`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(type ? { paths: list, type } : { paths: list }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`revalidate: HTTP ${res.status} — ${body.slice(0, 200)}`);

  let json;
  try { json = JSON.parse(body); } catch { throw new Error(`revalidate: non-JSON response — ${body.slice(0, 200)}`); }
  if (!json.revalidated) throw new Error(`revalidate: server revalidated 0 paths for ${list.join(', ')}`);

  if (!quiet) console.log(`  revalidated ${json.revalidated} path(s)${type ? ` (${type})` : ''}: ${list.join(', ')}`);
  return json;
}

/**
 * Publish-time purge for one collection: its own page, plus the two listings a
 * new collection has to appear in. Call this after creating a collection, after
 * flipping `visible`, and after editing authored prose — all three change what
 * the cached page should say.
 */
export async function revalidateCollection(slug, opts = {}) {
  if (!slug) throw new Error('revalidateCollection: slug is required');
  return revalidatePaths([`/collections/${slug}`, '/collections', '/collections/all'], opts);
}

/** The reader route whose hidden-book 404 is cached at the LAYOUT level (#4843). */
export const READER_PAGE_PATTERN = '/book/[id]/page/[pageId]';

function bookPaths(books) {
  const set = new Set();
  for (const b of books || []) {
    if (!b) continue;
    if (b.slug) set.add(`/book/${b.slug}`);
    if (b.id) set.add(`/book/${b.id}`);
  }
  return [...set];
}

/**
 * Evict the cached copies of books whose PUBLICATION changed (#6227) — the
 * script-side twin of what /api/books/[id]/visibility does in-process.
 *
 * While a book is hidden, every reader URL anyone touched is cached as a 404
 * raised in the reader's route-group layout; a page-level revalidation of the
 * book paths does not clear it. So, in this order:
 *   1. the reader route PATTERN + the book paths as type 'layout';
 *   2. the book paths as pages — the route purges these at Cloudflare.
 * The pattern call is broad (every reader page of every book), so a bulk caller
 * passes all its books in ONE call, never one call per book.
 *
 * books: [{ id, slug? }]. Throws on any failure — see bookEvictionFollowUp().
 */
export async function revalidateBookPages(books, opts = {}) {
  const paths = bookPaths(books);
  if (!paths.length) return { revalidated: 0, paths: [] };
  await revalidatePaths([READER_PAGE_PATTERN, ...paths], { ...opts, type: 'layout' });
  return revalidatePaths(paths, opts);
}

/**
 * The exact commands that do what revalidateBookPages() does, for a caller to
 * print when the eviction could not run (no secret in env, HTTP error). A
 * publish that cannot evict must not read as finished.
 */
export function bookEvictionFollowUp(books) {
  const paths = bookPaths(books);
  if (!paths.length) return '';
  const curl = (body) =>
    `curl -sS -X POST ${BASE}/api/admin/revalidate -H "x-revalidate-secret: $REVALIDATE_SECRET" ` +
    `-H 'Content-Type: application/json' -d '${JSON.stringify(body)}'`;
  return [
    curl({ paths: [READER_PAGE_PATTERN, ...paths], type: 'layout' }),
    curl({ paths }),
  ].join('\n');
}

/**
 * Reading-room URL space (#5266). Leaf module — no imports — so the proxy, the
 * client hooks that decide "is this an embedded surface?" and the room routes
 * all answer the one question identically: does this pathname live inside a
 * room, and if so which one?
 *
 * PRIOR ART: src/lib/tenant-roots.ts — the same "is segment 0 a tenant?" leaf
 * for partner rooms, but a closed static Set; rooms are user-made and open-
 * ended, so they get their own root (`/rooms/`) and a slug grammar instead.
 * src/lib/EmbedContext.tsx `withEmbedNamespace` only knows `/embed/<tenant>`;
 * `withRoomPrefix` below is its twin for `/rooms/<slug>`.
 *
 * A room is a self-serve, white-label shelf + reader at `/rooms/<slug>`; the
 * book page and reader underneath it (`/rooms/<slug>/book/<book>[/page/<id>]`)
 * are the global components rendered in embedded mode, exactly as
 * `/embed/[tenant]/*` renders them for partner rooms. Every internal link
 * inside a room must therefore be prefixed with `/rooms/<slug>` or the reader
 * walks the visitor out onto sourcelibrary.org proper (the same leak class
 * as the partner rooms, tenant-lockdown.md).
 *
 * `/rooms` (your rooms), `/rooms/new` and `/rooms/manage/<slug>` are the
 * owner's MANAGEMENT pages on the global site with the normal header; they
 * are excluded here by the reserved-segment list, so nothing treats them as
 * embedded. Keep RESERVED in step with the route folders under src/app/rooms.
 */

export const ROOMS_ROOT = '/rooms';

/** First segments under /rooms that are NOT room slugs (management routes). */
export const RESERVED_ROOM_SEGMENTS: ReadonlySet<string> = new Set([
  'new',
  'manage',
  'api',
  'book',
  'page',
  'mine',
]);

/** URL-safe room slug: 3–48 chars, lowercase letters/digits/hyphens, no edge hyphens. */
export const ROOM_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

export function isValidRoomSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && ROOM_SLUG_RE.test(slug) && !RESERVED_ROOM_SEGMENTS.has(slug);
}

/**
 * `/rooms/<slug>` when the pathname is inside a room, else null. Management
 * paths (`/rooms`, `/rooms/new`, `/rooms/manage/x`) return null.
 */
export function getRoomPrefixFromPathname(pathname: string | null | undefined): string | null {
  const slug = getRoomSlugFromPathname(pathname);
  return slug ? `${ROOMS_ROOT}/${slug}` : null;
}

/** The room slug a pathname is inside, else null. */
export function getRoomSlugFromPathname(pathname: string | null | undefined): string | null {
  if (!pathname || !pathname.startsWith(`${ROOMS_ROOT}/`)) return null;
  const slug = pathname.slice(ROOMS_ROOT.length + 1).split('/')[0];
  if (!slug || !isValidRoomSlug(slug)) return null;
  return slug;
}

/**
 * Prefix a site-relative href with the room, unless it is external, already
 * inside a room, or inside the partner embed namespace. Mirrors
 * `withEmbedNamespace` in src/lib/EmbedContext.tsx.
 */
export function withRoomPrefix(href: string, roomPrefix: string): string {
  if (!href || !href.startsWith('/')) return href;
  if (href.startsWith('//')) return href;
  if (href.startsWith(`${ROOMS_ROOT}/`) || href.startsWith('/embed/')) return href;
  if (href === '/') return roomPrefix;
  if (href.startsWith('/?')) return `${roomPrefix}${href.slice(1)}`;
  return `${roomPrefix}${href}`;
}

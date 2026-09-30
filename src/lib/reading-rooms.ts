/**
 * Reading rooms (#5266): self-serve, white-label shelves that put a chosen
 * set of books, and the reader for them, on someone else's website under
 * their own name.
 *
 * PRIOR ART: src/lib/tenant-catalog-books.ts — admission for PARTNER rooms
 * (tenantId or a catalogue row in Supabase); rooms admit by membership in a
 * curated collection or a user list instead, and are owned by a reader
 * account, not provisioned by us. src/lib/user-lists.ts — the list side of
 * the source reference; reused, not copied.
 *
 * One Mongo collection, `reading_rooms`, one doc per room. No new fields on
 * `books` or `users` (field-sprawl.md). The set of books is a REFERENCE
 * (`source`), never a copied id list, so a room built on a collection keeps
 * up with the collection.
 *
 * Every read of a book inside a room goes through `roomAdmitsBook` — the
 * admission check lives on the READ side (CLAUDE.md, Multi-Session Awareness)
 * because the failure that matters is a room quietly serving a book that is
 * not in its set, which is exactly how partner rooms leaked (#5038).
 */

import { randomBytes } from 'crypto';
import type { Db, Document } from 'mongodb';
import { findBookByIdOrSlug, type BookLookupResult } from '@/lib/book-lookup';
import { isValidRoomSlug } from '@/lib/reading-rooms-paths';

export const READING_ROOMS_COLLECTION = 'reading_rooms';

export const MAX_ROOMS_PER_OWNER = 5;
export const ROOM_NAME_MAX = 80;
export const ROOM_TAGLINE_MAX = 200;
export const ROOM_HOME_LABEL_MAX = 40;
export const ROOM_MAX_ORIGINS = 10;
/** Cards on a shelf. A collection can be thousands of books; a room is a shelf. */
export const ROOM_SHELF_LIMIT = 200;

export type RoomSource =
  | { type: 'collection'; slug: string }
  | { type: 'list'; id: string };

export interface RoomTheme {
  /** https URL of the owner's wordmark or logo. Rendered as a plain <img>. */
  logo_url: string | null;
  /** #rrggbb — used for links and buttons in the room chrome. */
  accent_hex: string | null;
  /** Where the room's name links back to (the owner's own site). */
  home_url: string | null;
  /** Text of that link, e.g. "Back to the podcast". */
  home_label: string | null;
}

export interface ReadingRoom {
  /** App-level id (`rm_` + hex); slug is the URL identity, id is stable across renames. */
  id: string;
  slug: string;
  /** NextAuth session user id. */
  owner_id: string;
  name: string;
  tagline: string;
  source: RoomSource;
  theme: RoomTheme;
  /** Hostnames allowed to frame the room (`example.org`, `www.example.org`). */
  allowed_origins: string[];
  status: 'active' | 'deleted';
  created_at: Date | string;
  updated_at: Date | string;
}

export function newRoomId(): string {
  return 'rm_' + randomBytes(9).toString('hex');
}

// ── Validation ──────────────────────────────────────────────────────────────

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function normalizeOriginHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  return s;
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanHttpsUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return null;
    return u.toString().slice(0, 500);
  } catch {
    return null;
  }
}

export function slugifyRoomName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

export interface RoomInput {
  slug?: unknown;
  name?: unknown;
  tagline?: unknown;
  source?: unknown;
  theme?: unknown;
  allowed_origins?: unknown;
}

export type ValidatedRoomInput = Pick<ReadingRoom, 'slug' | 'name' | 'tagline' | 'source' | 'theme' | 'allowed_origins'>;

/**
 * Validate a create/update body. Returns `{ ok: false, error }` with a message
 * fit to show the owner. `partial` skips required-field checks for PATCH.
 */
export function validateRoomInput(
  body: RoomInput,
  opts: { partial?: boolean } = {},
): { ok: true; value: Partial<ValidatedRoomInput> } | { ok: false; error: string } {
  const out: Partial<ValidatedRoomInput> = {};

  if (body.name !== undefined || !opts.partial) {
    const name = cleanText(body.name, ROOM_NAME_MAX);
    if (name.length < 2) return { ok: false, error: 'Give the room a name (at least 2 characters).' };
    out.name = name;
  }

  if (body.slug !== undefined || !opts.partial) {
    const slug = typeof body.slug === 'string' && body.slug.trim()
      ? body.slug.trim().toLowerCase()
      : out.name ? slugifyRoomName(out.name) : '';
    if (!isValidRoomSlug(slug)) {
      return { ok: false, error: 'The URL name must be 3–48 lowercase letters, digits or hyphens, and not a reserved word.' };
    }
    out.slug = slug;
  }

  if (body.tagline !== undefined) out.tagline = cleanText(body.tagline, ROOM_TAGLINE_MAX);
  else if (!opts.partial) out.tagline = '';

  if (body.source !== undefined || !opts.partial) {
    const src = body.source as { type?: unknown; slug?: unknown; id?: unknown } | undefined;
    if (src?.type === 'collection' && typeof src.slug === 'string' && /^[a-z0-9-]{1,80}$/.test(src.slug)) {
      out.source = { type: 'collection', slug: src.slug };
    } else if (src?.type === 'list' && typeof src.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(src.id)) {
      out.source = { type: 'list', id: src.id };
    } else {
      return { ok: false, error: 'Choose a collection or one of your lists as the room\'s books.' };
    }
  }

  if (body.theme !== undefined || !opts.partial) {
    const t = (body.theme && typeof body.theme === 'object' ? body.theme : {}) as Record<string, unknown>;
    const accent = typeof t.accent_hex === 'string' && HEX_RE.test(t.accent_hex.trim()) ? t.accent_hex.trim().toLowerCase() : null;
    if (typeof t.accent_hex === 'string' && t.accent_hex.trim() && !accent) {
      return { ok: false, error: 'Accent colour must be a hex colour like #9e4a3a.' };
    }
    const logo = cleanHttpsUrl(t.logo_url);
    if (typeof t.logo_url === 'string' && t.logo_url.trim() && !logo) {
      return { ok: false, error: 'Logo must be an https:// image URL.' };
    }
    const home = cleanHttpsUrl(t.home_url);
    if (typeof t.home_url === 'string' && t.home_url.trim() && !home) {
      return { ok: false, error: 'Home link must be an https:// URL.' };
    }
    out.theme = {
      logo_url: logo,
      accent_hex: accent,
      home_url: home,
      home_label: cleanText(t.home_label, ROOM_HOME_LABEL_MAX) || null,
    };
  }

  if (body.allowed_origins !== undefined || !opts.partial) {
    const raw = Array.isArray(body.allowed_origins)
      ? body.allowed_origins
      : typeof body.allowed_origins === 'string'
        ? body.allowed_origins.split(/[\s,]+/)
        : [];
    const hosts = new Set<string>();
    for (const r of raw) {
      if (typeof r !== 'string' || !r.trim()) continue;
      const h = normalizeOriginHost(r);
      if (!h) return { ok: false, error: `"${String(r).slice(0, 60)}" is not a hostname. Use the form example.org.` };
      hosts.add(h);
      if (hosts.size > ROOM_MAX_ORIGINS) return { ok: false, error: `At most ${ROOM_MAX_ORIGINS} sites can frame a room.` };
    }
    out.allowed_origins = [...hosts];
  }

  return { ok: true, value: out };
}

// ── Reads ───────────────────────────────────────────────────────────────────

const ROOM_PROJECTION = { _id: 0 } as const;

export async function getRoomBySlug(db: Db, slug: string): Promise<ReadingRoom | null> {
  if (!isValidRoomSlug(slug)) return null;
  const doc = await db.collection(READING_ROOMS_COLLECTION).findOne(
    { slug, status: 'active' },
    { projection: ROOM_PROJECTION, maxTimeMS: 5000 },
  );
  return (doc as ReadingRoom | null) ?? null;
}

export async function getRoomsForOwner(db: Db, ownerId: string): Promise<ReadingRoom[]> {
  const docs = await db.collection(READING_ROOMS_COLLECTION)
    .find({ owner_id: ownerId, status: 'active' }, { projection: ROOM_PROJECTION, maxTimeMS: 5000 })
    .sort({ updated_at: -1 })
    .limit(MAX_ROOMS_PER_OWNER * 2)
    .toArray();
  return docs as unknown as ReadingRoom[];
}

/** Public shape — never carries owner_id (safe-defaults.md). */
export function serializeRoom(room: ReadingRoom, isOwner: boolean) {
  const base = {
    id: room.id,
    slug: room.slug,
    name: room.name,
    tagline: room.tagline,
    source: room.source,
    theme: room.theme,
    created_at: room.created_at,
    updated_at: room.updated_at,
    is_owner: isOwner,
  };
  return isOwner ? { ...base, allowed_origins: room.allowed_origins } : base;
}

/** Card projection: everything CollectionBookCard reads, and both cover fields (see its docstring). */
export const ROOM_BOOK_CARD_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, editor: 1, year: 1,
  published: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
  thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_card: 1, image_thumb: 1,
  is_first_translation: 1, ft_disposition: 1, localized: 1, resource_type: 1, visible: 1,
} as const;

/** The canonical "live" book filter (CLAUDE.md, Stack). */
const LIVE_BOOK = { visible: true, pages_count: { $gt: 0 } };

/**
 * Books on the shelf, in shelf order: a collection's books oldest first (a
 * room of primary sources reads as a chronology), a list's in the order the
 * owner added them. Hidden books and artwork records never appear.
 */
export async function getRoomBooks(db: Db, room: ReadingRoom): Promise<Document[]> {
  if (room.source.type === 'collection') {
    return db.collection('books')
      .find({ collections: room.source.slug, ...LIVE_BOOK }, { projection: ROOM_BOOK_CARD_PROJECTION, maxTimeMS: 15000 })
      .sort({ year: 1, title: 1 })
      .limit(ROOM_SHELF_LIMIT)
      .toArray();
  }
  const items = await db.collection('user_list_items')
    .find({ list_id: room.source.id, target_type: 'book' }, { projection: { _id: 0, target_id: 1, added_at: 1 }, maxTimeMS: 5000 })
    .sort({ added_at: 1 })
    .limit(ROOM_SHELF_LIMIT)
    .toArray();
  if (!items.length) return [];
  const ids = items.map(i => i.target_id as string);
  const docs = await db.collection('books')
    .find({ $or: [{ id: { $in: ids } }, { slug: { $in: ids } }], ...LIVE_BOOK }, { projection: ROOM_BOOK_CARD_PROJECTION, maxTimeMS: 15000 })
    .toArray();
  const byKey = new Map<string, Document>();
  for (const d of docs) {
    byKey.set(d.id as string, d);
    if (d.slug) byKey.set(d.slug as string, d);
  }
  const seen = new Set<string>();
  const ordered: Document[] = [];
  for (const id of ids) {
    const d = byKey.get(id);
    if (!d || seen.has(d.id as string)) continue;
    seen.add(d.id as string);
    ordered.push(d);
  }
  return ordered;
}

/**
 * Look a book up by id or slug and admit it only if it is in the room's set.
 * Returns the lookup result (so the caller has the canonical slug) or null —
 * null for "not found" and "not in this room" alike, deliberately: a room
 * must not confirm the existence of a book it does not hold.
 *
 * Fails CLOSED on a lookup error: a room that cannot check admits nothing.
 */
export async function findBookInRoom(
  db: Db,
  room: ReadingRoom,
  idOrSlug: string,
  projection?: Document,
): Promise<BookLookupResult | null> {
  const proj = { ...(projection ?? {}), id: 1, slug: 1, collections: 1, visible: 1 };
  let result: BookLookupResult | null;
  try {
    result = await findBookByIdOrSlug(db, idOrSlug, proj);
  } catch {
    return null;
  }
  if (!result) return null;
  const book = result.book as { id?: string; _id?: { toString(): string }; slug?: string; collections?: string[]; visible?: boolean };
  if (book.visible === false) return null;
  const bookId = book.id || book._id?.toString();
  if (!bookId) return null;

  if (room.source.type === 'collection') {
    return Array.isArray(book.collections) && book.collections.includes(room.source.slug) ? result : null;
  }
  try {
    const keys = [bookId, ...(book.slug ? [book.slug] : [])];
    const hit = await db.collection('user_list_items').findOne(
      { list_id: room.source.id, target_type: 'book', target_id: { $in: keys } },
      { projection: { _id: 1 }, maxTimeMS: 5000 },
    );
    return hit ? result : null;
  } catch {
    return null;
  }
}

/**
 * Hostnames allowed to frame a room, for the proxy's X-Frame-Options decision.
 * Empty when the room does not exist — which means DENY, never "anyone".
 */
export async function getRoomEmbedOrigins(db: Db, slug: string): Promise<string[]> {
  if (!isValidRoomSlug(slug)) return [];
  try {
    const doc = await db.collection(READING_ROOMS_COLLECTION).findOne(
      { slug, status: 'active' },
      { projection: { _id: 0, allowed_origins: 1 }, maxTimeMS: 3000 },
    );
    return Array.isArray(doc?.allowed_origins) ? (doc!.allowed_origins as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Does a tenant's OWN catalogue reference this Source Library book?
 *
 * The tenant lockdown admits a book onto a partner subdomain when it is
 * explicitly assigned to that tenant (`books.tenantId`). But partner
 * catalogues also link *external-scan* editions of works they hold —
 * `sl_external_book_id` on `bph_works` (BPH) and `library_catalog_records`
 * (unified-catalogue tenants) — and those books are global (`tenantId`
 * null), so `/embed/<tenant>/book/<slug>` refused them and every
 * "read online" link the catalogue rendered for them was a 404
 * (picatrix, Greater Key of Solomon, Chymische Hochzeit… — see the
 * not_found_reports cluster of 2026-08-23→25).
 *
 * The catalogue row is curated by the partner's own librarians, so it is
 * the authorization: a book their catalogue points at may render inside
 * their reading room. This helper answers only that membership question —
 * visibility/hidden gating stays with the caller, and any book NOT
 * referenced stays locked out exactly as before.
 */

import type { Db, Document } from 'mongodb';
import { supabase } from '@/lib/supabase';
import { findBookByIdOrSlug, type BookLookupResult } from '@/lib/book-lookup';

export async function tenantCatalogReferencesBook(
  tenantSlug: string,
  bookId: string,
): Promise<boolean> {
  if (!tenantSlug || !bookId) return false;
  // bookId is URL-derived and interpolated into a PostgREST .or() filter —
  // restrict to the id alphabet so filter syntax (commas, parens) can't be
  // smuggled in. Real ids are 24-hex or similar opaque tokens.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(bookId)) return false;
  try {
    if (tenantSlug === 'bph') {
      const { data, error } = await supabase
        .from('bph_works')
        .select('ubn')
        .or(`sl_book_id.eq.${bookId},sl_external_book_id.eq.${bookId}`)
        .limit(1);
      if (error) return false;
      return (data?.length ?? 0) > 0;
    }
    const { data, error } = await supabase
      .from('library_catalog_records')
      .select('catalog_id')
      .eq('tenant_id', tenantSlug)
      .or(`sl_book_id.eq.${bookId},sl_external_book_id.eq.${bookId}`)
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    // Fail closed: an unreachable catalogue admits nothing extra.
    return false;
  }
}

/**
 * Book lookup with the full tenant admission rule: a book assigned to the
 * tenant (`books.tenantId`), OR a global book the tenant's catalogue references
 * (above). Without a tenant id this is the plain global lookup.
 *
 * `/book/[id]` applied the catalogue admission (#4218), but the page reader
 * `/book/[id]/page/[pageId]` did a bare tenant-scoped lookup — so on a partner
 * subdomain a catalogue-linked book rendered and every one of its page links
 * 404'd. Reader-side lookups go through here so the two cannot drift again.
 * Visibility/hidden gating stays with the caller, as above.
 */
export async function findBookForTenant(
  db: Db,
  idOrSlug: string,
  projection: Document | undefined,
  tenant: { id?: string | null; slug?: string | null } | null | undefined,
): Promise<BookLookupResult | null> {
  if (!tenant?.id) return findBookByIdOrSlug(db, idOrSlug, projection);

  const scoped = await findBookByIdOrSlug(db, idOrSlug, projection, tenant.id);
  if (scoped) return scoped;

  if (!tenant.slug || tenant.slug === 'default') return null;
  const unscoped = await findBookByIdOrSlug(db, idOrSlug, projection);
  if (!unscoped) return null;
  const book = unscoped.book as { id?: string; _id?: { toString(): string } };
  const bookId = book.id || book._id?.toString();
  if (!bookId) return null;
  return (await tenantCatalogReferencesBook(tenant.slug, bookId)) ? unscoped : null;
}

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

import { supabase } from '@/lib/supabase';

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

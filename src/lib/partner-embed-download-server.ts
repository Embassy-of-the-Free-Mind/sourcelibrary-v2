import { createHash } from 'crypto';
import { resolveTenantId } from '@/lib/tenant-context';
import { trustedClientIp } from '@/lib/client-ip';
import {
  ANON_EMBED_DAILY_BOOK_CAP,
  isPartnerEmbedDownloadFor,
  partnerEmbedTenantFromRequest,
} from '@/lib/partner-embed-download';

/**
 * Server half of the partner-embed anonymous download rule (#7702). The rule
 * and why it is a convenience gate, not a security boundary, are in
 * partner-embed-download.ts; this file only resolves the tenant id and builds
 * the per-visitor cap key.
 *
 * PRIOR ART: src/lib/partner-embed-download.ts — the client-safe half; it
 * cannot import mongodb or crypto, so the lookups live here.
 */

/**
 * True only when the request comes from an allowed partner's embed AND the
 * book belongs to that partner (`book.tenantId`). Referer and Host are
 * client-controlled: callers must still apply the anonymous daily cap.
 */
export async function isPartnerEmbedDownload(
  request: { headers: Headers },
  book: { tenantId?: string | null } | null | undefined,
): Promise<boolean> {
  if (!book?.tenantId) return false;
  const host = request.headers.get('host');
  const referer = request.headers.get('referer');
  const slug = partnerEmbedTenantFromRequest(host, referer);
  if (!slug) return false;
  const tenantId = await resolveTenantId(slug);
  return isPartnerEmbedDownloadFor({ host, referer, bookTenantId: book.tenantId, tenantIds: { [slug]: tenantId } });
}

/**
 * The `download_events.user_id` an anonymous embed visitor is counted under.
 * The IP is hashed, not stored: the cap needs a stable key, not an address.
 */
export function anonymousDownloadCapKey(headers: Headers): string {
  const ip = trustedClientIp(headers);
  return `anon-ip:${createHash('sha256').update(`download-cap:${ip}`).digest('hex').slice(0, 32)}`;
}

export const ANON_EMBED_LIMIT_MESSAGE =
  `Daily download limit reached (${ANON_EMBED_DAILY_BOOK_CAP} books/24h). Try again tomorrow.`;

/**
 * Citation tokens — the quote-link exception to the metered reader (#4357).
 *
 * A published citation must resolve forever: every /q/ shortlink in a
 * footnote, and every quote URL we have ever handed out, points a reader at
 * one specific page. If that page sits beyond the free sample, the wall
 * would break the citation — so the /q/ redirect appends `?cite=<token>`,
 * and the page-content API honors a valid token for THAT page only.
 *
 * The token is a keyed HMAC of the page id: a per-page capability, no
 * expiry (citations don't expire), no database. Holding a quote link to
 * page X lets you read page X — exactly the semantics of a citation — and
 * nothing else: the token doesn't verify for any other page, so it cannot
 * be walked along the book.
 *
 * Server-only (node crypto + a server secret): never import from a client
 * component.
 */
import { createHmac, timingSafeEqual } from 'crypto';

function secret(): string | null {
  // AUTH_SECRET is the keyed secret guaranteed present wherever the app runs
  // (src/lib/auth.ts:220 — NextAuth v5 naming; NEXTAUTH_SECRET kept as the
  // legacy fallback). No fallback VALUE: with no secret we mint nothing and
  // verify nothing.
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null;
}

export function mintCitationToken(pageId: string): string | null {
  const key = secret();
  if (!key || !pageId) return null;
  return createHmac('sha256', key).update(`cite:${pageId}`).digest('hex').slice(0, 32);
}

export function verifyCitationToken(pageId: string, token: string | null | undefined): boolean {
  if (!token || !/^[0-9a-f]{32}$/.test(token)) return false;
  const expected = mintCitationToken(pageId);
  if (!expected) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

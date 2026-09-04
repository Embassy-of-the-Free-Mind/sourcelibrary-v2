/**
 * Invitation tokens — one page, one reader, no account.
 *
 * PRIOR ART: src/lib/citation-token.ts, whose keyed-HMAC-per-resource shape
 * this follows deliberately (same secret, same no-database, same "the token
 * verifies for THAT resource only, so it cannot be walked"). It does not fit
 * as-is because a citation token identifies only a page: it says nothing about
 * WHO holds it, and here the whole point is that the reply is attributable to
 * one invited person without their ever signing in.
 *
 * WHY THIS EXISTS. The review queues require an account (ratings must be
 * attributable) and a visit to /review. For an audience of about 35 readers per
 * language who have never been contacted, that is two barriers in front of a
 * favour we are asking for. An emailed page with a link is one step, and email
 * is the only channel these 893 volunteers have ever given us.
 *
 * THE INVITEE ID IS DERIVED, NOT STORED. `inviteeId` is an HMAC of the email
 * address, formatted as a uuid so it satisfies the volunteer_id shape every
 * review route already validates. Two consequences, both wanted: the same
 * person gets the same id across every page we send them, so per-rater
 * agreement stays computable; and their address never enters the ratings
 * table, which is a public-ish evidence store.
 *
 * Server-only (node crypto + a server secret): never import from a client
 * component.
 */
import { createHmac, timingSafeEqual } from 'crypto';

function secret(): string | null {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null;
}

/** Stable pseudonymous id for an invited reader, in uuid shape. */
export function inviteeIdFor(email: string): string | null {
  const key = secret();
  if (!key || !email.trim()) return null;
  const h = createHmac('sha256', key).update(`invitee:${email.trim().toLowerCase()}`).digest('hex');
  // uuid-shaped so isValidVolunteerId() accepts it unchanged. Version nibble
  // forced to 4 and variant to 8 so it is a well-formed v4-looking value.
  return [h.slice(0, 8), h.slice(8, 12), `4${h.slice(13, 16)}`, `8${h.slice(17, 20)}`, h.slice(20, 32)].join('-');
}

export type InvitePayload = { itemId: string; invitee: string };

/**
 * `<itemId>.<invitee>.<mac>` — everything the confirm page needs, carried in
 * the URL. No database row per invitation: an invite that is never opened
 * should cost us nothing and leave nothing to clean up.
 */
export function mintInviteToken(p: InvitePayload): string | null {
  const key = secret();
  if (!key || !p.itemId || !p.invitee) return null;
  const body = `${encodeURIComponent(p.itemId)}.${p.invitee}`;
  const mac = createHmac('sha256', key).update(`invite:${body}`).digest('hex').slice(0, 32);
  return `${body}.${mac}`;
}

export function verifyInviteToken(token: string | null | undefined): InvitePayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawItem, invitee, mac] = parts;
  if (!/^[0-9a-f]{32}$/.test(mac)) return null;
  const key = secret();
  if (!key) return null;
  const expected = createHmac('sha256', key)
    .update(`invite:${rawItem}.${invitee}`)
    .digest('hex')
    .slice(0, 32);
  try {
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return { itemId: decodeURIComponent(rawItem), invitee };
}

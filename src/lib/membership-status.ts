// PRIOR ART: src/lib/membership.ts (getMembership: database lookup for paid status only, cannot run in the browser or see a student seat); src/lib/memberships.ts (tenant staff roles, a different concept).

/**
 * The one answer to "what is this person to the Ficino Society?". Pure and free
 * of database imports, so the session, the API routes and the browser share it.
 *
 *   paid    - a live Stripe subscription
 *   student - a live sponsored student seat
 *   joined  - signed up free: discussions, no member benefits
 *   none
 *
 * `membership.active` means paid and nothing else: it marks a contributor on the
 * public list and unlocks dedication, so a student seat must never set it.
 */

export type MembershipKind = 'paid' | 'student' | 'joined' | 'none';

/** A failed renewal gets this long for Stripe's retries before benefits lapse. */
export const PAID_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export interface StoredMembership {
  active?: boolean;
  expiresAt?: Date | string | null;
  joined?: boolean;
  student?: { expiresAt?: Date | string | null } | null;
}

export interface MembershipState {
  kind: MembershipKind;
  /** When this kind stops being true (ms since epoch); null if it does not lapse. */
  until: number | null;
}

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function membershipState(
  m: StoredMembership | null | undefined,
  now: number = Date.now(),
): MembershipState {
  if (m?.active) {
    const expires = toMs(m.expiresAt);
    if (expires === null) return { kind: 'paid', until: null };
    const until = expires + PAID_GRACE_MS;
    if (until > now) return { kind: 'paid', until };
  }

  // A seat with no readable end date is not a seat: unlike a subscription,
  // no webhook will ever come along to end it.
  const seatEnds = toMs(m?.student?.expiresAt);
  if (seatEnds !== null && seatEnds > now) return { kind: 'student', until: seatEnds };

  return { kind: m?.joined ? 'joined' : 'none', until: null };
}

/** Lifts the download cap and opens early access. A free join does not. */
export function hasMemberBenefits(kind: unknown): boolean {
  return kind === 'paid' || kind === 'student';
}

/** Reads `session.user.membership`, which holds a kind, or null for none. */
export function sessionHasMemberBenefits(user: unknown): boolean {
  return hasMemberBenefits((user as { membership?: unknown } | null | undefined)?.membership);
}

/** Dedicating a book is a contributor's thank-you, so paid only. */
export function sessionIsPaidMember(user: unknown): boolean {
  return (user as { membership?: unknown } | null | undefined)?.membership === 'paid';
}

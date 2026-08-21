import type { Db } from 'mongodb';
import { classifyHeaders } from '@/lib/analytics-ingest';

/**
 * Append-only log of authentication events.
 *
 * `users.lastLogin` / `loginCount` already record that a person signed in, but
 * they are STATE, not history: `lastLogin` is overwritten on every sign-in and
 * neither field records which provider was used. So the collection can answer
 * "who signed in, and when last" and nothing else — not sign-ins per day, not
 * Google vs magic link, not whether a requested magic link was ever used.
 *
 * That gap has a concrete cost. After the 2026-07-29 auth dependency bump
 * (next-auth beta.32, #3431) the open question was specifically whether the
 * magic-link path still sent mail — nodemailer stayed on 8.x because next-auth
 * caps its peer at `^8.0.5`. `lastLogin` could not answer it: a successful
 * sign-in looks identical whichever provider produced it, so the provider had
 * to be inferred from the ABSENCE of a `verification_tokens` row. An inference
 * from absence is exactly the reasoning CLAUDE.md warns about.
 *
 * Two events are recorded, and the pair is the point:
 *   - `magic_link_sent` when a link is mailed
 *   - `signin` when authentication actually completes
 * A `magic_link_sent` with no matching `signin` is a broken magic-link flow —
 * visible without anyone having to test sign-in by hand.
 *
 * Writes are best-effort and never block authentication: a logging failure must
 * not stop someone signing in. Every call site wraps this, and it also swallows
 * internally, because the failure mode of a telemetry write is silence, not a
 * locked-out user.
 */

export type AuthEventKind = 'signin' | 'magic_link_sent';

export interface AuthEventInput {
  kind: AuthEventKind;
  /** 'google' | 'nodemailer' | … — the NextAuth provider id. */
  provider?: string | null;
  email?: string | null;
  /** True when this sign-in also created the account. */
  isNewUser?: boolean;
  /** Inbound request headers, when the calling context can reach them. */
  headers?: Headers | null;
}

export interface AuthEventDoc {
  kind: AuthEventKind;
  provider: string;
  email: string | null;
  isNewUser: boolean;
  ts: Date;
  day: string;
  /** Classified at WRITE time — see analytics-ingest.ts. Retroactive is impossible. */
  traffic_class: string | null;
  user_agent: string | null;
  ip: string | null;
  host: string | null;
}

/** Build the document. Pure, so the shape is testable without a database. */
export function buildAuthEvent(input: AuthEventInput, now: Date): AuthEventDoc {
  // Classification is best-effort: `headers()` throws outside a request scope
  // (background jobs, tests), and a null class is honest where a fabricated
  // 'human' would quietly contaminate every later count.
  let cls: string | null = null;
  let userAgent: string | null = null;
  let ip: string | null = null;
  let host: string | null = null;
  if (input.headers) {
    try {
      const c = classifyHeaders(input.headers);
      cls = c.cls;
      userAgent = c.userAgent || null;
      ip = c.ip;
      host = c.host;
    } catch { /* leave null — see above */ }
  }

  return {
    kind: input.kind,
    // NextAuth reports the email provider as 'nodemailer'; normalize absent to
    // 'unknown' rather than dropping the key, so a provider breakdown never
    // silently loses rows to a missing field.
    provider: input.provider || 'unknown',
    email: input.email ? input.email.toLowerCase() : null,
    isNewUser: input.isNewUser === true,
    ts: now,
    day: now.toISOString().slice(0, 10),
    traffic_class: cls,
    user_agent: userAgent,
    ip,
    host,
  };
}

/**
 * Append one auth event. Never throws.
 *
 * No TTL index — this repo removed automated retention deliberately (#2976) and
 * prunes by hand. Volume is negligible: ~3,100 users have ever signed in, and
 * sign-ins run a few per day, so the collection grows by order kilobytes a year.
 */
export async function recordAuthEvent(db: Db, input: AuthEventInput): Promise<void> {
  try {
    await db.collection('auth_events').insertOne(buildAuthEvent(input, new Date()));
  } catch (error) {
    console.error('[auth-events] write failed:', error instanceof Error ? error.message : error);
  }
}

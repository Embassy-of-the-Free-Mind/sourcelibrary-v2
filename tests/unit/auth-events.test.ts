import { describe, it, expect } from 'vitest';
import { buildAuthEvent } from '@/lib/auth-events';

/**
 * These call `buildAuthEvent` rather than asserting on the source of auth.ts.
 * A source-shape test here could only catch deletion, never a wrong field name
 * — and a wrong field name is the exact defect this module exists to prevent
 * (#3409: a metric reported as missing because it was queried under posthog's
 * legacy singular property names).
 */

const NOW = new Date('2026-07-29T09:26:52.431Z');

function headersWith(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe('buildAuthEvent', () => {
  it('records the provider, which lastLogin cannot', () => {
    const ev = buildAuthEvent({ kind: 'signin', provider: 'google', email: 'A@Example.com' }, NOW);
    expect(ev.kind).toBe('signin');
    expect(ev.provider).toBe('google');
    // Lowercased so a provider/user breakdown doesn't split on casing.
    expect(ev.email).toBe('a@example.com');
    expect(ev.ts).toEqual(NOW);
    expect(ev.day).toBe('2026-07-29');
  });

  it('never drops a row to a missing provider', () => {
    // A missing key would silently vanish from a `group by provider`; 'unknown'
    // stays countable.
    expect(buildAuthEvent({ kind: 'signin' }, NOW).provider).toBe('unknown');
  });

  it('classifies at write time from the request headers', () => {
    const ev = buildAuthEvent({
      kind: 'signin',
      provider: 'nodemailer',
      headers: headersWith({
        'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'x-forwarded-for': '203.0.113.44',
        host: 'sourcelibrary.org',
      }),
    }, NOW);

    expect(ev.traffic_class).toBe('human');
    expect(ev.user_agent).toContain('Chrome');
    expect(ev.host).toBe('sourcelibrary.org');
    // Anonymized — last octet zeroed before storage.
    expect(ev.ip).toBe('203.0.113.0');
  });

  it('classifies a bot as a bot rather than as a member', () => {
    const ev = buildAuthEvent({
      kind: 'signin',
      headers: headersWith({ 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' }),
    }, NOW);
    expect(ev.traffic_class).not.toBe('human');
  });

  it('reports an unknown class as null rather than inventing one', () => {
    // No request scope (background job, test). CLAUDE.md: when an instrument
    // cannot measure, say so — a plausible wrong value is worse than none.
    const ev = buildAuthEvent({ kind: 'signin', provider: 'google' }, NOW);
    expect(ev.traffic_class).toBeNull();
    expect(ev.user_agent).toBeNull();
    expect(ev.ip).toBeNull();
  });

  it('distinguishes a link being sent from a sign-in completing', () => {
    // The pair is the point: sent-without-signin is a broken magic-link flow.
    const sent = buildAuthEvent({ kind: 'magic_link_sent', provider: 'nodemailer' }, NOW);
    const done = buildAuthEvent({ kind: 'signin', provider: 'nodemailer' }, NOW);
    expect(sent.kind).not.toBe(done.kind);
    expect([sent.kind, done.kind]).toEqual(['magic_link_sent', 'signin']);
  });

  it('defaults isNewUser to false rather than undefined', () => {
    // undefined would be indistinguishable from "not recorded" in a query.
    expect(buildAuthEvent({ kind: 'signin' }, NOW).isNewUser).toBe(false);
    expect(buildAuthEvent({ kind: 'signin', isNewUser: true }, NOW).isNewUser).toBe(true);
  });

  it('stores every field a later query will need', () => {
    // Guards the #3405 failure directly: analytics_events stored no user-agent,
    // so its contamination could never be cleaned retroactively.
    const ev = buildAuthEvent({
      kind: 'signin', provider: 'google', email: 'x@y.z',
      headers: headersWith({ 'user-agent': 'Chrome', host: 'sourcelibrary.org' }),
    }, NOW);
    for (const key of ['kind','provider','email','isNewUser','ts','day','traffic_class','user_agent','ip','host']) {
      expect(Object.hasOwn(ev, key), `missing ${key}`).toBe(true);
    }
  });
});

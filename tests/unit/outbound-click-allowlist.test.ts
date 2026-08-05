import { describe, it, expect } from 'vitest';
import { ALLOWED_EVENTS, ALLOWED_PROPS } from '@/lib/analytics-event-allowlist';
import { outboundClickPayload } from '@/lib/outbound-click';

/**
 * Guards the silent half of outbound click logging.
 *
 * POST /api/analytics/event answers 200 and DROPS any prop key not in
 * ALLOWED_PROPS, and rejects any event not in ALLOWED_EVENTS. So a payload that
 * has drifted from the allowlist does not fail loudly — the field is simply
 * absent when someone queries for it weeks later. These tests exercise the real
 * payload builder against the real allowlists, so either side drifting is red.
 *
 * NOT a source-grep test (CLAUDE.md: "a test that greps source is not a guard").
 * Negative controls verified by hand: removing 'donate_click' from
 * ALLOWED_EVENTS, removing 'locale' from ALLOWED_PROPS, and adding an
 * un-allowlisted key to outboundClickPayload each turn this file red.
 */

// Every (intent, locale) shape the component can emit. If OutboundLink gains a
// prop, add its shape here — that is the point of the file.
const SHAPES = [
  { label: 'donate, no locale', input: { surface: 'support_business', channel: 'naf_donorperfect' } },
  { label: 'donate, with locale', input: { surface: 'support', channel: 'efm_stripe', locale: 'es' } },
  { label: 'donate to email', input: { surface: 'support', channel: 'email', locale: 'en' } },
  {
    label: 'inquiry',
    input: { surface: 'sponsors_hero', channel: 'email', intent: 'inquiry' as const },
  },
];

describe('outbound click payloads survive the analytics allowlist', () => {
  it.each(SHAPES)('$label — event name is accepted by the route', ({ input }) => {
    const { event } = outboundClickPayload(input);
    expect(ALLOWED_EVENTS.has(event)).toBe(true);
  });

  it.each(SHAPES)('$label — every prop key is persisted, none silently dropped', ({ input }) => {
    const { props } = outboundClickPayload(input);
    const dropped = Object.keys(props).filter((k) => !ALLOWED_PROPS.has(k));
    expect(dropped).toEqual([]);
  });

  it('emits at least one prop for every shape — an empty payload is unattributable', () => {
    for (const { input } of SHAPES) {
      const { props } = outboundClickPayload(input);
      expect(Object.keys(props).length).toBeGreaterThan(0);
    }
  });

  it('distinguishes money from inquiry, so one cannot be read as the other', () => {
    expect(outboundClickPayload({ surface: 's', channel: 'email' }).event).toBe('donate_click');
    expect(
      outboundClickPayload({ surface: 's', channel: 'email', intent: 'inquiry' }).event,
    ).toBe('inquiry_click');
  });

  it('always carries surface AND channel — either alone cannot answer which page sent a gift where', () => {
    for (const { input } of SHAPES) {
      const { props } = outboundClickPayload(input);
      expect(props.surface, 'surface missing').toBeTruthy();
      expect(props.channel, 'channel missing').toBeTruthy();
    }
  });

  it('omits locale rather than sending an empty string', () => {
    const { props } = outboundClickPayload({ surface: 's', channel: 'email', locale: '' });
    expect('locale' in props).toBe(false);
  });
});

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
  // /give and the /support mount of <GiveForm> attach what the donor selected
  // before the handoff. Read as intent, never revenue.
  {
    label: 'give, one-time with amount',
    input: { surface: 'give', channel: 'efm_stripe', locale: 'en', amount: 25, frequency: 'once' as const },
  },
  {
    label: 'give, monthly with amount',
    input: { surface: 'support', channel: 'naf_donorperfect', locale: 'en', amount: 10, frequency: 'monthly' as const },
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

  // The allowlist check above is one-directional: it proves nothing we emit gets
  // dropped, and says nothing about a field we STOP emitting. Both failures look
  // identical in the data — the key is simply absent weeks later — so the
  // reverse assertion has to be stated separately. Found by negative control:
  // deleting the `amount` line from outboundClickPayload left every other test
  // in this file green.
  it.each(SHAPES.filter((s) => 'amount' in s.input || 'frequency' in s.input))(
    '$label — an input that declares amount/frequency actually emits them',
    ({ input }) => {
      const { props } = outboundClickPayload(input);
      const declared = input as { amount?: number; frequency?: string };
      if (declared.amount !== undefined) expect(props.amount).toBe(declared.amount);
      if (declared.frequency !== undefined) expect(props.frequency).toBe(declared.frequency);
    },
  );

  // An amount of 0 is not a choice anyone made — it is a surface that doesn't
  // ask, reporting one. Left in, it averages into the ladder analysis as a real
  // decision to give nothing.
  it('omits amount entirely on surfaces that never asked for one', () => {
    const { props } = outboundClickPayload({ surface: 'sponsors_hero', channel: 'email' });
    expect('amount' in props).toBe(false);
    expect('frequency' in props).toBe(false);
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

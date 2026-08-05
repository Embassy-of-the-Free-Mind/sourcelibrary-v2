/**
 * The analytics payload for an outbound conversion click, built as a pure
 * function so it can be tested without a DOM.
 *
 * <OutboundLink> calls this and hands the result to trackEvent(). The test
 * (tests/unit/outbound-click-allowlist.test.ts) calls the same function and
 * checks every key it produces against the REAL route allowlist — which is the
 * only way to catch this component's actual failure mode: a prop added here but
 * not to ALLOWED_PROPS is dropped by the route with a 200 and no error, and the
 * loss is invisible until someone queries for the field weeks later.
 */

export type OutboundIntent = 'donate' | 'inquiry';

export interface OutboundClickInput {
  surface: string;
  channel: string;
  locale?: string;
  intent?: OutboundIntent;
}

export interface OutboundClickPayload {
  event: 'donate_click' | 'inquiry_click';
  props: Record<string, string>;
}

export function outboundClickPayload({
  surface,
  channel,
  locale,
  intent = 'donate',
}: OutboundClickInput): OutboundClickPayload {
  const props: Record<string, string> = { surface, channel };
  // Omit rather than send undefined: trackEvent strips undefined anyway, but an
  // absent key and an empty string mean different things downstream ("this
  // surface has no locale" vs "the locale was blank").
  if (locale) props.locale = locale;

  return {
    event: intent === 'donate' ? 'donate_click' : 'inquiry_click',
    props,
  };
}

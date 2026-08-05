'use client';

import { trackEvent } from '@/lib/track-event';
import { outboundClickPayload, type OutboundIntent } from '@/lib/outbound-click';

/**
 * A link that hands the visitor to a destination we don't own — the Embassy's
 * Stripe page, NAF's DonorPerfect form, or their mail client — and logs the
 * click on the way out.
 *
 * Why this exists: every giving and partnership route on the site ends off-site.
 * Nothing on our side saw the handoff, and nothing on the other side reports back
 * (no donation webhook, no attribution — see the ops-repo handoff
 * `2026-06-29-metrics-feedback-skills-donation-flow.md`). So the question "does
 * /support/business reach a single business owner?" was unanswerable from both
 * ends simultaneously: we couldn't see the intent, and we couldn't see the gift.
 * This closes the half we control.
 *
 * A CLICK IS NOT A GIFT. It is the last event we can observe, which makes it the
 * only denominator we own — read it as intent-to-give, never as revenue, and
 * never divide it into a donation total from another system to manufacture a
 * conversion rate. The two numbers come from different populations (CLAUDE.md:
 * "a metric's name is a claim about its denominator").
 *
 * Bot traffic is STORED and tagged here rather than dropped, matching the rest of
 * /api/analytics/event — these clicks are low-volume so crawlers can't swamp
 * them, and a crawler hitting a donate button is itself worth seeing. Read paths
 * that want humans filter on `traffic_class`.
 */
export default function OutboundLink({
  href,
  surface,
  channel,
  locale,
  intent = 'donate',
  amount,
  frequency,
  className,
  newTab,
  children,
}: {
  href: string;
  /** Which page or component emitted the click — `support`, `support_business`, … */
  surface: string;
  /** Where it goes — `naf_donorperfect`, `efm_stripe`, `email`. */
  channel: string;
  locale?: string;
  /** `donate` for money, `inquiry` for a partnership/licensing/dataset ask. */
  intent?: OutboundIntent;
  /** On surfaces that ask before handing off (/give): what the donor selected. */
  amount?: number;
  frequency?: 'once' | 'monthly';
  className?: string;
  /** Defaults to true for http(s), false for mailto — a mailto in a new tab leaves a blank one behind. */
  newTab?: boolean;
  children: React.ReactNode;
}) {
  const openInNewTab = newTab ?? !href.startsWith('mailto:');

  return (
    <a
      href={href}
      className={className}
      onClick={() => {
        const { event, props } = outboundClickPayload({ surface, channel, locale, intent, amount, frequency });
        trackEvent(event, props);
      }}
      {...(openInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  );
}

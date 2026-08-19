/**
 * Fire-and-forget client tracker for value-moment events (cite, share, quote
 * copy, DOI view, download) → POST /api/analytics/event. Uses sendBeacon so it
 * survives navigation (e.g. a share that opens a new tab); falls back to a
 * keepalive fetch. Never throws — analytics must not break an interaction.
 */
export function trackEvent(
  event:
    | 'cite'
    | 'share'
    | 'quote_copy'
    | 'doi_view'
    | 'download'
    | 'signin_view'
    | 'signup_start'
    // Magic-link interstitial (/auth/confirm). `confirm_view` fires when someone
    // opens the link from their email, `confirm_click` when they press through to
    // the callback. The gap between them is the cost of the prefetch-safe second
    // click, and until these existed it was pure guesswork — a token that is
    // never consumed looks identical whether the mail was never opened, the
    // interstitial was abandoned, or the link was mangled in transit.
    | 'confirm_view'
    | 'confirm_click'
    // Onboarding form (/welcome). `welcome_view` on mount, then exactly one of
    // `welcome_save` / `welcome_skip`. The form shipped with no instrumentation,
    // so a completion rate of 4-in-3,854 was indistinguishable from a page
    // nobody could reach — which is exactly what it turned out to be (#3448).
    | 'welcome_view'
    | 'welcome_save'
    | 'welcome_skip'
    // Outbound conversion clicks, fired by <OutboundLink>. `donate_click` is a
    // handoff to a payment destination (NAF's DonorPerfect form, the Embassy's
    // Stripe link); `inquiry_click` is a handoff to email for a partnership,
    // licensing, dataset, or library ask. Both leave our origin, so the click is
    // the last thing we can see — the gift itself lands in someone else's system
    // with no webhook back to us. Never treat the count as revenue.
    | 'donate_click'
    | 'inquiry_click'
    // give_nav_click: a press on a control that navigates to /give, carrying
    // `source` ('header' | 'footer'). The referrer cannot answer this — see the
    // note in analytics-event-allowlist.ts. Relies on this function's sendBeacon
    // transport to survive the navigation it triggers.
    | 'give_nav_click',
  props?: Record<string, string | number | boolean | undefined>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const clean: Record<string, string | number | boolean> = {};
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v !== undefined) clean[k] = v;
      }
    }
    const body = JSON.stringify({ event, props: clean });
    const url = '/api/analytics/event';
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      if (ok) return;
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never throw */
  }
}

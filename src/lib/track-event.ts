/**
 * Fire-and-forget client tracker for value-moment events (cite, share, quote
 * copy, DOI view, download) → POST /api/analytics/event. Uses sendBeacon so it
 * survives navigation (e.g. a share that opens a new tab); falls back to a
 * keepalive fetch. Never throws — analytics must not break an interaction.
 */
export function trackEvent(
  event: 'cite' | 'share' | 'quote_copy' | 'doi_view' | 'download' | 'signin_view',
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

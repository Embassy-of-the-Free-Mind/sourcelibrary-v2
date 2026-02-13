/**
 * Google Analytics custom event helper.
 *
 * Uses the gtag() function injected by @next/third-parties/google.
 * All calls are fire-and-forget — failures are silently ignored so they
 * never break the UI.
 */

type GTagEvent = {
  action: string;
  category?: string;
  label?: string;
  value?: number;
  [key: string]: string | number | undefined;
};

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function sendGAEvent({ action, category, label, value, ...rest }: GTagEvent) {
  try {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', action, {
        event_category: category,
        event_label: label,
        value,
        ...rest,
      });
    }
  } catch {
    // Never throw from analytics
  }
}

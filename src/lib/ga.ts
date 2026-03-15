/**
 * Google Analytics event helper — consent-aware.
 *
 * Events are silently dropped if the user hasn't accepted analytics cookies.
 * This keeps call sites clean: they just call sendGAEvent() without worrying about consent.
 */

import { hasConsented } from './consent';

interface GAEventParams {
  action: string;
  category?: string;
  label?: string;
  value?: number;
  [key: string]: string | number | undefined;
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function sendGAEvent(params: GAEventParams) {
  if (typeof window === 'undefined') return;
  if (!hasConsented()) return;
  if (!window.gtag) return;

  const { action, category, label, value, ...rest } = params;
  window.gtag('event', action, {
    event_category: category,
    event_label: label,
    value,
    ...rest,
  });
}

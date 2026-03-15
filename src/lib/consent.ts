/**
 * Cookie/analytics consent management.
 *
 * Consent state is stored in localStorage (not a cookie — no consent needed for that).
 * Three states: 'accepted' | 'declined' | null (not yet chosen).
 */

const STORAGE_KEY = 'sl_analytics_consent';

export type ConsentState = 'accepted' | 'declined' | null;

export function getConsent(): ConsentState {
  if (typeof window === 'undefined') return null;
  const val = localStorage.getItem(STORAGE_KEY);
  if (val === 'accepted' || val === 'declined') return val;
  return null;
}

export function setConsent(state: 'accepted' | 'declined') {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, state);
  window.dispatchEvent(new CustomEvent('sl_consent_change', { detail: state }));
}

export function clearConsent() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('sl_consent_change', { detail: null }));
}

export function hasConsented(): boolean {
  return getConsent() === 'accepted';
}

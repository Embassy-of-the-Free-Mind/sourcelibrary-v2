/**
 * Per-browser volunteer ID for the human-in-the-loop review site.
 * Generated client-side as a UUID, stored in localStorage.
 * Anonymous by design — no PII, no link to login.
 */

const STORAGE_KEY = 'sl-volunteer-id';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateVolunteerId(): string {
  if (typeof window === 'undefined') return '';
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = uuid();
  window.localStorage.setItem(STORAGE_KEY, id);
  return id;
}

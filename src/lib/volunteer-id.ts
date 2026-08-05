/**
 * FALLBACK volunteer ID for a signed-out visitor browsing the review queues.
 *
 * This used to be the only identity the review site had, described here as
 * "anonymous by design". That was reversed on 2026-08-05: ratings are now
 * attributed to the signed-in account (useReviewQueue), because an anonymous
 * rating cannot be credited, cannot be matched to what its author told us they
 * read, and splits across devices — one reader on a phone and a laptop counted
 * as two raters, which quietly corrupts any agreement measure built on top.
 *
 * What remains is this: a signed-out visitor still gets a stable id so the
 * queue can dedupe what it shows them while they look around. They cannot
 * submit.
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

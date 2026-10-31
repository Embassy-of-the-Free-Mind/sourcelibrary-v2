// PRIOR ART: scripts/lib/pipeline-hold.mjs (the hold itself; re-exports these). Split out so a READ-only
// script (the /admin dashboard snapshot) can name the reasons without importing the hold writers, which
// would register it as a books writer in scripts/lib/lanes.mjs.
//
// Catalogue records with no fetched pages (#7343): not decisions about a book but books not yet
// acquired. Reported apart as "not acquired" by scripts/audit/hold-release-check.mjs, and left out of the
// held count on /admin, where 409K of them hid the ~55K holds that are decisions (#7860 group 1).
export const NOT_ACQUIRED_HOLD_REASONS = Object.freeze(['manifest-only-lazy-pages', 'acquisition-wave-2026-10b']);
export const isNotAcquiredReason = (reason) => NOT_ACQUIRED_HOLD_REASONS.includes(reason);

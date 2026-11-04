// PRIOR ART: scripts/lib/pipeline-hold.mjs (the hold itself; re-exports these). Split out so a READ-only
// script (the /admin dashboard snapshot) can name the reasons without importing the hold writers, which
// would register it as a books writer in scripts/lib/lanes.mjs.
//
// Catalogue records with no fetched pages (#7343): not decisions about a book but books not yet
// acquired. Reported apart as "not acquired" by scripts/audit/hold-release-check.mjs, and left out of the
// held count on /admin, where 409K of them hid the ~55K holds that are decisions (#7860 group 1).
export const NOT_ACQUIRED_HOLD_REASONS = Object.freeze(['manifest-only-lazy-pages', 'acquisition-wave-2026-10b']);
export const isNotAcquiredReason = (reason) => NOT_ACQUIRED_HOLD_REASONS.includes(reason);

// The books siku-translate-lane.mjs owns and translates while they stay held (#5600). Here so the reader-request lane
// can name them without a cycle: the Siku lane reads that lane's request judge (#7690).
// zh-histories-7546: the Four Histories (Shiji, Hanshu, Hou Hanshu, Sanguozhi), Siku copies OCR'd by the Paddle lane on
// 2026-10-28 (#7546). Derek 2026-10-29: "get more chinese translated". They go first, his 10-27 priority volumes first.
export const SIKU_LANE_HOLDS = Object.freeze(['paddle-zh-5600-ocr-only', 'gpu-backlog-5660', 'zh-histories-7546']);

// zh-shi-ji-8053: the Siku 史部 and 集部 volumes imported from IA's CADAL mirror (#8053), hidden, for OCR only by the
// Paddle SKQS lane (#5600). Deliberately NOT in SIKU_LANE_HOLDS: translating them is out of scope, and the Siku
// translation lane is stopped (#7914). Release only by decision ("release zh-shi-ji-8053"), with --to ocr_complete.
export const ZH_SHI_JI_HOLD = 'zh-shi-ji-8053';

// zh-complete-sets-8053: the missing volumes of Siku 經部/子部 works we already hold in part, imported hidden from IA's
// CADAL mirror (#8053) so each set is whole. For OCR only, by the Paddle SKQS lane (#5600). Deliberately NOT in
// SIKU_LANE_HOLDS: the Siku translation lane is stopped (#7914). Release only by decision ("release
// zh-complete-sets-8053"), with --to ocr_complete.
export const ZH_COMPLETE_SETS_HOLD = 'zh-complete-sets-8053';

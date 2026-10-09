// PRIOR ART: src/lib/bot-gate.ts, src/lib/traffic-classification.ts — both
// classify a caller by what it SAYS (its UA); this records what it DOES. The
// detector side is scripts/workers/traffic-anomaly-alert.mjs. none elsewhere
// (searched src/lib, scripts/{lib,workers,audit} for honeypot/tripwire/trap).

/**
 * Tripwire (#5995): a URL that no person can reach and no polite crawler will.
 *
 * Every book page carries a link to it that is invisible (display:none,
 * aria-hidden, out of the tab order), and robots.txt disallows it for EVERY
 * user-agent group. So a fetch of this path is, by construction, a client that
 * parses links out of raw HTML and ignores robots.txt — a scraper, whatever
 * user-agent it wears.
 *
 * Why this exists: the AS401560 fleet (#5993) read ~15K pages over three weeks
 * at ~100 reads/day per /24 — under every volume threshold the detector has.
 * A threshold on a unit the operator can subdivide is one the operator
 * chooses; a tripwire has no threshold to sit under.
 *
 * It RECORDS, it does not block. Known innocent trippers exist (link-prefetch
 * extensions, some accessibility and archiving tools), so a hit is evidence for
 * the detector to weigh alongside reading shape, never a verdict on its own.
 */
export const TRIPWIRE_PATH = '/catalog/complete';

/** Mongo collection: one doc per (UTC day, /24, user-agent), with a hit count. */
export const TRIPWIRE_COLLECTION = 'tripwire_hits';

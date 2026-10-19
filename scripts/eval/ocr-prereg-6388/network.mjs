// PRIOR ART: panel-key.mjs in this directory (#6434). The consensus network, key and scorer live there; this file only
// names what adjudicate.mjs (Amendment 2, #6388) takes from it, so the adjudicated key is built on the very same
// alignment, normaliser (lib/metrics.mjs normalizeForScript) and outcome code as the panel and trends.mjs.
export { MAX_CHARS, NORMALISER_VERSION, STRATA, READERS, isZh, norm, outcomeOf, buildNetwork, accepted, distToKey } from './panel-key.mjs';

// Shared-secret check for the embedding/CLIP server (scripts/workers/embedding-server.mjs)
// and the header builder for scripts that call it. Issue #6206.
//
// PRIOR ART: src/lib/clip.ts (clipHeaders) — same header for the TypeScript callers; this
// module is plain .mjs so the worker and the scripts under scripts/ can import it without a build.
//
// Rollout mode: when EMBED_SERVER_KEY is unset the check allows everything, so the code can
// ship and be deployed before the key exists. Setting the key on the box turns enforcement on.

import { timingSafeEqual } from 'node:crypto';

export const EMBED_KEY_HEADER = 'x-embed-key';

/** Routes that never need the key (liveness probes). Bare path only, query string ignored. */
export const OPEN_PATHS = new Set(['/health']);

/**
 * Pure decision: may this request proceed?
 * @param {{ key: string | undefined, headerValue: string | string[] | undefined, path: string }} a
 * @returns {{ ok: boolean, mode: 'rollout' | 'open-path' | 'authorized' | 'denied' }}
 */
export function checkEmbedAuth({ key, headerValue, path }) {
  const bare = String(path || '').split('?')[0];
  if (OPEN_PATHS.has(bare)) return { ok: true, mode: 'open-path' };
  if (!key) return { ok: true, mode: 'rollout' };
  if (typeof headerValue !== 'string' || headerValue.length === 0) return { ok: false, mode: 'denied' };
  const a = Buffer.from(headerValue);
  const b = Buffer.from(key);
  if (a.length !== b.length) return { ok: false, mode: 'denied' };
  return timingSafeEqual(a, b) ? { ok: true, mode: 'authorized' } : { ok: false, mode: 'denied' };
}

/**
 * Logger for 401s, so a caller that lost the key shows up in `journalctl -u sl-embedding-server`
 * instead of only as an empty Images tab. One line per window (default 1 min): the first denial's
 * path, remote address and user agent, plus how many more were denied in the previous window.
 * Never logs the header value. A scanner hammering the port costs one line a minute.
 * @param {{ log?: (line: string) => void, now?: () => number, windowMs?: number }} [o]
 * @returns {(d: { path?: string, remote?: string, userAgent?: string }) => void}
 */
export function createDenialLog({ log = console.warn, now = Date.now, windowMs = 60_000 } = {}) {
  let windowStart = -Infinity;
  let suppressed = 0;
  return ({ path, remote, userAgent } = {}) => {
    const t = now();
    if (t - windowStart < windowMs) { suppressed++; return; }
    const prior = suppressed > 0 ? ` (+${suppressed} more denied in the previous window)` : '';
    windowStart = t;
    suppressed = 0;
    const bare = String(path || '').split('?')[0].slice(0, 80);
    const ua = String(userAgent || '-').slice(0, 80);
    log(`embed-auth: 401 ${bare} from ${remote || '-'} ua=${JSON.stringify(ua)}${prior}`);
  };
}

/** Headers for a JSON POST to the embedding server; adds x-embed-key when EMBED_SERVER_KEY is set. */
export function embedAuthHeaders(env = process.env) {
  const headers = { 'Content-Type': 'application/json' };
  if (env.EMBED_SERVER_KEY) headers[EMBED_KEY_HEADER] = env.EMBED_SERVER_KEY;
  return headers;
}

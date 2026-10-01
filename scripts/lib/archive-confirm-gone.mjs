/**
 * Confirm a "source is gone" verdict before anything terminal is written (#4611).
 *
 * PRIOR ART: scripts/maintenance/archiving-watchdog.mjs probeUrl() — ONE 12 s
 * attempt on ONE page at concurrency 6; that single probe is the defect this file
 * exists to back up, so it stays the cheap first pass and this is the second.
 * /root/claude-jobs/resource-5462/probe.mjs (#5462) is the measurement that sized
 * the defect (3 pages x 3 attempts x 45 s, 1 per host); it is an out-of-repo,
 * one-shot, read-only sweep with hard-coded paths, so its rules are lifted here
 * rather than imported. scripts/lib/host-breaker.mjs is a scheduling breaker for
 * archivers, not a confirmation step — it never decides that a source is dead.
 *
 * WHY. The watchdog parked a book `needs_attention / archive_verdict: escalated`
 * ("likely gone") on two probe timeouts a week apart. #5462 re-probed the 721
 * books parked that way and found 709 alive (98%). `needs_attention` is excluded
 * from every orchestrator phase, so each false verdict is a book we own and stop
 * serving, with no path back.
 *
 * THE RULE. `gone` only when EVERY sample URL finally answered a definite
 * HTTP 403/404/410. Any 2xx that is not an HTML page is `alive`. Anything else — timeout, 5xx, 429,
 * network error, 400, a mix — is `unconfirmed`: not a fact about the source, so
 * the book stays 'unreachable' and is retried next run. For Internet Archive, an
 * item whose metadata answers (present, not dark) is never `gone`, whatever its
 * page URLs did — a stale page URL is not the same fact as a dead item.
 *
 * Every probe is serialized per host (concurrency 1) and retried with backoff, so
 * the confirmation is not competing with other requests to the host it is judging.
 * Nothing here writes; the caller records `evidence` on the book.
 */

export const DEFINITE_GONE_STATUSES = [403, 404, 410];

export const CONFIRM_DEFAULTS = {
  timeoutMs: 45_000,
  attempts: 3,
  backoffMs: 5_000,   // x attempt number, between retries of one URL
  hostGapMs: 1_500,   // minimum spacing between two requests to one host
  samples: 3,
};

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** First / middle / last — three pages from different parts of the book. */
export function pickSpread(items, n = CONFIRM_DEFAULTS.samples) {
  const arr = [...new Set((items || []).filter(Boolean))];
  if (arr.length <= n) return arr;
  if (n === 1) return [arr[0]];
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

/** Per-host FIFO with a minimum gap: at most one in-flight request per host. */
export function createHostQueue({ gapMs = CONFIRM_DEFAULTS.hostGapMs, sleep = realSleep, now = Date.now } = {}) {
  const hosts = new Map();
  return function withHost(host, fn) {
    const st = hosts.get(host) || { chain: Promise.resolve(), next: 0 };
    hosts.set(host, st);
    const run = st.chain.then(async () => {
      const wait = st.next - now();
      if (wait > 0) await sleep(wait);
      try { return await fn(); } finally { st.next = now() + gapMs; }
    });
    st.chain = run.catch(() => {});
    return run;
  };
}

async function getOnce(url, { fetchImpl, timeoutMs }) {
  try {
    const res = await fetchImpl(url, {
      method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'SourceLibrary/1.0 (archiving-watchdog confirm; https://sourcelibrary.org)' },
    });
    // Liveness only — never download the image.
    try { await res.body?.cancel?.(); } catch { /* already consumed / not a stream */ }
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
    return { status: res.status, ...(ct ? { ct } : {}) };
  } catch (e) {
    return { status: 0, err: (e?.name === 'TimeoutError' ? 'timeout' : (e?.cause?.code || e?.message || 'fetch failed')).slice(0, 60) };
  }
}

// A 2xx HTML page is a soft-404 / login wall, not a page image: neither alive nor gone.
const isAlive = (r) => r.status >= 200 && r.status < 300 && r.ct !== 'text/html';
const isGone = (r) => DEFINITE_GONE_STATUSES.includes(r.status);

/** Retry one URL until it answers definitively (alive or gone) or attempts run out. */
export async function confirmUrl(url, opts = {}) {
  const o = { ...CONFIRM_DEFAULTS, fetchImpl: fetch, sleep: realSleep, ...opts };
  const withHost = o.withHost || createHostQueue({ gapMs: o.hostGapMs, sleep: o.sleep });
  let host;
  try { host = new URL(url).host; } catch { return { url, final: { status: 0, err: 'bad url' }, attempts: [] }; }
  const attempts = [];
  let r = { status: 0, err: 'not probed' };
  for (let i = 0; i < o.attempts; i++) {
    r = await withHost(host, () => getOnce(url, o));
    attempts.push(r.status ? (r.status < 300 && !isAlive(r) ? `${r.status} ${r.ct}` : r.status) : r.err);
    if (isAlive(r) || isGone(r)) break;
    if (i < o.attempts - 1) await o.sleep(o.backoffMs * (i + 1));
  }
  return { url, final: r, attempts };
}

/**
 * IA item state — null when not an IA book. `state` is one of:
 *   present  metadata answers and the item is not dark (it exists, whatever its pages did)
 *   dark     IA has taken the item down
 *   absent   200 with no metadata (`{}` is IA's answer for an identifier that does not exist)
 *   unknown  the metadata call itself failed — no information, so it can never support `gone`
 */
export async function iaItemState(identifier, opts = {}) {
  if (!identifier || identifier === 'manifest.json') return null;
  const o = { ...CONFIRM_DEFAULTS, fetchImpl: fetch, sleep: realSleep, ...opts };
  const withHost = o.withHost || createHostQueue({ gapMs: o.hostGapMs, sleep: o.sleep });
  return withHost('archive.org', async () => {
    try {
      const r = await o.fetchImpl(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, { signal: AbortSignal.timeout(o.timeoutMs) });
      if (!r.ok) return { state: 'unknown', http: r.status };
      const j = await r.json();
      if (j.is_dark) return { state: 'dark' };
      if (!j.metadata) return { state: 'absent' };
      return { state: 'present', servers: j.workable_servers?.length ?? null };
    } catch (e) {
      return { state: 'unknown', err: e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'fetch failed').slice(0, 60) };
    }
  });
}

/**
 * Decide whether a book's source is really gone.
 * @param {{ urls: string[], iaIdentifier?: string|null }} input
 * @returns {Promise<{ verdict: 'gone'|'alive'|'unconfirmed', reason: string, evidence: object }>}
 */
export async function confirmGone({ urls, iaIdentifier = null }, opts = {}) {
  const o = { ...CONFIRM_DEFAULTS, fetchImpl: fetch, sleep: realSleep, ...opts };
  o.withHost = o.withHost || createHostQueue({ gapMs: o.hostGapMs, sleep: o.sleep });
  const sample = pickSpread(urls, o.samples);
  const probes = [];
  for (const url of sample) {
    const p = await confirmUrl(url, o);
    probes.push(p);
    if (isAlive(p.final)) break; // one live page is enough to decline
  }
  const ia = iaIdentifier ? await iaItemState(iaIdentifier, o) : null;

  const evidence = {
    checked_at: new Date(),
    probes: probes.map((p) => ({ url: p.url.slice(0, 200), status: p.final.status, err: p.final.err, attempts: p.attempts })),
    ...(ia ? { ia } : {}),
    timeout_ms: o.timeoutMs, attempts: o.attempts,
  };
  const codes = probes.map((p) => p.final.status || p.final.err).join(',');

  let verdict, reason;
  if (!probes.length) { verdict = 'unconfirmed'; reason = 'no sample page URL to confirm against'; }
  else if (probes.some((p) => isAlive(p.final))) { verdict = 'alive'; reason = `sample page answered on confirmation (${codes})`; }
  else if (!probes.every((p) => isGone(p.final))) { verdict = 'unconfirmed'; reason = `confirmation not definite (${codes})`; }
  else if (ia?.state === 'present') { verdict = 'unconfirmed'; reason = `pages ${codes} but IA item is present — stale page URLs, not a dead item`; }
  else if (ia?.state === 'unknown') { verdict = 'unconfirmed'; reason = `pages ${codes} but IA metadata did not answer (${ia.http || ia.err})`; }
  else { verdict = 'gone'; reason = `${probes.length}/${probes.length} sample pages HTTP ${codes}${ia ? ` · IA item ${ia.state}` : ''}`; }
  evidence.verdict = verdict;
  evidence.reason = reason;
  return { verdict, reason, evidence };
}

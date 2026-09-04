/**
 * Per-host circuit breaker for archivers.
 *
 * PRIOR ART: scripts/workers/archive-ocr.mjs (lines ~455-515) — the same three
 * rules, inlined there since #1909/#1914, and the only tested version of this
 * logic in the repo. archive-acquired.ts was about to become the FOURTH
 * hand-rolled copy (archive-ocr, archive-gallica, archive-harvard are the
 * others), and the version being written was worse than the one already
 * shipped: it had only the sustained-failure rule, missing both the cold-start
 * and ratio rules that catch the two failure shapes measured in #4588. So the
 * logic moves here instead. archive-ocr.mjs deliberately still carries its own
 * copy — swapping a load-bearing worker over belongs in its own PR, tracked
 * separately; this file is the one new callers must use.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * NOT politeness — the rate limiter in iiif-utils.mjs already does that. This
 * is about SCHEDULING: a worker pool has a fixed number of slots, and a host
 * that is refusing us can occupy every one of them with requests that cannot
 * succeed, while healthy work waits in the same queue.
 *
 * Measured on the pipeline box 2026-09-04 (#4588): a 50-minute archiver run
 * did 53 pages/min for four minutes off a healthy host, then its remaining
 * seven book slots landed on gallica (429 to every request) and Internet
 * Archive (400 to every request). Throughput sat at exactly 5 pages/min for
 * the next 45 minutes — every worker burning 4 attempts x 30s of timeout
 * against hosts that had answered hundreds of consecutive failures — while
 * 7,559 healthy MDZ/BSB books sat unreached in the same batch.
 *
 * ── Recovery ──────────────────────────────────────────────────────────────
 *
 * The inlined copies trip permanently for the life of the process. This one is
 * half-open: after `cooldownMs` it lets exactly ONE request through to find out
 * whether the host came back, and re-opens on failure. A breaker that never
 * re-tests is the same half-a-control-loop mistake as a backoff with no
 * recovery (#4396 -> #4559) — it just fails in the safe direction, so nobody
 * notices it never recovers.
 *
 * Everything here is per-process and in memory. Nothing a breaker decides is
 * ever written to a page or a book: an error we have not attributed must not
 * become a durable fact (invariants/archive-fetch-failures.md).
 */

/** Thresholds, matching archive-ocr.mjs so operators see one behaviour. */
export const BREAKER_DEFAULTS = {
  // Cold start: the host has never served us in this run. Five is low because
  // "unreachable from the first request" needs no patience.
  coldStartFails: 5,
  // Sustained: N back-to-back failures after earlier successes. Catches the
  // rate-limit-kicks-in-mid-run case that a cumulative ratio misses — once a
  // host has thousands of early successes the ratio stays healthy right
  // through a 429 storm. Any success resets the streak, so a blip is free.
  consecutiveFails: 20,
  // Noisy host: mostly-bad pages, measured only once there is enough to judge.
  ratioMinSamples: 50,
  ratioFailFraction: 0.9,
  // How long a tripped host is left alone before one probe is allowed through.
  cooldownMs: 10 * 60_000,
};

/**
 * @param {object} [opts] overrides for BREAKER_DEFAULTS, plus:
 * @param {() => number} [opts.now] clock seam, so tests need not sleep.
 * @param {(msg: string) => void} [opts.log] where trip notices go.
 */
export function createHostBreaker(opts = {}) {
  const cfg = { ...BREAKER_DEFAULTS, ...opts };
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => {});
  /** @type {Map<string, {ok:number,fail:number,skipped:number,consecutiveFails:number,statuses:Map<string,number>,openedAt:number,probing:boolean,reason:string}>} */
  const hosts = new Map();

  const stateFor = (host) => {
    let s = hosts.get(host);
    if (!s) {
      s = { ok: 0, fail: 0, skipped: 0, consecutiveFails: 0, statuses: new Map(), openedAt: 0, probing: false, reason: '' };
      hosts.set(host, s);
    }
    return s;
  };

  const trip = (host, s, reason) => {
    if (s.openedAt) return;
    s.openedAt = now();
    s.reason = reason;
    log(`host ${host}: ${reason} — pausing it for ${Math.round(cfg.cooldownMs / 60000)}m so the pool can work elsewhere`);
  };

  return {
    /**
     * May we send to `host` right now?
     *
     * Consumes the half-open probe slot when it returns true for a host whose
     * cooldown has elapsed, so only one caller tests a recovering host at a
     * time. Call `success` or `failure` for every `allow` that returned true,
     * or the probe slot stays held.
     */
    allow(host) {
      const s = stateFor(host);
      if (!s.openedAt) return true;
      if (now() - s.openedAt < cfg.cooldownMs) return false;
      if (s.probing) return false;
      s.probing = true;
      return true;
    },

    success(host) {
      const s = stateFor(host);
      s.ok++;
      s.consecutiveFails = 0;
      s.openedAt = 0;
      s.probing = false;
      s.reason = '';
    },

    /** @param {string} [code] status or class to count, e.g. '400', 'timeout'. */
    failure(host, code = 'other') {
      const s = stateFor(host);
      s.fail++;
      s.consecutiveFails++;
      s.probing = false;
      s.statuses.set(code, (s.statuses.get(code) ?? 0) + 1);
      // A failed half-open probe re-arms the cooldown FROM NOW. Without this the
      // breaker quietly stops being a breaker after its first cooldown: the trip
      // timestamp stays in the past, so `allow` hands every caller a probe slot
      // against a host that is still down. Caught by the negative control in
      // tests/unit/host-breaker.test.ts, not by reading the code — the bug is an
      // absence, and it fails in the direction that looks like normal operation.
      if (s.openedAt) { s.openedAt = now(); return; }
      const codes = [...s.statuses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c}:${n}`).join(' ');
      if (s.fail >= cfg.coldStartFails && s.ok === 0) {
        trip(host, s, `${s.fail} failures with 0 successes [${codes}]`);
      } else if (s.consecutiveFails >= cfg.consecutiveFails) {
        trip(host, s, `${s.consecutiveFails} consecutive failures after ${s.ok} successes [${codes}]`);
      } else if (s.ok + s.fail >= cfg.ratioMinSamples && s.fail / (s.ok + s.fail) > cfg.ratioFailFraction) {
        trip(host, s, `${s.fail}/${s.ok + s.fail} failed [${codes}]`);
      }
    },

    skipped(host) { stateFor(host).skipped++; },

    /** True while the host is tripped and its cooldown has not elapsed. */
    isOpen(host) {
      const s = hosts.get(host);
      return !!s?.openedAt && now() - s.openedAt < cfg.cooldownMs;
    },

    /** Host names currently tripped, for a heartbeat line. */
    openHosts() {
      return [...hosts.entries()].filter(([h]) => this.isOpen(h)).map(([h]) => h);
    },

    /**
     * One line per host: what it actually served us.
     *
     * A failure count with no status beside it is not a measurement. #4588 took
     * three wrong diagnoses to reach a cause that this table states outright —
     * the archiver had been logging "617 failed" for a week without ever
     * recording that they were 400s from one host and 429s from another.
     */
    report() {
      return [...hosts.entries()]
        .sort((a, b) => (b[1].ok + b[1].fail) - (a[1].ok + a[1].fail))
        .map(([h, s]) => {
          const codes = [...s.statuses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c}:${n}`).join(',');
          return `  ${h.padEnd(34)} ok ${String(s.ok).padStart(5)} | fail ${String(s.fail).padStart(5)}`
            + `${codes ? ` [${codes}]` : ''}${s.skipped ? ` | skipped ${s.skipped}` : ''}${s.openedAt ? ` | PAUSED (${s.reason})` : ''}`;
        }).join('\n');
    },

    /** Test/inspection seam. */
    stateOf(host) { return hosts.get(host); },
    size() { return hosts.size; },
  };
}

/**
 * Reduce a thrown error to the thing worth counting: an HTTP status, or a class.
 *
 * `rateLimitedFetch` throws `Error('HTTP 400')`; timeouts surface as an abort;
 * everything else is a socket-level failure. Distinguishing these is the whole
 * point — "400" means the URL can never work and "timeout" means it might.
 */
export function classifyFetchError(err) {
  const msg = String(err?.message ?? err ?? '');
  const m = msg.match(/\bHTTP (\d{3})\b/) || msg.match(/\b([45]\d\d)\b/);
  if (m) return m[1];
  if (/abort/i.test(msg)) return 'timeout';
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket/i.test(msg)) return 'network';
  return 'other';
}

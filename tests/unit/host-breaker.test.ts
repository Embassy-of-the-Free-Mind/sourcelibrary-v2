import { describe, it, expect } from 'vitest';
import { createHostBreaker, classifyFetchError, BREAKER_DEFAULTS } from '../../scripts/lib/host-breaker.mjs';

/**
 * The breaker exists to protect the WORKER POOL, not the remote host.
 *
 * #4588: a 50-minute archiver run spent 45 of those minutes with every slot
 * occupied by books on two hosts that were answering 400 and 429 to every
 * request, while 7,559 books on a host serving 100% of requests in 0.3s waited
 * behind them in the same batch. Throughput was a flat 5 pages/min.
 *
 * So the property under test is: after a host has demonstrated it will not
 * serve us, `allow()` says no, and keeps saying no until enough time has passed
 * to be worth re-testing — and then says yes exactly ONCE.
 *
 * Negative control run when written: deleting the `openedAt` assignment in
 * `trip()` turns the three tripping cases red; deleting the `probing` guard in
 * `allow()` turns "lets exactly one probe through" red; deleting the
 * `consecutiveFails = 0` reset in `success()` turns "a success resets the
 * streak" red. All three were confirmed to fail before being restored.
 */

/** A breaker with a clock we control, so recovery does not need a real 10 min. */
function harness(opts = {}) {
  let clock = 1_000_000;
  const lines: string[] = [];
  const b = createHostBreaker({ now: () => clock, log: (m: string) => lines.push(m), ...opts });
  return { b, lines, advance: (ms: number) => { clock += ms; }, at: () => clock };
}

describe('host breaker — stops scheduling work to a host that will not serve it', () => {
  it('trips on a cold start: N failures with no success at all', () => {
    const { b } = harness();
    for (let i = 0; i < BREAKER_DEFAULTS.coldStartFails; i++) {
      expect(b.allow('iiif.archive.org'), `request ${i} should still be allowed`).toBe(true);
      b.failure('iiif.archive.org', '400');
    }
    expect(b.allow('iiif.archive.org')).toBe(false);
    expect(b.isOpen('iiif.archive.org')).toBe(true);
  });

  it('does NOT trip a host that is merely slow to start but then works', () => {
    // The failure mode this guards against is over-eagerness: a breaker that
    // parks a healthy host costs exactly as much throughput as the stall it was
    // built to prevent.
    const { b } = harness();
    for (let i = 0; i < BREAKER_DEFAULTS.coldStartFails - 1; i++) b.failure('gallica.bnf.fr', 'timeout');
    b.success('gallica.bnf.fr');
    for (let i = 0; i < BREAKER_DEFAULTS.coldStartFails; i++) b.failure('gallica.bnf.fr', 'timeout');
    expect(b.isOpen('gallica.bnf.fr'), 'cold-start rule must not apply once the host has served us').toBe(false);
    expect(b.allow('gallica.bnf.fr')).toBe(true);
  });

  it('trips on a sustained streak that begins after a healthy stretch', () => {
    // The mid-run rate-limit storm. A cumulative ratio cannot see this: after
    // 500 successes, 20 failures is a 96% success rate and looks fine.
    const { b } = harness();
    for (let i = 0; i < 500; i++) b.success('gallica.bnf.fr');
    for (let i = 0; i < BREAKER_DEFAULTS.consecutiveFails - 1; i++) b.failure('gallica.bnf.fr', '429');
    expect(b.isOpen('gallica.bnf.fr')).toBe(false);
    b.failure('gallica.bnf.fr', '429');
    expect(b.isOpen('gallica.bnf.fr')).toBe(true);
  });

  it('a single success resets the streak, so a blip never trips it', () => {
    const { b } = harness();
    for (let i = 0; i < 200; i++) {
      for (let j = 0; j < BREAKER_DEFAULTS.consecutiveFails - 1; j++) b.failure('h.example', '500');
      b.success('h.example');
    }
    expect(b.isOpen('h.example')).toBe(false);
  });

  it('trips a noisy host on ratio once there is enough to judge', () => {
    const { b } = harness();
    // Alternate so no streak ever reaches the consecutive threshold, and keep
    // one success early so the cold-start rule cannot fire either. This case
    // must be the ratio rule or nothing.
    b.success('noisy.example');
    for (let i = 0; i < 200; i++) {
      b.failure('noisy.example', '503');
      if (i % 19 === 18) b.success('noisy.example');
    }
    expect(b.isOpen('noisy.example')).toBe(true);
  });
});

describe('host breaker — recovery is half-open, not permanent', () => {
  it('stays closed for the whole cooldown, then lets exactly one probe through', () => {
    const { b, advance } = harness();
    for (let i = 0; i < BREAKER_DEFAULTS.coldStartFails; i++) b.failure('h.example', '429');
    expect(b.allow('h.example')).toBe(false);

    advance(BREAKER_DEFAULTS.cooldownMs - 1);
    expect(b.allow('h.example'), 'must not re-test before the cooldown elapses').toBe(false);

    advance(2);
    expect(b.allow('h.example'), 'the probe').toBe(true);
    expect(b.allow('h.example'), 'only ONE caller may test a recovering host').toBe(false);
    expect(b.allow('h.example')).toBe(false);
  });

  it('a successful probe reopens the host fully', () => {
    const { b, advance } = harness();
    for (let i = 0; i < BREAKER_DEFAULTS.coldStartFails; i++) b.failure('h.example', '429');
    advance(BREAKER_DEFAULTS.cooldownMs + 1);
    expect(b.allow('h.example')).toBe(true);
    b.success('h.example');
    expect(b.isOpen('h.example')).toBe(false);
    expect(b.allow('h.example')).toBe(true);
    expect(b.allow('h.example')).toBe(true);
  });

  it('a failed probe re-arms the cooldown from now, rather than freeing the host', () => {
    // Without this the breaker would be worse than useless after the first
    // cooldown: every caller would be let through against a host still down.
    const { b, advance } = harness();
    for (let i = 0; i < BREAKER_DEFAULTS.coldStartFails; i++) b.failure('h.example', '429');
    advance(BREAKER_DEFAULTS.cooldownMs + 1);
    expect(b.allow('h.example')).toBe(true);
    b.failure('h.example', '429');
    expect(b.allow('h.example'), 'still down — back to blocked').toBe(false);
    advance(BREAKER_DEFAULTS.cooldownMs - 1);
    expect(b.allow('h.example'), 'cooldown must restart on the failed probe').toBe(false);
  });

  it('never trips a host it has not been told about', () => {
    const { b } = harness();
    expect(b.allow('untouched.example')).toBe(true);
    expect(b.isOpen('untouched.example')).toBe(false);
  });
});

describe('host breaker — the report names the source, not just a count', () => {
  it('carries the status codes each host actually returned', () => {
    // "617 failed" was the whole instrument for a week. It is what made #4588
    // take three wrong diagnoses.
    const { b } = harness();
    b.failure('iiif.archive.org', '400');
    b.failure('iiif.archive.org', '400');
    b.failure('iiif.archive.org', 'timeout');
    for (let i = 0; i < 3; i++) b.success('api.digitale-sammlungen.de');
    const r = b.report();
    expect(r).toMatch(/iiif\.archive\.org/);
    expect(r, 'the status the host returned must appear').toMatch(/400:2/);
    expect(r).toMatch(/timeout:1/);
    expect(r).toMatch(/api\.digitale-sammlungen\.de/);
  });

  it('marks a paused host as paused, with the reason', () => {
    const { b } = harness();
    for (let i = 0; i < BREAKER_DEFAULTS.coldStartFails; i++) b.failure('h.example', '429');
    expect(b.report()).toMatch(/PAUSED/);
    expect(b.report()).toMatch(/0 successes/);
  });
});

describe('classifyFetchError — a 400 and a timeout are not the same fact', () => {
  it('reads the status out of rateLimitedFetch errors', () => {
    // A 400 means the URL can never work; a timeout means it might. The
    // archiver logged both as "failed" and could distinguish neither.
    expect(classifyFetchError(new Error('HTTP 400'))).toBe('400');
    expect(classifyFetchError(new Error('HTTP 429'))).toBe('429');
    expect(classifyFetchError(new Error('HTTP 504'))).toBe('504');
  });

  it('names the classes that carry no status', () => {
    expect(classifyFetchError(new Error('This operation was aborted'))).toBe('timeout');
    expect(classifyFetchError(new Error('fetch failed'))).toBe('network');
    expect(classifyFetchError(new Error('ECONNRESET'))).toBe('network');
    expect(classifyFetchError(new Error('something else entirely'))).toBe('other');
    expect(classifyFetchError(undefined)).toBe('other');
  });
});

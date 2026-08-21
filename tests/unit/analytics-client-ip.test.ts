/**
 * The analytics write paths must record the CALLER's address, not Cloudflare's.
 *
 * On the canonical host the chain is client → Cloudflare → Vercel, and Vercel
 * rewrites `x-forwarded-for` with the address that connected to it — a
 * Cloudflare edge node. `clientIpFromHeaders()` read `x-forwarded-for` first,
 * so `analytics_pageviews` and `analytics_events` recorded 172.64.0.0/13,
 * 104.16.0.0/13 and 162.158.0.0/15 for every front-door request.
 *
 * That made a distributed fleet arriving through Cloudflare invisible by
 * construction: its reads spread evenly across edge nodes and looked organic.
 * The one fleet ever caught (AS132203, nine weeks, 17,357 books) was caught
 * only because it bypassed Cloudflare on an alias host, which is the sole
 * reason its real addresses were written down at all.
 *
 * These tests exercise the functions rather than asserting on source text —
 * with one deliberate exception at the bottom, where deletion IS the failure
 * mode (see the comment there).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

import { clientIpFromHeaders } from '@/lib/analytics-ingest';
import { isCdnEgress, CDN_EGRESS_CIDRS } from '../../scripts/workers/traffic-anomaly-alert.mjs';

const repoRoot = path.resolve(__dirname, '../..');

describe('clientIpFromHeaders', () => {
  it('prefers cf-connecting-ip over the Vercel-rewritten x-forwarded-for', () => {
    // The exact shape of a real front-door request: Cloudflare reports the
    // caller, Vercel reports Cloudflare. Before the fix this returned the
    // edge node — the negative control for this whole change.
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.44',
      'x-forwarded-for': '172.70.248.13',
    });
    expect(clientIpFromHeaders(headers)).toBe('203.0.113.0');
  });

  it('anonymizes to a /24 whichever header it came from', () => {
    expect(clientIpFromHeaders(new Headers({ 'cf-connecting-ip': '198.51.100.222' })))
      .toBe('198.51.100.0');
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '198.51.100.222' })))
      .toBe('198.51.100.0');
  });

  it('falls back through true-client-ip, x-forwarded-for, x-real-ip', () => {
    expect(clientIpFromHeaders(new Headers({ 'true-client-ip': '203.0.113.7' })))
      .toBe('203.0.113.0');
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.7, 172.70.1.1' })))
      .toBe('203.0.113.0');
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '203.0.113.7' })))
      .toBe('203.0.113.0');
    expect(clientIpFromHeaders(new Headers())).toBe('unknown');
  });

  it('reports unknown rather than a CDN address when no client header is present', () => {
    // A request that genuinely carries only the Vercel hop is unattributable.
    // "unknown" is the honest answer; a Cloudflare /24 is a wrong one that
    // would then be counted as a heavy reader.
    const ip = clientIpFromHeaders(new Headers({ 'x-forwarded-for': '172.70.248.13' }));
    expect(isCdnEgress(ip)).toBe(true); // still CDN — which is why the alarm below exists
  });
});

describe('isCdnEgress', () => {
  it('recognizes every edge range observed in production analytics', () => {
    // These are the addresses the concentration check flagged as "networks
    // each reading >2,000 pages" and told the operator to block.
    for (const ip of [
      '172.70.248.0', '172.70.242.0', '172.70.240.0', '172.70.250.0',
      '172.71.148.0', '172.71.144.0', '172.71.164.0', '172.68.193.0',
      '172.69.150.0', '104.22.123.0', '104.23.239.0', '162.158.110.0',
    ]) {
      expect(isCdnEgress(ip), `${ip} should be recognized as CDN egress`).toBe(true);
    }
  });

  it('does not swallow real client networks', () => {
    // AS132203 above all: if this ever reads as CDN the fleet check goes quiet.
    for (const ip of ['43.172.0.0', '43.173.255.0', '203.0.113.0', '8.8.8.0', '198.51.100.0']) {
      expect(isCdnEgress(ip), `${ip} must not be treated as CDN egress`).toBe(false);
    }
  });

  it('handles anonymized and malformed input without throwing', () => {
    expect(isCdnEgress('unknown')).toBe(false);
    expect(isCdnEgress('')).toBe(false);
    expect(isCdnEgress('2606:4700::0')).toBe(false); // IPv6 unsupported, must not crash
    expect(isCdnEgress('999.1.1.1')).toBe(false);
  });

  it('keeps the published range list non-empty and well-formed', () => {
    expect(CDN_EGRESS_CIDRS.length).toBeGreaterThan(10);
    for (const cidr of CDN_EGRESS_CIDRS) {
      expect(cidr).toMatch(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/);
    }
  });
});

describe('no analytics writer reads x-forwarded-for directly', () => {
  /**
   * An ABSENCE invariant, which is the one case where a source-shape assertion
   * is a real guard (cf. tests/unit/soft-404-loading-guard.test.ts): the way
   * this bug returns is a NEW analytics route reaching for `x-forwarded-for`
   * on its own instead of calling the shared helper. Nothing about behaviour
   * can catch a writer that does not exist yet.
   *
   * `src/lib/rate-limit.ts` and `src/lib/bot-attribution.ts` are deliberately
   * out of scope — rate-limit already reads cf-connecting-ip first, and
   * bot-attribution serves the edge-log path, not the analytics collections.
   */
  const analyticsRoutes = [
    'src/app/api/track/route.ts',
    'src/app/api/analytics/track/route.ts',
    'src/app/api/analytics/event/route.ts',
    'src/app/api/analytics/loading/route.ts',
    'src/app/api/analytics/broken-image/route.ts',
    'src/app/api/analytics/not-found/route.ts',
    'src/app/api/[tenant]/analytics/loading/route.ts',
  ].filter((p) => {
    try { readFileSync(path.join(repoRoot, p)); return true; } catch { return false; }
  });

  it('finds every analytics write route it means to guard', () => {
    // If a rename drops one silently the guard shrinks to nothing and still
    // passes — so pin the count, not just "more than zero".
    expect(analyticsRoutes.length).toBe(7);
  });

  it.each(analyticsRoutes)('%s does not read x-forwarded-for itself', (rel) => {
    const src = readFileSync(path.join(repoRoot, rel), 'utf8');
    expect(src).not.toMatch(/x-forwarded-for/i);
  });

  // Deliberately NOT asserted here: "cf-connecting-ip appears before
  // x-forwarded-for in analytics-ingest.ts". That was written, and it passed
  // with the header order reverted — the doc comment above the function
  // mentions cf-connecting-ip first, so the assertion was measuring prose.
  // The behavioural test at the top of this file is the real guard; it fails
  // on the reverted order, which was verified by running it that way.

  it('catches a NEW analytics route added later that reads the header itself', () => {
    // Match on the repo-RELATIVE path. Matching the absolute path silently
    // matched every route in the tree, because the worktree these run in is
    // itself named `.claude/worktrees/fix+analytics-client-ip` — a check that
    // always fires is as useless as one that never can.
    const apiRoot = path.join(repoRoot, 'src/app/api');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'route.ts') {
          const rel = path.relative(repoRoot, full);
          if (!/(^|\/)(analytics|track)(\/|$)/.test(rel)) continue;
          if (/x-forwarded-for/i.test(readFileSync(full, 'utf8'))) offenders.push(rel);
        }
      }
    };
    walk(apiRoot);
    expect(offenders).toEqual([]);
  });
});

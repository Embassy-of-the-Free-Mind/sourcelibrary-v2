/**
 * The detector's predicates. These are the pieces that decide whether a real
 * anomaly is reported, so they get pinned — a silently-widened allowlist here
 * would reproduce the nine-week blind spot the detector exists to close.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs worker, no types
import {
  isUnexpectedHost,
  isSupposedlyBlocked,
  looksLikeEnumeration,
  looksLikeSpray,
  prefix16,
  SPRAY_MIN_READS,
  SPRAY_MIN_SHARE,
  EXPECTED_HOSTS,
  CONCENTRATION_THRESHOLD,
  PREFIX16_THRESHOLD,
  ENUMERATION_PAGES_PER_BOOK,
  SHOULD_BE_BLOCKED,
} from '../../scripts/workers/traffic-anomaly-alert.mjs';
import { BLOCKED_CIDR_LIST, isBlockedNetwork } from '@/lib/blocked-networks';

describe('unexpected-host detection', () => {
  it('accepts only the hosts we deliberately serve readers from', () => {
    expect(isUnexpectedHost('sourcelibrary.org')).toBe(false);
    expect(isUnexpectedHost('bph.sourcelibrary.org')).toBe(false);
    expect(isUnexpectedHost('ficinosociety.org')).toBe(false);
  });

  it('flags a deployment host and any new alias', () => {
    // The bypass shape: a hostname on the same project, outside the CDN.
    expect(isUnexpectedHost('sourcelibrary-v2.vercel.app')).toBe(true);
    expect(isUnexpectedHost('sourcelibrary-v2-git-somebranch.vercel.app')).toBe(true);
    expect(isUnexpectedHost('somenewdomain.org')).toBe(true);
  });

  it('does not treat a missing host as an anomaly', () => {
    // Pre-#3438 rows carry no host; absence is unknown, not suspicious.
    expect(isUnexpectedHost(undefined)).toBe(false);
    expect(isUnexpectedHost(null)).toBe(false);
    expect(isUnexpectedHost('')).toBe(false);
  });

  it('keeps the allowlist small on purpose', () => {
    // Every added host is a surface nobody is watching. If this trips, the
    // question is whether the new host should serve readers at all.
    expect(EXPECTED_HOSTS.size).toBeLessThanOrEqual(4);
  });
});

describe('supposedly-blocked network detection', () => {
  it('covers the measured fleet range 43.172.0.0/15', () => {
    expect(isSupposedlyBlocked('43.172.195.0')).toBe(true);
    expect(isSupposedlyBlocked('43.173.181.0')).toBe(true);
  });

  it('covers the 2026-08-06 fleet operators', () => {
    expect(isSupposedlyBlocked('116.204.33.0')).toBe(true); // Huawei Cloud
    expect(isSupposedlyBlocked('150.5.132.0')).toBe(true); // Byteplus
    expect(isSupposedlyBlocked('82.157.9.0')).toBe(true); // Tencent AS45090
    expect(isSupposedlyBlocked('180.153.197.0')).toBe(true); // China Telecom /24
  });

  it('does not bleed into neighbouring space', () => {
    expect(isSupposedlyBlocked('43.171.195.0')).toBe(false);
    expect(isSupposedlyBlocked('43.174.195.0')).toBe(false);
    expect(isSupposedlyBlocked('143.172.195.0')).toBe(false);
    expect(isSupposedlyBlocked(null)).toBe(false);
    // Adjacent consumer space on the same ISPs must stay reachable.
    expect(isSupposedlyBlocked('180.153.198.0')).toBe(false);
    expect(isSupposedlyBlocked('112.65.213.0')).toBe(false);
  });

  /**
   * The detector's list is a hand-copy of the app's, because one is .mjs and
   * the other TypeScript. A detector watching a stale list reports silence and
   * means nothing — so the copy is pinned rather than trusted.
   */
  it('watches exactly what the app refuses', () => {
    const watched = new Set(SHOULD_BE_BLOCKED.flatMap((n: { cidrs: string[] }) => n.cidrs));
    const enforced = new Set(BLOCKED_CIDR_LIST);
    expect([...watched].filter((c) => !enforced.has(c))).toEqual([]);
    expect([...enforced].filter((c) => !watched.has(c))).toEqual([]);
  });

  it('agrees with the app on specific addresses', () => {
    for (const ip of ['116.204.33.7', '43.172.195.14', '82.157.9.1', '180.153.197.44', '31.223.11.9', '73.106.56.4']) {
      expect(isSupposedlyBlocked(ip)).toBe(isBlockedNetwork(ip));
    }
  });
});

describe('concentration thresholds', () => {
  it('sits well above a shared NAT and well below the observed fleet', () => {
    // Fleet /24s ran ~3,800-5,900 reads/24h each; genuine reader networks sit
    // in the low hundreds. A threshold inside that gap is the whole point.
    expect(CONCENTRATION_THRESHOLD).toBeGreaterThan(500);
    expect(CONCENTRATION_THRESHOLD).toBeLessThan(3800);
  });

  it('has a /16 threshold inside the measured gap', () => {
    // Below the quietest fleet /16 (2,287 reads/24h) so a rotating fleet trips
    // it, and above the loudest genuine /16 left after the block (938) so a
    // real network does not. Both numbers measured 2026-08-06.
    expect(PREFIX16_THRESHOLD).toBeLessThan(2287);
    expect(PREFIX16_THRESHOLD).toBeGreaterThan(938);
  });

  it('can fire below the per-/24 threshold, which is the entire point', () => {
    // The fleet's /24s sat far under CONCENTRATION_THRESHOLD by design. If the
    // /16 bar were raised above it, this check would only ever repeat check 1.
    expect(PREFIX16_THRESHOLD).toBeLessThan(CONCENTRATION_THRESHOLD);
  });
});

describe('enumeration vs reading', () => {
  it('calls the fleet enumeration', () => {
    // Measured 2026-08-02..06: ~1.4-1.8 pages per book across thousands.
    expect(looksLikeEnumeration(6032, 3331)).toBe(true);
    expect(looksLikeEnumeration(28595, 8605)).toBe(true);
  });

  it('does NOT call a devoted reader a fleet', () => {
    // 31.223.11.0 (TurkNet, consumer): 2,170 reads across 68 books, ~32 each.
    // A volume-only rule blocks this person; this is why the ratio exists.
    expect(looksLikeEnumeration(2170, 68)).toBe(false);
    expect(isBlockedNetwork('31.223.11.9')).toBe(false);
  });

  it('refuses to judge a network that has barely read anything', () => {
    // Too few books to tell a shape from noise — say nothing rather than guess.
    expect(looksLikeEnumeration(19, 19)).toBe(false);
    expect(looksLikeEnumeration(100, 0)).toBe(false);
  });

  it('keeps the ratio inside the measured gap', () => {
    expect(ENUMERATION_PAGES_PER_BOOK).toBeGreaterThan(1.8);
    expect(ENUMERATION_PAGES_PER_BOOK).toBeLessThan(32);
  });
});

describe('proxy-pool (spray) detection', () => {
  it('recognises the 2026-08-06 pool', () => {
    // 183.199.x.x: 254 reads across 153 /24s. No per-unit threshold sees this.
    expect(looksLikeSpray(254, 153)).toBe(true);
    expect(looksLikeSpray(215, 113)).toBe(true);
    // And it fires far below the /16 volume bar, which is the entire point.
    expect(254).toBeLessThan(PREFIX16_THRESHOLD);
  });

  it('does not fire on a network of actual readers', () => {
    // 31.223.x.x in the same window: 411 reads from 8 /24s — 51 each.
    expect(looksLikeSpray(411, 8)).toBe(false);
    // A busy /16 with many /24s but real per-network volume is not a pool.
    expect(looksLikeSpray(5000, 50)).toBe(false);
  });

  it('refuses to judge a handful of networks', () => {
    // Two /24s with one read each is noise, not a pool.
    expect(looksLikeSpray(2, 2)).toBe(false);
    expect(looksLikeSpray(0, 0)).toBe(false);
  });

  it('keeps both alert floors, so it fires on neither quiet nor busy nights alone', () => {
    expect(SPRAY_MIN_READS).toBeGreaterThan(0);
    expect(SPRAY_MIN_SHARE).toBeGreaterThan(0);
    expect(SPRAY_MIN_SHARE).toBeLessThan(1);
  });
});

describe('prefix16', () => {
  it('rolls a /24 up to its /16', () => {
    expect(prefix16('116.204.33.0')).toBe('116.204.x.x');
    expect(prefix16('1.92.219.0')).toBe('1.92.x.x');
  });

  it('returns null for anything that is not an IPv4 literal', () => {
    expect(prefix16('2a02:c7f:1234::1')).toBe(null);
    expect(prefix16(null)).toBe(null);
  });
});

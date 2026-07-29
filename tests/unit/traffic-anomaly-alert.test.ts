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
  EXPECTED_HOSTS,
  CONCENTRATION_THRESHOLD,
} from '../../scripts/workers/traffic-anomaly-alert.mjs';

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

  it('does not bleed into neighbouring space', () => {
    expect(isSupposedlyBlocked('43.171.195.0')).toBe(false);
    expect(isSupposedlyBlocked('43.174.195.0')).toBe(false);
    expect(isSupposedlyBlocked('143.172.195.0')).toBe(false);
    expect(isSupposedlyBlocked(null)).toBe(false);
  });
});

describe('concentration threshold', () => {
  it('sits well above a shared NAT and well below the observed fleet', () => {
    // Fleet /24s ran ~3,800-5,900 reads/24h each; genuine reader networks sit
    // in the low hundreds. A threshold inside that gap is the whole point.
    expect(CONCENTRATION_THRESHOLD).toBeGreaterThan(500);
    expect(CONCENTRATION_THRESHOLD).toBeLessThan(3800);
  });
});

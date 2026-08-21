/**
 * The reference-set verification, tested against the incidents that motivated it. (#3556)
 *
 * Every fixture below is a REAL state observed on 2026-08-04 while re-deriving the
 * set. Each one produced a log that looked like success. The whole point of this
 * check is that it reads the destination instead.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import { verifyReferenceSet } from '../../scripts/enrichment/rebuild-reference-set.mjs';

/** The good state, measured 2026-08-04 after a clean rebuild. */
const HEALTHY = { locFiles: 43, locRows: 126_558, wdRows: 15_015, inMongo: 126_558 };

describe('the healthy state passes', () => {
  it('no problems when extract and Mongo agree', () => {
    expect(verifyReferenceSet(HEALTHY)).toEqual([]);
  });
});

describe('the incidents it must catch', () => {
  it('THE LOAD TRUNCATION: 120,976 in Mongo against a 126,558-row extract', () => {
    // withMongo's 300s watchdog killed the load at part 30 of 43, exit code 0.
    const problems = verifyReferenceSet({ ...HEALTHY, inMongo: 120_976 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/5,582 rows never loaded/);
    expect(problems[0]).toMatch(/--load/);
  });

  it('THE SILENT NO-OP: extraction ran, nothing was written to Mongo', () => {
    // Following the documented `--keep-gz` runbook: 126,558 rows on disk, and the
    // collection still holding its previous contents.
    const problems = verifyReferenceSet({ ...HEALTHY, inMongo: 118_352 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/8,206 rows never loaded/);
  });

  it('THE BLOCKED SOURCE: every part 403d, so nothing was derived', () => {
    // loc.gov behind a Cloudflare challenge from a datacenter IP.
    const problems = verifyReferenceSet({ locFiles: 0, locRows: 0, wdRows: 15_015, inMongo: 118_352 });
    expect(problems.some((p: string) => /0 of 43 parts/.test(p))).toBe(true);
    expect(problems.some((p: string) => /empty/.test(p))).toBe(true);
  });

  it('A PARTIAL EXTRACT: some parts failed, the rest look fine', () => {
    const problems = verifyReferenceSet({ ...HEALTHY, locFiles: 41, locRows: 120_000, inMongo: 126_558 });
    expect(problems.some((p: string) => /41 of 43 parts/.test(p))).toBe(true);
  });

  it('THE MISSING SECOND SOURCE: LoC-only is a different baseline, not a smaller one', () => {
    // The Wikidata rows also lived only in the locked worktree. Running without
    // them yields 25.8%, which is NOT comparable to the published 27.0% — the
    // dangerous outcome is a number that looks like a regression and is a
    // different measurement.
    const problems = verifyReferenceSet({ ...HEALTHY, wdRows: 0 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/25\.8%.*27\.0%/);
  });
});

describe('it does not fire on states that are fine', () => {
  it('Mongo ahead of the extract is not an error', () => {
    // Extra rows from an older, larger snapshot are stale, not truncated. This
    // check guards the truncation direction only, and says so.
    expect(verifyReferenceSet({ ...HEALTHY, inMongo: 130_000 })).toEqual([]);
  });
});

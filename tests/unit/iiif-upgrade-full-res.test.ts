import { describe, it, expect } from 'vitest';
import { upgradeToFullRes } from '../../scripts/lib/iiif-utils.mjs';

/**
 * A IIIF Image path is /{region}/{size}/{rotation}/{quality}.{format}.
 *
 * `upgradeToFullRes` rewrites the SIZE segment to `full`. Several per-host rules
 * matched `/full/<digits>/` without anchoring to that segment, so on a URL whose
 * size was already `full` they matched the ROTATION instead:
 *
 *   .../f1/full/full/0/default.jpg   ->   .../f1/full/full/full/default.jpg
 *
 * `full` is not a valid rotation, so the request 404s. Measured 2026-08-30:
 * 0 of 28 sampled Gallica books were fetchable, while the stored URL returned
 * 200 the moment it was requested unmodified. The archiver was asking for a URL
 * it had corrupted itself, and the failure looked like a dead corpus.
 *
 * These cases pin the size segment as the ONLY thing this function may rewrite.
 * Negative control run when written: reverting either the early return or the
 * anchored host rules turns the "already full" cases red.
 */

const GALLICA_FULL = 'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k60617k/f1/full/full/0/default.jpg';
const GALLICA_SIZED = 'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k61073880/f9/full/2000,/0/default.jpg';
const VATICAN_FULL = 'https://digi.vatlib.it/iiif/MSS_Vat.lat.3225/canvas/p1/full/full/0/default.jpg';
const VATICAN_SIZED = 'https://digi.vatlib.it/iiif/MSS_Vat.lat.3225/canvas/p1/full/1000,/0/default.jpg';
const MDZ_FULL = 'https://api.digitale-sammlungen.de/iiif/image/v2/bsb00100705_00001/full/full/0/default.jpg';
const MDZ_SIZED = 'https://api.digitale-sammlungen.de/iiif/image/v2/bsb00100705_00001/full/2000,/0/default.jpg';

describe('upgradeToFullRes — never rewrites the rotation segment', () => {
  it('leaves an already-full Gallica URL untouched (the #4409 regression)', () => {
    expect(upgradeToFullRes(GALLICA_FULL)).toBe(GALLICA_FULL);
  });

  it('leaves an already-full Vatican URL untouched', () => {
    // digi.vatlib had the identical unanchored rule. The Vatican pool is 20,267
    // untouched import candidates, so this would have bitten at scale later.
    expect(upgradeToFullRes(VATICAN_FULL)).toBe(VATICAN_FULL);
  });

  it('leaves an already-full MDZ URL untouched', () => {
    expect(upgradeToFullRes(MDZ_FULL)).toBe(MDZ_FULL);
  });

  it('never emits `full` in the rotation position, for any host', () => {
    for (const url of [GALLICA_FULL, VATICAN_FULL, MDZ_FULL, GALLICA_SIZED, VATICAN_SIZED, MDZ_SIZED]) {
      expect(upgradeToFullRes(url), url).not.toMatch(/\/full\/full\/full\//);
    }
  });
});

describe('upgradeToFullRes — still upgrades the size segment', () => {
  it('upgrades a sized Gallica URL and preserves rotation + quality', () => {
    expect(upgradeToFullRes(GALLICA_SIZED))
      .toBe('https://gallica.bnf.fr/iiif/ark:/12148/bpt6k61073880/f9/full/full/0/default.jpg');
  });

  it('upgrades a sized Vatican URL', () => {
    expect(upgradeToFullRes(VATICAN_SIZED))
      .toBe('https://digi.vatlib.it/iiif/MSS_Vat.lat.3225/canvas/p1/full/full/0/default.jpg');
  });

  it('upgrades a sized MDZ URL', () => {
    expect(upgradeToFullRes(MDZ_SIZED))
      .toBe('https://api.digitale-sammlungen.de/iiif/image/v2/bsb00100705_00001/full/full/0/default.jpg');
  });

  it('keeps Harvard pinned to its 2000px variant', () => {
    // Harvard MPS 429s hard on /full/full/ even at 1 req/s — the existing
    // opt-out must survive this change.
    const harvard = 'https://mps.lib.harvard.edu/iiif/2/ids:12345/full/2000,/0/default.jpg';
    expect(upgradeToFullRes(harvard)).toBe(harvard);
  });

  it('rewrites archive.org pct: sizes', () => {
    expect(upgradeToFullRes('https://iiif.archive.org/iiif/3/abc$5/full/pct:50/0/default.jpg'))
      .toBe('https://iiif.archive.org/iiif/3/abc$5/full/full/0/default.jpg');
  });

  it('is a no-op on null, empty and non-IIIF input', () => {
    expect(upgradeToFullRes(null as unknown as string)).toBeNull();
    expect(upgradeToFullRes('')).toBe('');
    expect(upgradeToFullRes('https://example.org/plain.jpg')).toBe('https://example.org/plain.jpg');
  });
});

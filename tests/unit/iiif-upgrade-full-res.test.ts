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

  it('rewrites archive.org pct: sizes — to the v3 keyword, not the v2 one', () => {
    // This case previously asserted `/full/full/`, which is exactly the URL the
    // service rejects. See the v3 block below.
    expect(upgradeToFullRes('https://iiif.archive.org/iiif/3/abc$5/full/pct:50/0/default.jpg'))
      .toBe('https://iiif.archive.org/iiif/3/abc$5/full/max/0/default.jpg');
  });

  it('is a no-op on null, empty and non-IIIF input', () => {
    expect(upgradeToFullRes(null as unknown as string)).toBeNull();
    expect(upgradeToFullRes('')).toBe('');
    expect(upgradeToFullRes('https://example.org/plain.jpg')).toBe('https://example.org/plain.jpg');
  });
});

/**
 * IIIF Image API 3.0 removed the size keyword `full`; the v3 spelling is `max`.
 *
 * A v3 service answers `/full/full/` with `400 Bad Request — Invalid size`, in
 * about 0.2s. That is fast, cheap, and indistinguishable in our logs from any
 * other page failure — so the archiver reported it as throughput ("~58% of
 * pages failed") rather than as a URL that can never work, and #4588 spent
 * three rounds of diagnosis on a cause that was in the response body.
 *
 * Measured on the pipeline box 2026-09-04, one Internet Archive item, 4 pages:
 *
 *   /full/full/  ->  400 in 0.5s ("Invalid size"), or 504 after 60s
 *   /full/max/   ->  200 in 2.9s, 1.3–1.8 MB
 *
 * The corpus holds BOTH spellings against the same host — 873 sampled pages on
 * `/full/max/` and 324 on `/full/full/` — which is why the endpoint looked
 * intermittently healthy rather than systematically broken.
 *
 * These cases pin the version keyword to what the URL's own path declares.
 * Negative control run when written: reverting the v3 branch in
 * `upgradeToFullRes` turns all four of the first block red, and none of the
 * v2 cases above.
 */
const IA_V3_FULL = 'https://iiif.archive.org/image/iiif/3/itemid%2Fitemid_jp2.zip%2Fitemid_jp2%2Fitemid_0001.jp2/full/full/0/default.jpg';
const IA_V3_MAX = 'https://iiif.archive.org/image/iiif/3/itemid%2Fitemid_jp2.zip%2Fitemid_jp2%2Fitemid_0001.jp2/full/max/0/default.jpg';
const KYOTO_V3_SIZED = 'https://rmda.kulib.kyoto-u.ac.jp/iiif/3/abc/full/1000,/0/default.jpg';

describe('upgradeToFullRes — IIIF Image API 3.0 says `max`, not `full`', () => {
  it('rewrites a v3 /full/full/ URL to /full/max/', () => {
    expect(upgradeToFullRes(IA_V3_FULL)).toBe(IA_V3_MAX);
  });

  it('leaves a v3 URL that already says max alone', () => {
    expect(upgradeToFullRes(IA_V3_MAX)).toBe(IA_V3_MAX);
  });

  it('upgrades a sized v3 URL to max, not to full', () => {
    // Kyoto is the other v3-pathed host in the corpus, and it is a
    // SILENT_CAP_HOST — so this rule reaches it too, and must reach it with
    // the keyword its API version defines.
    expect(upgradeToFullRes(KYOTO_V3_SIZED)).toBe('https://rmda.kulib.kyoto-u.ac.jp/iiif/3/abc/full/max/0/default.jpg');
  });

  it('never emits the v2 keyword on a v3 path', () => {
    for (const url of [IA_V3_FULL, IA_V3_MAX, KYOTO_V3_SIZED, 'https://iiif.archive.org/iiif/3/abc$5/full/pct:50/0/default.jpg']) {
      expect(upgradeToFullRes(url), url).not.toMatch(/\/iiif\/3\/[^ ]*\/full\/full\//);
    }
  });

  it('leaves v2 hosts on `full` — the keyword change is scoped to v3 paths', () => {
    // The whole risk of this change is over-reach: `max` on a v2 service is as
    // wrong as `full` on a v3 one. dl.ndl.go.jp is the live proof — it 500s on
    // `max` and is explicitly excluded — and every v2 host below must be
    // untouched by the v3 branch.
    expect(upgradeToFullRes(GALLICA_SIZED)).toMatch(/\/full\/full\//);
    expect(upgradeToFullRes(MDZ_SIZED)).toMatch(/\/full\/full\//);
    expect(upgradeToFullRes(VATICAN_SIZED)).toMatch(/\/full\/full\//);
    const ndl = 'https://dl.ndl.go.jp/api/iiif/861218/R0000009/full/max/0/default.jpg';
    expect(upgradeToFullRes(ndl)).toBe('https://dl.ndl.go.jp/api/iiif/861218/R0000009/full/full/0/default.jpg');
  });
});

import { describe, it, expect } from 'vitest';
import { getPageImageUrl, getPageSource, type PageImageFields } from '@/lib/page-image-url';
import { isBrowserRenderableImageUrl } from '@/lib/csp-img-hosts';
import { getPageSource as getPageSourceJs } from '../../scripts/lib/page-image-url.mjs';

const R2 = 'https://images.sourcelibrary.org';
const BOOK = '674057212677591a7c897d60';

// One representative page per real-world shape we measured in the corpus.
const fixtures: Record<string, PageImageFields> = {
  // ~89%: a normal archived page with pre-sized variants.
  normal: {
    photo: `${R2}/pages/${BOOK}/0005-full.jpg`,
    archived_photo: `${R2}/archived/${BOOK}/5.jpg`,
    display_photo: `${R2}/pages/${BOOK}/0005.jpg`,
    image_thumb: `${R2}/pages/${BOOK}/0005-thumb.jpg`,
  },
  // Old-era split: cropped_photo is the half; display_photo is the WRONG uncropped resize.
  oldSplit: {
    split_from_spread: true,
    cropped_photo: `${R2}/cropped/${BOOK}/abc123.jpg`,
    photo: `${R2}/archived/${BOOK}/1.jpg`,
    archived_photo: `${R2}/archived/${BOOK}/1.jpg`,
    display_photo: `${R2}/pages/${BOOK}/0001.jpg`,
  },
  // New-era split: photo is already the `sp…` half; display_photo is correct.
  newSplit: {
    split_from_spread: true,
    photo: `${R2}/pages/${BOOK}/sp0014-full.jpg`,
    archived_photo: `${R2}/pages/${BOOK}/sp0014-full.jpg`,
    display_photo: `${R2}/pages/${BOOK}/sp0014.jpg`,
  },
  // New-era split whose display_photo was never repointed at the half — it is
  // still a resize of the WHOLE SPREAD. Measured in production 2026-08-29 on
  // "An encyclopedic outline of masonic… philosophy" p.15, whose reader showed
  // an introduction spread beside OCR of the title page. The fixture above
  // assumes display_photo is an `sp…` URL; a large part of the corpus is this
  // shape instead, so the optimistic fixture hid the bug.
  newSplitStaleDisplay: {
    split_from_spread: true,
    photo: `${R2}/pages/${BOOK}/sp0014-full.jpg`,
    archived_photo: `${R2}/cropped/${BOOK}/sp0014.jpg`,
    display_photo: `${R2}/pages/${BOOK}/0015.jpg`,
  },
  // IIIF source, no R2 variant: origin server resizes via /full/{w},/.
  iiif: {
    photo: `https://digi.vatlib.it/iiifimage/MSS_Vat.arm.19/Vat.arm.19_0003.jp2/full/1000,/0/default.jpg`,
  },
  // Raw JP2 source (no variant): browser-unsafe — must not be served for display.
  rawJp2: {
    photo: `https://example.org/scans/${BOOK}/0007.jp2`,
  },
  // Archiving failed: source URLs are dead.
  failed: {
    archived_photo: 'failed:HTTP 404',
    photo: `${R2}/archived/${BOOK}/9.jpg`,
  },
  // Crop-coords page (~0.04%): region defined, no materialized half, not split.
  // display_photo is the UNcropped resize, so display/thumb must proxy-crop.
  cropCoords: {
    crop: { xStart: 250, xEnd: 750 },
    archived_photo: `${R2}/archived/${BOOK}/3.jpg`,
    photo: `${R2}/archived/${BOOK}/3.jpg`,
    display_photo: `${R2}/pages/${BOOK}/0003.jpg`,
  },
};

describe('crop-coords page proxy-crops, never the uncropped variant', () => {
  it('display → proxy-crops the source, not display_photo', () => {
    const url = getPageImageUrl(fixtures.cropCoords, 'display')!;
    expect(url).toContain('/api/image');
    expect(url).toContain('cx=250');
    expect(url).toContain('cw=750');
    expect(url).not.toContain('0003.jpg'); // the uncropped display variant
  });
  it('thumb → proxy-crops too', () => {
    const url = getPageImageUrl(fixtures.cropCoords, 'thumb')!;
    expect(url).toContain('/api/image');
    expect(url).toContain('cx=250');
  });
});

describe('getPageImageUrl — universal size axis', () => {
  it('normal page: display → pre-sized R2 display variant (free)', () => {
    expect(getPageImageUrl(fixtures.normal, 'display')).toBe(`${R2}/pages/${BOOK}/0005.jpg`);
  });
  it('normal page: thumb → pre-sized R2 thumb variant', () => {
    expect(getPageImageUrl(fixtures.normal, 'thumb')).toBe(`${R2}/pages/${BOOK}/0005-thumb.jpg`);
  });
  it('normal page: original → the archived source', () => {
    expect(getPageImageUrl(fixtures.normal, 'original')).toBe(`${R2}/archived/${BOOK}/5.jpg`);
  });
  it('default size is display', () => {
    expect(getPageImageUrl(fixtures.normal)).toBe(getPageImageUrl(fixtures.normal, 'display'));
  });
});

describe('split-from-spread source identity', () => {
  it('old-era: display proxies the cropped half, NOT the uncropped display_photo', () => {
    const url = getPageImageUrl(fixtures.oldSplit, 'display')!;
    expect(url).toContain('/api/image');
    expect(url).toContain(encodeURIComponent(`${R2}/cropped/${BOOK}/abc123.jpg`));
    expect(url).not.toContain('0001.jpg'); // the trap variant
  });
  it('old-era: original → the cropped half', () => {
    expect(getPageImageUrl(fixtures.oldSplit, 'original')).toBe(`${R2}/cropped/${BOOK}/abc123.jpg`);
  });
  it('new-era: display → the correct sp… display variant', () => {
    expect(getPageImageUrl(fixtures.newSplit, 'display')).toBe(`${R2}/pages/${BOOK}/sp0014.jpg`);
  });
  it('new-era: thumb → derived sp… thumb variant', () => {
    expect(getPageImageUrl(fixtures.newSplit, 'thumb')).toBe(`${R2}/pages/${BOOK}/sp0014-thumb.jpg`);
  });
  it('new-era: original → the sp… half', () => {
    expect(getPageImageUrl(fixtures.newSplit, 'original')).toBe(`${R2}/pages/${BOOK}/sp0014-full.jpg`);
  });

  // The reader renders `display`. If that resolves to the spread while the OCR
  // beside it was read from the half, the two panels describe different pages —
  // which is what a reader reported on 2026-08-29. `getPageSource` already
  // returns the half here; the pre-sized-variant tier was overriding it.
  it('new-era with a STALE display_photo: display must not fall back to the spread', () => {
    const url = getPageImageUrl(fixtures.newSplitStaleDisplay, 'display')!;
    expect(url).not.toContain('0015.jpg'); // the spread — the trap
    expect(url).toContain('sp0014');
  });
  it('new-era with a STALE display_photo: thumb stays on the half', () => {
    const url = getPageImageUrl(fixtures.newSplitStaleDisplay, 'thumb')!;
    expect(url).not.toContain('0015');
    expect(url).toContain('sp0014');
  });
  it('new-era with a STALE display_photo: source identity is unchanged', () => {
    // getPageSource was never the problem — it returns the half. The pre-sized
    // variant tier in resolveSized was overriding it.
    expect(getPageSource(fixtures.newSplitStaleDisplay)).toBe(`${R2}/pages/${BOOK}/sp0014-full.jpg`);
  });
});

describe('IIIF-native resize tier', () => {
  it('display → rewrites the IIIF size segment to the requested width', () => {
    expect(getPageImageUrl(fixtures.iiif, 'display')).toBe(
      `https://digi.vatlib.it/iiifimage/MSS_Vat.arm.19/Vat.arm.19_0003.jp2/full/1200,/0/default.jpg`,
    );
  });
  it('thumb → IIIF size segment at thumb width', () => {
    expect(getPageImageUrl(fixtures.iiif, 'thumb')).toContain('/full/150,/');
  });
  it('a .jp2 mid-URL ending in default.jpg is browser-safe (not rejected)', () => {
    expect(getPageImageUrl(fixtures.iiif, 'display')).not.toBeNull();
  });
});

describe('format & failure guards', () => {
  it('raw .jp2 source is not served for display (browser-unsafe)', () => {
    expect(getPageImageUrl(fixtures.rawJp2, 'display')).toBeNull();
    expect(getPageImageUrl(fixtures.rawJp2, 'thumb')).toBeNull();
  });
  it('raw .jp2 is still returned for original (OCR/download can transcode)', () => {
    expect(getPageImageUrl(fixtures.rawJp2, 'original')).toBe(`https://example.org/scans/${BOOK}/0007.jp2`);
  });
  it('failed archive → null at every size', () => {
    for (const size of ['thumb', 'display', 'original', 'hires'] as const) {
      expect(getPageImageUrl(fixtures.failed, size)).toBeNull();
    }
  });
});

describe('cost-tier invariant', () => {
  it('never routes through the metered Vercel image optimizer', () => {
    for (const page of Object.values(fixtures)) {
      for (const size of ['thumb', 'display', 'original', 'hires'] as const) {
        const url = getPageImageUrl(page, size);
        if (url) expect(url).not.toContain('/_next/image');
      }
    }
  });
});

describe('TS and scripts JS twin agree on getPageSource', () => {
  it('returns identical source for every fixture', () => {
    for (const [name, page] of Object.entries(fixtures)) {
      expect(getPageSourceJs(page), name).toBe(getPageSource(page));
    }
  });
});

/**
 * Browser-renderability invariant (2026-08-21).
 *
 * `media.getty.edu` was never added to CSP_IMG_HOSTS, so all 2,506 Florentine
 * Codex pages resolved `image_thumb` to a Getty URL the browser refused —
 * broken images in the page grid, the cover picker AND the reader, while curl
 * got a clean 200 from every one of them. A stored URL is only useful if the
 * browser will load it, so the resolver screens candidates against the same
 * list the CSP is built from and falls through to a host that works.
 */
describe('CSP renderability invariant', () => {
  const renderable = (url: string) => url.startsWith('/') || isBrowserRenderableImageUrl(url);

  it('every corpus-shaped fixture resolves to a URL the browser may load', () => {
    // Not a universal law — see the both-lists-blocked case below, where the
    // only usable URL is one the browser refuses. It IS a law for every page
    // shape that exists in the corpus, which is what this asserts.
    for (const [name, page] of Object.entries(fixtures)) {
      for (const size of ['thumb', 'display', 'hires'] as const) {
        const url = getPageImageUrl(page, size);
        if (url) expect(renderable(url), `${name}/${size}: ${url}`).toBe(true);
      }
    }
  });

  it('a stored thumb on a CSP-blocked host falls through to the R2 variant', () => {
    // The exact Florentine Codex shape: provider thumb, R2 fallbacks alongside.
    const blockedHost: PageImageFields = {
      image_thumb: 'https://blocked.example.org/iiif/x/full/150,/0/default.jpg',
      photo: 'https://blocked.example.org/iiif/x/full/1200,/0/default.jpg',
      thumbnail_blob: `${R2}/pages/${BOOK}/0001-thumb.jpg`,
      archived_photo: `${R2}/archived/${BOOK}/1.jpg`,
    };
    expect(getPageImageUrl(blockedHost, 'thumb')).toBe(`${R2}/pages/${BOOK}/0001-thumb.jpg`);
  });

  it('CSP-blocked but proxy-fetchable → the same-origin proxy', () => {
    // images.metmuseum.org is in the /api/image allowlist but not in img-src,
    // so the proxy is the one route that renders.
    const proxyable: PageImageFields = {
      image_thumb: 'https://images.metmuseum.org/CRDImages/x/thumb.jpg',
      photo: 'https://images.metmuseum.org/CRDImages/x/original.jpg',
    };
    for (const size of ['thumb', 'display', 'hires'] as const) {
      expect(getPageImageUrl(proxyable, size), size).toMatch(/^\/api\/image\?/);
    }
  });

  it('blocked by BOTH lists → keeps the bounded stored URL, never null', () => {
    // Nothing can render this in a browser, but a server-side consumer
    // (pageExportImageUrl → fetch) still can, so it must not be discarded.
    const nowhere: PageImageFields = {
      image_thumb: 'https://blocked.example.org/iiif/x/full/150,/0/default.jpg',
      display_photo: 'https://blocked.example.org/iiif/x/full/1200,/0/default.jpg',
      photo: 'https://blocked.example.org/iiif/x/original.jpg',
    };
    expect(getPageImageUrl(nowhere, 'thumb')).toBe('https://blocked.example.org/iiif/x/full/150,/0/default.jpg');
    expect(getPageImageUrl(nowhere, 'display')).toBe('https://blocked.example.org/iiif/x/full/1200,/0/default.jpg');
  });

  it('an allowlisted IIIF host still gets the free origin-side resize', () => {
    // digi.vatlib.it is in CSP_IMG_HOSTS — must NOT be pushed onto our proxy.
    expect(getPageImageUrl(fixtures.iiif, 'thumb')).toContain('digi.vatlib.it');
    expect(getPageImageUrl(fixtures.iiif, 'thumb')).not.toContain('/api/image');
  });
});

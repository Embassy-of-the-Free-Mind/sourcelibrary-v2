import { describe, it, expect } from 'vitest';
import { iiifFullSizeUrl as tsFullSize } from '../../src/lib/iiif-image-service';
import { extractCanvasImage as tsExtract } from '../../src/lib/import-utils';
import { iiifFullSizeUrl as mjsFullSize } from '../../scripts/lib/iiif-utils.mjs';
import { extractCanvasImage as mjsExtract } from '../../scripts/iiif-discovery/lib/manifest-store.mjs';
import { manifestToPages } from '../../scripts/iiif-discovery/lib/iiif-metadata.mjs';

/**
 * IIIF Image API 3.0 removed the size keyword `full`; a v3 service answers
 * `/full/full/` with `400 Invalid size` (#4655). Manifest→page builders used to
 * append `/full/full/0/default.jpg` unconditionally, minting 91,695 pages that
 * could never fetch. These pin `max` for v3 and `full` for everything else,
 * across both twins (src/ and scripts/) and the builders that call them.
 */

const IA_V3 = 'https://iiif.archive.org/image/iiif/3/foo%2Ffoo_jp2.zip%2Ffoo_jp2%2Ffoo_0001.jp2';
const MDZ_V2 = 'https://api.digitale-sammlungen.de/iiif/image/v2/bsb00100705_00001';
const NDL = 'https://dl.ndl.go.jp/api/iiif/3/1234567/R0000001';
const DLCS_V3 = 'https://dlc.services/iiif-img/v3/7/18/abc';
const OPAQUE = 'https://images.example.org/svc/abc';

describe.each([
  ['src', tsFullSize],
  ['scripts', mjsFullSize],
])('iiifFullSizeUrl (%s twin)', (_name, fn) => {
  it('v3 path -> max', () => {
    expect(fn(IA_V3)).toBe(`${IA_V3}/full/max/0/default.jpg`);
    expect(fn(DLCS_V3)).toBe(`${DLCS_V3}/full/max/0/default.jpg`);
  });
  it('v2 path -> full', () => {
    expect(fn(MDZ_V2)).toBe(`${MDZ_V2}/full/full/0/default.jpg`);
  });
  it('dl.ndl.go.jp keeps full despite its v3-shaped path (500s on max)', () => {
    expect(fn(NDL)).toBe(`${NDL}/full/full/0/default.jpg`);
  });
  it('opaque path: the service object decides', () => {
    expect(fn(OPAQUE)).toBe(`${OPAQUE}/full/full/0/default.jpg`);
    expect(fn(OPAQUE, [{ id: OPAQUE, type: 'ImageService3', profile: 'level2' }])).toBe(`${OPAQUE}/full/max/0/default.jpg`);
    expect(fn(OPAQUE, { '@id': OPAQUE, '@context': 'http://iiif.io/api/image/3/context.json' })).toBe(`${OPAQUE}/full/max/0/default.jpg`);
    expect(fn(OPAQUE, { '@id': OPAQUE, '@context': 'http://iiif.io/api/image/2/context.json', profile: 'http://iiif.io/api/image/2/level2.json' })).toBe(`${OPAQUE}/full/full/0/default.jpg`);
  });
});

const v3Canvas = (sid: string, svc: Record<string, unknown> = {}) => ({
  items: [{ items: [{ body: { id: `${sid}/full/max/0/default.jpg`, service: [{ id: sid, type: 'ImageService3', ...svc }] } }] }],
});
const v2Canvas = (sid: string) => ({
  images: [{ resource: { '@id': `${sid}/full/full/0/default.jpg`, service: { '@id': sid, '@context': 'http://iiif.io/api/image/2/context.json' } } }],
});

describe.each([
  ['src/lib/import-utils', tsExtract],
  ['scripts manifest-store', mjsExtract],
])('extractCanvasImage (%s) never mints /full/full/ on a v3 service', (_name, fn) => {
  it('IA v3 canvas -> /full/max/', () => {
    expect(fn(v3Canvas(IA_V3) as never).photo).toBe(`${IA_V3}/full/max/0/default.jpg`);
  });
  it('v2 canvas unchanged -> /full/full/', () => {
    expect(fn(v2Canvas(MDZ_V2) as never).photo).toBe(`${MDZ_V2}/full/full/0/default.jpg`);
  });
});

describe('manifestToPages', () => {
  it('v3 manifest -> /full/max/', () => {
    const pages = manifestToPages({ items: [v3Canvas(IA_V3)] });
    expect(pages[0].photo).toBe(`${IA_V3}/full/max/0/default.jpg`);
  });
});

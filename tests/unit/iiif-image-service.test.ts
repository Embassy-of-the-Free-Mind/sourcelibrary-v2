/**
 * #5079: an Internet Archive BookReader URL is IIIF-shaped but has no Image API
 * service behind it — `{base}/info.json` answers 404, or a JPEG. The manifest must
 * paint such a page with NO service rather than advertise one viewers cannot load.
 * Negative control: drop the NOT_AN_IMAGE_SERVICE guard and the IA cases fail.
 */
import { describe, it, expect } from 'vitest';
import { extractImageService } from '@/lib/iiif-image-service';
import { imageServiceId } from '../../scripts/lib/allmaps.mjs';

const IA_BOOKREADER = [
  'https://archive.org/download/waghenaer-1584-spieghel-der-zeevaerdt/page/n9/full/pct:50/0/default.jpg',
  'https://archive.org/download/spiegelderzeevae00wagh/page/n5/full/full/0/default.jpg',
  'https://ia800505.us.archive.org/download/gri_tychonisbrah00brah/page/n106/full/1000,/0/default.jpg',
];

describe('extractImageService', () => {
  it.each(IA_BOOKREADER)('returns null for the IA BookReader endpoint %s', (url) => {
    expect(extractImageService(url)).toBeNull();
    expect(imageServiceId(url)).toBeNull();
  });

  it('still recovers the real IA Image API service on iiif.archive.org', () => {
    const base = 'https://iiif.archive.org/image/iiif/3/x%2Fx_jp2.zip%2Fx_jp2%2Fx_0001.jp2';
    expect(extractImageService(`${base}/full/max/0/default.jpg`)).toEqual({
      id: base,
      type: 'ImageService3',
      profile: 'level2',
    });
    expect(imageServiceId(`${base}/full/max/0/default.jpg`)).toBe(base);
  });

  it('still recovers an unrecognized IIIF host with the conservative default', () => {
    const base = 'https://images.uba.uva.nl/iiif/2/abc.jpg';
    expect(extractImageService(`${base}/full/1000,/0/default.jpg`)?.id).toBe(base);
  });

  it('returns null for a plain re-hosted JPEG', () => {
    expect(extractImageService('https://images.sourcelibrary.org/pages/abc/1.jpg')).toBeNull();
  });
});

/**
 * Allmaps editor link (#5070): the link must point at something Allmaps can TILE.
 *
 * Our own manifest paints the provenance-marked R2 derivative, which has no IIIF
 * Image service, so a link built from `display_photo` or `archived_photo` would open
 * the editor on an image it cannot load. The helper therefore reads the SOURCE image
 * URL first and falls back to the source manifest; an R2-only page yields null (no
 * button), never a dead link.
 */
import { describe, it, expect } from 'vitest';
import { allmapsEditorUrl, allmapsTargetUrl } from '@/lib/allmaps';

describe('allmapsTargetUrl', () => {
  it('turns an Allard Pierson IIIF image URL into its info.json', () => {
    const target = allmapsTargetUrl({
      pageImageUrls: [
        'https://images.uba.uva.nl/iiif/2/default!1!3!1!990011196650205131!otm-kzl-1804-a-2_005.jpg/full/1000,/0/default.jpg',
      ],
    });
    expect(target).toBe(
      'https://images.uba.uva.nl/iiif/2/default!1!3!1!990011196650205131!otm-kzl-1804-a-2_005.jpg/info.json',
    );
  });

  it('falls back to the Internet Archive manifest when the page image is the BookReader URL', () => {
    // archive.org/download/…/page/nN/… is IIIF-shaped but answers 404 to info.json,
    // so it must NOT be treated as an image service (it would be a dead link).
    const target = allmapsTargetUrl({
      pageImageUrls: ['https://archive.org/download/waghenaer-1584-spieghel-der-zeevaerdt/page/n9/full/pct:50/0/default.jpg'],
      iaIdentifier: 'waghenaer-1584-spieghel-der-zeevaerdt',
    });
    expect(target).toBe('https://iiif.archive.org/iiif/3/waghenaer-1584-spieghel-der-zeevaerdt/manifest.json');
  });

  it('falls back to the imported IIIF manifest when the page image is not IIIF-shaped', () => {
    const target = allmapsTargetUrl({
      pageImageUrls: ['https://example.org/scans/page-5.jpg'],
      iiifManifest: 'https://uvaerfgoed.nl/viewer/api/v1/records/11245_3_39654/manifest/',
    });
    expect(target).toBe('https://uvaerfgoed.nl/viewer/api/v1/records/11245_3_39654/manifest/');
  });

  it('returns null for an R2-only page (nothing Allmaps can tile)', () => {
    expect(allmapsTargetUrl({
      pageImageUrls: [
        'https://images.sourcelibrary.org/pages/69b525942379d2fed6c291f6/0005.jpg',
        'https://images.sourcelibrary.org/archived/69b525942379d2fed6c291f6/5.jpg',
        null,
      ],
    })).toBeNull();
  });
});

describe('allmapsEditorUrl', () => {
  it('encodes the target into the editor url parameter', () => {
    const url = allmapsEditorUrl({
      pageImageUrls: ['https://gallica.bnf.fr/iiif/ark:/12148/btv1b53095154p/f7/full/pct:50/0/native.jpg'],
    });
    expect(url).toBeNull(); // `native` is not a IIIF quality; the regex rejects it → no link
    const ok = allmapsEditorUrl({
      pageImageUrls: ['https://gallica.bnf.fr/iiif/ark:/12148/btv1b53095154p/f7/full/pct:50/0/default.jpg'],
    });
    expect(ok).toBe(
      'https://editor.allmaps.org/images?url=' +
        encodeURIComponent('https://gallica.bnf.fr/iiif/ark:/12148/btv1b53095154p/f7/info.json'),
    );
  });
});

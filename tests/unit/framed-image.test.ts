import { describe, it, expect } from 'vitest';
import { coverFrame, pageImageFrame, framedAspect, framedImageStyle } from '@/lib/framed-image';
import { r2PageIdentity } from '@/lib/r2-page-identity';
// @ts-expect-error — plain .mjs script, no types
import { coverOf, fetchCandidates, same } from '../../scripts/maintenance/cover-frame-backfill.mjs';

const B = '697d9c99f2b56306a9ec9626';
const frame = { x: 0.1, y: 0, w: 0.8, h: 1, ar: 0.7, v: 3 };
const R2 = 'https://images.sourcelibrary.org';

describe('coverFrame — a stored frame applies only to the cover it was measured on', () => {
  const book = { thumbnail_frame: { ...frame, of: `${B}/5` } };

  it('applies to every size of that page image', () => {
    for (const url of [`${R2}/archived/${B}/5.jpg`, `${R2}/pages/${B}/0005.jpg`, `${R2}/pages/${B}/0005-thumb.jpg`, `${R2}/pages/${B}/0005-card.avif`]) {
      expect(coverFrame(book, url)).toEqual(frame);
    }
  });

  it('is refused once the cover is another page, another book, or not ours', () => {
    expect(coverFrame(book, `${R2}/pages/${B}/0006.jpg`)).toBeNull();
    expect(coverFrame(book, `${R2}/pages/other-book/0005.jpg`)).toBeNull();
    expect(coverFrame(book, `${R2}/cropped/${B}/697d9cd5fcc22692eaaf0c7a.jpg`)).toBeNull();
    expect(coverFrame(book, 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg')).toBeNull();
    expect(coverFrame(book, `/api/image?url=${encodeURIComponent(`${R2}/pages/${B}/0005.jpg`)}&w=400`)).toBeNull();
    expect(coverFrame(book, null)).toBeNull();
  });

  it('needs the identity: a bare page frame on a book is never applied', () => {
    expect(coverFrame({ thumbnail_frame: frame }, `${R2}/pages/${B}/0005.jpg`)).toBeNull();
    expect(coverFrame({ thumbnail_frame: { ...frame, of: '' } }, `${R2}/pages/${B}/0005.jpg`)).toBeNull();
  });

  it('refuses a frame that would hide most of the image, and a book without one', () => {
    expect(coverFrame({ thumbnail_frame: { ...frame, w: 0.4, of: `${B}/5` } }, `${R2}/pages/${B}/0005.jpg`)).toBeNull();
    expect(coverFrame({}, `${R2}/pages/${B}/0005.jpg`)).toBeNull();
    expect(coverFrame(null, `${R2}/pages/${B}/0005.jpg`)).toBeNull();
  });
});

describe('pageImageFrame — a page frame carries to that page\'s thumbnail only', () => {
  const page = { page_frame: frame, display_photo: `${R2}/pages/${B}/0013.jpg`, archived_photo: `${R2}/archived/${B}/13.jpg` };

  it('applies to the thumbnail of the measured image', () => {
    expect(pageImageFrame(page, `${R2}/pages/${B}/0013-thumb.jpg`)).toEqual(frame);
  });

  it('is refused for a split half or another page, by URL', () => {
    expect(pageImageFrame(page, `${R2}/pages/${B}/sp0013-thumb.jpg`)).toBeNull();
    expect(pageImageFrame(page, `${R2}/pages/${B}/0014-thumb.jpg`)).toBeNull();
  });

  it('is refused for a page shown as part of its stored image', () => {
    const url = `${R2}/pages/${B}/0013-thumb.jpg`;
    expect(pageImageFrame({ ...page, split_from_spread: true }, url)).toBeNull();
    expect(pageImageFrame({ ...page, cropped_photo: `${R2}/cropped/${B}/x.jpg` }, url)).toBeNull();
    expect(pageImageFrame({ ...page, crop: { xStart: 0, xEnd: 500 } }, url)).toBeNull();
  });

  it('leaves a URL with no identity to the shape check on load', () => {
    expect(pageImageFrame(page, '/api/image?url=x&w=150')).toEqual(frame);
  });

  it('a page without a frame gets none', () => {
    expect(pageImageFrame({ display_photo: page.display_photo }, `${R2}/pages/${B}/0013-thumb.jpg`)).toBeNull();
  });
});

describe('framedImageStyle — the crop in percentages of a page-shaped box', () => {
  it('scales and offsets the whole image so only the frame shows', () => {
    expect(framedImageStyle({ x: 0.1, y: 0.2, w: 0.8, h: 0.5, ar: 1, v: 3 })).toEqual({ left: '-12.5%', top: '-40%', width: '125%', height: '200%' });
  });

  it('the box has the shape of the framed page, not of the scan', () => {
    expect(framedAspect({ x: 0, y: 0, w: 0.8, h: 1, ar: 0.75, v: 3 })).toBeCloseTo(0.6);
  });
});

describe('cover-frame-backfill — which cover is measured', () => {
  it('measures the cover a Mongo-fed card draws and records its identity', () => {
    const c = coverOf({ id: B, image_display: ` ${R2}/archived/${B}/5.jpg `, thumbnail: `${R2}/cropped/${B}/abc.jpg` });
    expect(c).toEqual({ url: `${R2}/archived/${B}/5.jpg`, of: `${B}/5` });
    expect(c.of).toBe(r2PageIdentity(`${R2}/pages/${B}/0005-card.avif`));
  });

  it('skips a cover that is not this book\'s own R2 image', () => {
    expect(coverOf({ id: B, thumbnail: `${R2}/archived/undefined/5.jpg` })).toBeNull();
    expect(coverOf({ id: B, thumbnail: `${R2}/artwork/art-1.jpg` })).toBeNull();
    expect(coverOf({ id: B, thumbnail: 'https://archive.org/download/x/page/n1.jpg' })).toBeNull();
    expect(coverOf({ id: B })).toBeNull();
  });

  it('reads the 1200px copy first and the stored URL last', () => {
    expect(fetchCandidates(`${R2}/archived/${B}/5.jpg`)).toEqual([`${R2}/pages/${B}/0005.jpg`, `${R2}/archived/${B}/5.jpg`]);
    expect(fetchCandidates(`${R2}/pages/${B}/0005-full.jpg`)).toEqual([`${R2}/pages/${B}/0005.jpg`, `${R2}/pages/${B}/0005-full.jpg`]);
    expect(fetchCandidates(`${R2}/cropped/${B}/abc.jpg`)).toEqual([`${R2}/cropped/${B}/abc.jpg`]);
  });

  it('keeps a stored frame a re-read only nudged, and replaces one for another cover', () => {
    const stored = { x: 0, y: 0.05, w: 0.94, h: 0.91, ar: 0.69, v: 3, of: `${B}/5` };
    expect(same({ ...stored, x: 0.03, w: 0.89 }, stored)).toBe(true);
    expect(same({ ...stored, w: 0.8 }, stored)).toBe(false);
    expect(same({ ...stored, of: `${B}/6` }, stored)).toBe(false);
    expect(same({ ...stored, v: 4 }, stored)).toBe(false);
    expect(same(stored, null)).toBe(false);
  });
});

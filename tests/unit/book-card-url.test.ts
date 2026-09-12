import { describe, it, expect } from 'vitest';
import { getBookCardUrl, cardUrlForCover } from '@/lib/utils';
import { buildCoverUpdate } from '@/lib/cover-fields';

const R2 = 'https://images.sourcelibrary.org';

/**
 * The 500px AVIF card variant is addressed by a STORED pointer (`image_card`),
 * never by deriving a sibling URL — a guessed `-card.avif` 404s for every book
 * the backfill hasn't reached, which is the broken-cover failure already
 * recorded twice in book-cover-loader.ts.
 *
 * The pointer names one specific page, so it goes stale the moment the cover
 * moves. A stale pointer is worse than a missing one: it renders the PREVIOUS
 * cover. These tests pin both halves of the guard.
 */
describe('cardUrlForCover — where a cover\'s card variant lives', () => {
  it('maps a canonical page scan to its sibling', () => {
    expect(cardUrlForCover(`${R2}/pages/abc/0005.jpg`)).toBe(`${R2}/pages/abc/0005-card.avif`);
  });

  // 8,464 of the 16,800 backfill candidates are in this shape. The card is NOT
  // a sibling of the stored URL — /archived/{id}/5.jpg is the same page as
  // /pages/{id}/0005.jpg, zero-padded. A naive sibling check silently rejected
  // half the corpus in review.
  it('rewrites the legacy /archived/ path to its /pages/ home, zero-padded', () => {
    expect(cardUrlForCover(`${R2}/archived/abc/5.jpg`)).toBe(`${R2}/pages/abc/0005-card.avif`);
    expect(cardUrlForCover(`${R2}/archived/abc/12.jpg`)).toBe(`${R2}/pages/abc/0012-card.avif`);
    expect(cardUrlForCover(`${R2}/thumbnails/abc/7.jpg`)).toBe(`${R2}/pages/abc/0007-card.avif`);
  });

  it('normalises whichever variant suffix is stored', () => {
    expect(cardUrlForCover(`${R2}/pages/abc/0005-thumb.jpg`)).toBe(`${R2}/pages/abc/0005-card.avif`);
    expect(cardUrlForCover(`${R2}/pages/abc/0005-full.jpg`)).toBe(`${R2}/pages/abc/0005-card.avif`);
  });

  it('handles cropped covers', () => {
    expect(cardUrlForCover(`${R2}/cropped/abc/def.jpg`)).toBe(`${R2}/cropped/abc/def-card.avif`);
  });

  it('returns null for covers with no R2 page-scan home', () => {
    expect(cardUrlForCover('https://upload.wikimedia.org/x.jpg')).toBeNull();
    expect(cardUrlForCover('https://archive.org/download/x/page/n0/full/pct:15/0/default.jpg')).toBeNull();
    expect(cardUrlForCover(null)).toBeNull();
    expect(cardUrlForCover('')).toBeNull();
  });
});

describe('getBookCardUrl — only a live, non-stale pointer is used', () => {
  it('uses the card when it names the same page as the cover', () => {
    expect(getBookCardUrl({ image_display: `${R2}/pages/abc/0005.jpg`, image_card: `${R2}/pages/abc/0005-card.avif` }))
      .toBe(`${R2}/pages/abc/0005-card.avif`);
  });

  it('uses the card for a legacy /archived/ cover', () => {
    expect(getBookCardUrl({ image_display: `${R2}/archived/abc/5.jpg`, image_card: `${R2}/pages/abc/0005-card.avif` }))
      .toBe(`${R2}/pages/abc/0005-card.avif`);
  });

  // The case this guard exists for: someone picks a different cover page after
  // the backfill ran. Serving the old card would show the WRONG page.
  it('refuses a pointer left behind by a cover change', () => {
    expect(getBookCardUrl({ image_display: `${R2}/pages/abc/0012.jpg`, image_card: `${R2}/pages/abc/0005-card.avif` })).toBeNull();
    expect(getBookCardUrl({ image_display: `${R2}/archived/abc/12.jpg`, image_card: `${R2}/pages/abc/0005-card.avif` })).toBeNull();
  });

  it('refuses a pointer belonging to another book', () => {
    expect(getBookCardUrl({ image_display: `${R2}/pages/xyz/0005.jpg`, image_card: `${R2}/pages/abc/0005-card.avif` })).toBeNull();
  });

  it('falls back when there is no pointer yet', () => {
    expect(getBookCardUrl({ image_display: `${R2}/pages/abc/0005.jpg`, image_card: null })).toBeNull();
    expect(getBookCardUrl({ image_display: `${R2}/pages/abc/0005.jpg` })).toBeNull();
  });

  it('refuses a card pointer against a cover that has no R2 home', () => {
    expect(getBookCardUrl({ image_display: 'https://upload.wikimedia.org/x.jpg', image_card: `${R2}/pages/abc/0005-card.avif` })).toBeNull();
  });

  /**
   * The card must never change WHICH picture a surface shows, only its weight.
   *
   * `thumbnail` and `image_display` disagree for 4,309 live books (incomplete
   * dual-write, PR #1588), and surfaces render different ones: the Supabase-fed
   * catalogue has only `thumbnail`; Mongo-fed surfaces prefer `image_display`.
   * So the guard validates against whichever cover the caller will actually
   * render. Validating against `image_display` unconditionally swapped the
   * cover on 3,635 books — caught in review, pinned here.
   */
  describe('validates against the cover the caller actually renders', () => {
    it('on a catalogue row (thumbnail only), matches the card to thumbnail', () => {
      expect(getBookCardUrl({ thumbnail: `${R2}/pages/abc/0005.jpg`, image_card: `${R2}/pages/abc/0005-card.avif` }))
        .toBe(`${R2}/pages/abc/0005-card.avif`);
    });

    it('refuses a card cut from a different page than the rendered cover', () => {
      // image_display says page 12, but this surface renders `thumbnail` (page 5).
      // Serving the page-12 card here would silently change the cover.
      expect(getBookCardUrl({ thumbnail: `${R2}/pages/abc/0005.jpg`, image_card: `${R2}/pages/abc/0012-card.avif` })).toBeNull();
    });

    it('prefers image_display when the surface projects it', () => {
      expect(getBookCardUrl({
        image_display: `${R2}/pages/abc/0012.jpg`,
        thumbnail: `${R2}/pages/abc/0005.jpg`,
        image_card: `${R2}/pages/abc/0012-card.avif`,
      })).toBe(`${R2}/pages/abc/0012-card.avif`);
    });
  });
});

describe('buildCoverUpdate clears the card pointer', () => {
  // Write-side half of the same invariant. Without this every cover change
  // leaves a pointer at the old page and the read guard is the only thing
  // standing between the reader and the previous cover.
  it('sets image_card to null on every cover write', () => {
    const update = buildCoverUpdate(
      { archived_photo: `${R2}/pages/abc/0012.jpg`, page_number: 12 } as never,
      { source: 'manual' },
    );
    expect(update).not.toBeNull();
    expect(update!.image_card).toBeNull();
  });

  it('a freshly written cover therefore reads as having no card', () => {
    const update = buildCoverUpdate(
      { archived_photo: `${R2}/pages/abc/0012.jpg`, page_number: 12 } as never,
      { source: 'manual' },
    );
    expect(getBookCardUrl({ image_display: update!.image_display, image_card: update!.image_card })).toBeNull();
  });
});

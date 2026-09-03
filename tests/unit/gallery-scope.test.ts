import { describe, it, expect } from 'vitest';
import {
  galleryFilter, galleryHref, isLinkableScope,
  DEFAULT_MIN_QUALITY, DEFAULT_MAX_PER_BOOK, NO_PER_BOOK_CAP,
} from '@/lib/gallery-scope';

/**
 * These lock the one property that kept breaking: a count and the link shown
 * beside it must describe the same set. Each case below is a bug that shipped.
 */
describe('gallery scope', () => {
  it('always writes the params it filtered on, so a changed default cannot silently split a count from its link', () => {
    const href = galleryHref({ collection: 'slime-moulds', minQuality: 0.5, maxPerBook: NO_PER_BOOK_CAP });
    expect(href).toContain('minQuality=0.5');
    expect(href).toContain('maxPerBook=999');
    // Even when the value equals today's default.
    expect(galleryHref({ bookId: 'b1' })).toContain(`minQuality=${DEFAULT_MIN_QUALITY}`);
  });

  it('matches /api/gallery\'s default quality — 0.7, not 0.5', () => {
    // A collection counted at 0.5 while linking to a page defaulting to 0.7:
    // 1,995 plates promised, 758 delivered.
    expect(DEFAULT_MIN_QUALITY).toBe(0.7);
    expect(galleryFilter({ bookId: 'b1' })).toMatchObject({ gallery_quality: { $gte: 0.7 } });
  });

  it('counts only what the gallery can serve', () => {
    // Mycology promised 2,980 and served 2,793: images with no crop are not
    // servable, so they must not be counted.
    const f = galleryFilter({ bookIds: ['a'] });
    expect(f).toMatchObject({ book_visible: true, extracted_url: { $ne: null }, image_url: { $ne: null } });
  });

  it('applies the per-book cap to the count, since the gallery applies it to results', () => {
    // "View all 267 plates" opened a page capped at 3 per book, showing 9.
    expect(galleryFilter({ bookIds: ['a'] })).toMatchObject({ book_rank: { $lte: DEFAULT_MAX_PER_BOOK } });
    expect(galleryFilter({ bookIds: ['a'], maxPerBook: NO_PER_BOOK_CAP })).not.toHaveProperty('book_rank');
  });

  it('never caps per book when scoped to a single book', () => {
    // A book's own gallery shows all of that book; the cap exists for variety
    // across books and would silently truncate it to three.
    expect(galleryFilter({ bookId: 'b1' })).not.toHaveProperty('book_rank');
  });

  it('marks subject-filtered scopes unlinkable, because /gallery cannot reproduce them', () => {
    // The slime moulds gallery shows 5 subject plates; /gallery would show 267.
    // Such a count must not label a link there.
    expect(isLinkableScope({ bookIds: ['a'], descriptionMatch: 'lycogala' })).toBe(false);
    expect(isLinkableScope({ collection: 'mycology' })).toBe(true);
    expect(galleryHref({ collection: 'x', descriptionMatch: 'lycogala' })).not.toContain('lycogala');
  });
});

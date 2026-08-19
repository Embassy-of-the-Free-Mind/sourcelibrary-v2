import { describe, it, expect } from 'vitest';
import { artworkRedirectSlug } from '@/lib/artwork-slug';
import { artworkToGalleryItem } from '@/lib/gallery-merge';

/**
 * Every standalone artwork had TWO fully-rendering URLs — `/artwork/<slug>` and
 * `/book/<slug>` — because `/book/[id]` branches to <ArtworkInfo> on `resource_type`
 * rather than refusing artworks. Both routes emitted a self-referential canonical, and
 * the gallery/MCP layer handed out the `/book` form, so AI clients cited the twin.
 *
 * These are the two ends of the fix. They are pinned separately because they fail in
 * opposite directions: the emitter failing means a non-canonical URL leaks out again
 * (cosmetic, recoverable); the redirect predicate failing means a live page 404s
 * (visible, and worse than the problem it fixes).
 */

const artwork = { content_type: 'artwork', resource_type: 'print', slug: 'art-ouroboros-emblem-1598' };

describe('artworkRedirectSlug — what /book/[id] hands to /artwork', () => {
  it('redirects a standalone artwork to its slug', () => {
    expect(artworkRedirectSlug(artwork)).toBe('art-ouroboros-emblem-1598');
  });

  it('redirects the manuscript-illumination kind too (resource_type is not one enum)', () => {
    // Real record: e-codices zbz-Ms-Rh-0172 f.44, a folio of Aurora consurgens.
    expect(artworkRedirectSlug({
      content_type: 'artwork', resource_type: 'manuscript-illumination', slug: 'e-codices-zbz-ms-rh-0172-044-max-copy',
    })).toBe('e-codices-zbz-ms-rh-0172-044-max-copy');
  });

  it('leaves readable books alone', () => {
    expect(artworkRedirectSlug({ resource_type: 'printed_book', slug: 'pandora-reusner' })).toBeNull();
    expect(artworkRedirectSlug({ resource_type: 'manuscript', slug: 'aurora-consurgens' })).toBeNull();
    expect(artworkRedirectSlug({ slug: 'no-resource-type-at-all' })).toBeNull();
  });

  it('leaves text-only works alone — TextReader owns them, /artwork would 404', () => {
    expect(artworkRedirectSlug({ content_type: 'text', resource_type: 'text', slug: 'javanese-wikisource' })).toBeNull();
  });

  it('never redirects a content_type:"book" record — getArtwork() refuses those', () => {
    // The guard that keeps a mis-tagged textual book from being bounced into a 404.
    expect(artworkRedirectSlug({ content_type: 'book', resource_type: 'print', slug: 'some-book' })).toBeNull();
  });

  it('keeps the /book form when there is no slug — /artwork matches by slug only', () => {
    expect(artworkRedirectSlug({ content_type: 'artwork', resource_type: 'print', slug: null })).toBeNull();
  });
});

describe('artworkToGalleryItem — the URL handed to tiles and MCP clients', () => {
  it('emits the canonical /artwork link', () => {
    expect(artworkToGalleryItem({ id: 'abc123', slug: 'art-ouroboros-emblem-1598', title: 'Ouroboros' }).link)
      .toBe('/artwork/art-ouroboros-emblem-1598');
  });

  it('falls back to /book/<id> only when the record has no slug', () => {
    expect(artworkToGalleryItem({ id: 'abc123', title: 'Untitled' }).link).toBe('/book/abc123');
  });
});

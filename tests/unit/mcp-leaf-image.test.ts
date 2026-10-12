import { describe, it, expect } from 'vitest';
import { absoluteImageUrl, leafImageCandidates } from '@/lib/mcp-leaf-image';
import { getPageImageUrl } from '@/lib/page-image-url';

/**
 * get_quote with include_image attached no image for 39 of 40 sampled books
 * (#3937, measured 2026-10-12): the quote API returns the browser-facing
 * display URL, which for most pages is a relative `/api/image?…` path, and the
 * MCP server fetched it as-is. Every candidate handed to a server-side fetch
 * must be absolute.
 */
describe('leafImageCandidates', () => {
  const relative =
    '/api/image?url=https%3A%2F%2Fimages.sourcelibrary.org%2Fcropped%2F697d9ca23ae651930d9afc0d%2F697d9eead66c7725753ac06d.jpg&w=1200&q=80';
  const r2 = 'https://images.sourcelibrary.org/pages/69bd9e336120d54bd037bf37/0020.jpg';

  it('makes a same-origin proxy path absolute', () => {
    expect(absoluteImageUrl(relative)).toBe(`https://sourcelibrary.org${relative}`);
    expect(absoluteImageUrl(r2)).toBe(r2);
    expect(absoluteImageUrl('//cdn.example.org/a.jpg')).toBe('//cdn.example.org/a.jpg');
  });

  it('never returns a URL a server-side fetch cannot resolve', () => {
    for (const url of [relative, r2]) {
      for (const candidate of leafImageCandidates(url)) {
        expect(() => new URL(candidate)).not.toThrow();
      }
    }
  });

  it('follows a proxy URL with a smaller request for the same source and crop', () => {
    const [first, second] = leafImageCandidates(`${relative}&cx=0&cw=500`);
    expect(first).toBe(`https://sourcelibrary.org${relative}&cx=0&cw=500`);
    const p = new URL(second).searchParams;
    expect(p.get('url')).toBe('https://images.sourcelibrary.org/cropped/697d9ca23ae651930d9afc0d/697d9eead66c7725753ac06d.jpg');
    expect(p.get('w')).toBe('1000');
    expect(p.get('q')).toBe('70');
    expect(p.get('cx')).toBe('0');
    expect(p.get('cw')).toBe('500');
  });

  it('follows a pre-sized R2 variant with a proxied re-encode (the variant can exceed 1 MB)', () => {
    const [first, second] = leafImageCandidates(r2);
    expect(first).toBe(r2);
    const u = new URL(second);
    expect(u.origin + u.pathname).toBe('https://sourcelibrary.org/api/image');
    expect(u.searchParams.get('url')).toBe(r2);
  });

  it('covers what the display resolver actually returns for an un-pre-sized page', () => {
    const display = getPageImageUrl(
      { photo: 'https://images.sourcelibrary.org/cropped/697d9ca23ae651930d9afc0d/697d9eead66c7725753ac06d.jpg' },
      'display',
    );
    expect(display).toMatch(/^\/api\/image\?/);
    expect(leafImageCandidates(display as string).every((c) => c.startsWith('https://'))).toBe(true);
  });
});

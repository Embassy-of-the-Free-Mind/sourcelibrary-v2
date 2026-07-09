import { describe, it, expect } from 'vitest';
import {
  findEmbeddedImageUrls,
  applyImageRemovals,
} from '@/lib/embassy/citation-fixes';

// The Librarian is told to embed only image URLs a tool actually returned
// this turn. When it invents one anyway, the server strips the fabricated
// `![alt](url)` embed rather than trying to "fix" it — there's no honest
// repair for a picture that doesn't exist. These tests pin the two pure
// helpers that power that removal: finding embed URLs, and cutting them
// out of already-streamed text without mangling the surrounding prose.

describe('findEmbeddedImageUrls', () => {
  it('finds multiple embeds in order', () => {
    const text = [
      'Intro paragraph.',
      '![first alt](https://example.com/one.png)',
      'Some prose in between.',
      '![second alt](https://example.com/two.png)',
      'Closing paragraph.',
    ].join('\n');
    expect(findEmbeddedImageUrls(text)).toEqual([
      'https://example.com/one.png',
      'https://example.com/two.png',
    ]);
  });

  it('ignores plain markdown links (no leading !)', () => {
    const text = 'See [the catalog record](https://example.com/notembed.png) for more.';
    expect(findEmbeddedImageUrls(text)).toEqual([]);
  });

  it('handles an optional markdown title', () => {
    const text = '![a](https://example.com/x.png "My Title")';
    expect(findEmbeddedImageUrls(text)).toEqual(['https://example.com/x.png']);
  });
});

describe('applyImageRemovals', () => {
  const URL = 'https://example.com/img.png';

  it('removes an own-line embed and its trailing newline, leaving no blank gap', () => {
    const text = 'Some intro text.\n![alt text](https://example.com/img.png)\nNext paragraph continues.\n';
    const out = applyImageRemovals(text, [URL]);
    expect(out).toBe('Some intro text.\nNext paragraph continues.\n');
    expect(out).not.toContain('\n\n');
  });

  it('leaves a following italic caption line intact', () => {
    const text = '![alt](https://example.com/img.png)\n*Caption citing Agrippa, De Occulta Philosophia, p.12.*\n';
    const out = applyImageRemovals(text, [URL]);
    expect(out).toBe('*Caption citing Agrippa, De Occulta Philosophia, p.12.*\n');
  });

  it('leaves embeds whose URL is not in removeUrls untouched', () => {
    const text = 'Before.\n![alt](https://example.com/other.png)\nAfter.\n';
    const out = applyImageRemovals(text, [URL]);
    expect(out).toBe(text);
  });

  it('removes an inline embed mid-paragraph', () => {
    const text = 'Here is an image ![alt](https://example.com/img.png) inline with text.';
    const out = applyImageRemovals(text, [URL]);
    expect(out).not.toContain(URL);
    expect(out).not.toContain('![alt]');
    expect(out).toBe('Here is an image  inline with text.');
  });

  it('escapes regex metacharacters in the URL and still removes it', () => {
    const trickyUrl = 'https://example.com/img.png?size=100&mode=fit+crop';
    const text = `Before.\n![alt](${trickyUrl})\nAfter.\n`;
    const out = applyImageRemovals(text, [trickyUrl]);
    expect(out).toBe('Before.\nAfter.\n');
    expect(out).not.toContain(trickyUrl);
  });

  it('is a no-op with an empty removeUrls array', () => {
    const text = 'Before.\n![alt](https://example.com/img.png)\nAfter.\n';
    expect(applyImageRemovals(text, [])).toBe(text);
  });

  it('does not strip a removeUrl that appears as a plain link elsewhere', () => {
    const text = `![alt](${URL})\nSee also [source](${URL}) for more.\n`;
    const out = applyImageRemovals(text, [URL]);
    expect(out).toBe(`See also [source](${URL}) for more.\n`);
  });
});

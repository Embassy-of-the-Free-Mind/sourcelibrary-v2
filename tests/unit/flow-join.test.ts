import { describe, it, expect } from 'vitest';
import { joinPagesHtml, continuesAcross } from '@/lib/flow-join';
import { markdownToHtml } from '@/lib/export-markdown-html';

/** The continuous /read view (#7118): pages run together only where the sentence does. */
const page = (n: number, md: string | null, block = false) =>
  ({ n, html: md === null ? null : markdownToHtml(md), href: `/book/b/page/${n}`, block });
const plain = (html: string) => html.replace(/<a class="page-marker"[^>]*>\d+<\/a>/g, '|');

describe('continuesAcross', () => {
  it('carries on when the page ends mid-sentence', () => {
    expect(continuesAcross('and so the stone was', 'heated for forty days.')).toBe(true);
    expect(continuesAcross('first, the vessel,', 'then the fire')).toBe(true);
  });
  it('breaks after a finished sentence that the next page does not continue', () => {
    expect(continuesAcross('It was heated.', 'Then it was cooled.')).toBe(false);
    expect(continuesAcross('He said, “Enough.”', 'The second book')).toBe(false);
  });
  it('carries on when the next page starts lower-case, whatever the punctuation', () => {
    expect(continuesAcross('as in Aristotle, Phys. 4.', 'chapter two, where')).toBe(true);
  });
});

describe('joinPagesHtml', () => {
  it('runs a sentence across the page into one paragraph, with the marker inside it', () => {
    const html = joinPagesHtml([page(1, 'First para.\n\nThe stone was'), page(2, 'heated for forty days.\n\nNext para.')]);
    expect(plain(html)).toBe('<p>|First para.</p>\n<p>The stone was | heated for forty days.</p>\n<p>Next para.</p>');
    expect(html).toContain('href="/book/b/page/2"');
    expect(html).toContain('id="p2"');
  });

  it('keeps the paragraph break where the page ends a sentence', () => {
    const html = joinPagesHtml([page(1, 'It was heated.'), page(2, 'Then it was cooled.')]);
    expect(plain(html)).toBe('<p>|It was heated.</p>\n<p>|Then it was cooled.</p>');
  });

  it('closes a hyphenated word without splitting it with the marker', () => {
    const html = joinPagesHtml([page(1, 'in this trea-'), page(2, 'tise we show')]);
    expect(plain(html)).toBe('<p>|in this treatise| we show</p>');
  });

  it('never joins into or out of a block page (an untranslated original)', () => {
    const html = joinPagesHtml([page(1, 'the stone was'), page(2, 'lapis erat', true), page(3, 'heated')]);
    expect(plain(html)).toBe('<p>|the stone was</p>\n<p>|lapis erat</p>\n<p>|heated</p>');
  });

  it('gives a blank page its marker on the next page, so no page number disappears', () => {
    const html = joinPagesHtml([page(1, 'The stone was'), page(2, null), page(3, 'heated.')]);
    expect(html).toContain('id="p2"');
    expect(plain(html)).toBe('<p>|The stone was || heated.</p>');
  });

  it('does not join a paragraph into a heading', () => {
    const html = joinPagesHtml([page(1, 'the stone was'), page(2, '# Chapter Two\n\nIt begins.')]);
    expect(html).toContain('<h1>Chapter Two</h1>');
    expect(plain(html).startsWith('<p>|the stone was</p>\n|<h1>')).toBe(true);
  });
});

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

  it('never runs editorial placeholders together', () => {
    const html = joinPagesHtml([page(1, '[Blank page — no translatable content]'), page(2, '[Blank page — no translatable content]')]);
    expect(plain(html)).toBe('<p>|[Blank page — no translatable content]</p>\n<p>|[Blank page — no translatable content]</p>');
  });

  it('drops a repeating running head and a signature mark at a join (Giorgi, 2026-10-22)', () => {
    const html = joinPagesHtml([
      page(1, 'PROEM.\nin that supramundane wheel\na iij'),
      page(2, 'PROEM.\nit possesses the middle, as John says.'),
    ]);
    expect(plain(html)).toBe('<p>|PROEM.<br/>in that supramundane wheel | it possesses the middle, as John says.</p>');
  });

  it('drops a running head set as its own paragraph, only when the page joins', () => {
    const joined = joinPagesHtml([page(1, 'PROEM.\n\nthe proportions of numbers, and'), page(2, 'PROEM.\n\nin Davidic hymns.')]);
    expect(plain(joined)).toBe('<p>|PROEM.</p>\n<p>the proportions of numbers, and | in Davidic hymns.</p>');
    const unjoined = joinPagesHtml([page(1, 'PROEM.\n\nIt ends.'), page(2, 'PROEM.\n\nThe next begins.')]);
    expect(plain(unjoined)).toBe('<p>|PROEM.</p>\n<p>It ends.</p>\n<p>|PROEM.</p>\n<p>The next begins.</p>');
  });

  it('drops a single capitals line when the text under it carries on in lower case', () => {
    const html = joinPagesHtml([page(1, 'we have deemed to'), page(2, 'PROLOGUE.\ntruly harmonious')]);
    expect(plain(html)).toBe('<p>|we have deemed to | truly harmonious</p>');
  });

  it('closes up the translation\'s continuation ellipses at a join', () => {
    const html = joinPagesHtml([page(1, 'so that we may be led...'), page(2, '...we may reach the goal.')]);
    expect(plain(html)).toBe('<p>|so that we may be led | we may reach the goal.</p>');
  });

  it('does not close up a hyphen across a continuation ellipsis (Giorgi p26)', () => {
    const html = joinPagesHtml([page(1, 'so that to it one may be led-'), page(2, '...we may reach the goal.')]);
    expect(plain(html)).toBe('<p>|so that to it one may be led- | we may reach the goal.</p>');
  });

  it('does not run a title line into the next page (Blake, The Marriage of Heaven and Hell)', () => {
    const html = joinPagesHtml([page(1, 'THE MARRIAGE of HEAVEN and HELL'), page(2, 'The Argument.')]);
    expect(plain(html)).toBe('<p>|THE MARRIAGE of HEAVEN and HELL</p>\n<p>|The Argument.</p>');
  });

  it('keeps a capitals line that opens only one page: a chapter title, not a running head', () => {
    const html = joinPagesHtml([page(1, 'and so the stone was'), page(2, 'CHAPTER TWO\nOn the heating of the stone.')]);
    expect(plain(html)).toContain('CHAPTER TWO');
  });

  it('does not join a paragraph into a heading', () => {
    const html = joinPagesHtml([page(1, 'the stone was'), page(2, '# Chapter Two\n\nIt begins.')]);
    expect(html).toContain('<h1>Chapter Two</h1>');
    expect(plain(html).startsWith('<p>|the stone was</p>\n|<h1>')).toBe(true);
  });
});

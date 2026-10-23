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
    const html = joinPagesHtml([page(1, '[This page could not be translated]'), page(2, '[This page could not be translated]')]);
    expect(plain(html)).toBe('<p>|[This page could not be translated]</p>\n<p>|[This page could not be translated]</p>');
  });

  it('drops a repeating running head and a signature mark at a join (Giorgi, 2026-10-22)', () => {
    const html = joinPagesHtml([
      page(1, 'PROEM.\nin that supramundane wheel\na iij'),
      page(2, 'PROEM.\nit possesses the middle, as John says.'),
    ]);
    expect(plain(html)).toBe('<p>|in that supramundane wheel | it possesses the middle, as John says.</p>');
  });

  it('drops a recurring running head from every page, joined or not: a continuous text has no page furniture', () => {
    const joined = joinPagesHtml([page(1, 'PROEM.\n\nthe proportions of numbers, and'), page(2, 'PROEM.\n\nin Davidic hymns.')]);
    expect(plain(joined)).toBe('<p>|the proportions of numbers, and | in Davidic hymns.</p>');
    const unjoined = joinPagesHtml([page(1, 'PROEM.\n\nIt ends.'), page(2, 'PROEM.\n\nThe next begins.')]);
    expect(plain(unjoined)).toBe('<p>|It ends.</p>\n<p>|The next begins.</p>');
  });

  it('keeps a head that is a page\'s only text', () => {
    const html = joinPagesHtml([page(1, 'PROEM.'), page(2, 'PROEM.\n\nIt ends.'), page(3, 'PROEM.\n\nNext.')]);
    expect(plain(html).startsWith('<p>|PROEM.</p>')).toBe(true);
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

  it('moves printed footnotes out of a sentence that runs over the page (Albigensians p48, p84)', () => {
    const html = joinPagesHtml([page(1, 'From Au-\n1. Art. Avignonet.'), page(2, 'riac, they fled.\n\nNext.')]);
    expect(plain(html)).toBe('<p>|From Auriac,| they fled.</p>\n<p class="flow-footnote">1. Art. Avignonet.</p>\n<p>Next.</p>');
    const rule = joinPagesHtml([page(1, 'They would have re-embarked\n---\n1. Dom Vaissette, Vol. VI.'), page(2, 'immediately.')]);
    expect(plain(rule)).toBe('<p>|They would have re-embarked | immediately.</p>\n<p class="flow-footnote">1. Dom Vaissette, Vol. VI.</p>');
  });

  it('moves footnote paragraphs marked (a) out of the join (Leibniz, Essays on Theodicy)', () => {
    const html = joinPagesHtml([page(1, 'it is solely for\n\n---\n(a) This printing was made in Frankfurt.'), page(2, 'the circumstance of the time.')]);
    expect(plain(html)).toBe('<p>|it is solely for | the circumstance of the time.</p>\n<p class="flow-footnote">(a) This printing was made in Frankfurt.</p>');
  });

  it('drops a mixed-case running foot that recurs with a changing page number (Hanshan)', () => {
    const html = joinPagesHtml([
      page(1, 'One.\n\nDream Wanderings, Fascicle 3 23'),
      page(2, 'Two.\n\nDream Wanderings, Fascicle 3 24'),
      page(3, 'the practice of canjiu\n\nDream Wanderings, Fascicle 3 25'),
      page(4, ', you must hold the gong\'an.'),
    ]);
    expect(plain(html)).toContain('the practice of canjiu, | you must hold');
  });

  it('drops an inline signature mark at the end of the page (Elias, "nor J 2")', () => {
    const html = joinPagesHtml([page(1, 'what they are, where they come from, nor J 2'), page(2, 'what they are made of.')]);
    expect(plain(html)).toBe('<p>|what they are, where they come from, nor | what they are made of.</p>');
  });

  it('drops a signature mark set as its own paragraph, and keeps a short real word', () => {
    expect(plain(joinPagesHtml([page(1, 'where they come from, nor\n\nJ 2'), page(2, 'where they go.')])))
      .toBe('<p>|where they come from, nor | where they go.</p>');
    expect(plain(joinPagesHtml([page(1, 'He said:\n\nYes'), page(2, 'The next.')]))).toContain('Yes');
  });

  it('joins across a translator\'s note that closes the page (Albigensians, EPUB with notes on)', () => {
    const html = joinPagesHtml([
      { n: 1, html: '<p>the lords had to appear before <span class="note">[The Inquisition of Toulouse.]</span></p>', href: '/p/1' },
      { n: 2, html: '<p>the terrible tribunal.</p>', href: '/p/2' },
    ]);
    expect(plain(html)).toBe('<p>|the lords had to appear before <span class="note">[The Inquisition of Toulouse.]</span> | the terrible tribunal.</p>');
  });

  it('carries a notes-only paragraph closing the page onto the sentence, which then runs on (Albigensians p43)', () => {
    const html = joinPagesHtml([
      { n: 43, html: '<p>the lords had to appear before</p>\n<p><span class="note">[1. Art. Laurac. 2. Du Mège, Hist. de Toul.]</span></p>', href: '/p/43' },
      { n: 44, html: '<p>the terrible tribunal.</p>', href: '/p/44' },
    ]);
    expect(plain(html)).toBe('<p>|the lords had to appear before <span class="note">[1. Art. Laurac. 2. Du Mège, Hist. de Toul.]</span> | the terrible tribunal.</p>');
  });

  it('keeps closing punctuation at the top of a page with the sentence before it', () => {
    const html = joinPagesHtml([page(1, 'as soon as a single thought arises'), page(2, ', it becomes an error.')]);
    expect(plain(html)).toBe('<p>|as soon as a single thought arises, | it becomes an error.</p>');
  });

  describe('illustrations', () => {
    const fig = '<figure>F</figure>';
    it('follow the first paragraph of their own page, after its page number', () => {
      const html = joinPagesHtml([page(1, 'It ends.'), { ...page(2, 'A new one.\n\nAnd more.'), figures: fig }]);
      expect(plain(html)).toBe('<p>|It ends.</p>\n<p>|A new one.</p>\n<figure>F</figure>\n<p>And more.</p>');
    });
    it('wait for a sentence that runs over the page to close, never splitting it', () => {
      const html = joinPagesHtml([page(1, 'The stone was'), { ...page(2, 'heated for days.\n\nThen cooled.'), figures: fig }]);
      expect(plain(html)).toBe('<p>|The stone was | heated for days.</p>\n<figure>F</figure>\n<p>Then cooled.</p>');
    });
    it('carry to the next break when the joined paragraph runs on to a later page', () => {
      const html = joinPagesHtml([page(1, 'The stone was'), { ...page(2, 'heated for'), figures: fig }, page(3, 'forty days.\n\nThen cooled.')]);
      expect(plain(html)).toBe('<p>|The stone was | heated for | forty days.</p>\n<figure>F</figure>\n<p>Then cooled.</p>');
    });
    it('a plate page with no text stands where it is when no sentence is open', () => {
      const html = joinPagesHtml([page(1, 'It ends.'), { ...page(2, null), figures: fig }, page(3, 'Next.')]);
      expect(plain(html)).toBe('<p>|It ends.</p>\n|<figure>F</figure>\n<p>|Next.</p>');
    });
    it('take the place of the translation\'s own account of the plate (Fludd, Temple of Music)', () => {
      const html = joinPagesHtml([{ ...page(1, 'ON MUSIC.\n\n[An elaborate architectural engraving titled "Temple of Music"]\n\nThe towers sound.'), figures: fig }]);
      expect(plain(html)).toBe('<p>|ON MUSIC.</p>\n<figure>F</figure>\n<p>The towers sound.</p>');
    });
    it('seat in order, one per account, with any extra after the last', () => {
      const html = joinPagesHtml([{ ...page(1, 'Text.\n\n[A woodcut of a lion]\n\nMore.\n\n[A diagram of the spheres]\n\nEnd.'), figures: '<figure>A</figure><figure>B</figure><figure>C</figure>' }]);
      expect(plain(html)).toBe('<p>|Text.</p>\n<figure>A</figure>\n<p>More.</p>\n<figure>B</figure><figure>C</figure>\n<p>End.</p>');
    });
    it('leave a bracketed account in place on a page with no figure', () => {
      expect(joinPagesHtml([page(1, 'Text.\n\n[A woodcut of a lion]')])).toContain('[A woodcut of a lion]');
    });
    it('are never lost at the end of the run', () => {
      expect(joinPagesHtml([page(1, 'The stone was'), { ...page(2, 'heated for'), figures: fig }])).toContain(fig);
    });
  });

  it('does not join a paragraph into a heading', () => {
    const html = joinPagesHtml([page(1, 'the stone was'), page(2, '# Chapter Two\n\nIt begins.')]);
    expect(html).toContain('<h1>Chapter Two</h1>');
    expect(plain(html).startsWith('<p>|the stone was</p>\n|<h1>')).toBe(true);
  });
});

describe('joinPagesHtml — blank leaves', () => {
  it('reads a whole-page "[Blank page]" notice as no text, so the sentence runs across it', () => {
    const html = joinPagesHtml([page(1, 'the stone was'), page(2, '[Blank page — no translatable content]'), page(3, 'heated for days.')]);
    expect(html).not.toContain('Blank page');
    expect(plain(html)).toBe('<p>|the stone was || heated for days.</p>');
  });
  it('keeps a "could not be translated" notice: that is missing text, not a blank leaf', () => {
    const html = joinPagesHtml([page(1, 'It ends.'), page(2, '[This page could not be translated due to content recitation]')]);
    expect(html).toContain('could not be translated');
  });
});

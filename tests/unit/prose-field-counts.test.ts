import { describe, it, expect } from 'vitest';
import { toPlainText, countParagraphs } from '@/components/ui/ProseField';

/**
 * The word count is the only number a writer sees while drafting, and the
 * newsletter is authored as HTML with a large editorial comment block at the
 * top. If either leaked into the count, "~330 words" would be wrong by
 * hundreds and nobody would notice, because a plausible number looks correct.
 */
describe('ProseField counting', () => {
  it('counts plain prose as written', () => {
    expect(toPlainText('one two three', 'plain')).toBe('one two three');
    expect(countParagraphs('a\n\nb\n\nc', 'plain')).toBe(3);
  });

  it('ignores blank trailing blocks when counting paragraphs', () => {
    expect(countParagraphs('a\n\n\n\nb\n\n   \n\n', 'plain')).toBe(2);
  });

  it('strips tags so markup is not counted as words', () => {
    const html = '<p style="margin: 0 0 20px;">Hello there friend</p>';
    expect(toPlainText(html, 'html')).toBe('Hello there friend');
    expect(toPlainText(html, 'html').split(/\s+/)).toHaveLength(3);
  });

  it('strips an editorial comment even when it contains tags', () => {
    // The comment MUST be stripped before the generic tag strip, and this case
    // is the whole reason. A comment with no ">" inside it is removed by the
    // generic `<[^>]+>` rule as a side effect, so a naive fixture passes with
    // the comment rule deleted — verified by removing it and watching the test
    // stay green. Real newsletter headers do contain tags ("the <h1> from the
    // subject line"), and there the generic rule stops at the FIRST ">" and
    // spills the rest of the note into the word count.
    const html = '<!-- supplies the <h1> from the subject line -->\n<p>Two words</p>';
    expect(toPlainText(html, 'html')).toBe('Two words');
  });

  it('does not let an image alt attribute inflate the count', () => {
    const html = '<p>Real text</p><img src="x.jpg" alt="a very long description of a picture" />';
    expect(toPlainText(html, 'html')).toBe('Real text');
  });

  it('counts an entity as one character, not as a word', () => {
    // &mdash; is punctuation in the rendered letter; counting it as a word
    // would make every em-dash inflate the total.
    expect(toPlainText('<p>a &mdash; b</p>', 'html').split(/\s+/)).toHaveLength(3);
    expect(toPlainText('<p>a&nbsp;b</p>', 'html')).toBe('a b');
  });

  it('counts <p> tags as paragraphs in html mode', () => {
    expect(countParagraphs('<p>one</p><p style="x">two</p>', 'html')).toBe(2);
    // A <pre> or <picture> tag must not be mistaken for a paragraph.
    expect(countParagraphs('<picture></picture><pre>x</pre><p>one</p>', 'html')).toBe(1);
  });

  it('leaves plain text alone in plain mode even if it contains angle brackets', () => {
    expect(toPlainText('a < b and c > d', 'plain')).toBe('a < b and c > d');
  });
});

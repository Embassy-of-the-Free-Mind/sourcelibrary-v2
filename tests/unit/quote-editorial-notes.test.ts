/**
 * The quote surface serves the page's words, not the translator model's commentary (#8567).
 *
 * A member's research assistant quoted "those who have a free spirit those who claim spiritual
 * freedom as an excuse to ignore all moral laws" from Theologia Deutsch 1523, scan 62: the second
 * half is the model's definition of the term, written as `<term>…</term> <gloss>…</gloss>`, and
 * `get_quote` handed it over inside the "verbatim, ready to quote" translation. The reader already
 * hides it with notes off (#5895, #5942); the quote path now uses the same split.
 */
import { describe, it, expect } from 'vitest';
import { resolveQuoteText, EDITORIAL_NOTES_NOTE } from '@/lib/quote-text';
import type { Page } from '@/lib/types';

const page = (translation: string, ocr = 'menschen/ die ordnung vnd gesetz'): Page =>
  ({ id: 'p1', book_id: 'b1', page_number: 62, ocr: { data: ocr }, translation: { data: translation } } as unknown as Page);

describe('resolveQuoteText: model commentary leaves the quotable text', () => {
  it('moves a model definition after a <term> out of the text (the Theologia Deutsch case)', () => {
    const q = resolveQuoteText(page(
      'And the others, those who have a <term>free spirit</term> <gloss>those who claim spiritual freedom as an excuse to ignore all moral laws</gloss>, say in mockery that they deal with it.'
    ), 'b1', 'en', { mark: false });
    expect(q?.source).toBe('translation');
    expect(q?.text).not.toMatch(/excuse to ignore all moral laws/);
    expect(q?.text).toMatch(/free spirit/);
    expect(q?.text).toMatch(/say in mockery/);
    expect(q?.editorial?.some((e) => /excuse to ignore all moral laws/.test(e.body))).toBe(true);
  });

  it('moves an explanatory <note> out and keeps it, labelled, with its anchor', () => {
    const q = resolveQuoteText(page(
      'This, as it seems, would not be the turning over of a shell <note>a reference to an ancient game of heads or tails</note>, but a turning of the soul.'
    ), 'b1', 'en', { mark: false });
    expect(q?.text).not.toMatch(/heads or tails/);
    expect(q?.text).toMatch(/turning over of a shell/);
    expect(q?.text).toMatch(/turning of the soul/);
    const n = q?.editorial?.find((e) => /heads or tails/.test(e.body));
    expect(n).toBeTruthy();
    expect(n?.anchor).toMatch(/shell/);
  });

  it('keeps page marks: a margin note is on the page, so it stays in the text', () => {
    const q = resolveQuoteText(page('<margin>Of the free spirit</margin>\n\nThe body text of the page.'), 'b1', 'en', { mark: false });
    expect(q?.text).toMatch(/Of the free spirit/);
    expect(q?.editorial).toBeUndefined();
  });

  it('leaves plain text untouched and adds no editorial field', () => {
    const q = resolveQuoteText(page('A page with no commentary at all.'), 'b1', 'en', { mark: false });
    expect(q?.text).toBe('A page with no commentary at all.');
    expect(q?.editorial).toBeUndefined();
  });

  it('never empties a page made only of commentary', () => {
    const q = resolveQuoteText(page('<note>A woodcut of a pelican.</note>'), 'b1', 'en', { mark: false });
    expect(q?.text.length).toBeGreaterThan(0);
  });

  it('tells callers not to quote the commentary', () => {
    expect(EDITORIAL_NOTES_NOTE).toMatch(/Do not put it inside quotation/);
  });
});

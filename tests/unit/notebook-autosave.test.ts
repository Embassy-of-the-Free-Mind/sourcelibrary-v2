import { describe, expect, it } from 'vitest';
import { quotedFindings } from '@/lib/embassy/notebook-autosave';
import type { GroundingPage } from '@/lib/embassy/grounding';

const page: GroundingPage = {
  bookId: 'b1', bookSlug: 'corpus-hermeticum', bookTitle: 'Corpus Hermeticum', page: 12,
  text: 'And the Mind, being God, male and female, life and light, brought forth by speech another Mind, the Maker.',
};
const other: GroundingPage = { bookId: 'b2', bookSlug: 'other', bookTitle: 'Other', page: 3, text: 'Nothing relevant here at all.' };

describe('quotedFindings', () => {
  it('saves a blockquote found on a page read, with that page', () => {
    const text = 'Intro.\n\n> "the Mind, being God, male and female, life and light, brought forth by speech" — *[Corpus Hermeticum](https://sourcelibrary.org/book/corpus-hermeticum)*, [Page 12](https://sourcelibrary.org/book/corpus-hermeticum/page-number/12)\n\nMore.';
    const out = quotedFindings(text, [other, page]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ bookId: 'b1', page: 12 });
    expect(out[0].quote).toBe('the Mind, being God, male and female, life and light, brought forth by speech');
  });

  it('saves an inline quotation found on a page', () => {
    const text = 'Hermes says that "being God, male and female, life and light, brought forth by speech another Mind" in this passage.';
    expect(quotedFindings(text, [page])).toHaveLength(1);
  });

  it('skips a quotation no page holds (negative control)', () => {
    const text = '> "the Mind, being God, male and female, life and darkness, brought forth by silence"';
    expect(quotedFindings(text, [page])).toEqual([]);
  });

  it('skips short quotes and quotes already in the notebook', () => {
    expect(quotedFindings('He calls it "life and light" here.', [page])).toEqual([]);
    const text = '> the Mind, being God, male and female, life and light, brought forth by speech';
    expect(quotedFindings(text, [page], ['The mind, being God, male and female, life and light, brought forth by speech'])).toEqual([]);
  });
});

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

  // v3#249: thread 6af70498c205a9be6ed8c6bb, turn 2, held three quotations grounding had kept
  // and the notebook stayed empty. The page texts below are copied from the stored
  // translations (2026-11-13), markup included; the blockquotes are the answer's own.
  const deVita15: GroundingPage = {
    bookId: 'b3', bookSlug: 'de-vita-libri-tres-de-triplici-vita-apologia-quod-necessaria-ficinus-3', bookTitle: 'Three Books on Life', page: 15,
    text: 'For as much as they are idle with the rest of the body, so much are they busy with the brain and mind. Thence they are compelled to generate phlegm, which the Greeks call <term>phlegma</term> <gloss>phlegm</gloss>, and black bile, which they call melancholy. The former often blunts and suffocates the intellect. The latter, however, if it abounds too much or burns, vexes the soul with constant worry and frequent delusions, and disturbs the judgment.',
  };
  const deVita43: GroundingPage = {
    bookId: 'b4', bookSlug: 'three-books-on-life-ficino', bookTitle: 'Three Books on Life', page: 43,
    text: '<margin>Causes.</margin>\nWhen the thinner parts of the blood are frequently consumed, the remaining blood necessarily becomes thick, dry, and black. Added to this is the fact that nature, when occupied in contemplation and focused entirely on the brain and heart, neglects the stomach and the liver. Therefore, when food—especially that which is either too abundant or too hard—is poorly digested, the resulting blood is made cold, thick, and black. All these things are accustomed to produce a melancholic spirit and a sorrowful and fearful mind; for indeed, internal darkness occupies and terrifies the soul much more than external darkness.\n\nBut of all men of letters, those are most oppressed by black bile <note>original: "atra bile"; the humor associated with melancholy</note> who, being earnestly devoted to the study of philosophy, call the mind away from the body and bodily things and join it to the incorporeal.',
  };

  it('saves an elided quotation whose parts are on one page, in order (the live answer)', () => {
    const text = [
      'In the third chapter of the first book, he writes:',
      '',
      '> "For as much as they are idle with the rest of the body, so much are they busy with the brain and mind. Thence they are compelled to generate phlegm... and black bile, which they call melancholy. The former often blunts and suffocates the intellect. The latter, however, if it abounds too much or burns, vexes the soul with constant worry and frequent delusions, and disturbs the judgment."',
      '> — *[Three Books on Life](https://sourcelibrary.org/book/de-vita-libri-tres-de-triplici-vita-apologia-quod-necessaria-ficinus-3)*, [Page 15](https://sourcelibrary.org/book/de-vita-libri-tres-de-triplici-vita-apologia-quod-necessaria-ficinus-3?page=15)',
      '',
      '> "When the thinner parts of the blood are frequently consumed, the remaining blood necessarily becomes thick, dry, and black. Added to this is the fact that nature, when occupied in contemplation and focused entirely on the brain and heart, neglects the stomach and the liver... internal darkness occupies and terrifies the soul much more than external darkness."',
      '> — *[Three Books on Life](https://sourcelibrary.org/book/three-books-on-life-ficino)*, [Page 43](https://sourcelibrary.org/book/three-books-on-life-ficino?page=43)',
    ].join('\n');
    const out = quotedFindings(text, [other, deVita43, deVita15]);
    expect(out.map(f => [f.bookId, f.page])).toEqual([['b3', 15], ['b4', 43]]);
    expect(out[0].quote).toContain('generate phlegm... and black bile');
  });

  it('reads the page through its markup, as grounding does', () => {
    // A note sits in mid-sentence on p.43; on p.15 a quoter writes the term or its gloss.
    const acrossNote = 'He says "those are most oppressed by black bile who, being earnestly devoted to the study of philosophy, call the mind away from the body" there.';
    expect(quotedFindings(acrossNote, [deVita43]).map(f => f.page)).toEqual([43]);
    const gloss = 'They "generate phlegm, which the Greeks call phlegm, and black bile, which they call melancholy" by study.';
    const term = 'They "generate phlegm, which the Greeks call phlegma, and black bile, which they call melancholy" by study.';
    expect(quotedFindings(gloss, [deVita15]).map(f => f.page)).toEqual([15]);
    expect(quotedFindings(term, [deVita15]).map(f => f.page)).toEqual([15]);
  });

  it('skips an elided quotation whose parts are out of order or on different pages (negative controls)', () => {
    const backwards = '> "internal darkness occupies and terrifies the soul much more than external darkness... the remaining blood necessarily becomes thick, dry, and black"';
    expect(quotedFindings(backwards, [deVita43])).toEqual([]);
    const twoPages = '> "Thence they are compelled to generate phlegm... the remaining blood necessarily becomes thick, dry, and black"';
    expect(quotedFindings(twoPages, [deVita15, deVita43])).toEqual([]);
  });

  it('skips short quotes and quotes already in the notebook', () => {
    expect(quotedFindings('He calls it "life and light" here.', [page])).toEqual([]);
    const text = '> the Mind, being God, male and female, life and light, brought forth by speech';
    expect(quotedFindings(text, [page], ['The mind, being God, male and female, life and light, brought forth by speech'])).toEqual([]);
  });
});

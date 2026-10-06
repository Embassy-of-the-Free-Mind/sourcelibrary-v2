// PRIOR ART: tests/unit/citation-fixes.test.ts and librarian-image-removals.test.ts pin the
// link-repair and image-removal halves of the post-turn round trip; neither checks what the
// TEXT claims. This pins the grounding pass (#5904). Every positive case has a negative twin
// so a later "loosening" that verifies everything goes red instead of quietly passing.
import { describe, it, expect } from 'vitest';
import { applyGroundingEdits } from '@/lib/embassy/citation-fixes';
import {
  answerUnits,
  groundAnswer,
  quantitiesIn,
  sentences,
  supportCitations,
  type GroundingImage,
  type GroundingPage,
} from '@/lib/embassy/grounding';

const BASE = 'https://sourcelibrary.org';

// The shape of Monconys, Journal des voyages II p.51 (#5904): the oven is there, "twenty
// times an hour" is not.
const MONCONYS_51: GroundingPage = {
  bookId: 'mon1', bookSlug: 'journal-des-voyages-monconys', bookTitle: 'Journal des voyages de M. de Monconys', page: 51,
  text: 'He also has a furnace that I have seen, which is two feet square, in which with 6 sous of local coal one bakes 280 pounds of bread in 24 hours; which, as I have tested, is of a taste much better than that which one bakes in other ovens. Kuffler showed us the regulator of the fire.\nIl a aussi vn fourneau que i\'ay veu, de deux pieds en quarré, où auec 6 ſols de charbon du pays on cuit 280 liures de pain en 24 heures.',
};
const KHUNRATH_16: GroundingPage = {
  bookId: 'khu1', bookSlug: 'warhafftiger-bericht-khunrath', bookTitle: 'Warhafftiger Bericht vom philosophischen Athanore', page: 16,
  text: 'The figure of the philosophical athanor, with its tower and the chambers for the vessels, as it is set up in the laboratory.',
};

function ground(text: string, opts: Partial<Parameters<typeof groundAnswer>[0]> = {}) {
  const r = groundAnswer({
    text, pages: [MONCONYS_51, KHUNRATH_16], supportLoaded: true, images: [], question: 'How did Drebbel\'s oven work?', siteBase: BASE, ...opts,
  });
  return { ...r, out: applyGroundingEdits(text, r.edits) };
}

describe('applyGroundingEdits', () => {
  it('applies edits in order, each searched after the previous one', () => {
    const text = 'A b. A b.';
    expect(applyGroundingEdits(text, [{ find: 'A b.', replace: 'X.' }, { find: 'A b.', replace: 'Y.' }])).toBe('X. Y.');
  });
  it('skips an edit whose text is not there, and leaves text alone with no edits', () => {
    expect(applyGroundingEdits('hello', [{ find: 'absent', replace: 'z' }])).toBe('hello');
    expect(applyGroundingEdits('hello', [])).toBe('hello');
  });
});

describe('quotes', () => {
  it('keeps a quote that is on a retrieved page (folded: long s, case)', () => {
    const text = 'Monconys writes that "auec 6 sols de charbon du pays" the oven worked — *[Journal](https://sourcelibrary.org/book/journal-des-voyages-monconys)*, [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51).';
    const { out, report } = ground(text);
    expect(report.quotesUnquoted).toBe(0);
    expect(out).toBe(text);
  });
  it('removes the quotation marks from a quote that is on no page', () => {
    const text = 'Monconys says the oven "could be opened twenty times an hour" without cooling — [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51).';
    const { out, report } = ground(text);
    expect(report.quotesUnquoted).toBe(1);
    expect(out).toContain('the oven could be opened twenty times an hour without cooling');
    expect(out).not.toContain('"could be');
  });
  it('does not let a short quote pass on scattered words (page or pooled tool text)', () => {
    // "spirit", "within", "body" each occur somewhere in the tool text, never as the phrase.
    const text = 'The Picatrix defines the talisman as a "spirit within a body" of matter — [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51).';
    const extra = '{"context":"the spirit of the planet ... within the stone ... a body of bronze"}';
    expect(ground(text, { extraSupport: extra }).report.quotesUnquoted).toBe(1);
    expect(ground(text, { extraSupport: '{"context":"a talisman is a spirit within a body, says the Picatrix"}' }).report.quotesUnquoted).toBe(0);
  });
  it('matches a quote against page text that carries markup, ignoring the quoter\'s [brackets]', () => {
    // Real shapes: Reusner's Pandora lexicon p.320 and Schott's Mechanica p.44 (#5904 after-run).
    const pandora: GroundingPage = { bookId: 'p', bookSlug: 'pandora', bookTitle: 'Pandora', page: 320,
      text: 'Lotici: i.e., <term>urina</term> <gloss>urine</gloss>. Leo viridis: i.e., <term>vitriolum</term> <gloss>vitriol</gloss>. Leo: i.e., <term>aurum</term>.' };
    const schott: GroundingPage = { bookId: 's', bookSlug: 'schott', bookTitle: 'Mechanica', page: 44,
      text: '<margin>Gaspar Ens</margin> Gaspar Ens, in his *Mathematical Wonder-worker* <note>Original: "Thaumaturgo suo Mathematico."</note>, brings examples from other writers.' };
    const a = '> "Leo viridis: i.e., vitriolum [vitriol]."\n— [Page 320](https://sourcelibrary.org/book/pandora/page-number/320)';
    const b = '> "Gaspar Ens, in his *Mathematical Wonder-worker* [Thaumaturgus Mathematicus], brings examples from other writers..."\n— [Page 44](https://sourcelibrary.org/book/schott/page-number/44)';
    expect(ground(a, { pages: [pandora] }).report.blockquotesRemoved).toBe(0);
    expect(ground(b, { pages: [schott] }).report.blockquotesRemoved).toBe(0);
    // …and the bracket rule does not launder an invented quote.
    const c = '> "Leo viridis: i.e., the [green] dragon of the sages."\n— [Page 320](https://sourcelibrary.org/book/pandora/page-number/320)';
    expect(ground(c, { pages: [pandora] }).report.blockquotesRemoved).toBe(1);
  });
  it('keeps a quotation that runs over a page break, with a term/gloss rendered either way', () => {
    // Drebbel, Ein kurtzer Tractat pp.17–18 (#5904 after-run): removed before this fix.
    const p17: GroundingPage = { bookId: 'd', bookSlug: 'tractat', bookTitle: 'Tractat', page: 17,
      text: 'for just as heat makes air and water subtle, thin, and coarse, so cold makes coarse, shrinks, and presses together, just as we see clearly when we hang an empty glass <term>Retortam</term> <gloss>retort</gloss> with the mouth into a vat with water and place a warm fire under' };
    const p18: GroundingPage = { bookId: 'd', bookSlug: 'tractat', bookTitle: 'Tractat', page: 18,
      text: 'So we will see, as soon as the air in the glass begins to become warm, that winds rise out of the mouth of the retort, and that the water becomes full of bubbles.' };
    const text = '> "just as heat makes air and water subtle, thin, and coarse... we hang an empty glass Retort with the mouth into a vat with water... as soon as the air in the glass begins to become warm, winds rise out of the mouth of the retort"\n— [Page 17](https://sourcelibrary.org/book/tractat/page-number/17)';
    expect(ground(text, { pages: [p17, p18] }).report.blockquotesRemoved).toBe(0);
    // One invented fragment among real ones still fails.
    const bad = '> "just as heat makes air and water subtle, thin, and coarse... and the oven may be opened twenty times an hour without losing its heat"\n— [Page 17](https://sourcelibrary.org/book/tractat/page-number/17)';
    expect(ground(bad, { pages: [p17, p18] }).report.blockquotesRemoved).toBe(1);
  });
  it('reads a quotation across the page break, re-joining the hyphenated word', () => {
    // Deutsches Theatrum Chemicum pp.193–194, the Latin Emerald Tablet (#5904 after-run).
    const mk = (page: number, ocr: string): GroundingPage => ({ bookId: 't', bookSlug: 'theatrum', bookTitle: 'Theatrum', page, text: ocr, parts: ['', ocr] });
    const p193 = mk(193, 'Es lautet aber besagte SMARAGDINA TABULA im Lateinischen wie folget:\n> Verum est sine mendacio, certum & verissimum: Quod est inferius, est sicut id quod est supe-');
    const p194 = mk(194, 'rius, ad perpetranda miracula rei unius. Et sicut omnes res fuerunt ab uno');
    const text = '> "Verum est sine mendacio, certum & verissimum: Quod est inferius, est sicut id quod est superius, ad perpetranda miracula rei unius."\n— [Page 193](https://sourcelibrary.org/book/theatrum/page-number/193)';
    expect(ground(text, { pages: [p193, p194] }).report.blockquotesRemoved).toBe(0);
    // Without the next page the tail is on no page read.
    expect(ground(text, { pages: [p193] }).report.blockquotesRemoved).toBe(1);
  });
  it('does not read a citation written on the quote\'s own line as part of the quotation', () => {
    // Monconys, Journal p.68 (#5904 final run): removed before this fix, though verbatim on the page.
    const p68: GroundingPage = { bookId: 'm', bookSlug: 'journal-des-voyages', bookTitle: 'Journal', page: 68,
      text: '<margin>June 1663. Fig. 10.</margin> & half outside, and which is full of mercury; which, rising when the air of the retort that is on the ashes presses it, plugs the register; for the wall of the furnace is like a diaphragm that divides the mercury vessel in two, as this figure will make one remember.' };
    const sameLine = '> "...full of mercury; which, rising when the air of the retort that is on the ashes presses it, plugs the register; for the wall of the furnace is like a diaphragm that divides the mercury vessel in two..." — *[Journal of the Voyages of Monsieur de Monconys](https://sourcelibrary.org/book/journal-des-voyages)* by [Monconys, Balthazar de](https://sourcelibrary.org/author/monconys-balthazar-de), [Page 68](https://sourcelibrary.org/book/journal-des-voyages?page=68)';
    expect(ground(sameLine, { pages: [p68] }).report.blockquotesRemoved).toBe(0);
    const unquoted = '> full of mercury; which, rising when the air of the retort that is on the ashes presses it, plugs the register — *[Journal](https://sourcelibrary.org/book/journal-des-voyages)*, [Page 68](https://sourcelibrary.org/book/journal-des-voyages?page=68)';
    expect(ground(unquoted, { pages: [p68] }).report.blockquotesRemoved).toBe(0);
    // Same shape, invented words: still removed.
    const bad = '> "...full of mercury; and the oven could be opened twenty times an hour without cooling..." — *[Journal](https://sourcelibrary.org/book/journal-des-voyages)*, [Page 68](https://sourcelibrary.org/book/journal-des-voyages?page=68)';
    expect(ground(bad, { pages: [p68] }).report.blockquotesRemoved).toBe(1);
  });
  it('checks an elided quote fragment by fragment', () => {
    const ok = 'He saw "a furnace that I have seen … 280 pounds of bread in 24 hours" there — [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51).';
    expect(ground(ok).report.quotesUnquoted).toBe(0);
    const bad = 'He saw "a furnace that I have seen … that never once went out at night" there — [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51).';
    expect(ground(bad).report.quotesUnquoted).toBe(1);
  });
  it('removes a blockquote no page supports, with a visible note', () => {
    const text = 'Intro.\n\n> "Mercury purified by the eight processes becomes like a wish-fulfilling gem."\n> — *[Rasaratna Samuccaya](https://sourcelibrary.org/book/rasaratna-samuccaya-vagbhata)*, [Page 45](https://sourcelibrary.org/book/rasaratna-samuccaya-vagbhata?page=45)\n\nAfter.';
    const { out, report } = ground(text);
    expect(report.blockquotesRemoved).toBe(1);
    expect(out).not.toContain('wish-fulfilling');
    expect(out).toContain('could not find on any page I read');
    expect(out).toContain('After.');
  });
  it('keeps a blockquote that is on the page', () => {
    const text = '> "which is two feet square, in which with 6 sous of local coal one bakes 280 pounds of bread in 24 hours"\n> — [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51)';
    expect(ground(text).report.blockquotesRemoved).toBe(0);
  });
  it('does not judge a quote in a script it cannot fold, nor anything when support failed to load', () => {
    const greek = '> "Ἐν ἀρχῇ ἦν ὁ λόγος καὶ ὁ λόγος ἦν πρὸς τὸν θεόν"\n> — [Page 3](https://sourcelibrary.org/book/x/page-number/3)';
    expect(ground(greek).edits).toEqual([]);
    const fabricated = 'He wrote "a sentence found on no page whatsoever" once — [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51).';
    expect(ground(fabricated, { supportLoaded: false }).edits).toEqual([]);
  });
  it('judges a page-cited blockquote even when the model read no page at all', () => {
    const text = '> "Mercury purified by the eight processes becomes like a gem."\n> — [Page 45](https://sourcelibrary.org/book/rasaratna-samuccaya-vagbhata?page=45)';
    expect(ground(text, { pages: [] }).report.blockquotesRemoved).toBe(1);
  });
});

describe('quantities', () => {
  it('finds unit-bearing numbers, not years or page references', () => {
    expect(quantitiesIn('It bakes 280 pounds of bread.')).toEqual(['280']);
    expect(quantitiesIn('It could be opened twenty times an hour.')).toEqual(['twenty']);
    expect(quantitiesIn('Kuffler asked £10,000 for it.')).toEqual(['10,000']);
    expect(quantitiesIn('Drebbel died in 1633, see page 51.')).toEqual([]);
  });
  it('drops a sentence whose quantity is on no page, keeps the cited rest', () => {
    const text = 'The oven baked 280 pounds of bread in a day. It could be opened twenty times an hour without cooling. See [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51).';
    const { out, report } = ground(text);
    expect(report.sentencesDropped).toBe(1);
    expect(out).toContain('280 pounds');
    expect(out).not.toContain('twenty times');
    expect(out).toContain('[Page 51]');
  });
  it('accepts a number another tool result gave the model (a catalogue count)', () => {
    const text = 'Our catalogue holds 34 books by Hermes, among them the Tabula of Hortulanus.';
    expect(ground(text, { extraSupport: '{"context":"Catalogue browse — 34 books match: author Hermes"}' }).report.sentencesDropped).toBe(0);
    expect(ground(text).report.sentencesDropped).toBe(1);
  });
  it('drops an uncited paragraph whole when its number came from nowhere and no page matches', () => {
    const text = 'Intro line.\n\nThe Sanskrit tradition identifies eighteen stages of mercury processing. The first eight purify it.\n\nNext paragraph.';
    const { out } = ground(text);
    expect(out).toBe('Intro line.\n\nNext paragraph.');
  });
});

describe('uncited claims', () => {
  it('attaches the page a factual paragraph came from', () => {
    const text = 'Kuffler showed Monconys a furnace two feet square that baked bread with local coal, of a taste much better than other ovens.';
    const { out, report } = ground(text);
    expect(report.attached).toBe(1);
    expect(out).toContain('[Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51)');
  });
  it('leaves general framing alone when no page matches it', () => {
    const text = 'Drebbel was celebrated at the court of James I for his submarine and his perpetual motion.';
    const { out, report } = ground(text);
    expect(report.attached).toBe(0);
    expect(report.uncitedLeft).toBe(1);
    expect(out).toBe(text);
  });
  it('does not attach to a lead-in that ends with a colon', () => {
    const text = 'Kuffler showed Monconys a furnace two feet square that baked bread with local coal, as he recorded:';
    expect(ground(text).report.attached).toBe(0);
  });
});

describe('captions', () => {
  const athanor: GroundingImage = {
    url: 'https://images.sourcelibrary.org/archived/khu1/16.jpg', bookId: 'khu1', bookSlug: 'warhafftiger-bericht-khunrath',
    bookTitle: 'Warhafftiger Bericht vom philosophischen Athanore', bookAuthor: 'Heinrich Khunrath', page: 16, type: 'diagram',
    description: 'A philosophical athanor with a central tower.',
  };
  it('rewrites a caption that ties the image to the question\'s subject its own record never mentions', () => {
    const text = '![Drebbel oven](https://images.sourcelibrary.org/archived/khu1/16.jpg)\n*Drebbel\'s self-regulating oven, from [Warhafftiger Bericht vom philosophischen Athanore](https://sourcelibrary.org/book/warhafftiger-bericht-khunrath)*';
    const { out, report } = ground(text, { images: [athanor] });
    expect(report.captionsRewritten).toBe(1);
    expect(out).not.toContain('Drebbel');
    expect(out).toContain('[Page 16](https://sourcelibrary.org/book/warhafftiger-bericht-khunrath/page-number/16)');
  });
  it('treats a variant spelling of the question\'s name in the image\'s own record as the same name', () => {
    const tomb: GroundingImage = { url: 'https://images.sourcelibrary.org/archived/fam1/12.jpg', bookId: 'fam1', bookSlug: 'fama', bookTitle: 'Fama Fraternitatis', page: 12,
      description: 'The brothers open the vault of Christian Rosenkreuz.' };
    const text = '![tomb](https://images.sourcelibrary.org/archived/fam1/12.jpg)\n*The opening of the tomb of Christian Rosenkreutz — [Fama Fraternitatis](https://sourcelibrary.org/book/fama), [Page 12](https://sourcelibrary.org/book/fama/page-number/12)*';
    const q = 'What does the Fama say was found in Christian Rosenkreutz\'s tomb?';
    expect(ground(text, { images: [tomb], question: q }).edits).toEqual([]);
    // …but a different name is still a stranger.
    const other = text.replace('Christian Rosenkreutz', 'Christian Drebbel');
    expect(ground(other, { images: [tomb], question: 'What did Christian Drebbel build?' }).report.captionsRewritten).toBe(1);
  });
  it('rewrites a caption that links a different book', () => {
    const text = '![athanor](https://images.sourcelibrary.org/archived/khu1/16.jpg)\n*An athanor from [Journal](https://sourcelibrary.org/book/journal-des-voyages-monconys)*';
    expect(ground(text, { images: [athanor] }).report.captionsRewritten).toBe(1);
  });
  it('adds a caption where there is none', () => {
    const text = '![athanor](https://images.sourcelibrary.org/archived/khu1/16.jpg)\n\nNext.';
    const { out } = ground(text, { images: [athanor] });
    expect(out).toMatch(/^!\[[^\]]*\]\(https:\/\/images\.sourcelibrary\.org\/archived\/khu1\/16\.jpg\)\n\*A philosophical athanor with a central tower — \[/);
  });
  it('leaves a caption that names its own book and asserts nothing else', () => {
    const text = '![athanor](https://images.sourcelibrary.org/archived/khu1/16.jpg)\n*A philosophical athanor — [Warhafftiger Bericht](https://sourcelibrary.org/book/warhafftiger-bericht-khunrath), [Page 16](https://sourcelibrary.org/book/warhafftiger-bericht-khunrath/page-number/16)*';
    expect(ground(text, { images: [athanor] }).edits).toEqual([]);
  });
  it('treats a link to the image\'s own book under another of its slugs as its own book', () => {
    // gallery_images.book_slug is often empty or stale; the live slug and aliases are resolved
    // from `books` before the check. Measured: every caption in the first after-run read as
    // "links a different book" until this was fixed.
    const text = '![athanor](https://images.sourcelibrary.org/archived/khu1/16.jpg)\n*A philosophical athanor — [Bericht](https://sourcelibrary.org/book/khunrath-athanor-old-slug), [Page 16](https://sourcelibrary.org/book/khunrath-athanor-old-slug?page=16)*';
    expect(ground(text, { images: [{ ...athanor, bookAliases: ['khunrath-athanor-old-slug'] }] }).edits).toEqual([]);
    expect(ground(text, { images: [athanor] }).report.captionsRewritten).toBe(1);
  });
  it('leaves an image no tool described this turn alone (prior turn / unknown)', () => {
    const text = '![x](https://images.sourcelibrary.org/archived/other/3.jpg)\n*Drebbel\'s oven*';
    expect(ground(text, { images: [athanor] }).edits).toEqual([]);
  });
});

describe('structure helpers', () => {
  it('never splits a sentence inside a link or after an abbreviation', () => {
    const s = sentences('Dr. Kuffler showed it (see [p. 5. Note](https://x.org/a.b)). Then he left.');
    expect(s).toEqual(['Dr. Kuffler showed it (see [p. 5. Note](https://x.org/a.b)). ', 'Then he left.']);
  });
  it('groups a blockquote with the citation line under it', () => {
    const units = answerUnits('> "quoted words here"\n— *[T](https://sourcelibrary.org/book/t)*\n\nProse.');
    expect(units.map(u => u.kind)).toEqual(['blockquote', 'prose']);
  });
  it('supports pages cited by EARLIER assistant turns, never by user messages', () => {
    const cites = supportCitations('Now [Page 9](https://sourcelibrary.org/book/b/page-number/9).', [
      { role: 'user', content: 'see https://sourcelibrary.org/book/u/page-number/1' },
      { role: 'assistant', content: 'Earlier [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51).' },
    ]);
    expect(cites).toEqual([{ slug: 'b', page: 9 }, { slug: 'journal-des-voyages-monconys', page: 51 }]);
  });
});

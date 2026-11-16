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
  it('applies an edit at its own offset, not at an earlier identical span', () => {
    const text = 'Salt, sulphur and mercury.\n\n- Salt';
    const at = text.lastIndexOf('- Salt') + 2;
    expect(applyGroundingEdits(text, [{ find: 'Salt', replace: 'SALT', at }])).toBe('Salt, sulphur and mercury.\n\n- SALT');
    // Offsets shift with earlier edits that change length.
    expect(applyGroundingEdits('aa bb aa', [{ find: 'aa', replace: 'xxxx', at: 0 }, { find: 'aa', replace: 'y', at: 6 }])).toBe('xxxx bb y');
  });
  it('keeps a $ in quoted text literal when removing quotation marks', () => {
    const r = groundAnswer({ text: 'He priced it "at $1 and $& a pound" there.', pages: [MONCONYS_51], supportLoaded: true, images: [], question: 'q', siteBase: BASE });
    expect(applyGroundingEdits('He priced it "at $1 and $& a pound" there.', r.edits)).toContain('at $1 and $& a pound there');
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
  it('removes a blockquote no page supports, leaving no note in its place (#7190)', () => {
    const text = 'Intro.\n\n> "Mercury purified by the eight processes becomes like a wish-fulfilling gem."\n> — *[Rasaratna Samuccaya](https://sourcelibrary.org/book/rasaratna-samuccaya-vagbhata)*, [Page 45](https://sourcelibrary.org/book/rasaratna-samuccaya-vagbhata?page=45)\n\nAfter.';
    const { out, report } = ground(text);
    expect(report.blockquotesRemoved).toBe(1);
    expect(out).not.toContain('wish-fulfilling');
    expect(out).not.toContain('could not find');
    expect(out).toBe('Intro.\n\nAfter.');
  });
  it('turns the colon of a lead-in into a full stop when the quote it introduced is removed (#7190)', () => {
    // The live shape: the reader writes Spanish, the model translates the English page into a blockquote.
    const quote = '> La virtud es un medio entre dos vicios, uno que peca por exceso y otro por defecto.\n> — [Página 12](https://sourcelibrary.org/es/book/ethica-aristoteles?page=12)';
    const { out } = ground(`Aristóteles trata la virtud como un término medio:\n\n${quote}\n\n### Siguiente`);
    expect(out).toBe('Aristóteles trata la virtud como un término medio.\n\n### Siguiente');
    // A lead-in this pass already edited (unquoted) gets the stop in the same edit.
    const edited = ground(`He called it "a furnace that never once went out at night" and wrote:\n\n${quote}`).out;
    expect(edited).toBe('He called it a furnace that never once went out at night and wrote.\n\n');
    // A kept quote leaves its lead-in alone.
    const kept = 'Monconys wrote:\n\n> "which is two feet square, in which with 6 sous of local coal one bakes 280 pounds of bread in 24 hours"\n> — [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51)';
    expect(ground(kept).out).toBe(kept);
  });
  describe('a removed quotation takes its announcement with it (v3#249)', () => {
    const INVENTED_1 = '> "For the spirit, which is the most subtle of all things, is easily consumed by the heat of the mind\'s perpetual motion."\n> — *[Three Books on Life](https://sourcelibrary.org/book/three-books-on-life-ficino)*, [Page 43](https://sourcelibrary.org/book/three-books-on-life-ficino?page=43)';
    const INVENTED_2 = '> "Saturn, who is the author of contemplation, and the most remote of all planets, is also the cause of the most profound thought."';
    const REAL = '> "which is two feet square, in which with 6 sous of local coal one bakes 280 pounds of bread in 24 hours"\n> — [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51)';

    it('pins the live shape: thread 6af70498c205a9be6ed8c6bb, 2026-11-13, "Quote him."', () => {
      // The answer as it streamed, rebuilt from the stored message and its grounding trace:
      // the prose is the stored text, and the two blockquotes are the trace's first 120
      // characters of each, closed off. Both were on no page and were removed; what the
      // reader got was the sentence that introduced each one, followed by the next heading.
      const opening = 'Marsilio Ficino, the Florentine philosopher and physician, transformed the medieval understanding of melancholy by linking it to the divine frenzy of genius and the influence of the planet Saturn.';
      const answer = 'Marsilio Ficino, the leading figure of the Florentine Platonic Academy, redefined melancholy in his seminal work *De Vita Libri Tres* (*Three Books on Life*, 1489). He argued that melancholy was not merely a disease, but a unique temperament shared by all great thinkers, philosophers, and poets.';
      const saturn = 'Ficino believed that while Saturn could be a "malefic" planet causing depression and stagnation, it was also the source of divine wisdom. He taught that by using specific "celestial medicines"—such as music, fragrances, and diet—scholars could "capture" the positive aspects of Saturn while mitigating the dark effects of melancholy.';
      const text = [
        opening,
        '',
        answer,
        '',
        '### The Melancholy of Scholars',
        'In the first book of *De Vita*, titled *De sanitate tuenda* (On Preserving Health), Ficino explains why scholars are particularly prone to this condition.',
        '',
        INVENTED_1,
        '',
        '### The Divine Influence of Saturn',
        saturn,
        '',
        'He describes the dual nature of this temperament.',
        INVENTED_2,
        '',
        '### Remedies for the Melancholic',
        'To combat the "black bile," Ficino recommended:',
        '*   **Music and Sound:** Melancholics should listen to harmonious music to lift the spirit.',
      ].join('\n');
      const { out, report } = ground(text, {
        question: 'What did Marsilio Ficino say about melancholy? Quote him.',
        openingEnd: opening.length,
        // The search result named the book, so "Three Books" is a count the model was given.
        extraSupport: 'Books found:\n- "Three Books on Life" by Marsilio Ficino',
      });
      expect(out).toBe([
        answer,
        '',
        '### The Divine Influence of Saturn',
        saturn,
        '',
        '### Remedies for the Melancholic',
        'To combat the "black bile," Ficino recommended:',
        '*   **Music and Sound:** Melancholics should listen to harmonious music to lift the spirit.',
      ].join('\n'));
      expect(report).toMatchObject({ blockquotesRemoved: 2, leadInsRemoved: 2, headingsRemoved: 1, openingRemoved: true });
    });

    it('removes "he writes:" and a short colon line with no verb, keeping the sentences before them', () => {
      expect(ground(`Ficino treats melancholy as a matter of the body. In the third chapter of the first book, he writes:\n\n${INVENTED_2}\n\nAfter.`).out)
        .toBe('Ficino treats melancholy as a matter of the body.\n\nAfter.');
      expect(ground(`Ficino treats melancholy as a matter of the body.\n\nIn his own words:\n\n${INVENTED_2}\n\nAfter.`).out)
        .toBe('Ficino treats melancholy as a matter of the body.\n\nAfter.');
      // A link to the BOOK does not make the lead-in a cited claim; "as follows" needs no verb of saying.
      expect(ground(`Before.\n\nAs he writes in the third book of *[De vita](https://sourcelibrary.org/book/three-books-on-life-ficino)*:\n\n${INVENTED_2}\n\nAfter.`).out)
        .toBe('Before.\n\nAfter.');
      expect(ground(`Before.\n\nIn the 1609 edition the Latin text is rendered as follows:\n\n${INVENTED_2}\n\nAfter.`).out)
        .toBe('Before.\n\nAfter.');
      // A list item that is nothing but the announcement goes whole.
      expect(ground(`* **Ética:** el texto dice:\n${INVENTED_2}`).out).toBe('');
    });

    it('keeps a sentence that reports what was said, cites a page, or still introduces a kept quote (negative twins)', () => {
      // Reports the content: only the colon changes.
      expect(ground(`Ficino says that scholars are prone to black bile:\n\n${INVENTED_2}\n\nAfter.`).out)
        .toBe('Ficino says that scholars are prone to black bile.\n\nAfter.');
      // States something about the text, ends in a full stop: untouched.
      const states = `He describes the furnace as a tower with three chambers.\n\n${INVENTED_2}\n\nAfter.`;
      expect(ground(states).out).toBe('He describes the furnace as a tower with three chambers.\n\nAfter.');
      // Cites its own page: the sentence stands without the quote.
      const cited = 'Monconys describes the oven — [Page 51](https://sourcelibrary.org/book/journal-des-voyages-monconys/page-number/51).';
      expect(ground(`${cited}\n\n${INVENTED_2}\n\nAfter.`).out).toBe(`${cited}\n\nAfter.`);
      // Two quotes under one lead-in, one of them real: the lead-in still introduces it.
      expect(ground(`Monconys writes:\n\n${INVENTED_2}\n\n${REAL}`).out).toBe(`Monconys writes:\n\n${REAL}`);
      // A long sentence with clauses of its own is never removed whole: the colon becomes a full stop.
      const long = 'Ficino trained as a physician under his father, who served the Medici household in Florence for many years; he turned to Plato only later, and in the third chapter of the first book he writes';
      expect(ground(`${long}:\n\n${INVENTED_2}\n\nAfter.`).out).toBe(`${long}.\n\nAfter.`);
      // "title" the noun is not a verb of saying.
      const noun = 'This is the title page of the first edition.';
      expect(ground(`${noun}\n\n${INVENTED_2}\n\nAfter.`).out).toBe(`${noun}\n\nAfter.`);
      // A closing suggestion is not judged, but the colon that pointed at a removed quote still goes.
      expect(ground(`You might compare what the second book has to offer:\n\n${INVENTED_2}\n\nAfter.`).out)
        .toBe('You might compare what the second book has to offer.\n\nAfter.');
      // A heading between the paragraph and the quote: the paragraph did not introduce it.
      expect(ground(`Monconys writes of the oven.\n\n### The passage\n\n${INVENTED_2}\n\n### Next\nAfter.`).out).toBe('Monconys writes of the oven.\n\n### Next\nAfter.');
    });

    it('removes a heading only when everything under it was removed', () => {
      const kept = `### Scholars\nHe writes:\n\n${INVENTED_2}\n\nThis paragraph stays where it is.\n\n### Next\nMore.`;
      expect(ground(kept).out).toBe('### Scholars\nThis paragraph stays where it is.\n\n### Next\nMore.');
      // A heading the model itself left empty is not this pass's business.
      const empty = '### Empty\n\n### Next\nMore.';
      expect(ground(empty).out).toBe(empty);
      // The last section of the answer.
      expect(ground(`Before.\n\n### Scholars\nHe writes:\n\n${INVENTED_2}`).out).toBe('Before.\n\n');
    });

    it('removes the opening only when the answer starts over on the same subject', () => {
      const opening = 'The Emerald Tablet is the short Hermetic text that alchemists treated as the summary of their art.';
      const restart = 'The Emerald Tablet, or *Tabula Smaragdina*, is the foundational text of Western alchemy, and the library holds it in several printings from the sixteenth and seventeenth centuries, in Latin and in German, with commentary.';
      const carriesOn = 'Its thirteen sentences were printed many times in the sixteenth and seventeenth centuries, and the library holds several of those printings, in Latin and in German, most of them with a commentary alongside.';
      expect(ground(`${opening}\n\n${restart}`, { openingEnd: opening.length }).out).toBe(restart);
      // Negative twins: the answer carries on from the opening; no opening was recorded; the rest is too short to be the answer.
      expect(ground(`${opening}\n\n${carriesOn}`, { openingEnd: opening.length }).out).toBe(`${opening}\n\n${carriesOn}`);
      expect(ground(`${opening}\n\n${restart}`).out).toBe(`${opening}\n\n${restart}`);
      expect(ground(`${opening}\n\nThe Emerald Tablet is short.`, { openingEnd: opening.length }).out).toBe(`${opening}\n\nThe Emerald Tablet is short.`);
      // It does not depend on the support text having loaded.
      expect(ground(`${opening}\n\n${restart}`, { openingEnd: opening.length, supportLoaded: false }).out).toBe(restart);
    });
  });

  it('keeps a requested rewrite, unquoted, instead of removing it (2026-11-08 Chemical Wedding)', () => {
    // The live shape: the reader pasted the bird song and asked for it in modern English;
    // the model's version is on no page, so the old pass deleted it three turns running.
    const poem = '> Rejoice, dear little bird,\n> And praise your Creator on high;\n> Lift up your voice, clear and bright.\n> — [Page 18](https://sourcelibrary.org/book/chymische-hochzeit?page=18)';
    const text = `### Modern English\n\n${poem}\n\n### The message`;
    const asked = ground(text, { question: 'Turn this poem into modern English. It is hard to read.' });
    expect(asked.report.blockquotesRemoved).toBe(0);
    expect(asked.report.blockquotesUnquoted).toBe(1);
    expect(asked.out).toContain('Rejoice, dear little bird,\nAnd praise your Creator on high;');
    expect(asked.out).not.toMatch(/^>/m);
    for (const q of ['Just give me the adapted version of the poem', 'Can you paraphrase this?', 'Translate this passage for me', 'Rewrite it in plain English']) {
      expect(ground(text, { question: q }).report.blockquotesUnquoted).toBe(1);
    }
    // Negative twin: the same unsupported blockquote, no rewrite asked for — still removed.
    for (const q of ["Who translated Ficino's Plato?", 'Was the play an adaptation of the novel?', 'Is this an adapted text?']) {
      expect(ground(text, { question: q }).report.blockquotesRemoved).toBe(1);
    }
    const notAsked = ground(text, { question: 'What does the bird song mean?' });
    expect(notAsked.report.blockquotesRemoved).toBe(1);
    expect(notAsked.out).not.toContain('Rejoice');
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

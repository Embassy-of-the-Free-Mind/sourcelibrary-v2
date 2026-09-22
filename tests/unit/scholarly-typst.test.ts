/**
 * The scholarly deposit PDF is permanent once Zenodo has it, so the text
 * pipeline's failure modes are pinned here. Each case is one that reached a
 * rendered page while the typography was being rebuilt (2026-09-21).
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
// @ts-expect-error — plain .mjs script library, no types
import { translationToTypst, findRunningHeads, generateTypstSource, generateScholarlyPdf, resolveDedication, dedicationToTypst, displayTitle, translationLine, indexEntries, urlDisplay, stripLeadingApparatus } from '../../scripts/lib/scholarly-typst.mjs';

const page = (n: number, data: string, ocr?: string) => ({ page_number: n, translation: { data }, ...(ocr ? { ocr: { data: ocr } } : {}) });

describe('translationToTypst', () => {
  it('ends a labelled marginal note at its own line, not at the end of the paragraph', () => {
    // A page with no blank lines: the author's next speech must stay in the body
    const { body } = translationToTypst(
      'Theod. I find Triton\'s trumpets.\n[Marginal note:] Origin and use of the Murex.\nCosmiel. Those are murex shells, most famous in every age, the unique ornament of Kings.',
    );
    expect(body).toContain('#mnote[Origin and use of the Murex.]');
    expect(body).toMatch(/\nCosmiel\. Those are murex shells/);
  });

  it('gathers the short lines under a bare label and stops at the first full line', () => {
    const { body } = translationToTypst(
      '[Marginal note:]\nTwofold nourishment\nof birds.\n\nCOSMIEL. Every kind of bird is born from seed, and seed from nourishment, which draws its origin from the air.',
    );
    expect(body).toContain('#mnote[Twofold nourishment of birds.]');
    expect(body).toContain('COSMIEL. Every kind of bird');
  });

  it('takes a printed running head as the page number, not as text', () => {
    const { body, printedPage } = translationToTypst('**Cap. V. On the globe of the Earth. 103**\n\nborn, is the multitude.');
    expect(printedPage).toBe('103');
    expect(body).toBe('born, is the multitude.');
  });

  it('leaves a first line alone when it only looks a little like a running head', () => {
    const { body, printedPage } = translationToTypst('In that year the plague returned to the city and all who could leave it left by the river gate in 1630\n\nMore text.');
    expect(printedPage).toBeNull();
    expect(body).toContain('river gate in 1630');
  });

  it('strips entities, attribute-bearing HTML and metadata tags', () => {
    const { body, printedPage } = translationToTypst(
      '<meta>About the page.</meta>\n<page-num>140</page-num>\n\n<div align="center">R</div> text&nbsp;&nbsp;&nbsp;here &nbsp\n\n<summary>s</summary>',
    );
    expect(printedPage).toBe('140');
    expect(body).not.toMatch(/&nbsp|<div|About the page|<summary/);
    expect(body).toContain('text here');
  });

  it('turns notes and explanatory terms into footnotes and resolves a note nested in one', () => {
    const { body } = translationToTypst('the interpreters <term>hypophetas: secondary priests <note>so Ficino</note></term> must abstain.');
    expect(body).toContain('#footnote[hypophetas: secondary priests');
    expect(body).not.toContain('%%');
  });

  it('does not backtrack on a long first line', () => {
    const started = Date.now();
    translationToTypst(`${'word '.repeat(2000)}\nnext`);
    findRunningHeads([page(1, `${'word '.repeat(2000)}\nnext`)]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('findRunningHeads', () => {
  it('calls a page-opening line a running head only when it recurs', () => {
    const pages = [
      ...[1, 2, 3, 4, 5].map(n => page(n, `-># IAMBLICHUS #<-\n\nText of page ${n}.`)),
      page(6, '### Concerning Sacrifices\n\nIt is asked by what logic.'),
      page(7, '<margin>A</margin>\n\nText.'),
    ];
    const heads = findRunningHeads(pages);
    expect([...heads]).toEqual(['iamblichus']);
  });
});

describe('resolveDedication', () => {
  it('prefers the book, then a collection it belongs to, then the funder line', () => {
    const forum = { slug: 'forum', dedication: 'To S.\n\nwhose generosity…' };
    expect(resolveDedication({ dedication: 'Own' , collections: ['forum'] }, [forum])).toBe('Own');
    expect(resolveDedication({ collections: ['other', 'forum'] }, [forum])).toBe(forum.dedication);
    expect(resolveDedication({ collections: ['other'], acquisition_funder: 'S. P.' }, [forum])).toMatch(/^To S\. P\.,/);
    expect(resolveDedication({ collections: ['other'] }, [forum])).toBeNull();
  });
});

describe('dedicationToTypst', () => {
  it('sets the address cascade, salutation, body and signed close', () => {
    const t = dedicationToTypst('TO\nA PATRON\nSOURCE LIBRARY SENDS GREETING\n\nSIR,\n\nBody one.\n\nBody two.\n\n---\n\nYour servants,\nSOURCE LIBRARY\nAmsterdam, 2026');
    expect(t).toContain('tracking: 0.3em)[TO]');
    expect(t).toContain('text(size: 15pt, tracking: 0.12em)[A PATRON]');
    expect(t).toContain('smallcaps[SIR,]');
    expect(t).toContain('[Body one.\n\nBody two.]');
    expect(t).toContain('smallcaps[SOURCE LIBRARY]');
    expect(t).toContain('fill: muted)[Amsterdam, 2026]');
  });
  it('still sets the one-line form', () => {
    const t = dedicationToTypst('To S. P.,\n\nwhose generosity brought this book here.');
    expect(t).toContain('smallcaps[To S. P.,]');
    expect(t).toContain('[whose generosity brought this book here.]');
  });
});

describe('page seams', () => {
  const book = { id: 'b2', slug: 'seams', title: 'T', author: 'A', language: 'Latin' };
  it('sets a sentence broken across two pages as one paragraph and drops the continuation ellipsis', () => {
    const src = generateTypstSource(book, [
      page(6, 'He ought to inquire whether he sinned in a time of joy. It is graver...', 'Grauior est'),
      page(7, '...fornication committed in mourning is more serious. Next sentence.', 'fornicatio tempore luctus.'),
    ], { includeOriginal: true });
    expect(src).toMatch(/It is graver\.\.\.\n#src\("7"[^\n]*\);fornication committed/);
    expect(src).toMatch(/Grauior est\n#src\("7"[^\n]*\);fornicatio/);
  });
  it('keeps the paragraph break when the page ends a sentence or the next starts one', () => {
    const src = generateTypstSource(book, [
      page(1, 'A full sentence.'),
      page(2, 'Another full sentence.'),
      page(3, 'lowercase start after a full stop is still a new paragraph.'),
    ]);
    expect(src.match(/#pagegap/g)).toHaveLength(3);
  });
  it('puts a chapter heading after a continued sentence, not inside it', () => {
    const src = generateTypstSource({ ...book, chapters: [{ pageNumber: 2, title: 'Two', level: 1 }] }, [
      page(1, 'It is graver...'),
      page(2, '...fornication is worse. Done.'),
    ]);
    expect(src).toMatch(/It is graver\.\.\.\n#src\("2"[^\n]*\);fornication is worse\. Done\.\n\n#heading\(level: 2\)\[Two\]/);
  });
});

describe('generateTypstSource', () => {
  const book = { id: 'b1', slug: 'a-book', title: 'Liber "de" #rebus', display_title: 'A Book: Of Things', author: 'A | B', language: 'Latin', published: '1657' };
  const pages = [
    page(1, '# Chapter One #\n\n[Marginal note: A note.]\nBody text with *emphasis*.and a <note>note [with] #brackets</note>.', 'Caput primum\n\nTextus cum la-\ntet verbo.'),
    page(2, '/ slash start\n- dash start\n1. numbered\n\n' + ['Aloe','Basil','Caraway','Dodder','Elder','Fennel','Garlic','Hyssop','Iris','Juniper','Kale','Lovage','Mallow','Nettle'].map((n, i) => `${n} ${i + 100}.A`).join('\n')),
  ];

  it('anchors every source page and keeps the DOI when it has one', () => {
    const src = generateTypstSource(book, pages, { doi: '10.5281/zenodo.1', version: '1.0.0' });
    expect(src).toContain('#src("1", printed: none, side: "t"');
    expect(src).toContain('#src("2", printed: none, side: "t"');
    expect(src).toContain('https://doi.org/10.5281/zenodo.1');
    expect(src).toContain('A, B');
  });

  it('cross-links a page to its source text only when the source side has that page, and reflows the transcription', () => {
    const src = generateTypstSource({ ...book, acquisition_funder: 'Stefan Pernar' }, pages, { credits: ['Books funded by X'] });
    expect(src).toContain('#src("1", printed: none, side: "t", other: "Latin");');
    expect(src).toContain('#src("1", printed: none, side: "o", other: "English");');
    expect(src).toContain('#src("2", printed: none, side: "t");');
    expect(src).toContain('latet verbo');
    expect(src).toContain('Books funded by X');
    expect(src).toContain('To Stefan Pernar,');
    expect(src).toContain('whose generosity brought this book');
    expect(src).toContain('page-number/');
  });

  const hasTypst = (() => { try { execSync('typst --version', { stdio: 'pipe' }); return true; } catch { return false; } })();
  it.skipIf(!hasTypst)('compiles', async () => {
    const pdf = await generateScholarlyPdf(book, pages, { introduction: '## Context\n\nAn *intro* with https://example.org/x.' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 60000);
});

/**
 * Found by rendering six books and reading the pages (2026-09-22). Each case
 * below reached a cover, an index or a colophon that would have gone into a
 * permanent deposit.
 */
describe('displayTitle', () => {
  it('drops catalogue apparatus that is not part of the title', () => {
    expect(displayTitle('De mysteriis Aegyptiorum (with Proclus, Porphyry)')).toBe('De mysteriis Aegyptiorum');
    expect(displayTitle('Clavicula Salomonis (Hebrew Manuscript)')).toBe('Clavicula Salomonis');
    expect(displayTitle('春秋五禮例宗·卷四~卷十 (vol 2)')).toBe('春秋五禮例宗·卷四~卷十');
    expect(displayTitle('Euripides V: Bacchae, Heracles, Phoenissae (Loeb)')).toBe('Euripides V: Bacchae, Heracles, Phoenissae');
  });

  it('keeps a parenthetical that is a real alternative title', () => {
    // The negative control: a blanket "strip any trailing parenthetical" would
    // discard this, which is why the rule is a list of known apparatus.
    expect(displayTitle('Iter extaticum II (Mundus subterraneus prodromus)'))
      .toBe('Iter extaticum II (Mundus subterraneus prodromus)');
  });

  it('drops an imprint tail and a parenthetical repeating the author', () => {
    expect(displayTitle('Liber de penitentia (Alain de Lille), Augsburg 1518', { author: 'Alain de Lille' }))
      .toBe('Liber de penitentia');
  });

  it('makes existing hyphens non-breaking so a name cannot split across lines', () => {
    // "PICATRIX (GHĀYAT AL-" / "ḤAKĪM)" appeared on a rendered cover
    expect(displayTitle('Picatrix')).toBe('Picatrix');
    expect(displayTitle('Ghāyat al-Ḥakīm')).toBe('Ghāyat al\u2011Ḥakīm');
  });

  it('never returns empty, even when the whole title looks like apparatus', () => {
    expect(displayTitle('(vol 2)')).toBe('(vol 2)');
  });
});

describe('translationLine', () => {
  it('does not say a book was translated from the language it is in', () => {
    // 1,460 deposit-eligible books are language: "English" and read
    // "An English translation from the English" on their cover
    expect(translationLine('English')).toBe('A modernized English edition');
  });

  it('names the source language when there is one', () => {
    expect(translationLine('Latin')).toBe('An English translation from the Latin');
  });

  it('omits the clause when the language is unknown', () => {
    expect(translationLine('')).toBe('An English translation');
    expect(translationLine('source language')).toBe('An English translation');
  });
});

describe('indexEntries', () => {
  const e = (term: string, pages: number[]) => ({ term, pages });

  it('keeps the locators (they were being dropped for a bare word list)', () => {
    const out = indexEntries([e('Aloe', [3, 1, 2])], 100);
    expect(out).toEqual([{ term: 'Aloe', pages: [1, 2, 3] }]);
  });

  it('merges entries that differ only by case, preferring the capitalised form', () => {
    const out = indexEntries([e('botany', [1]), e('Botany', [2])], 100);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ term: 'Botany', pages: [1, 2] });
  });

  it('drops a term so common it is the subject rather than a way in', () => {
    const everywhere = Array.from({ length: 300 }, (_, i) => i + 1);
    const out = indexEntries([e('botany', everywhere), e('Aloe', [5, 9])], 940);
    expect(out.map(x => x.term)).toEqual(['Aloe']);
  });

  it('keeps a frequent term in a short book, where a quarter is only a page or two', () => {
    const out = indexEntries([e('Solomon', [1, 2, 3, 4, 5, 6])], 20);
    expect(out.map(x => x.term)).toEqual(['Solomon']);
  });

  it('sorts for reading but selects by weight', () => {
    // A weighted source list sliced alphabetically would stop at the first letters
    const many = Array.from({ length: 300 }, (_, i) => e(`term${String(i).padStart(3, '0')}`, [i + 1]));
    many.push(e('zzz-important', [1, 2, 3, 4, 5]));
    const out = indexEntries(many, 400);
    expect(out.some(x => x.term === 'zzz-important')).toBe(true);
    const terms = out.map(x => x.term);
    expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  });

  it('drops entries with no locators rather than printing a bare word', () => {
    expect(indexEntries([e('ghost', [])], 100)).toEqual([]);
  });
});

describe('urlDisplay', () => {
  it('breaks a URL only at slashes, never at a hyphen the slug already contains', () => {
    const out = urlDisplay('https://sourcelibrary.org/book/de-historia-stirpium-commentarii-insignes-fuchs-2');
    expect(out.startsWith('sourcelibrary.org/')).toBe(true);
    expect(out).not.toContain('-');           // every hyphen is now U+2011
    expect(out).toContain('\u2011');
    expect(out).toContain('/\u200B');
  });
});

describe('stripLeadingApparatus', () => {
  it('sees through a run of bracketed page furniture', () => {
    // A rendered Kircher page opened with exactly this
    expect(stripLeadingApparatus('[Bottom center signature mark] A [Bottom right catchword/fragment] -self, returned'))
      .toBe('-self, returned');
  });

  it('leaves a woodcut description alone — it is the only record of the plate', () => {
    // Fuchs deposits 1,321 pages and one image; these descriptions are the
    // only evidence the ~500 woodcuts exist
    const t = '[Large decorative initial Q containing a figure] Quoniam autem';
    expect(stripLeadingApparatus(t)).toBe(t);
  });

  it('leaves a translator supplement alone', () => {
    const t = '[He should be] willing to lift';
    expect(stripLeadingApparatus(t)).toBe(t);
  });

  it('does nothing to ordinary prose', () => {
    expect(stripLeadingApparatus('The volume is encased in a binding.')).toBe('The volume is encased in a binding.');
  });
});

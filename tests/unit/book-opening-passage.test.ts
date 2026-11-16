import { describe, it, expect } from 'vitest';
import type { Page } from '@/lib/types';
import {
  pickOpeningPassage, passageParagraph, cutAtSentence, passageStartPage,
  PASSAGE_MAX_CHARS, PASSAGE_MIN_CHARS,
} from '@/lib/book-opening-passage';
import { schemaInLanguage } from '@/components/seo/SchemaOrgMetadata';

const PROSE = 'The Egyptians call this serpent the Oubaios, which in the Greek language is the Basilisk. '
  + 'They fashion it out of gold and place it around the statues of the gods. The Egyptians say that '
  + 'Eternity is represented by this animal because, among the three known kinds of serpents, the others '
  + 'are mortal, but this one alone is immortal.';
const LATIN = 'Aegyptii serpentem hunc Ubaeum vocant, quod Graeca lingua Basiliscum significat. Hunc ex auro '
  + 'fingunt et deorum simulacris circumponunt, quoniam inter tria serpentum genera solus immortalis est.';

const book = { id: 'b1', pages_count: 100, pages_translated: 90, language: 'Latin' };
const page = (n: number, translation: string, extra: Record<string, unknown> = {}): Page => ({
  id: `p${n}`, book_id: 'b1', page_number: n, page_type: 'text',
  ocr: { data: LATIN }, translation: { data: translation, model: 'gemini-3-flash-preview', source: 'ai' },
  ...extra,
} as unknown as Page);

describe('passageParagraph', () => {
  it('keeps a paragraph of running English prose, verbatim', () => {
    expect(passageParagraph(PROSE)).toBe(PROSE);
  });
  it('removes emphasis marks and term tags but not the words', () => {
    expect(passageParagraph(PROSE.replace('Oubaios', '*Oubaios*').replace('Basilisk', '<term>Basilisk</term>'))).toBe(PROSE);
  });
  it.each([
    ['a heading', `# ${PROSE}`],
    ['a centred line', `->${PROSE}<-`],
    ['a paragraph with a note left in it', `${PROSE} <note>original: basiliscus</note>`],
    ['a paragraph with a translator supplement in brackets', PROSE.replace('this animal', '[this] animal')],
    ['a table row', `| Page | Line | ${PROSE} |`],
    ['a contents line with dot leaders', `${PROSE} .......... 12`],
    ['a short line', 'Here begins the first book.'],
    ['verse set on separate lines', PROSE.replace(/\. /g, '.\n')],
    ['untranslated source text', `${LATIN} ${LATIN}`],
    ['a dedication address in capitals', 'To the Most Excellent Lord LUIS DE VASCONCELLOS E SOUSA, COUNT OF CASTEL MELHOR, of the Council of State of His Majesty, and his Chief Steward, and the Secretary of State of the kingdom.'],
    ['a paragraph with a footnote call', PROSE.replace('gods. The', 'gods. 1) The')],
  ])('rejects %s', (_name, text) => {
    expect(passageParagraph(text)).toBeNull();
  });
});

describe('cutAtSentence', () => {
  it('returns a short complete paragraph whole', () => {
    expect(cutAtSentence(PROSE)).toEqual({ text: PROSE, truncated: false });
  });
  it('cuts a long paragraph at a sentence end and says so', () => {
    const long = `${PROSE} ${PROSE} ${PROSE}`;
    const cut = cutAtSentence(long)!;
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS);
    expect(cut.text.length).toBeGreaterThanOrEqual(PASSAGE_MIN_CHARS);
    expect(long.startsWith(cut.text)).toBe(true);
    expect(cut.text.endsWith('.')).toBe(true);
  });
  it('does not treat an abbreviation as a sentence end', () => {
    const p = `${'It is told of St. Paul in the acts that he came to the city and taught there many days among the people of that place, '.repeat(6)}and so it ended. Then more was said.`;
    const cut = cutAtSentence(p);
    if (cut) expect(cut.text.endsWith('St.')).toBe(false);
  });
  it('gives nothing when no sentence ends inside the limit', () => {
    expect(cutAtSentence('word '.repeat(300).trim())).toBeNull();
  });
});

describe('passageStartPage', () => {
  it('starts at the first chapter when it is inside the free sample, else at page 1', () => {
    expect(passageStartPage(100, 7)).toBe(7);
    expect(passageStartPage(100, 40)).toBe(1);
    expect(passageStartPage(100, null)).toBe(1);
  });
});

describe('pickOpeningPassage', () => {
  it('takes the first prose paragraph of the first usable page', () => {
    const got = pickOpeningPassage([page(3, `# CHAPTER ONE\n\n${PROSE}\n\nMore.`)], book);
    expect(got).toMatchObject({ text: PROSE, truncated: false, pageId: 'p3', pageNumber: 3 });
  });
  it('quotes only words that stand on the page it links to', () => {
    const pages = [page(3, `# Title\n\n->A motto<-`), page(4, `${PROSE}`)];
    const got = pickOpeningPassage(pages, book)!;
    expect(got.pageId).toBe('p4');
    expect(String(pages[1].translation!.data)).toContain(got.text);
  });
  it('leaves the translator model commentary out of the quotation', () => {
    const got = pickOpeningPassage([page(3, `<meta>This page opens the treatise.</meta>\n\n${PROSE}<note>The basilisk is the uraeus.</note>`)], book)!;
    expect(got.text).toBe(PROSE);
    expect(got.text).not.toContain('uraeus');
    expect(got.text).not.toContain('opens the treatise');
  });
  it('never quotes a page past the free sample, whatever is loaded', () => {
    expect(pickOpeningPassage([page(21, PROSE)], book)).toBeNull();
    expect(pickOpeningPassage([page(20, PROSE)], book)?.pageId).toBe('p20');
    // seo_indexable widens the reader's free set; the opening passage still keeps to the sample.
    expect(pickOpeningPassage([page(60, PROSE, { seo_indexable: true })], book)).toBeNull();
  });
  it.each([
    ['a title page', { page_type: 'title-page' }],
    ['a contents page', { page_type: 'toc' }],
    ['a blank', { page_type: 'blank' }],
    ['a page the reader does not list', { page_type: 'digitizer-insert' }],
    ['a hidden repeat capture', { repeat_of: 'p2' }],
    ['a page marked unreadable', { ocr: { data: LATIN, unreadable: true } }],
    ['a leaf already printed in English', { ocr: { data: PROSE } }],
  ])('skips %s', (_name, extra) => {
    expect(pickOpeningPassage([page(3, PROSE, extra)], book)).toBeNull();
  });
  it('skips a page a stored check has a warning on', () => {
    expect(pickOpeningPassage([page(3, PROSE)], book, { warnedPages: { 3: { kind: 'x' } } })).toBeNull();
    expect(pickOpeningPassage([page(3, PROSE), page(4, PROSE)], book, { warnedPages: { 3: {} } })?.pageId).toBe('p4');
  });
  it('gives nothing for a page whose translation is withheld', () => {
    const p = page(3, PROSE);
    delete (p as unknown as { translation?: unknown }).translation;
    expect(pickOpeningPassage([p], book)).toBeNull();
  });
  it('gives nothing for an English edition (a stored "translation" there is a rewording)', () => {
    const english = { ...book, language: 'English', translation_state: { english_original: true } };
    expect(pickOpeningPassage([page(3, PROSE, { ocr: { data: PROSE } })], english)).toBeNull();
  });
  it('gives nothing for a book still served as unsplit spreads, or with no page count', () => {
    expect(pickOpeningPassage([page(3, PROSE)], { ...book, needs_splitting: true })).toBeNull();
    expect(pickOpeningPassage([page(3, PROSE)], { ...book, needs_splitting: true, split_completed: true })).not.toBeNull();
    expect(pickOpeningPassage([page(3, PROSE)], { ...book, pages_count: 0 })).toBeNull();
  });
});

describe('schemaInLanguage (book JSON-LD)', () => {
  it('gives a BCP 47 tag for a language we know', () => {
    expect(schemaInLanguage('Latin')).toBe('la');
    expect(schemaInLanguage('German')).toBe('de');
  });
  it('gives every tag of a compound label', () => {
    expect(schemaInLanguage('Latin, German')).toEqual(['la', 'de']);
  });
  it('passes an unknown label through and never guesses', () => {
    expect(schemaInLanguage('Enochian')).toBe('Enochian');
    expect(schemaInLanguage('Latin and Enochian')).toBe('Latin and Enochian');
    expect(schemaInLanguage(undefined)).toBeUndefined();
  });
});

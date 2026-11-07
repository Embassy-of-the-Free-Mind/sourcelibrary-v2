import { describe, it, expect } from 'vitest';
import { READER_UI_STRINGS } from '@/lib/reader-strings';
import { printedDisplay, printedInputMode, resolvePageBox, romanValue, NO_PRINTED_NUMBERS, type PrintedNumbers } from '@/lib/printed-numbers';

const pages = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, page_number: i + 1 }));
const ids = (input: string, list: { id: string; page_number: number }[], printed: PrintedNumbers) => resolvePageBox(input, list, printed).map((m) => `${m.via}:${m.pageId}`);

describe('resolvePageBox (#8041)', () => {
  // Kitab Manafi: frame 5 is printed ٦٧, the numbers fall as the frames rise.
  const confirmed: PrintedNumbers = {};
  for (let frame = 4; frame <= 68; frame++) confirmed[`p${frame}`] = { label: String(72 - frame).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]), value: 72 - frame, numbering: 'arabic-indic' };

  it('a confirmed run: a printed number no frame holds goes straight there', () => {
    expect(ids('67', pages(40), confirmed)).toEqual(['printed:p5']);
  });

  it('Arabic-Indic digits typed are the same number', () => {
    expect(ids('٦٧', pages(40), confirmed)).toEqual(['printed:p5']);
    expect(ids('۶۷', pages(40), confirmed)).toEqual(['printed:p5']);
  });

  it('a number that is both a frame and a printed page returns both, printed first, and picks neither', () => {
    expect(ids('67', pages(80), confirmed)).toEqual(['printed:p5', 'scan:p67']);
  });

  it('the same page reached both ways is one match, not a choice', () => {
    expect(ids('36', pages(80), confirmed)).toEqual(['printed:p36']);
  });

  it('a gap ends the run: a frame with no number resolves as a frame and carries none', () => {
    const gap: PrintedNumbers = { p1: { label: '1', value: 1, numbering: 'arabic' }, p2: { label: '2', value: 2, numbering: 'arabic' }, p6: { label: '9', value: 9, numbering: 'arabic' } };
    const [m, ...rest] = resolvePageBox('4', pages(8), gap);
    expect(rest).toEqual([]);
    expect(m).toEqual({ pageId: 'p4', pageNumber: 4, via: 'scan', printed: undefined });
    // 4 was never printed-confirmed, and interpolating across the gap would have invented it.
    expect(ids('9', pages(8), gap)).toEqual(['printed:p6']);
  });

  it('an unconfirmed book: frames only, as before', () => {
    expect(resolvePageBox('5', pages(8), NO_PRINTED_NUMBERS)).toEqual([{ pageId: 'p5', pageNumber: 5, via: 'scan', printed: undefined }]);
    expect(resolvePageBox('99', pages(8), NO_PRINTED_NUMBERS)).toEqual([]);
    expect(resolvePageBox('xii', pages(8), NO_PRINTED_NUMBERS)).toEqual([]);
  });

  it('a printed number twice in a book (front matter and body) returns both and guesses neither', () => {
    const twice: PrintedNumbers = { p3: { label: '12', value: 12, numbering: 'arabic' }, p40: { label: '12', value: 12, numbering: 'arabic' } };
    expect(ids('12', pages(50), twice)).toEqual(['printed:p3', 'printed:p40', 'scan:p12']);
  });

  it('roman pages answer to roman numerals, not to digits, in any case and in the early j form', () => {
    const roman: PrintedNumbers = { p2: { label: 'xii', value: 12, numbering: 'roman' }, p9: { label: 'xij', value: 12, numbering: 'roman' } };
    expect(ids('xii', pages(5), { p2: roman.p2 })).toEqual(['printed:p2']);
    expect(ids('XII', pages(5), { p2: roman.p2 })).toEqual(['printed:p2']);
    expect(ids('xii', pages(10), roman)).toEqual(['printed:p2', 'printed:p9']);
    expect(ids('12', pages(5), { p2: roman.p2 })).toEqual([]);
  });

  it('folio: the label picks the side, a bare number offers both', () => {
    const folio: PrintedNumbers = { p1: { label: '12r', value: 12, numbering: 'folio', side: 'r' }, p2: { label: '12v', value: 12, numbering: 'folio', side: 'v' } };
    expect(ids('12v', pages(5), folio)).toEqual(['printed:p2']);
    expect(ids('12 V', pages(5), folio)).toEqual(['printed:p2']);
    expect(ids('12', pages(5), folio)).toEqual(['printed:p1', 'printed:p2']);
  });

  it('letter and Chinese numerals match as printed and by value', () => {
    const hebrew: PrintedNumbers = { p1: { label: 'צ״ט', value: 99, numbering: 'hebrew' } };
    expect(ids('צט', pages(5), hebrew)).toEqual(['printed:p1']);
    expect(ids('99', pages(5), hebrew)).toEqual(['printed:p1']);
    const chinese: PrintedNumbers = { p1: { label: '二七三', value: 273, numbering: 'chinese' } };
    expect(ids('二七三', pages(5), chinese)).toEqual(['printed:p1']);
    expect(ids('273', pages(5), chinese)).toEqual(['printed:p1']);
  });

  it('text that folds to nothing matches nothing', () => {
    expect(resolvePageBox(' … ', pages(5), confirmed)).toEqual([]);
  });

  it('a page outside the reader list (a hidden repeat capture) is not offered', () => {
    expect(ids('67', [{ id: 'p6', page_number: 6 }], confirmed)).toEqual([]);
  });
});

describe('printedDisplay', () => {
  it('shows Western digits for Arabic-Indic with the printed form as the tooltip', () => {
    expect(printedDisplay({ label: '٦٧', value: 67, numbering: 'arabic-indic' })).toEqual({ text: '67', title: '٦٧' });
  });
  it('shows roman and folio as printed, letter numerals with their value', () => {
    expect(printedDisplay({ label: 'xii', value: 12, numbering: 'roman' }).text).toBe('xii');
    expect(printedDisplay({ label: '12v', value: 12, numbering: 'folio', side: 'v' }).text).toBe('12v');
    expect(printedDisplay({ label: '二七三', value: 273, numbering: 'chinese' }).text).toBe('二七三 (273)');
  });
});

describe('printedInputMode', () => {
  it('asks for a keyboard only where a label needs letters', () => {
    expect(printedInputMode({ a: { label: '٦٧', value: 67, numbering: 'arabic-indic' } })).toBe('numeric');
    expect(printedInputMode({ a: { label: 'xii', value: 12, numbering: 'roman' } })).toBe('text');
  });
});

describe('romanValue', () => {
  it('reads valid numerals and refuses words', () => {
    expect(romanValue('xiv')).toBe(14);
    expect(romanValue('xij')).toBe(12);
    expect(romanValue('mcmlx')).toBe(1960);
    expect(romanValue('hello')).toBeNull();
    expect(romanValue('iiii')).toBeNull();
    expect(romanValue('')).toBeNull();
  });
});

describe('reader strings', () => {
  it('every locale names the printed number and the frame, and asks which', () => {
    for (const [locale, { toolbar }] of Object.entries(READER_UI_STRINGS)) {
      expect(toolbar.printedPage('67'), locale).toContain('67');
      expect(toolbar.scanPage(5), locale).toContain('5');
      expect(toolbar.whichPage, locale).toBeTruthy();
    }
    expect(Object.keys(READER_UI_STRINGS).sort()).toEqual(['en', 'es', 'la', 'nl', 'zh']);
  });
});

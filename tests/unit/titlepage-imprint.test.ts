// #7201: the imprint read keeps a field only when it cites a line that carries it. These pin the parser and
// the guards; the by-eye precision of what survives them is in scripts/eval/experiments/2026-10-23-titlepage-imprint-7201.md.
import { describe, it, expect } from 'vitest';
import {
  parseImprintReply,
  checkImprint,
  quoteSupportsYear,
  quoteSupportsName,
  quoteCarriesValue,
  quoteIsOnPage,
  imageWindow,
  boundedImageUrl,
  imprintPrompt,
  // @ts-expect-error — .mjs script lib, no types
} from '../../scripts/lib/titlepage-imprint.mjs';

const TP = 'DE MAGIA NATURALI LIBRI DUO. Auctore Ioanne Baptista Porta Neapolitano. LVGDVNI, Apud Ioan. Tornaesium. M. D. XLIX.';

describe('parseImprintReply', () => {
  it('reads a fenced reply and fills missing keys', () => {
    const r = parseImprintReply('```json\n{"date":{"as_printed":"1672","year":1672,"calendar":"CE","page":3,"quoted_line":"1672"},"names":[]}\n```');
    expect(r.parse_failed).toBeUndefined();
    expect(r.date.year).toBe(1672);
    expect(r.title).toBeNull();
    expect(r.names).toEqual([]);
    expect(r.title_page).toBeNull();
  });
  it('is a parse failure, never an empty imprint, on junk or a non-object', () => {
    expect(parseImprintReply('Here is the imprint: {').parse_failed).toBe(true);
    expect(parseImprintReply('[1,2]').parse_failed).toBe(true);
    expect(parseImprintReply('').parse_failed).toBe(true);
  });
});

describe('quoteSupportsYear', () => {
  it('finds Arabic and Roman years, including spaced and dotted numerals', () => {
    expect(quoteSupportsYear('Venetiis, 1505', 1505, 'CE')).toBe(true);
    expect(quoteSupportsYear('LVGDVNI, Apud Ioan. Tornaesium. M. D. XLIX.', 1549, 'CE')).toBe(true);
    expect(quoteSupportsYear('ANNO M.DC.LXXX. Cum Privilegio', 1680, 'CE')).toBe(true);
    expect(quoteSupportsYear('M DCC LXXXIII', 1783, null)).toBe(true);
  });
  it('reads early-modern type the v1 guard rejected (real #7201 replies)', () => {
    expect(quoteSupportsYear('clɔ Iɔ CXIV.', 1614, 'CE')).toBe(true);
    expect(quoteSupportsYear('ANNO clɔ. Iɔ. c. v.', 1605, 'CE')).toBe(true);
    expect(quoteSupportsYear('1 5 61.', 1561, 'CE')).toBe(true);
    expect(quoteSupportsYear('I 5 7 9.', 1579, 'CE')).toBe(true);
    expect(quoteSupportsYear('J . 5 81', 1581, 'CE')).toBe(true);
  });
  it('still rejects what v1 rightly caught: a misread numeral and a scriptural chapter', () => {
    expect(quoteSupportsYear('a christi natali. Mccccxxxxiii.', 1493, 'CE')).toBe(false); // prints 1443
    expect(quoteSupportsYear('HIEREM: XV.', 1515, 'CE')).toBe(false);
  });
  it('rejects a line that does not print the year', () => {
    expect(quoteSupportsYear('Apud Ioan. Tornaesium', 1549, 'CE')).toBe(false);
    expect(quoteSupportsYear('Anno 1548', 1549, 'CE')).toBe(false);
    expect(quoteSupportsYear('Anno 1549', undefined, 'CE')).toBe(false);
  });
  it('abstains (null) when the model converted from another calendar', () => {
    expect(quoteSupportsYear('سنة ١٣٠٣', 1885, 'Hijri')).toBeNull();
  });
});

describe('quoteSupportsName / quoteCarriesValue / quoteIsOnPage', () => {
  it('names: declension passes, an unrelated line fails, another script abstains', () => {
    expect(quoteSupportsName('Auctore Ioanne Baptista Porta', 'Giovanni Battista Della Porta')).toBe(true);
    expect(quoteSupportsName('Médico e Historiador de Su Majestad', 'Francisco Hernández')).toBe(false);
    expect(quoteSupportsName('防風茅元儀輯', 'Mao Yuanyi')).toBeNull();
  });
  it('letter-spaced capitals and a first-line title quote pass; an unrelated fragment does not', () => {
    expect(quoteCarriesValue('B A S I L E A E,', 'BASILEAE')).toBe(true);
    expect(quoteCarriesValue('GEORGII AGRICOLAE', 'GEORGII AGRICOLAE EPISTOLA AD PLATEANVM, CVI sunt adiecta', { fragment: true })).toBe(true);
    expect(quoteCarriesValue('H A R M O N I A E X', 'HARMONIA EX tribus Euangelistis composita', { fragment: true })).toBe(true);
    expect(quoteCarriesValue('GEORGII AGRICOLAE', 'GEORGII AGRICOLAE EPISTOLA AD PLATEANVM, CVI sunt adiecta')).toBe(false);
    expect(quoteCarriesValue('Apud Ioan. Tornaesium', 'DE MAGIA NATURALI', { fragment: true })).toBe(false);
    expect(quoteSupportsName('I O A N N I S K E P L E R I', 'Johannes Kepler')).toBe(true);
  });
  it('values: the as-printed words must be in the quote', () => {
    expect(quoteCarriesValue('LVGDVNI, Apud Ioan. Tornaesium.', 'LVGDVNI')).toBe(true);
    expect(quoteCarriesValue('LVGDVNI, Apud Ioan. Tornaesium.', 'Venetiis')).toBe(false);
  });
  it('quotes match through punctuation and case, not through other words', () => {
    expect(quoteIsOnPage('lvgdvni apud ioan tornaesium', TP)).toBe(true);
    expect(quoteIsOnPage('Parisiis apud Morel', TP)).toBe(false);
  });
});

describe('checkImprint', () => {
  const textPages = new Map([[3, TP], [4, 'AD LECTOREM. Salve.']]);
  const reply = {
    title: { value: 'DE MAGIA NATURALI LIBRI DUO', page: 3, quoted_line: 'DE MAGIA NATURALI LIBRI DUO.' },
    names: [
      { name_nominative: 'Ioannes Baptista Porta', name_as_printed: 'Ioanne Baptista Porta', role: 'Author', page: 3, quoted_line: 'Auctore Ioanne Baptista Porta Neapolitano.' },
      { name_nominative: 'Jean de Tournes', name_as_printed: 'Ioan. Tornaesium', role: 'printer', page: 4, quoted_line: 'Apud Ioan. Tornaesium.' },
    ],
    date: { as_printed: 'M. D. XLIX.', year: 1549, calendar: 'CE', page: 3, quoted_line: 'M. D. XLIX.' },
    place: { as_printed: 'LVGDVNI', modern: 'Lyon', page: 3, quoted_line: 'LVGDVNI, Apud Ioan. Tornaesium.' },
    printer_publisher: { as_printed: 'Apud Ioan. Tornaesium', page: 9, quoted_line: 'Apud Ioan. Tornaesium.' },
    edition_statement: null,
    title_page: 3,
  };

  it('text mode: keeps cited fields, drops a quote on the wrong page and a page never shown', () => {
    const r = checkImprint(reply, { mode: 'text', pages: textPages });
    expect(r.fields.title.value).toBe('DE MAGIA NATURALI LIBRI DUO');
    expect(r.fields.date.year).toBe(1549);
    expect(r.fields.place.modern).toBe('Lyon');
    expect(r.fields.printer_publisher).toBeNull();
    expect(r.fields.edition_statement).toBeNull();
    expect(r.names.map((n: { role: string }) => n.role)).toEqual(['author']);
    const reasons = r.rejected.map((x: { field: string; reason: string }) => `${x.field}:${x.reason}`).sort();
    expect(reasons).toEqual(['names:quote_on_other_page', 'printer_publisher:page_not_shown']);
    expect(r.title_page).toBe(3);
  });

  it('a date whose line does not print its year is dropped, and so is an implausible year', () => {
    const bad = { ...reply, date: { as_printed: '1549', year: 1549, calendar: 'CE', page: 3, quoted_line: 'Apud Ioan. Tornaesium.' } };
    expect(checkImprint(bad, { mode: 'text', pages: textPages }).rejected.some((x: { reason: string }) => x.reason === 'quote_lacks_year')).toBe(true);
    const wild = { ...reply, date: { as_printed: 'XLIX', year: 49, calendar: 'CE', page: 3, quoted_line: 'M. D. XLIX.' } };
    expect(checkImprint(wild, { mode: 'text', pages: textPages }).rejected.some((x: { reason: string }) => x.reason === 'implausible_year')).toBe(true);
  });

  it('image mode: no OCR to test, but the page must have been shown and the line must carry the value', () => {
    const imgPages = new Map([[1, null], [2, null], [3, null]]);
    const r = checkImprint({ ...reply, printer_publisher: { ...reply.printer_publisher, page: 3 } }, { mode: 'image', pages: imgPages });
    expect(r.fields.date.year).toBe(1549);
    expect(r.fields.printer_publisher.as_printed).toBe('Apud Ioan. Tornaesium');
    expect(r.names.map((n: { role: string }) => n.role)).toEqual(['author']); // the printer cited p4, not shown
    const lacking = checkImprint({ ...reply, place: { as_printed: 'Venetiis', modern: 'Venice', page: 3, quoted_line: 'LVGDVNI' } }, { mode: 'image', pages: imgPages });
    expect(lacking.fields.place).toBeNull();
  });
});

describe('imageWindow / boundedImageUrl / imprintPrompt', () => {
  it('skips typed blanks and covers, keeps untyped pages, in page order', () => {
    const w = imageWindow([{ page_number: 3 }, { page_number: 1, page_type: 'cover' }, { page_number: 2, page_type: 'blank' }, { page_number: 4 }], 8);
    expect(w.map((p: { page_number: number }) => p.page_number)).toEqual([3, 4]);
  });
  it('bounds a IIIF full-size request and leaves other URLs alone', () => {
    expect(boundedImageUrl('https://api.digitale-sammlungen.de/iiif/image/v2/bsb1_00001/full/full/0/default.jpg'))
      .toBe('https://api.digitale-sammlungen.de/iiif/image/v2/bsb1_00001/full/!1600,1600/0/default.jpg');
    expect(boundedImageUrl('https://images.sourcelibrary.org/archived/x/1.jpg')).toBe('https://images.sourcelibrary.org/archived/x/1.jpg');
  });
  it('has a text and an image frame and refuses anything else', () => {
    expect(imprintPrompt('image')).toMatch(/page IMAGES/);
    expect(imprintPrompt('text')).toMatch(/transcribed by OCR/);
    expect(() => imprintPrompt('audio')).toThrow();
  });
});

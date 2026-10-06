/**
 * Book-level cover policy (scripts/lib/cover-choice.mjs): illustrated titles
 * wear a plate, otherwise the best scored opening page, then a plate, then the
 * first ordinary page — never junk.
 */
import { describe, it, expect } from 'vitest';
import {
  chooseCover,
  isIllustratedTitle,
  isManualCover,
  isJunkCover,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/cover-choice.mjs';

const img = (n: number) => `https://images.sourcelibrary.org/archived/book1/${n}.jpg`;
const page = (n: number, ocr: string, extra: Record<string, unknown> = {}) =>
  ({ page_number: n, archived_photo: img(n), ocr: { data: ocr }, ...extra });

const blank = page(1, '<page-type>blank</page-type> Blank flyleaf.');
const insert = page(2, 'Digitized by the Internet Archive in 2010 with funding from Microsoft Corporation');
const title = page(5, '<page-type>title-page</page-type>\n# DE FUNGIS\n# LIBER\n# PRIMUS\nTypis Breitkopf, decorative border');
const text = page(9, '<page-type>text</page-type> Caput primum. De fungis in genere.');
const plateDoc = page(78, '<page-type>illustration</page-type> Hand-coloured plate of fungi.');
const plate = { page_number: 78, gallery_quality: 0.9, type: 'engraving', bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } };
const platePages = new Map([[78, plateDoc]]);

describe('isIllustratedTitle', () => {
  it.each([
    'Icones et descriptiones fungorum',
    'Illustrations of British Mycology',
    'Fungorum qui in Bavaria nascuntur Icones',
    'Naturgetreue Abbildungen der Schwämme',
    'Planches pour les champignons',
    'Coloured Figures of English Fungi',
    '本草圖譜',
  ])('recognises %s', t => expect(isIllustratedTitle({ title: t })).toBe(true));

  it.each(['Systema Mycologicum', 'Opera Omnia', 'Ornithologia', 'The Romance of Blanquerna'])(
    'does not flag %s', t => expect(isIllustratedTitle({ title: t })).toBe(false),
  );
});

describe('chooseCover', () => {
  it('gives an illustrated title its best plate even when a title page exists', () => {
    const c = chooseCover({ title: 'Icones Fungorum' }, [blank, insert, title, text], [plate], platePages);
    expect(c.page.page_number).toBe(78);
    expect(c.rule).toBe('illustrated-title-plate');
  });

  it('prefers the title page for an ordinary book', () => {
    const c = chooseCover({ title: 'De Fungis' }, [blank, insert, title, text], [plate], platePages);
    expect(c.page.page_number).toBe(5);
    expect(c.rule).toBe('scored-page');
  });

  it('falls back to a representative plate when no page scores', () => {
    const c = chooseCover({ title: 'De Fungis' }, [blank, insert, text], [plate], platePages);
    expect(c.page.page_number).toBe(78);
    expect(c.rule).toBe('representative-plate');
  });

  it('ignores marginal drawings, ornaments and bookplates as plates', () => {
    const small = { ...plate, bbox: { x: 0, y: 0, width: 0.3, height: 0.3 } };
    const ornament = { ...plate, type: 'decorative' };
    const bookplate = { ...plate, type: 'exlibris' };
    const c = chooseCover({ title: 'Icones Fungorum' }, [blank, insert, text], [small, ornament, bookplate], platePages);
    expect(c.page.page_number).toBe(9);
    expect(c.rule).toBe('first-ordinary-page');
  });

  it('takes the first ordinary page over blanks and inserts', () => {
    const c = chooseCover({ title: 'De Fungis' }, [blank, insert, text], [], new Map());
    expect(c.page.page_number).toBe(9);
  });

  it('returns null when only junk is available', () => {
    expect(chooseCover({ title: 'De Fungis' }, [blank, insert], [], new Map())).toBeNull();
  });

  it('never picks a page whose image host would not render', () => {
    const raw = page(5, title.ocr.data, { archived_photo: undefined, photo: 'https://archive.org/download/x/page/n4.jpg' });
    const c = chooseCover({ title: 'De Fungis' }, [blank, raw, text], [], new Map());
    expect(c.page.page_number).toBe(9);
  });
});

describe('guards', () => {
  it('treats every manual-* source as hand-picked', () => {
    expect(isManualCover({ thumbnail_source: 'manual' })).toBe(true);
    expect(isManualCover({ thumbnail_source: 'manual-title-page' })).toBe(true);
    expect(isManualCover({ thumbnail_source: 'smart_ocr' })).toBe(false);
  });

  it('flags blank and scanner-insert covers as junk, not title pages', () => {
    expect(isJunkCover(blank, {})).toBe(true);
    expect(isJunkCover(insert, {})).toBe(true);
    expect(isJunkCover(title, {})).toBe(false);
  });
});

describe('currentCoverPageNumber', () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module
  const load = () => import('../../scripts/lib/cover-choice.mjs');
  it('reads cover_page, then the cover URL, else null', async () => {
    const { currentCoverPageNumber } = await load();
    expect(currentCoverPageNumber({ id: 'b1', cover_page: 7 })).toBe(7);
    expect(currentCoverPageNumber({ id: 'b1', thumbnail: 'https://images.sourcelibrary.org/archived/b1/12.jpg' })).toBe(12);
    expect(currentCoverPageNumber({ id: 'b1', image_display: 'https://images.sourcelibrary.org/pages/b1/0034-thumb.jpg' })).toBe(34);
    expect(currentCoverPageNumber({ id: 'b1', thumbnail: 'https://images.sourcelibrary.org/pages/b1/spppuy-0081.jpg' })).toBe(81);
    expect(currentCoverPageNumber({ id: 'b1', thumbnail: 'https://archive.org/services/img/x' })).toBeNull();
    expect(currentCoverPageNumber({ id: 'b1', thumbnail: 'https://images.sourcelibrary.org/archived/other/3.jpg' })).toBeNull();
  });
});

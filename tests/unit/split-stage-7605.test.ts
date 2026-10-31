import { describe, it, expect, vi } from 'vitest';

// Build, then swap (#7605, Derek 2026-10-30): a split book's leaves are built HIDDEN while its spreads stay live, read
// and translated there, and swapped in only when every leaf has text and English. These pin the rules that decide what
// text a leaf starts with, when a swap may happen, and where an old citation lands afterwards.

const BOOK = '6a2032ad18654bf8e1903546';
let redirects: Record<string, unknown>[] = [];
const pagesByNumber: Record<number, string> = { 3: 'leaf-3-now' };
vi.mock('@/lib/mongodb', () => ({
  getReadDb: async () => ({
    collection: (name: string) => ({
      findOne: async (q: Record<string, unknown>) => {
        if (name === 'shortlink_redirects') return redirects.find((r) => r.code === q.code) ?? null;
        if (name === 'pages') { const id = pagesByNumber[q.page_number as number]; return id ? { id } : null; }
        if (name === 'books') return { id: BOOK, slug: 'mystical-verses' };
        return null;
      },
    }),
  }),
}));
vi.mock('@/lib/shortlink-visit-log', () => ({ logShortlinkVisit: () => {} }));
vi.mock('@/lib/free-preview', () => ({ meteredReaderEnabled: () => false }));


const stage = await import('../../scripts/lib/split-stage.mjs');
const { isTranslatablePage, sameLanguageReason } = await import('../../scripts/lib/translate-core.mjs');
const { decodeShortlinkCode } = await import('../../scripts/lib/shortlink-code.mjs');
const { encodeShortlink } = await import('@/lib/shortlinks');
const { contentHash } = await import('../../scripts/lib/write-provenance.mjs');

const LTR = ['left', 'right'];
const RTL = ['right', 'left'];

describe('the text a leaf starts with (leavesForFrame)', () => {
  const spread = '<split-position>500</split-position>\n<page-type>text</page-type>\nLeft words\n<page-break/>\n<page-type>text</page-type>\nRight words';

  it('cuts a reviewed fold at the OCR\'s single <page-break/>, in the book\'s reading order', () => {
    expect(stage.leavesForFrame({ fold: 480, ocr: spread }, LTR).map((l) => [l.side, l.ocr?.includes('Left'), l.text_from]))
      .toEqual([['left', true, 'page-break'], ['right', false, 'page-break']]);
    const rtl = stage.leavesForFrame({ fold: 480, ocr: spread }, RTL);
    expect(rtl[0].side).toBe('right');
    expect(rtl[0].ocr).toContain('Right words');
    expect(rtl[1].ocr).toContain('Left words');
  });

  it('puts each half on the leaf the side check says it was read from (frame 7 of the gate book put the right page first)', () => {
    const rl = stage.leavesForFrame({ fold: 490, ocr: spread, sides: 'rl' }, RTL);
    expect(rl.map((l) => [l.side, l.ocr?.includes('Left words')])).toEqual([['right', true], ['left', false]]);
    // Unsure: both leaves are read fresh rather than guessed.
    expect(stage.leavesForFrame({ fold: 490, ocr: spread, sides: null }, RTL).map((l) => l.ocr)).toEqual([null, null]);
  });

  it('reads the side check\'s answer, and refuses anything but one left and one right', async () => {
    const { sidesFrom } = await import('../../scripts/maintenance/split-text-sides.mjs');
    expect(sidesFrom('{"A": "left", "B": "right", "evidence": "x"}')).toBe('lr');
    expect(sidesFrom('{"A": "right", "B": "left"}')).toBe('rl');
    // A reply that states its answer twice (gate book p.10) is read by its last object.
    expect(sidesFrom('{"A": "left", "B": "right"} {"A": "left", "B": "right", "evidence": "y"}')).toBe('lr');
    expect(sidesFrom('{"A": "left", "B": "right"\u060C "evidence": "z"}')).toBe('lr');
    expect(sidesFrom('{"A": "left", "B": "left"}')).toBeNull();
    expect(sidesFrom('{"A": "unsure", "B": "right"}')).toBeNull();
    expect(sidesFrom('no json')).toBeNull();
  });

  it('never carries the <split-position> tag onto a leaf', () => {
    for (const l of stage.leavesForFrame({ fold: 500, ocr: spread }, LTR)) expect(l.ocr).not.toContain('split-position');
  });

  it('a cut frame with no break, or with two, gives leaves to read fresh, never text cut somewhere else', () => {
    expect(stage.leavesForFrame({ fold: 500, ocr: 'one block of text' }, LTR).map((l) => l.ocr)).toEqual([null, null]);
    expect(stage.leavesForFrame({ fold: 500, ocr: 'a<page-break/>b<page-break/>c' }, LTR).map((l) => l.ocr)).toEqual([null, null]);
    expect(stage.leavesForFrame({ fold: 500, ocr: null }, LTR).map((l) => l.text_from)).toEqual([null, null]);
  });

  it('an empty side is read fresh; the other side keeps its text', () => {
    expect(stage.leavesForFrame({ fold: 500, ocr: 'Left only\n<page-break/>\n  ' }, LTR).map((l) => l.ocr)).toEqual(['Left only', null]);
  });

  it('a frame kept whole keeps all of its text, whatever the OCR said about pages', () => {
    const [whole] = stage.leavesForFrame({ fold: null, ocr: spread }, LTR);
    expect(whole.side).toBe('single');
    expect(whole.ocr).toContain('Left words');
    expect(whole.ocr).toContain('Right words');
    expect(whole.ocr).not.toContain('<page-break/>');
    expect(stage.leavesForFrame({ fold: null, ocr: '' }, LTR)[0].ocr).toBeNull();
  });
});

describe('staged leaves: hidden, in leaf order, and still read by the lanes', () => {
  const leaf = (n: number, extra = {}) => ({ id: `L${n}`, page_number: stage.stagedPageNumber(n), staged_split: { run: 'r1', leaf: n, frame_id: `F${Math.ceil(n / 2)}` }, ...extra });

  it('sits below zero, neighbours by page_number ± 1, and takes its number at the swap', () => {
    expect(stage.stagedPageNumber(1)).toBeLessThan(0);
    expect(stage.stagedPageNumber(2) - stage.stagedPageNumber(1)).toBe(1);
    expect(stage.isStagedLeaf(leaf(3))).toBe(true);
    expect(stage.leafNumberOf(leaf(3))).toBe(3);
    // An archived spread (-(n+1)) is not a staged leaf, and neither is a swapped-in leaf.
    expect(stage.isStagedLeaf({ page_number: -4, archived_spread: true })).toBe(false);
    expect(stage.isStagedLeaf({ ...leaf(3), page_number: 3 })).toBe(false);
  });

  it('translate-core reads a staged leaf, and still refuses an archived spread as soft-hidden', () => {
    const ocr = { data: '<page-type>text</page-type>\nIn principio erat verbum, et verbum erat apud Deum, et Deus erat verbum.' };
    expect(isTranslatablePage({ ...leaf(1), ocr }).ok).toBe(true);
    expect(isTranslatablePage({ page_number: -2, page_type: 'archived-spread', ocr })).toEqual({ ok: false, reason: 'soft-hidden' });
  });
});

describe('when a swap may happen (swapRefusal)', () => {
  const frameOcr = (k: number) => `spread ${k}`;
  const frames = [1, 2].map((k) => ({ id: `F${k}`, page_number: k, ocr: { data: frameOcr(k) } }));
  const leaf = (n: number, over: Record<string, unknown> = {}) => {
    const k = Math.ceil(n / 2);
    return {
      id: `L${n}`, page_number: stage.stagedPageNumber(n), page_type: 'text',
      staged_split: { run: 'r1', leaf: n, frame_id: `F${k}`, frame_ocr_hash: contentHash(frameOcr(k)) },
      ocr: { data: `<page-type>text</page-type>\nleaf ${n} has a sentence of words to translate here.` },
      translation: { data: `English of leaf ${n}` },
      ...over,
    };
  };
  const translatable = (l: { page_number: number }) => isTranslatablePage({ ...l, page_number: stage.leafNumberOf(l) });
  const ready = () => [1, 2, 3, 4].map((n) => leaf(n));

  it('passes when every leaf has OCR and English', () => {
    expect(stage.swapRefusal({ frames, leaves: ready(), translatable })).toBeNull();
  });

  it('does not wait for English on an English book (#5154: the lanes never write it)', () => {
    const noEn = ready().map((l) => ({ ...l, translation: undefined }));
    const english = stage.swapTranslatable({ book: { language: 'English' }, isTranslatablePage, sameLanguageReason });
    expect(stage.swapRefusal({ frames, leaves: noEn, translatable: english })).toBeNull();
    const latin = stage.swapTranslatable({ book: { language: 'Latin' }, isTranslatablePage, sameLanguageReason });
    expect(stage.swapRefusal({ frames, leaves: noEn, translatable: latin })).toMatch(/no English: 1, 2, 3, 4/);
  });

  it('refuses a leaf with no OCR, or with OCR and no English', () => {
    const noOcr = ready(); noOcr[1] = leaf(2, { ocr: undefined, translation: undefined });
    expect(stage.swapRefusal({ frames, leaves: noOcr, translatable })).toMatch(/no OCR: 2/);
    const noEn = ready(); noEn[3] = leaf(4, { translation: undefined });
    expect(stage.swapRefusal({ frames, leaves: noEn, translatable })).toMatch(/no English: 4/);
  });

  it('a blank leaf needs no English', () => {
    const blank = ready(); blank[2] = leaf(3, { page_type: 'blank', ocr: { data: '<page-type>blank</page-type>' }, translation: undefined });
    expect(stage.swapRefusal({ frames, leaves: blank, translatable })).toBeNull();
  });

  it('refuses when the live pages are not the staged frames, or a spread was re-read since the stage', () => {
    expect(stage.swapRefusal({ frames: [...frames, { id: 'F3', page_number: 3, ocr: { data: 'x' } }], leaves: ready(), translatable })).toMatch(/p\.3 .* no staged leaves/);
    expect(stage.swapRefusal({ frames: [frames[0]], leaves: ready(), translatable })).toMatch(/not a live page/);
    expect(stage.swapRefusal({ frames: [frames[0], { ...frames[1], ocr: { data: 'a new read' } }], leaves: ready(), translatable })).toMatch(/OCR changed/);
  });

  it('refuses a gap in the leaf numbers, two runs, or no leaves', () => {
    expect(stage.swapRefusal({ frames, leaves: ready().filter((l) => l.id !== 'L2'), translatable })).toMatch(/not 1\.\.3/);
    const two = ready(); two[0] = leaf(1, { staged_split: { ...leaf(1).staged_split, run: 'r2' } });
    expect(stage.swapRefusal({ frames, leaves: two, translatable })).toMatch(/2 runs/);
    expect(stage.swapRefusal({ frames, leaves: [], translatable })).toBe('no staged leaves');
  });

  it('a whole-frame leaf with the frame\'s own text keeps the frame\'s English; a cut leaf never does', () => {
    const frame = { id: 'F9', ocr: { data: '<split-position>500</split-position>\nCover A\n<page-break/>\nCover B' }, translation: { data: 'English of the cover', model: 'm' } };
    const whole = { id: 'L9', split_side: 'single', staged_split: { side: 'single' }, ocr: { data: 'Cover A\n\nCover B' } };
    expect(stage.carriedTranslation(whole, frame)).toMatchObject({ data: 'English of the cover', carried_from: { page_id: 'F9' } });
    expect(stage.carriedTranslation({ ...whole, ocr: { data: 'Cover A' } }, frame)).toBeNull();
    expect(stage.carriedTranslation({ ...whole, staged_split: { side: 'left' }, split_side: 'left' }, frame)).toBeNull();
    expect(stage.carriedTranslation({ ...whole, translation: { data: 'its own' } }, frame)).toBeNull();
  });

  it('names each spread\'s leaves in reading order, and sends an old page number to its spread\'s first leaf', () => {
    expect([...stage.splitIntoByFrame(ready())]).toEqual([['F1', ['L1', 'L2']], ['F2', ['L3', 'L4']]]);
    expect(stage.firstLeafByOldNumber(frames, ready()).get(2)).toBe('L3');
  });
});

describe('the script decoder agrees with the app\'s shortlink codes', () => {
  it('round-trips encodeShortlink for ObjectId books', () => {
    for (const [id, n] of [['6a2032ad18654bf8e1903546', 1], ['6a197ed682e9146694f9ef8a', 41], ['000000000000000000000001', 65535]] as const) {
      expect(decodeShortlinkCode(encodeShortlink(id, n))).toEqual({ bookId: id, pageNumber: n });
    }
    expect(decodeShortlinkCode('not-a-code!')).toBeNull();
    expect(decodeShortlinkCode('u0000000000000000000000000')).toBeNull();
  });
});

describe('/q/<code> follows a shortlink_redirects row (#7605)', () => {

  const go = async (code: string) => {
    const { GET } = await import('@/app/q/[code]/route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest(`https://sourcelibrary.org/q/${code}`), { params: Promise.resolve({ code }) });
    return res.headers.get('location');
  };

  it('a known pre-split code opens the old spread\'s first leaf; any other code resolves by page number as before', async () => {
    const code = encodeShortlink(BOOK, 3);
    redirects = [];
    expect(await go(code)).toBe('https://sourcelibrary.org/book/mystical-verses/page/leaf-3-now');
    redirects = [{ code, book_id: BOOK, page_id: 'leaf-5-first-of-old-spread-3' }];
    expect(await go(code)).toBe('https://sourcelibrary.org/book/mystical-verses/page/leaf-5-first-of-old-spread-3');
    // A row naming another book is ignored: the code itself says which book it is.
    redirects = [{ code, book_id: 'someone-else', page_id: 'x' }];
    expect(await go(code)).toBe('https://sourcelibrary.org/book/mystical-verses/page/leaf-3-now');
  });
});

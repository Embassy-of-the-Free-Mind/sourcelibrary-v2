import { describe, it, expect } from 'vitest';
import { buildCoverUpdate, resolvePageCoverUrl, COVER_WRITE_FIELDS, isRenderableCoverUrl, selectFallbackCoverPage, selectScoredCoverPage, isJunkRepresentativePage, COVER_SCORE_CONFIDENT } from '@/lib/cover-fields';

const SAMPLE_URL = 'https://images.sourcelibrary.org/cropped/abc/page-1.jpg';
const SAMPLE_THUMB = 'https://images.sourcelibrary.org/thumbnails/abc/page-1-thumb.jpg';

describe('resolvePageCoverUrl', () => {
  it('returns enhanced_photo when present and not split', () => {
    expect(resolvePageCoverUrl({ enhanced_photo: SAMPLE_URL, photo: 'http://other' } as any)).toBe(SAMPLE_URL);
  });

  it('uses photo for split-from-spread pages', () => {
    expect(resolvePageCoverUrl({ split_from_spread: true, photo: SAMPLE_URL, archived_photo: 'http://other' } as any)).toBe(SAMPLE_URL);
  });

  it('falls back through cropped > archived > photo_original > photo', () => {
    expect(resolvePageCoverUrl({ cropped_photo: SAMPLE_URL } as any)).toBe(SAMPLE_URL);
    expect(resolvePageCoverUrl({ archived_photo: SAMPLE_URL } as any)).toBe(SAMPLE_URL);
    expect(resolvePageCoverUrl({ photo_original: SAMPLE_URL } as any)).toBe(SAMPLE_URL);
    expect(resolvePageCoverUrl({ photo: SAMPLE_URL } as any)).toBe(SAMPLE_URL);
  });

  it('rejects relative or empty URLs', () => {
    expect(resolvePageCoverUrl({} as any)).toBeNull();
    expect(resolvePageCoverUrl({ photo: '/api/image?url=foo' } as any)).toBeNull();
  });
});

describe('buildCoverUpdate', () => {
  it('writes all four canonical fields plus dual-write legacy mirrors', () => {
    const update = buildCoverUpdate(
      { archived_photo: SAMPLE_URL, page_number: 5, thumbnail_blob: SAMPLE_THUMB } as any,
      { source: 'manual', actor: 'admin', method: 'cover-picker-ui' },
    );
    expect(update).not.toBeNull();
    expect(update!.image_display).toBe(SAMPLE_URL);
    expect(update!.thumbnail).toBe(SAMPLE_URL);
    expect(update!.image_thumb).toBe(SAMPLE_THUMB);
    expect(update!.thumbnail_blob).toBe(SAMPLE_THUMB);
    expect(update!.thumbnail_source).toBe('manual');
    expect(update!.cover_page).toBe(5);
    expect(update!.field_provenance?.thumbnail.method).toBe('cover-picker-ui');
  });

  it('uses display URL as thumb when page has no pre-generated thumb', () => {
    const update = buildCoverUpdate(
      { archived_photo: SAMPLE_URL, page_number: 1 } as any,
      { source: 'smart_ocr' },
    );
    expect(update!.image_thumb).toBe(SAMPLE_URL);
    expect(update!.thumbnail_blob).toBe(SAMPLE_URL);
  });

  it('returns null when page has no usable image', () => {
    expect(buildCoverUpdate({ page_number: 3 } as any, { source: 'manual' })).toBeNull();
  });

  it('omits cover_page when page has no page_number', () => {
    const update = buildCoverUpdate({ archived_photo: SAMPLE_URL } as any, { source: 'manual' });
    expect(update!.cover_page).toBeUndefined();
  });
});

describe('COVER_WRITE_FIELDS', () => {
  it('includes both legacy and canonical field names', () => {
    expect(COVER_WRITE_FIELDS).toContain('image_display');
    expect(COVER_WRITE_FIELDS).toContain('image_thumb');
    expect(COVER_WRITE_FIELDS).toContain('thumbnail');
    expect(COVER_WRITE_FIELDS).toContain('thumbnail_blob');
    expect(COVER_WRITE_FIELDS).toContain('thumbnail_source');
  });
});

describe('isRenderableCoverUrl', () => {
  it('accepts the hosts the site CSP allows', () => {
    expect(isRenderableCoverUrl('https://images.sourcelibrary.org/archived/abc/8.jpg')).toBe(true);
    expect(isRenderableCoverUrl('https://x.public.blob.vercel-storage.com/a.jpg')).toBe(true);
    expect(isRenderableCoverUrl('https://upload.wikimedia.org/wikipedia/commons/a.jpg')).toBe(true);
  });

  // The whole point of the gate: these load fine with curl but the browser
  // blocks them, so they must never be persisted as a cover.
  it('rejects un-rehosted source hosts and empty values', () => {
    expect(isRenderableCoverUrl('https://archive.org/download/abc/page1.jpg')).toBe(false);
    expect(isRenderableCoverUrl('https://gallica.bnf.fr/ark:/12148/f1.highres')).toBe(false);
    expect(isRenderableCoverUrl('https://dl.ndl.go.jp/api/iiif/123/full/full/0/default.jpg')).toBe(false);
    expect(isRenderableCoverUrl(null)).toBe(false);
    expect(isRenderableCoverUrl(undefined)).toBe(false);
    expect(isRenderableCoverUrl('')).toBe(false);
  });
});

describe('selectFallbackCoverPage', () => {
  const p = (page_number: number, page_type?: string) => ({ page_number, page_type });

  it('prefers a classified title page over anything earlier', () => {
    const pages = [p(0, 'color-card'), p(1, 'blank'), p(2, 'frontispiece'), p(3, 'title-page'), p(4, 'text')];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(3);
  });

  it('falls back to a frontispiece when there is no title page', () => {
    const pages = [p(0, 'blank'), p(1, 'frontispiece'), p(2, 'text')];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(1);
  });

  // The regression this exists to prevent: an un-curated scan opens with the
  // digitizer's colour chart, which used to become the book's cover.
  it('skips scanner junk and blanks when nothing is classified', () => {
    const pages = [p(0, 'color-card'), p(1, 'scanner_metadata'), p(2, 'blank'), p(3, 'text')];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(3);
  });

  it('keeps cover/frontcover leaves eligible — they are good covers, not junk', () => {
    const pages = [p(0, 'frontcover'), p(1, 'text')];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(0);
  });

  it('returns the first page rather than nothing when every leaf is junk', () => {
    const pages = [p(0, 'color-card'), p(1, 'blank')];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(0);
  });

  it('returns undefined for an empty book', () => {
    expect(selectFallbackCoverPage([])).toBeUndefined();
  });
});

describe('isJunkRepresentativePage', () => {
  // The exact leaf that shipped as the About image on
  // /book/indian-home-rule-hind-swaraj-gandhi. Note page_type is `frontispiece`
  // — a type the selectors PREFER — so only the OCR text can catch it.
  const IA_PLATE = {
    page_type: 'frontispiece',
    ocr_head: '<scan-quality>good</scan-quality> <language>English</language> <script>printed</script>'
      + ' <page-type>frontispiece</page-type> <warning>This is a modern digital insertion page from the'
      + ' Internet Archive, not an original historical manuscript page. Digitized by the Internet Archive'
      + ' in 2008 with funding from Microsoft Corporation</warning>',
  };

  it('rejects the Internet Archive digitisation plate despite a preferred page_type', () => {
    expect(isJunkRepresentativePage(IA_PLATE)).toBe(true);
  });

  it('rejects Google Books boilerplate', () => {
    expect(isJunkRepresentativePage({ page_type: 'text', ocr_head: 'This is a digital copy of a book preserved on library shelves' })).toBe(true);
  });

  // THE TRAP. Google-scanned books carry a `Digitized by Google` watermark on
  // every leaf, so a broad /digitized by/ rule silently disqualifies the real
  // title page of every Google-digitised book. Verified against
  // untersuchungen-uber-die-brandpilze… p5, whose OCR genuinely opens this way.
  it('does NOT reject a real page merely carrying a digitisation watermark', () => {
    expect(isJunkRepresentativePage({
      page_type: 'title-page',
      ocr_head: '<meta>Digitized by Google</meta> # UNTERSUCHUNGEN ÜBER DIE BRANDPILZE und die durch sie verursachten Krankheiten der Pflanzen. Von ANTON DE BARY.',
    })).toBe(false);
    expect(isJunkRepresentativePage({ page_type: 'text', ocr_head: '<meta>Digitized by Google</meta> the mycelium penetrates the host tissue' })).toBe(false);
  });

  // A photograph of the outside of the book: an object, not the work.
  it('rejects binding and cover-board shots', () => {
    for (const head of [
      'Handwritten library shelfmark on a modern adhesive label. The page is a book cover or binding.',
      'A marbled or textured brown book cover with a dark leather spine',
      'This image shows the front cover of a leather-bound book',
      'An ornate 17th-century red morocco binding with gold-tooled borders',
      'The exterior cover of the volume, vellum boards, showing wear',
    ]) {
      expect(isJunkRepresentativePage({ page_type: 'frontispiece', ocr_head: head })).toBe(true);
    }
  });

  // This corpus is full of anatomy and medicine — `spine` in body prose is real
  // content, not a binding shot.
  it('does not treat anatomical prose as a binding shot', () => {
    expect(isJunkRepresentativePage({ page_type: 'text', ocr_head: 'the spine consists of twenty-four articulating vertebrae' })).toBe(false);
  });

  it('rejects owner and library provenance marks', () => {
    for (const head of [
      'Armorial book plate of the Earl of Pembroke',
      'Ex libris Johannis Dee',
      'The Ramakrishna Mission Institute of Culture Library Presented by',
      'Handwritten library shelfmark on a modern adhesive label',
      'library identification labels and a modern barcode',
      'accession number 90819 stamped in violet ink',
      'A colour card and calibration target placed beside the gutter',
    ]) {
      expect(isJunkRepresentativePage({ page_type: 'text', ocr_head: head })).toBe(true);
    }
  });

  it('rejects junk page types even with no OCR at all', () => {
    expect(isJunkRepresentativePage({ page_type: 'digitizer-insert' })).toBe(true);
    expect(isJunkRepresentativePage({ page_type: 'color-card', ocr_head: null })).toBe(true);
  });

  it('keeps real content pages, including ones that merely mention a library', () => {
    expect(isJunkRepresentativePage({ page_type: 'text', ocr_head: '# INDIAN HOME RULE. But, as you have asked the question, it is my duty to answer' })).toBe(false);
    expect(isJunkRepresentativePage({ page_type: 'title-page', ocr_head: '<vocab>Indian Home Rule, M. K. Gandhi</vocab> # INDIAN HOME RULE' })).toBe(false);
    expect(isJunkRepresentativePage({ page_type: 'plate', ocr_head: 'An engraved plate showing the alchemical furnace' })).toBe(false);
  });

  it('is a no-op when OCR has not run — type is then the only signal', () => {
    expect(isJunkRepresentativePage({ page_type: 'text' })).toBe(false);
    expect(isJunkRepresentativePage({})).toBe(false);
  });
});

describe('selectFallbackCoverPage — digitiser plates', () => {
  it('never returns a mistyped digitiser plate, even though frontispiece is preferred', () => {
    const pages = [
      { page_number: 1, page_type: 'blank' },
      { page_number: 2, page_type: 'frontispiece', ocr_head: '<warning>This is a modern digital insertion page from the Internet Archive</warning> Digitized by the Internet Archive in 2008 with funding from Microsoft Corporation' },
      { page_number: 5, page_type: 'title-page', ocr_head: '# INDIAN HOME RULE' },
    ];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(5);
  });

  it('skips the plate and falls to real content when there is no title page', () => {
    const pages = [
      { page_number: 2, page_type: 'frontispiece', ocr_head: 'Digitized by the Internet Archive in 2008 with funding from Microsoft Corporation' },
      { page_number: 9, page_type: 'text', ocr_head: 'the argument of the present treatise' },
    ];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(9);
  });
});

describe('isJunkRepresentativePage — scanner hand in frame', () => {
  it('rejects pages whose OCR describes a hand holding the book', () => {
    for (const head of [
      'A gloved hand is visible at the bottom edge of the page',
      "The scanner's hand holding the volume open",
      'fingers are visible along the left margin of the photograph',
    ]) {
      expect(isJunkRepresentativePage({ page_type: 'text', ocr_head: head })).toBe(true);
    }
  });

  it('keeps hand-colored plates and handwriting notes', () => {
    expect(isJunkRepresentativePage({ page_type: 'plate', ocr_head: 'A hand-colored woodcut of the celestial spheres' })).toBe(false);
    expect(isJunkRepresentativePage({ page_type: 'text', ocr_head: 'Handwriting in the lower margin records a former owner' })).toBe(false);
  });
});

describe('selectScoredCoverPage', () => {
  it('uses the OCR scorer when it can decide: a real title page beats an earlier first leaf', () => {
    const pages = [
      { page_number: 1, ocr_head: 'Some faint unclassified text.' },
      { page_number: 3, page_type: 'title-page', ocr_head: 'DE PROVIDENTIA ET FATO typis excudebat, ornamental border' },
    ];
    const pick = selectScoredCoverPage(pages, 'De providentia et fato');
    expect(pick?.page.page_number).toBe(3);
    expect(pick?.method).toBe('smart-ocr');
    expect(pick?.score).toBeGreaterThanOrEqual(COVER_SCORE_CONFIDENT);
  });

  it('never scores a hand-in-frame or blank page as the cover', () => {
    const pages = [
      { page_number: 1, ocr_head: 'A gloved hand is visible at the edge, holding the book' },
      { page_number: 2, ocr_head: 'This page is blank, aged paper.' },
      { page_number: 4, page_type: 'frontispiece', ocr_head: 'An allegorical engraved portrait of the author' },
    ];
    const pick = selectScoredCoverPage(pages);
    expect(pick?.page.page_number).toBe(4);
    expect(pick?.method).toBe('smart-ocr');
  });

  it('falls back to the type-priority rule when nothing scores confidently (no OCR yet)', () => {
    // A typed title page still clears the bar without OCR — the genuinely
    // undecidable case is NO types and NO OCR.
    const typed = selectScoredCoverPage([{ page_number: 1 }, { page_number: 2, page_type: 'title-page' }]);
    expect(typed?.page.page_number).toBe(2);

    const untyped = selectScoredCoverPage([{ page_number: 1 }, { page_number: 2 }]);
    expect(untyped?.method).toBe('type-priority');
    expect(untyped?.page.page_number).toBe(1);
    expect(untyped?.score).toBeNull();
  });

  it('returns undefined on an empty page list', () => {
    expect(selectScoredCoverPage([])).toBeUndefined();
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * The unread e-rara re-cut plan (scripts/lib/erara-recut-plan.mjs, v3#466). The refusals are the shapes met in the
 * 2026-11-17 census: a book the first-read lane has started, a page carrying a frame or a printed page number, a book
 * archived by two writers, a book whose text was moved before.
 */
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
// @ts-ignore -- plain .mjs
import { unreadRecutRefusal, coverAfterRecut, UNREAD_PAGE_KEYS, BOOK_IMAGE_DERIVED_UNSET } from '../../scripts/lib/erara-recut-plan.mjs';

const page = (n: number, extra: any = {}) => ({
  _id: `o${n}`, id: `p${n}`, book_id: 'b', page_number: n, created_at: new Date(0), updated_at: new Date(0),
  photo: `https://www.e-rara.ch/i3f/v21/${100 + n}/full/1000,/0/default.jpg`, photo_original: `https://www.e-rara.ch/i3f/v21/${100 + n}/full/1000,/0/default.jpg`,
  thumbnail: `https://www.e-rara.ch/i3f/v21/${100 + n}/full/200,/0/default.jpg`,
  archived_photo: `https://images.sourcelibrary.org/archived/b/${n}.jpg`, display_photo: `https://images.sourcelibrary.org/pages/b/${String(n).padStart(4, '0')}.jpg`,
  thumbnail_blob: `https://images.sourcelibrary.org/pages/b/${String(n).padStart(4, '0')}-thumb.jpg`,
  archive_metadata: { source: 'erara_pdf', archived_at: new Date(0), bytes: 1 }, image_width: 10, image_height: 10, ...extra,
});
const pages = (n: number, over: Record<number, any> = {}) => Array.from({ length: n }, (_, i) => page(i + 1, over[i + 1]));
const book = (extra: any = {}) => ({ id: 'b', pages_ocr: 0, pages_translated: 0, ...extra });

describe('unreadRecutRefusal', () => {
  it('passes a book that carries nothing but identity and image pointers', () => {
    expect(unreadRecutRefusal({ book: book(), pages: pages(20) })).toBeNull();
  });
  it('refuses a book the lane has started to read', () => {
    expect(unreadRecutRefusal({ book: book(), pages: pages(20, { 3: { ocr: { model: 'x' } } }) })).toMatch(/page 3 carries ocr/);
    expect(unreadRecutRefusal({ book: book({ pages_ocr: 39 }), pages: pages(20) })).toMatch(/39 transcribed/);
  });
  it.each(['page_frame', 'printed_page', 'detected_images', 'script_type', 'page_type', 'translation', 'a_field_added_next_month'])('refuses a page carrying %s', (k) => {
    expect(unreadRecutRefusal({ book: book(), pages: pages(20, { 7: { [k]: 1 } }) })).toMatch(new RegExp(`page 7 carries ${k}`));
  });
  it('refuses a book archived by two writers, or already on the corrected mapping', () => {
    expect(unreadRecutRefusal({ book: book(), pages: pages(20, { 5: { archive_metadata: { source: 'uva_iiif' } } }) })).toMatch(/page 5 was not archived from the e-rara PDF/);
    expect(unreadRecutRefusal({ book: book(), pages: pages(20, { 5: { archive_metadata: { source: 'erara_pdf', pdf_leaf_offset: 1 } } }) })).toMatch(/pdf_leaf_offset/);
  });
  it('refuses gaps, hidden rows and a page with no canvas', () => {
    expect(unreadRecutRefusal({ book: book(), pages: pages(20).filter((p) => p.page_number !== 9) })).toMatch(/not 1\.\.19 without gaps/);
    expect(unreadRecutRefusal({ book: book(), pages: [page(-1), ...pages(5)] })).toMatch(/without gaps/);
    expect(unreadRecutRefusal({ book: book(), pages: pages(20, { 2: { photo: 'https://example.org/x.jpg', photo_original: undefined } }) })).toMatch(/no e-rara IIIF canvas/);
  });
  it('refuses a repaired book, a book with text-made fields, and a book whose text was moved', () => {
    expect(unreadRecutRefusal({ book: book({ archive_metadata: { jp2_offset_repaired: true } }), pages: pages(20) })).toMatch(/already repaired/);
    expect(unreadRecutRefusal({ book: book({ chapters: [{ title: 'I' }] }), pages: pages(20) })).toMatch(/chapters/);
    expect(unreadRecutRefusal({ book: book({ chapters: [] }), pages: pages(20) })).toBeNull();
    expect(unreadRecutRefusal({ book: book(), pages: pages(20), events: [{ type: 'text_shift_repair' }] })).toMatch(/text-move event/);
  });
  it('the allowed keys hold no text and nothing measured from a leaf', () => {
    for (const k of ['ocr', 'translation', 'page_type', 'script_type', 'page_frame', 'printed_page', 'detected_images', 'columns']) expect(UNREAD_PAGE_KEYS.has(k)).toBe(false);
  });
});

describe('coverAfterRecut', () => {
  it('moves a cover that is one of the book\'s page images one row earlier', () => {
    const ps = pages(20);
    const c = coverAfterRecut({ thumbnail: ps[6].archived_photo }, ps);
    expect(c).toMatchObject({ from: 7, to: 6 });
    expect(c.page.page_number).toBe(6);
  });
  it('matches a display or thumb variant, with or without a version query', () => {
    const ps = pages(20);
    expect(coverAfterRecut({ thumbnail: `${ps[3].display_photo}?v=3` }, ps)).toMatchObject({ from: 4, to: 3 });
    expect(coverAfterRecut({ thumbnail: ps[3].thumbnail_blob }, ps)).toMatchObject({ from: 4, to: 3 });
  });
  it('a cover on row 1 (the e-rara sheet) stays on row 1, which becomes leaf 1', () => {
    const ps = pages(20);
    expect(coverAfterRecut({ thumbnail: ps[0].archived_photo }, ps)).toMatchObject({ from: 1, to: 1 });
  });
  it('leaves a cover that is not one of this book\'s page images alone', () => {
    expect(coverAfterRecut({ thumbnail: 'https://www.e-rara.ch/i3f/v21/101/full/200,/0/default.jpg' }, pages(20))).toBeNull();
    expect(coverAfterRecut({}, pages(20))).toBeNull();
  });
});

describe('the tools that use the plan', () => {
  const tool = fs.readFileSync('scripts/maintenance/repair-bulk-jp2-offset.mjs', 'utf8');
  const driver = fs.readFileSync('scripts/maintenance/erara-recut-466.mjs', 'utf8');
  it('the image tool re-cuts an unread book only through unreadRecutRefusal, and only when every sample is shifted', () => {
    expect(tool).toContain("const why = unreadRecutRefusal({ book: wholeBook, pages: whole, events });");
    expect(tool).toContain('if (v.shift !== v.checked)');
    expect(tool).toContain("if (!UNREAD) return console.log('  [REFUSE] no pre-archival pages");
  });
  it('the driver stops at the first book that does not verify', () => {
    expect(driver).toMatch(/outcome: 'STOPPED'[\s\S]{0,200}stopped = true;\s*break;/);
  });
  it('the driver has no unpurged apply', () => {
    expect(driver).toContain("if (APPLY && NO_PURGE) { console.error('[REFUSE] --apply with --no-purge");
  });
  it('fields cleared after a re-cut are known book fields', () => {
    const known = new Set(JSON.stringify(JSON.parse(fs.readFileSync('scripts/lib/books-known-fields.json', 'utf8'))).match(/"[a-z_0-9]+"/g)!.map((s) => s.slice(1, -1)));
    for (const f of BOOK_IMAGE_DERIVED_UNSET) expect(known.has(f)).toBe(true);
  });
});

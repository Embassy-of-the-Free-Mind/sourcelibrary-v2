/**
 * The read side of book_checks (#6174, src/lib/book-checks.ts).
 *
 * What these pin: the latest row per method is the newest one, never an older verdict; and a check is STALE as soon
 * as the text it read has been rewritten — the verdict described other text, so it must not be carried over onto
 * the new text silently. A page record that is gone is stale too.
 */
import { describe, it, expect } from 'vitest';
import { latestPerMethod, stalePages, type BookCheck, type PageTextStamp } from '@/lib/book-checks';

const row = (over: Partial<BookCheck> = {}): BookCheck => ({
  book_id: 'b1', checked_at: new Date('2026-10-07T10:00:00Z'), method_id: 'shelf-overview', method_version: '1', run_id: 'r1',
  pages_read: [7, 8], reader: { kind: 'model', model: 'opus', image_opened: true }, verdict: 'caveat',
  evidence_path: 'x.json',
  text_provenance: [
    { page_number: 7, ocr_model: 'm', translation_model: 'm', ocr_updated_at: '2026-05-01T00:00:00Z', translation_updated_at: '2026-05-02T00:00:00Z' },
    { page_number: 8, ocr_model: 'm', translation_model: 'm' },
  ],
  ...over,
});

const pages = (entries: [number, PageTextStamp][]) => new Map(entries);

describe('latestPerMethod', () => {
  it('keeps the first (newest) row of each method from a newest-first list', () => {
    const a = row({ run_id: 'new', verdict: 'fix' });
    const b = row({ run_id: 'old', verdict: 'show' });
    const c = row({ method_id: 'curation-check', run_id: 'cur' });
    const l = latestPerMethod([a, c, b]);
    expect(l['shelf-overview'].run_id).toBe('new');
    expect(l['curation-check'].run_id).toBe('cur');
  });
});

describe('stalePages', () => {
  const unchanged: [number, PageTextStamp][] = [
    [7, { page_number: 7, ocr: { updated_at: '2026-05-01T00:00:00Z' }, translation: { updated_at: '2026-05-02T00:00:00Z' } }],
    [8, { page_number: 8, ocr: { updated_at: '2026-04-01T00:00:00Z' }, translation: { updated_at: '2026-04-01T00:00:00Z' } }],
  ];

  it('is empty while the text is what the check read', () => {
    expect(stalePages(row(), pages(unchanged))).toEqual([]);
  });

  it('flags a page re-OCRed after the recorded stamp', () => {
    const p = pages(unchanged);
    p.set(7, { page_number: 7, ocr: { updated_at: '2026-06-01T00:00:00Z' }, translation: { updated_at: '2026-05-02T00:00:00Z' } });
    expect(stalePages(row(), p)).toEqual([7]);
  });

  it('with no stamp, compares against checked_at', () => {
    const p = pages(unchanged);
    p.set(8, { page_number: 8, ocr: { updated_at: '2026-10-08T00:00:00Z' } });
    expect(stalePages(row(), p)).toEqual([8]);
  });

  it('flags a page the row already marked changed, and a page that no longer exists', () => {
    const r = row();
    r.text_provenance[0].changed_since_check = true;
    expect(stalePages(r, pages([unchanged[0]]))).toEqual([7, 8]);
  });
});

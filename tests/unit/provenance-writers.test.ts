import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
// @ts-expect-error untyped .mjs
import { findUnmarkedWriters } from '../../scripts/audit/provenance-writers.mjs';
// @ts-expect-error untyped .mjs
import { displayKeyFor, markDisplay } from '../../scripts/workers/lib/display-image.mjs';
// @ts-expect-error untyped .mjs
import { detectWatermark } from '../../scripts/lib/provenance-mark.mjs';
// @ts-expect-error untyped .mjs
import { ledgerKey, newLedger, ledgerPageFields, openLedger } from '../../scripts/lib/manifest-ledger.mjs';

const BOOK = '6ac50fec0749a01cb8199437';

describe('page images are marked when written (#4406)', () => {
  it('no script writes a display-shaped key outside the shared marking path', () => {
    expect(findUnmarkedWriters()).toEqual([]);
  });

  it('markDisplay leaves a mark the detector finds, and the input buffer alone', async () => {
    vi.stubEnv('PROVENANCE_SECRET_KEY', 'test-key');
    const noise = Buffer.alloc(1200 * 1600 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const clean = await sharp(noise, { raw: { width: 1200, height: 1600, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
    const before = Buffer.from(clean);
    const marked = await markDisplay(clean, { bookId: BOOK, pageNumber: 1 });
    expect(clean.equals(before)).toBe(true);
    expect((await detectWatermark(marked, { editionId: BOOK, key: 'test-key' })).present).toBe(true);
    expect((await detectWatermark(clean, { editionId: BOOK, key: 'test-key' })).present).toBe(false);
  });
});

describe('a master is never the display object (#4406)', () => {
  const url = (k: string) => `https://images.sourcelibrary.org/${k}`;

  it('sends the display to a sibling key when the canonical key holds the master', () => {
    const page = { book_id: BOOK, page_number: 7, archived_photo: url(`pages/${BOOK}/0007.jpg`) };
    expect(displayKeyFor(page)).toEqual({ key: `pages/${BOOK}/0007-marked.jpg`, canonicalHoldsMaster: true });
  });

  it('uses the canonical key when the master is under archived/', () => {
    const page = { book_id: BOOK, page_number: 7, archived_photo: url(`archived/${BOOK}/7.jpg`) };
    expect(displayKeyFor(page)).toEqual({ key: `pages/${BOOK}/0007.jpg`, canonicalHoldsMaster: false });
  });

  it('reads photo at the canonical key as the clean copy only when there is no archived_photo', () => {
    const photo = url(`pages/${BOOK}/0007.jpg`);
    expect(displayKeyFor({ book_id: BOOK, page_number: 7, photo }).canonicalHoldsMaster).toBe(true);
    expect(displayKeyFor({ book_id: BOOK, page_number: 7, photo, archived_photo: url(`pages/${BOOK}/0007-full.jpg`) }).canonicalHoldsMaster).toBe(false);
  });

  it('new ledgers hold masters under archived/; old ledgers keep the key their bytes are at', () => {
    const fresh = newLedger({ photos: ['https://x/1.jpg'], base: 'https://images.sourcelibrary.org' });
    expect(ledgerKey(BOOK, 1, fresh.layout)).toBe(`archived/${BOOK}/1.jpg`);
    expect(ledgerKey(BOOK, 1, undefined)).toBe(`pages/${BOOK}/0001.jpg`);
    const view = openLedger(fresh);
    view.markDone(1, { width: 10, height: 10, bytes: 1 });
    const stored = view.encode({ base: 'https://images.sourcelibrary.org' });
    expect(ledgerPageFields(stored, openLedger(stored), BOOK, 1)?.archived_photo).toBe(url(`archived/${BOOK}/1.jpg`));
  });
});

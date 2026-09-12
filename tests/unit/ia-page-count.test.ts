import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { iaPageCount } from '../../scripts/lib/ia-page-count.mjs';

/**
 * The case this guards, from 2026-09-07: al-Maqrizi's Khitat (MIFAO 30/33) was set
 * aside as "PDF-only" because IA reported no `imagecount` and its page images live
 * inside a Single Page Processed JP2 ZIP. It has 207 canvases.
 */
const MAQRIZI_METADATA = {
  metadata: { identifier: 'MIFAO30', title: 'MIFAO 30 Maqrīzī - El-mawâ\'iz wa\'l-i\'tibâr' },
  files: [
    { name: 'MIFAO30.pdf', format: 'Text PDF' },
    { name: 'MIFAO30_jp2.zip', format: 'Single Page Processed JP2 ZIP' },
    { name: 'MIFAO30_djvu.txt', format: 'DjVuTXT' },
    { name: '__ia_thumb.jpg', format: 'Item Tile' },
  ],
};

const manifestFetch = (canvases: number, version: 3 | 2 = 3) => async (url: string) => {
  if (version === 3 && !url.includes('/iiif/3/')) return { ok: false } as any;
  if (version === 2 && url.includes('/iiif/3/')) return { ok: false } as any;
  return {
    ok: true,
    json: async () =>
      version === 3
        ? { items: Array.from({ length: canvases }, (_, i) => ({ id: `c${i}` })) }
        : { sequences: [{ canvases: Array.from({ length: canvases }, (_, i) => ({ id: `c${i}` })) }] },
  } as any;
};

describe('iaPageCount', () => {
  it('counts IIIF canvases when imagecount is absent and images are zipped (the Maqrizi case)', async () => {
    const r = await iaPageCount('MIFAO30', { metadata: MAQRIZI_METADATA, fetchImpl: manifestFetch(207) });
    expect(r).toEqual({ pages: 207, source: 'iiif_v3' });
  });

  it('NEGATIVE CONTROL: without the IIIF step the same item reads as an empty book', async () => {
    // Simulate the bug: no manifest reachable, so we fall through to metadata alone.
    const deadManifest = async () => ({ ok: false }) as any;
    const r = await iaPageCount('MIFAO30', { metadata: MAQRIZI_METADATA, fetchImpl: deadManifest });
    // 0, NOT 1 — the lone _jp2.zip must never be counted as a page. A caller seeing 0
    // knows it failed; a caller seeing 1 believes it has a one-page book.
    expect(r.pages).toBe(0);
    expect(r.source).toBe('none');
  });

  it('falls back to imagecount when there is no manifest', async () => {
    const meta = { metadata: { imagecount: '794' }, files: [] };
    const r = await iaPageCount('egyptiansdni01budguoft', { metadata: meta, fetchImpl: async () => ({ ok: false }) as any });
    expect(r).toEqual({ pages: 794, source: 'imagecount' });
  });

  it('supports IIIF v2 manifests', async () => {
    const r = await iaPageCount('old-item', { metadata: MAQRIZI_METADATA, fetchImpl: manifestFetch(141, 2) });
    expect(r).toEqual({ pages: 141, source: 'iiif_v2' });
  });

  it('counts loose .jp2 pages, excluding thumbnails, and never a single one', async () => {
    const loose = {
      metadata: {},
      files: [
        { name: 'p0001.jp2' }, { name: 'p0002.jp2' }, { name: 'p0003.jp2' },
        { name: 'thumb_p0001.jp2' },
      ],
    };
    const r = await iaPageCount('loose', { metadata: loose, fetchImpl: async () => ({ ok: false }) as any });
    expect(r).toEqual({ pages: 3, source: 'jp2_files' });

    const single = { metadata: {}, files: [{ name: 'container.jp2' }] };
    const one = await iaPageCount('single', { metadata: single, fetchImpl: async () => ({ ok: false }) as any });
    expect(one.pages).toBe(0);
  });

  it('an explicit override wins over the manifest (unlike the route, see module header)', async () => {
    const r = await iaPageCount('MIFAO30', { metadata: MAQRIZI_METADATA, manual: 12, fetchImpl: manifestFetch(207) });
    expect(r).toEqual({ pages: 12, source: 'manual' });
  });

  it('a dead manifest endpoint does not throw', async () => {
    const boom = async () => { throw new Error('ECONNRESET'); };
    const r = await iaPageCount('x', { metadata: { metadata: { imagecount: '5' }, files: [] }, fetchImpl: boom });
    expect(r).toEqual({ pages: 5, source: 'imagecount' });
  });
});

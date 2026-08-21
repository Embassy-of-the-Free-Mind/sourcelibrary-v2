import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script module, no types
import { fetchAccessLeaves, indexJp2FilesByLeaf } from '../../scripts/lib/ia-access-leaves.mjs';

/**
 * Pins the IIIF-leaf -> jp2-zip-ordinal mapping that #3368 turned on.
 *
 * IA excludes calibration/deleted leaves from the access derivatives but keeps
 * them in *_jp2.zip, so `/page/nN` and the zip ordinal are different sequences.
 * Assuming they were the same archived every page its neighbour's scan.
 */

const xml = (pages: string) => `<?xml version="1.0"?><book>${pages}</book>`;
const page = (leaf: number, type: string, add?: string) =>
  `<page leafNum="${leaf}"><pageType>${type}</pageType>${add ? `<addToAccessFormats>${add}</addToAccessFormats>` : ''}</page>`;

function mockFetch(body: string, { ok = true } = {}) {
  return async () => ({ ok, text: async () => body }) as unknown as Response;
}

describe('fetchAccessLeaves', () => {
  it('skips a leading Color Card, so IIIF n0 maps to zip leaf 1', async () => {
    // The exact shape of b30324828 (Pseudodoxia), the reported book.
    const body = xml([
      page(0, 'Color Card', 'false'),
      page(1, 'Cover'),
      page(2, 'Normal'),
      page(3, 'Normal'),
    ].join(''));
    const leaves = await fetchAccessLeaves('x', { fetchImpl: mockFetch(body) });
    expect(leaves).toEqual([1, 2, 3]);
    // The defect, stated as an assertion: IIIF n0 is zip leaf 1, not 0.
    expect(leaves![0]).toBe(1);
  });

  it('treats an item with no excluded leaves as an identity mapping', async () => {
    const body = xml([page(0, 'Cover'), page(1, 'Normal'), page(2, 'Normal')].join(''));
    const leaves = await fetchAccessLeaves('x', { fetchImpl: mockFetch(body) });
    expect(leaves).toEqual([0, 1, 2]);
  });

  it('excludes Delete leaves as well as cards', async () => {
    const body = xml([
      page(0, 'Delete'),
      page(1, 'Normal'),
      page(2, 'White Card', 'false'),
      page(3, 'Normal'),
    ].join(''));
    expect(await fetchAccessLeaves('x', { fetchImpl: mockFetch(body) })).toEqual([1, 3]);
  });

  it('keeps tail-only exclusions from shifting earlier pages', async () => {
    // Cards shot at the end are the common case and must be harmless.
    const body = xml([
      page(0, 'Cover'), page(1, 'Normal'), page(2, 'Normal'), page(3, 'Color Card', 'false'),
    ].join(''));
    const leaves = await fetchAccessLeaves('x', { fetchImpl: mockFetch(body) });
    expect(leaves!.slice(0, 3)).toEqual([0, 1, 2]);
  });

  it('parses the scandata.json shape when the XML is absent', async () => {
    const json = JSON.stringify({
      pageData: { page: {
        0: { pageType: 'Color Card', addToAccessFormats: 'false', leafNum: 0 },
        1: { pageType: 'Normal', leafNum: 1 },
        2: { pageType: 'Normal', leafNum: 2 },
      } },
    });
    let call = 0;
    const fetchImpl = (async () => {
      call++;
      return call === 1
        ? { ok: false, text: async () => '' }        // no _scandata.xml
        : { ok: true, text: async () => json };      // falls through to scandata.json
    }) as unknown as typeof fetch;
    expect(await fetchAccessLeaves('x', { fetchImpl })).toEqual([1, 2]);
  });

  it('returns null when no scandata is parseable, so callers must verify', async () => {
    const fetchImpl = (async () => ({ ok: false, text: async () => '' })) as unknown as typeof fetch;
    expect(await fetchAccessLeaves('x', { fetchImpl })).toBeNull();
  });

  it('never throws the caller out on a network error', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect(await fetchAccessLeaves('x', { fetchImpl })).toBeNull();
  });
});

describe('indexJp2FilesByLeaf', () => {
  it('keys files by the ordinal in the filename, not list position', () => {
    // A sparse zip: positional indexing would shift everything after the gap.
    const map = indexJp2FilesByLeaf([
      '/t/b_jp2/b_0000.jp2', '/t/b_jp2/b_0001.jp2', '/t/b_jp2/b_0003.jp2',
    ]);
    expect(map.get(0)).toBe('/t/b_jp2/b_0000.jp2');
    expect(map.get(3)).toBe('/t/b_jp2/b_0003.jp2');
    expect(map.get(2)).toBeUndefined();
  });

  it('ignores non-jp2 entries', () => {
    expect(indexJp2FilesByLeaf(['/t/notes.txt']).size).toBe(0);
  });
});

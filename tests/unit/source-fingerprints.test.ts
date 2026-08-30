import { describe, it, expect } from 'vitest';
import {
  sourceFingerprint,
  sourceFingerprints,
  deriveSourceIdentifiers,
  normalizeSourceUrl,
  sourceSubrange,
  dcIdentifiers,
} from '@/lib/dedup';
import * as twin from '../../scripts/lib/source-fingerprints.mjs';

/**
 * Tier 1 of the import dedupe is the tier that *cannot be wrong*: it decides
 * "this is literally the same digital object". These tests pin the two ways it
 * has been wrong.
 *
 * UNDER-matching (why the set exists): one priority-chosen string meant the SAME
 * Internet Archive object arrived as `ia:<id>` through one route and as
 * `iiif:…/manifest.json` through another, and tier 1 saw two different books.
 *
 * OVER-matching (why the exclusions are load-bearing): every widening tried
 * against the live corpus first, and three plausible rules merged thousands of
 * distinct books. Those three are pinned here as negative tests so a future
 * "improvement" that reinstates them fails loudly instead of quietly declining
 * to acquire volume 2 of everything.
 */

const IA_MANIFEST = 'https://iiif.archive.org/iiif/cosmographia00ptol/manifest.json';
const IA_MANIFEST_V3 = 'https://iiif.archive.org/iiif/3/cosmographia00ptol/manifest.json';
const IA_DETAILS = 'https://archive.org/details/cosmographia00ptol';

describe('sourceFingerprints — the cross-form catch', () => {
  it('gives the same key to one IA object however it was addressed', () => {
    const viaId = sourceFingerprints({ ia_identifier: 'cosmographia00ptol' });
    const viaManifest = sourceFingerprints({ image_source: { provider: 'iiif', iiif_manifest: IA_MANIFEST } });
    const viaV3 = sourceFingerprints({ image_source: { provider: 'iiif', iiif_manifest: IA_MANIFEST_V3 } });
    const viaDetails = sourceFingerprints({ image_source: { provider: 'internet_archive', source_url: IA_DETAILS } });
    for (const other of [viaManifest, viaV3, viaDetails]) {
      expect(other).toContain('ia:cosmographia00ptol');
      expect(viaId.some((f) => other.includes(f))).toBe(true);
    }
  });

  it('does not mistake the IIIF version segment for the identifier', () => {
    // `/iiif/3/<id>/manifest.json`: a naive `/iiif/([^/]+)/` rule captured "3"
    // and put 5,831 unrelated books into one duplicate group.
    expect(deriveSourceIdentifiers(IA_MANIFEST_V3)).toEqual(['ia:cosmographia00ptol']);
    expect(deriveSourceIdentifiers(IA_MANIFEST_V3)).not.toContain('ia:3');
  });

  it('collapses trivially different spellings of one manifest URL', () => {
    expect(normalizeSourceUrl('https://www.e-rara.ch/i3f/v20/1139486/manifest.json'))
      .toBe(normalizeSourceUrl('http://e-rara.ch/i3f/v20/1139486/manifest/'));
  });

  it('recovers a bsb id from any MDZ URL form', () => {
    expect(deriveSourceIdentifiers('https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10192557/manifest'))
      .toContain('mdz:bsb10192557');
    expect(deriveSourceIdentifiers('https://www.digitale-sammlungen.de/de/view/bsb10192557'))
      .toContain('mdz:bsb10192557');
  });

  it('recovers a Gallica ark and a Göttingen/SBB PPN', () => {
    expect(deriveSourceIdentifiers('https://gallica.bnf.fr/ark:/12148/bpt6k1234567/f1.image'))
      .toContain('gallica:ark:/12148/bpt6k1234567');
    expect(deriveSourceIdentifiers('https://content.staatsbibliothek-berlin.de/dc/PPN1042281858/manifest'))
      .toContain('ppn:PPN1042281858');
  });
});

describe('sourceFingerprints — what must NOT be in the set', () => {
  it('never keys on a catalogue number shared by every volume of a serial', () => {
    // LCCN / OCLC identify a bibliographic RECORD, not a scan. Including them
    // merged 56,324 docs in the dry run — every volume of The Century
    // Illustrated Monthly Magazine shares `LCCN:412667`.
    const vol1 = sourceFingerprints({
      ia_identifier: 'centuryillustrat01newyuoft',
      dublin_core: { dc_identifier: ['IA:centuryillustrat01newyuoft', 'LCCN:412667'] },
    });
    const vol2 = sourceFingerprints({
      ia_identifier: 'centuryillustrat02newyuoft',
      dublin_core: { dc_identifier: ['IA:centuryillustrat02newyuoft', 'LCCN:412667'] },
    });
    expect(vol1).not.toContain('dc:LCCN:412667');
    expect(vol1.some((f) => vol2.includes(f))).toBe(false);
  });

  it('survives dc_identifier being a bare string, not an array', () => {
    // True of 89,772 books. `dc_identifier[0]` is then a single CHARACTER, which
    // is how `dc:1` came to be shared by 3,371 books in the dry run.
    const book = { dublin_core: { dc_identifier: 'ERARA:17163' }, image_source: { provider: 'e-rara', identifier: '17163' } };
    expect(dcIdentifiers(book)).toEqual(['ERARA:17163']);
    expect(sourceFingerprints(book)).not.toContain('dc:E');
    expect(sourceFingerprints(book)).toEqual(['e-rara:17163']);
  });

  it('keeps the members of one bundled IA item apart', () => {
    // IA item 20230305_20230305_1003 bundles ten separate Arabic works. Without
    // the sub-range discriminator they all reduce to the item id.
    const mk = (work: string) => ({
      dublin_core: { dc_identifier: [`IA-BUNDLE:20230305_20230305_1003/${work}`, 'ark:/13960/s208fvmk2xb'] },
      image_source: { provider: 'internet_archive', identifier: '20230305_20230305_1003', source_url: 'https://archive.org/details/20230305_20230305_1003' },
    });
    const a = sourceFingerprints(mk('al-badri-rahat-al-arwah'));
    const b = sourceFingerprints(mk('e310fc124b45eb79'));
    expect(sourceSubrange(mk('e310fc124b45eb79'))).toBe('e310fc124b45eb79');
    expect(a.some((f) => b.includes(f))).toBe(false);
  });

  it('keeps two page ranges of one manifest apart', () => {
    const base = { provider: 'iiif', iiif_manifest: 'https://example.org/iiif/x/manifest' };
    const a = sourceFingerprints({ image_source: { ...base, page_range: '1-40' } });
    const b = sourceFingerprints({ image_source: { ...base, page_range: '41-90' } });
    expect(a.some((f) => b.includes(f))).toBe(false);
  });
});

describe('the legacy scalar fingerprint is untouched', () => {
  it('still picks one identifier by the same priority order', () => {
    expect(sourceFingerprint({ ia_identifier: 'x1', gallica_ark: 'y2' })).toBe('ia:x1');
    expect(sourceFingerprint({ mdz_id: 'bsb10192557' })).toBe('mdz:bsb10192557');
    expect(sourceFingerprint({ image_source: { provider: 'iiif', iiif_manifest: IA_MANIFEST } })).toBe(`iiif:${IA_MANIFEST}`);
    expect(sourceFingerprint({})).toBeNull();
  });
});

describe('TS / .mjs parity', () => {
  // The direct importers and the Hetzner workers run the .mjs twin; the API
  // routes run the TS side. If they disagree, the same object gets a different
  // identity depending on which door it came through.
  const FIXTURES: Record<string, unknown>[] = [
    {},
    { ia_identifier: 'cosmographia00ptol' },
    { image_source: { provider: 'iiif', iiif_manifest: IA_MANIFEST } },
    { image_source: { provider: 'iiif', iiif_manifest: IA_MANIFEST_V3, source_url: IA_DETAILS } },
    { mdz_id: 'BSB10192557', bsb_id: 'bsb10192557', image_source: { provider: 'mdz', identifier: 'bsb10192557', iiif_manifest: 'https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10192557/manifest' } },
    { gallica_ark: 'bpt6k1234567', image_source: { provider: 'gallica', source_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k1234567' } },
    { image_source: { provider: 'e-rara', identifier: '1139486', iiif_manifest: 'https://www.e-rara.ch/i3f/v20/1139486/manifest' } },
    { dublin_core: { dc_identifier: 'ERARA:17163' }, image_source: { provider: 'e-rara', identifier: '17163' } },
    { dublin_core: { dc_identifier: ['IA-BUNDLE:20230305_20230305_1003/abc', 'ark:/13960/s208fvmk2xb'] }, image_source: { provider: 'internet_archive', identifier: '20230305_20230305_1003', source_url: 'https://archive.org/details/20230305_20230305_1003' } },
    { image_source: { provider: 'pdf', pdf_url: 'https://example.org/a/b.pdf' } },
    { google_books_id: 'AbCdEfGhIjK', image_source: { provider: 'google_books', source_url: 'https://books.google.com/books?id=AbCdEfGhIjK' } },
    { bodleian_uuid: '5c9da286-6a02-406c-b990-0896b8ddbbb0', image_source: { provider: 'bodleian', iiif_manifest: 'https://iiif.bodleian.ox.ac.uk/iiif/manifest/5c9da286-6a02-406c-b990-0896b8ddbbb0.json' } },
    { image_source: { provider: 'iiif', iiif_manifest: 'not a url' } },
    { image_source: null, dublin_core: null },
    { dublin_core: { dc_identifier: [null, 42, '  '] } },
  ];

  for (const [i, f] of FIXTURES.entries()) {
    it(`fixture ${i} agrees`, () => {
      expect(twin.sourceFingerprints(f)).toEqual(sourceFingerprints(f));
      expect(twin.sourceFingerprint(f)).toEqual(sourceFingerprint(f));
      expect(twin.sourceSubrange(f)).toEqual(sourceSubrange(f));
    });
  }
});

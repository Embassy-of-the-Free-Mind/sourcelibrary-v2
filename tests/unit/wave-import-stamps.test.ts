import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { buildWaveBook, waveCatalogueStamps, IMPORTER } from '../../scripts/iiif-discovery/lib/wave-import.mjs';
import { catalogueStampsForInsert, ProvenanceError } from '../../scripts/lib/catalogue-fields.mjs';
import { makeBookDoc } from '../../scripts/lib/book-docs.mjs';

// #8024. In the 7 days to 2026-11-04, 0 of 59,861 new titles and authors carried a stamp, and 55,216 of the books
// came from this importer. These are two real `import_candidates` rows (production, 2026-11-13; the second is the
// candidate behind book 6ae2529c16de29adc6747299), unchanged except `_id`, which is kept as its string.

const apian = {
  _id: '69b69dd4003885aadae3e5be',
  manifest_url: 'https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10804119/manifest',
  source: 'bsb',
  origin_library: 'Bayerische Staatsbibliothek (Munich)',
  title: 'Beschreibvng Des Hochloblichen Fvrstenthvb Obern Vnd Nidern Bayrn P.W.V.B. : [Gewidmet] Ad Illustriss. Et Sereniss. Principem Ac Dominum Domin. Albertum Comitem Palatinum Rheni Utriusque Bavariae Ducem Do. Suum Clementiss. ; Cautum est Bavarici Ducis privilegio ne quis hanc Cosmographiam excudat, excusam imprimat, impressam vendat, aut alio modo divulget',
  author: 'Apian, Philipp',
  display_title: null,
  language: 'German',
  date_text: '[1579]',
  date_earliest: 1579,
  date_latest: 1579,
  page_count: null,
  categories: [],
  provider_name: 'Münchener DigitalisierungsZentrum (Bavarian State Library)',
  source_url: 'https://www.digitale-sammlungen.de/en/view/bsb10804119',
  source_id: 'bsb10804119',
  metadata: { bsb_id: 'bsb10804119', oai_set: 'vd16', languages: ['ger'] },
  status: 'discovered',
  discovered_at: new Date('2026-03-15T11:53:56.079Z'),
};
const anonymous = {
  ...apian,
  _id: '69b6e699296d81824f2c0024',
  manifest_url: 'https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00120080/manifest',
  title: 'Es ist zwar schon öfters durch offenbahre, aller Orthen durch dises gantze Hoch-Fürstliche Stüfft, und Fürstenthumb publiciret ... : Aychstätt den zweyten Monats-Tag Maij, im Ein Taussend, Siben Hundert, und Vierzehenden Jahr',
  author: 'Unknown',
  date_text: '[1714]',
  source_url: 'https://www.digitale-sammlungen.de/en/view/bsb00120080',
  source_id: 'bsb00120080',
  metadata: { bsb_id: 'bsb00120080', oai_set: 'vd18', languages: ['ger'] },
};

const canvas = (i: number) => ({
  '@id': `c${i}`, '@type': 'sc:Canvas', width: 1000, height: 1500,
  images: [{ resource: { '@id': `https://api.digitale-sammlungen.de/iiif/image/v2/bsb10804119_0000${i}/full/full/0/default.jpg`, service: { '@id': `https://api.digitale-sammlungen.de/iiif/image/v2/bsb10804119_0000${i}` } } }],
});
const manifest = { '@context': 'http://iiif.io/api/presentation/2/context.json', sequences: [{ canvases: [1, 2, 3, 4, 5].map(canvas) }] };
const now = new Date('2026-11-13T12:00:00Z');
const opts = (slug: string) => ({
  language: 'German', campaign: 'acquisition-wave-2026-10-lazy', slug, now, bookId: new ObjectId(),
  hold: { reason: 'manifest-only-lazy-pages', release: 'test', release_when: { kind: 'decision', ref: 'test' } },
});

describe('wave import stamps title and author at birth (#8024)', () => {
  it('stamps title, display_title and author from the candidate record, in a doc makeBookDoc accepts', () => {
    const book = buildWaveBook(apian, manifest, opts('beschreibvng'));
    expect(book.author).toBe('Apian, Philipp');
    for (const f of ['title', 'display_title', 'author']) {
      const s = book.field_provenance[f];
      expect(s).toMatchObject({
        source: 'source_catalogue', script: 'scripts/iiif-discovery/lib/wave-import.mjs', importer: IMPORTER,
        provider: 'bsb', record_kind: 'import_candidate', candidate_id: '69b69dd4003885aadae3e5be',
        record_url: 'https://www.digitale-sammlungen.de/en/view/bsb10804119', oai_set: 'vd16', previous_value: null,
      });
      expect(s.date).toEqual(now);
      expect(book.field_provenance_history[f]).toEqual([s]);
    }
    expect(book.field_provenance.display_title.note).toMatch(/copied as the display title/);
    expect(() => makeBookDoc(book)).not.toThrow();
  });

  it('leaves a placeholder author unstamped (the record did not name one)', () => {
    const book = buildWaveBook(anonymous, manifest, opts('es-ist-zwar'));
    expect(book.author).toBe('Unknown');
    expect(book.field_provenance.author).toBeUndefined();
    expect(Object.keys(book.field_provenance).sort()).toEqual(['display_title', 'title']);
    expect(book.field_provenance.title.oai_set).toBe('vd18');
  });

  it('writes no stamp at all when the record gave neither title nor author', () => {
    const book = buildWaveBook({ ...anonymous, title: null }, manifest, opts('bsb-item'));
    expect(book.title).toBe('bsb item');
    expect(book).not.toHaveProperty('field_provenance');
    expect(waveCatalogueStamps(anonymous, { title: null, author: null }, now)).toEqual({});
  });
});

describe('catalogueStampsForInsert', () => {
  const stamp = { source: 'source_catalogue', script: 'scripts/x.mjs' };
  it('refuses a stamp without source or script, a caller previous_value, a non-catalogue field, or an empty value', () => {
    expect(() => catalogueStampsForInsert({ title: 'T' }, { source: 'x' } as never)).toThrow(ProvenanceError);
    expect(() => catalogueStampsForInsert({ title: 'T' }, { ...stamp, previous_value: 'y' } as never)).toThrow(ProvenanceError);
    expect(() => catalogueStampsForInsert({ slug: 'x' } as never, stamp)).toThrow(ProvenanceError);
    expect(() => catalogueStampsForInsert({ author: '  ' }, stamp)).toThrow(/empty/);
  });
  it('writes one stamp and one history entry per field, as a first write', () => {
    const r = catalogueStampsForInsert({ title: 'T', author: 'A' }, stamp, now);
    expect(r.field_provenance.title).toEqual({ ...stamp, date: now, previous_value: null });
    expect(r.field_provenance_history.author).toEqual([{ ...stamp, date: now, previous_value: null }]);
  });
});

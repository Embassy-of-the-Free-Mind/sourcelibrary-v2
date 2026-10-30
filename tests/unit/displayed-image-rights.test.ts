import { describe, it, expect } from 'vitest';
import { displayedImageRights } from '@/lib/types';

// #7771: the book page shows what the holding library stated, not the importer's default.
describe('displayedImageRights', () => {
  it('Gallica: BnF states NoC-NC; the importer stored publicdomain', () => {
    const r = displayedImageRights({
      license: 'publicdomain',
      attribution: undefined,
      rights_normalized: {
        status: 'stated', class: 'noc-nc', statement_uri: 'http://rightsstatements.org/vocab/NoC-NC/1.0/',
        attribution_required: 'Bibliothèque nationale de France. Département des Manuscrits.',
      },
    });
    expect(r.fromLibrary).toBe(true);
    expect(r.license?.name).toBe('No Copyright – Non-Commercial Use Only');
    expect(r.license?.url).toBe('http://rightsstatements.org/vocab/NoC-NC/1.0/');
    expect(r.credit).toContain('Bibliothèque nationale de France');
  });

  it('BL: a terms-of-use statement with no URI shows the library’s sentence', () => {
    const terms = 'Except as otherwise permitted under your national copyright law this material may not be copied or distributed further';
    const r = displayedImageRights({ license: 'unknown', rights_normalized: { status: 'stated', class: 'terms-of-use', statement_uri: null, terms_text: terms } });
    expect(r.license?.name).toBe('The library’s terms of use');
    expect(r.terms).toBe(terms);
  });

  it('an importer assumption or a silent library falls back to the stored values', () => {
    for (const status of ['assumed-by-importer', 'manifest-silent', 'fetch-failed']) {
      const r = displayedImageRights({ license: 'publicdomain', attribution: 'Internet Archive', rights_normalized: { status, class: 'public-domain' } });
      expect(r.fromLibrary).toBe(false);
      expect(r.license?.name).toBe('Public Domain');
      expect(r.credit).toBe('Internet Archive');
    }
  });

  it('no image_source at all shows nothing', () => {
    expect(displayedImageRights(undefined)).toEqual({ license: null, credit: null, terms: null, fromLibrary: false });
  });
});

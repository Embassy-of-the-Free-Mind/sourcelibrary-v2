import { describe, it, expect } from 'vitest';
import { imageRightsFields } from '@/components/seo/schema-utils';

const opts = { published: '1533', licensePage: 'https://sourcelibrary.org/book/x' };

/**
 * Schema.org rights reach search engines as facts about a picture. The failures this guards:
 * a public-domain mark nobody verified, and the raw word `unknown` sent as a licence URL.
 */
describe('imageRightsFields', () => {
  it('claims nothing for the importer default', () => {
    const f = imageRightsFields({
      provider: 'internet_archive', license: 'publicdomain',
      rights_normalized: { status: 'assumed-by-importer', class: 'public-domain' },
    }, opts);
    expect(f.license).toBeUndefined();
    expect(f.acquireLicensePage).toBeUndefined();
    expect(f.copyrightNotice).toBeUndefined();
  });

  it('claims nothing when the licence is unknown, absent, or the bare default', () => {
    for (const license of ['unknown', undefined, 'publicdomain', 'Open access (University of Oxford)']) {
      const f = imageRightsFields({ provider: 'sbb', license, rights_normalized: { status: 'manifest-silent', class: 'unknown' } }, opts);
      expect(f.license).toBeUndefined();
      expect(f.copyrightNotice).toBeUndefined();
    }
  });

  it('keeps a library statement, with its notice and license page', () => {
    const f = imageRightsFields({
      rights_normalized: { status: 'stated', class: 'noc-nc', statement_uri: 'http://rightsstatements.org/vocab/NoC-NC/1.0/' },
    }, opts);
    expect(f.license).toBe('http://rightsstatements.org/vocab/NoC-NC/1.0/');
    expect(f.acquireLicensePage).toBe(opts.licensePage);
    expect(f.copyrightNotice).toContain('Original published 1533.');
  });

  it('invents no date in the notice', () => {
    const f = imageRightsFields({
      rights_normalized: { status: 'stated', class: 'public-domain', statement_uri: 'https://creativecommons.org/publicdomain/mark/1.0/' },
    }, { licensePage: opts.licensePage });
    expect(f.copyrightNotice).not.toContain('1900');
  });

  it('keeps a real licence URL stored on a record no manifest confirmed', () => {
    const url = 'https://creativecommons.org/licenses/by/4.0/';
    expect(imageRightsFields({ license: url, rights_normalized: { status: 'no-manifest' } }, opts).license).toBe(url);
  });

  it('prefers the library credit, and names a provider rather than printing its key', () => {
    expect(imageRightsFields({ attribution: 'Courtesy of X', provider: 'internet_archive' }, opts).creditText).toBe('Courtesy of X');
    expect(imageRightsFields({ provider: 'internet_archive' }, opts).creditText).toBe('Digitized by Internet Archive');
  });

  it('omits the credit when no one can be named', () => {
    expect(imageRightsFields({}, opts).creditText).toBeUndefined();
  });
});

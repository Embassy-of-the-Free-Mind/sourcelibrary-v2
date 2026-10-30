import { describe, it, expect } from 'vitest';
import { libraryRightsUri } from '@/lib/types';

// #7771: IIIF `rights` and schema.org `license` carry the holding library's statement, and a
// library that spoke without a standard URI never gets the public-domain default.
describe('libraryRightsUri', () => {
  it('Gallica: BnF stated NoC-NC with its URI', () => {
    expect(libraryRightsUri({ rights_normalized: { status: 'stated', class: 'noc-nc',
      statement_uri: 'http://rightsstatements.org/vocab/NoC-NC/1.0/' } })).toBe('http://rightsstatements.org/vocab/NoC-NC/1.0/');
  });

  it('a stated class with a non-standard URI gets the standard URI for its class', () => {
    expect(libraryRightsUri({ rights_normalized: { status: 'stated', class: 'noc-nc',
      statement_uri: 'https://gallica.bnf.fr/html/und/conditions-dutilisation-des-contenus-de-gallica' } }))
      .toBe('http://rightsstatements.org/vocab/NoC-NC/1.0/');
  });

  it('BL terms of use: null, so the caller omits rights instead of defaulting to the PDM', () => {
    expect(libraryRightsUri({ rights_normalized: { status: 'stated', class: 'terms-of-use', statement_uri: null } })).toBeNull();
  });

  it('the library has not spoken: undefined, so the caller keeps the stored licence', () => {
    expect(libraryRightsUri({ rights_normalized: { status: 'assumed-by-importer', class: 'public-domain' } })).toBeUndefined();
    expect(libraryRightsUri({ rights_normalized: { status: 'stated', class: 'unknown' } })).toBeUndefined();
    expect(libraryRightsUri({})).toBeUndefined();
    expect(libraryRightsUri(undefined)).toBeUndefined();
  });
});

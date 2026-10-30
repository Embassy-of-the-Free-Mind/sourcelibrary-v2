import { describe, it, expect } from 'vitest';
import { imageAccessFor } from '@/lib/types';

// #7771: a reuse restriction is tested before the pre-1930 release, so a scan the library
// marks non-commercial is never offered for sale.
describe('imageAccessFor', () => {
  it('a 1650 Gallica scan BnF marks NoC-NC is free, not paid, though the importer stored publicdomain', () => {
    expect(imageAccessFor({ year: 1650, image_source: { provider: 'gallica', license: 'publicdomain',
      rights_normalized: { status: 'stated', class: 'noc-nc' } } })).toBe('nc-free');
  });

  it('a pre-1930 book whose stored licence is CC BY-NC is free, not paid', () => {
    expect(imageAccessFor({ year: 1700, image_source: { provider: 'mdz', license: 'CC-BY-NC-SA-4.0' } })).toBe('nc-free');
  });

  it('library terms of use or an in-copyright statement are never charged', () => {
    for (const cls of ['terms-of-use', 'in-copyright']) {
      expect(imageAccessFor({ year: 1800, image_source: { provider: 'bl', license: 'unknown',
        rights_normalized: { status: 'stated', class: cls } } })).toBe('nc-free');
    }
  });

  it('an importer assumption does not count as the library speaking', () => {
    expect(imageAccessFor({ year: 1650, image_source: { provider: 'internet_archive', license: 'publicdomain',
      rights_normalized: { status: 'assumed-by-importer', class: 'noc-nc' } } })).toBe('open');
  });

  it('unchanged: pre-1930 public domain is open, BPH is open, modern unknown is blocked', () => {
    expect(imageAccessFor({ year: 1650, image_source: { provider: 'erara', license: 'publicdomain',
      rights_normalized: { status: 'stated', class: 'public-domain' } } })).toBe('open');
    expect(imageAccessFor({ year: 1990, image_source: { provider: 'bph', license: 'unknown' } })).toBe('open');
    expect(imageAccessFor({ year: 1990, image_source: { provider: 'internet_archive', license: 'unknown' } })).toBe('blocked');
    expect(imageAccessFor({ year: 1990, image_source: { provider: 'internet_archive' } })).toBe('blocked');
  });
});

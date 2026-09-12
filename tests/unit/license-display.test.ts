/**
 * `licenseDisplay` resolves what a book page SHOWS for a stored rights value.
 *
 * The rule these pin: resolve for display, never rewrite the data — and never
 * round a restrictive statement up to a permissive one. 1,260 live books store
 * `rightsstatements.org/vocab/NoC-NC`, which means "No Copyright –
 * Non-Commercial Use Only". Treating that as public domain would misstate the
 * rights on every one of them, which is the kind of error a reader acts on.
 */
import { describe, it, expect } from 'vitest';
import { licenseDisplay } from '../../src/lib/types/image-source';

describe('licenseDisplay', () => {
  it('resolves our own ids to their names', () => {
    expect(licenseDisplay('publicdomain')).toEqual({ name: 'Public Domain' });
    expect(licenseDisplay('CC-BY-SA-4.0')?.name).toBe('CC BY-SA 4.0');
  });

  it('resolves the deed URLs and spellings the importers actually stored', () => {
    for (const v of [
      'http://creativecommons.org/publicdomain/mark/1.0/',
      'https://creativecommons.org/publicdomain/mark/1.0/',
      'PDM 1.0',
      'pdm',
    ]) {
      expect(licenseDisplay(v)?.name, v).toBe('Public Domain Mark 1.0');
    }
    for (const v of ['CC0', 'cc0', 'CC0 1.0 Universal', 'https://creativecommons.org/publicdomain/zero/1.0/']) {
      expect(licenseDisplay(v)?.name, v).toBe('CC0 1.0');
    }
  });

  it('NEVER rounds a restrictive statement up to public domain', () => {
    const noc = licenseDisplay('https://rightsstatements.org/vocab/NoC-NC/1.0/');
    expect(noc?.name).toBe('No Copyright – Non-Commercial Use Only');
    expect(noc?.name).not.toMatch(/^Public Domain/);
  });

  it('carries the URL through so the statement can be linked', () => {
    const r = licenseDisplay('https://creativecommons.org/publicdomain/mark/1.0/');
    expect(r?.url).toBe('https://creativecommons.org/publicdomain/mark/1.0/');
    expect(licenseDisplay('publicdomain')?.url).toBeUndefined();
  });

  it('falls through to the source’s own words rather than guessing', () => {
    // ETCSL stores this, and it is not a licence in anyone's vocabulary.
    expect(licenseDisplay('Open access (University of Oxford)')?.name).toBe('Open access (University of Oxford)');
    // An unrecognised URL is labelled rather than printed raw — a link is not a
    // licence name — but it is still linked, not translated into one.
    const gallica = licenseDisplay('https://gallica.bnf.fr/html/und/conditions-dutilisation-des-contenus-de-gallica');
    expect(gallica?.name).toBe('See the source’s rights statement');
    expect(gallica?.url).toContain('gallica.bnf.fr');
  });

  it('is null for nothing at all', () => {
    expect(licenseDisplay(undefined)).toBeNull();
    expect(licenseDisplay('')).toBeNull();
    expect(licenseDisplay('   ')).toBeNull();
  });
});

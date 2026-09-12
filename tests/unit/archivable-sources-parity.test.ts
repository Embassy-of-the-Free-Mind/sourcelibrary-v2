import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  ARCHIVABLE_SOURCE_HOSTS,
  isArchivableSourceUrl,
  ARCHIVABLE_SOURCES_REGEX,
} from '@/lib/archivable-sources';
import {
  ARCHIVABLE_SOURCE_HOSTS as HOSTS_MJS,
  isArchivableSourceUrl as isArchivableMjs,
} from '../../scripts/lib/archivable-sources.mjs';

/**
 * Three copies of this list existed and all three disagreed (3, 10 and 4 hosts).
 * The watchdog classified a book "archivable" on its list, called the route, and
 * the route refused on its own — a silent no-op that reads as success. Same
 * two-lists-must-agree shape as the CSP/proxy failure in #4163.
 *
 * The `.mjs` twin exists because scripts cannot import the TS module. That
 * arrangement is only safe if something fails when they drift, which is this.
 */
describe('archivable sources: the TS module and its .mjs twin', () => {
  it('hold identical host lists, in the same order', () => {
    expect([...HOSTS_MJS]).toEqual([...ARCHIVABLE_SOURCE_HOSTS]);
  });

  it('agree on every host, and on things that merely look like one', () => {
    const probes = [
      'https://archive.org/download/x/page/n0/full/pct:50/0/default.jpg',
      'https://ia1.us.archive.org/x.jpg',
      'https://api.digitale-sammlungen.de/iiif/image/v2/bsb1/full/full/0/default.jpg',
      'https://www.e-rara.ch/zuz/i3f/v20/1/full/full/0/default.jpg',
      'https://evilarchive.org/x.jpg',
      'https://notdlc.services/x.jpg',
      'https://mps.lib.harvard.edu/assets/images/drs:1/full/2000,/0/default.jpg',
      'https://iiif.universiteitleiden.nl/iiif/2/x/full/full/0/default.jpg',
      'not a url',
      '',
    ];
    for (const p of probes) {
      expect(isArchivableMjs(p), p).toBe(isArchivableSourceUrl(p));
    }
  });
});

describe('archivable sources: host matching', () => {
  it('matches a host and its subdomains', () => {
    expect(isArchivableSourceUrl('https://archive.org/x.jpg')).toBe(true);
    expect(isArchivableSourceUrl('https://ia1.us.archive.org/x.jpg')).toBe(true);
    expect(isArchivableSourceUrl('https://api.digitale-sammlungen.de/x.jpg')).toBe(true);
  });

  it('does NOT match a bare suffix — the #3508 lesson', () => {
    // An attacker only has to register a domain ending in an allowlisted string.
    expect(isArchivableSourceUrl('https://evilarchive.org/x.jpg')).toBe(false);
    expect(isArchivableSourceUrl('https://nothab.de/x.jpg')).toBe(false);
    expect(isArchivableSourceUrl('https://xcdli.earth/x.jpg')).toBe(false);
  });

  it('rejects hosts that refuse a datacenter IP, so a stall never becomes a failed fetch', () => {
    // Probed 2026-08-27 from Hetzner with real urls from `pages`:
    // Harvard 429, Leiden 403, IRHT 301, QDL no response.
    expect(isArchivableSourceUrl('https://mps.lib.harvard.edu/assets/images/drs:1/full/2000,/0/default.jpg')).toBe(false);
    expect(isArchivableSourceUrl('https://iiif.universiteitleiden.nl/iiif/2/x/full/full/0/default.jpg')).toBe(false);
    expect(isArchivableSourceUrl('https://iiif.irht.cnrs.fr/iiif/ark:/1/full/1000,/0/default.jpg')).toBe(false);
    expect(isArchivableSourceUrl('https://iiif.qdl.qa/iiif/images/1/x.jp2/full/1000,/0/default.jpg')).toBe(false);
  });

  it('rejects non-urls rather than throwing', () => {
    expect(isArchivableSourceUrl(null)).toBe(false);
    expect(isArchivableSourceUrl(undefined)).toBe(false);
    expect(isArchivableSourceUrl('')).toBe(false);
    expect(isArchivableSourceUrl('ftp://archive.org/x.jpg')).toBe(false);
    expect(isArchivableSourceUrl('https://')).toBe(false);
  });

  it('the Mongo regex is built from the same array it screens with', () => {
    for (const h of ARCHIVABLE_SOURCE_HOSTS) {
      expect(ARCHIVABLE_SOURCES_REGEX.test(`https://${h}/x.jpg`), h).toBe(true);
    }
  });
});

describe('no stale private copies of the list remain', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

  /**
   * The negative control for this guard: reintroduce a literal host-alternation
   * regex in any of the three former copies and this goes red. Without it the
   * lists can silently fork again, which is the whole defect.
   */
  for (const f of [
    'src/app/api/books/[id]/archive-images/route.ts',
    'scripts/maintenance/archiving-watchdog.mjs',
    'scripts/archive-cover-pages.mjs',
  ]) {
    it(`${f} imports the shared list instead of defining its own`, () => {
      const src = read(f);
      expect(src).toMatch(/archivable-sources/);
      // A hand-rolled alternation of two or more source hosts is the old shape.
      expect(src).not.toMatch(/archive\\?\.org\|gallica/);
    });
  }
});

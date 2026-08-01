/**
 * bib_records: keep the whole record, and type-check the relation. (#3455, #3428)
 *
 * The defect these pin: we fetch rich bibliographic records and keep sixteen
 * flat fields, so a work ABOUT a text is indistinguishable from a rendering OF
 * it. Godwin's *Athanasius Kircher's Theatre of the World* — an illustrated
 * study — sits in `translation_catalogs` as a translation with Godwin as
 * `translator`, and nothing downstream can tell. Its MARC record says otherwise
 * plainly, and we had that at fetch time.
 *
 * The fixtures are REAL MARC-XML fetched from the LoC SRU gateway on
 * 2026-07-29, not hand-written. A hand-written fixture would only prove the
 * classifier agrees with my idea of MARC; these prove it agrees with LoC.
 *
 * The two cases are the acceptance criteria from #3455, and they are
 * deliberately adversarial to each other: both are 2009/1992 scholarly
 * monographs about hermetic material by a named academic at a real press. Every
 * "is this plausible / is this author real" check passes on both. Only the
 * record's own structure separates them:
 *
 *   Copenhaver  041 1 $a eng $h grc $h lat   → translation
 *   Godwin      (no 041 at all)
 *               600 10 $x Criticism and interpretation → study
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, beforeAll } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import {
  parseMarcXmlRecords,
  buildBibRecord,
  projectToCatalogRow,
  classifyWorkType,
  classifyCompleteness,
  extractIdentifiers,
  extentPages,
  originalLanguages,
  uniformTitle,
} from '../../scripts/lib/bib-record.mjs';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures/marc', name), 'utf8');

let copenhaver: any;
let godwin: any;

beforeAll(async () => {
  [copenhaver] = await parseMarcXmlRecords(fixture('loc-copenhaver-hermetica.xml'));
  [godwin] = await parseMarcXmlRecords(fixture('loc-godwin-theatre-of-the-world.xml'));
});

describe('parseMarcXmlRecords', () => {
  it('finds the MARC record nested inside an SRU response', () => {
    // An SRU response wraps the MARC <record> in its own <zs:record>. Once
    // namespace prefixes are stripped both are named "record" — matching on the
    // name alone grabs the wrapper, which has no MARC in it at all.
    expect(copenhaver).toBeDefined();
    expect(copenhaver.datafields.length).toBeGreaterThan(5);
    expect(copenhaver.controlfields['008']).toContain('1992');
  });

  it('returns [] rather than throwing on junk input', () => {
    return expect(parseMarcXmlRecords('')).resolves.toEqual([]);
  });
});

describe('Copenhaver, Hermetica (CUP 1992) — a translation', () => {
  it('classifies as a translation on the strength of 041', () => {
    const { work_type, evidence } = classifyWorkType(copenhaver);
    expect(work_type).toBe('translation');
    expect(evidence.join(' ')).toMatch(/041\$h=grc,lat/);
  });

  it('reads the original languages off 041$h', () => {
    expect(originalLanguages(copenhaver)).toEqual(['grc', 'lat']);
  });

  it('classifies as complete', () => {
    const { work_type } = classifyWorkType(copenhaver);
    expect(classifyCompleteness(copenhaver, work_type).completeness).toBe('complete');
  });

  it('parses the page extent out of "lxxxiii, 320 p."', () => {
    expect(extentPages(copenhaver)).toBe(320);
  });

  it('carries external identifiers, so the row stays re-checkable', () => {
    const ids = extractIdentifiers(copenhaver);
    expect(ids.lccn).toBe('91025703');
    expect(ids.isbn).toContain('0521361443');
  });

  it('projects into a translation_catalogs row with completeness=complete', () => {
    const bib = buildBibRecord({ rec: copenhaver, source: 'loc', rawXml: 'x' });
    const row = projectToCatalogRow(bib);
    expect(row).not.toBeNull();
    expect(row.completeness).toBe('complete');
    expect(row.translator).toMatch(/Copenhaver/);
    expect(row.lccn).toBe('91025703');
  });
});

describe('Godwin, Theatre of the World (2009) — a study, not a translation', () => {
  it('classifies as a study, not a translation', () => {
    // The whole point of #3455/#3428: the fabrication is in the RELATION, not
    // the entities. Author, publisher and year are all real.
    const { work_type, evidence } = classifyWorkType(godwin);
    expect(work_type).toBe('study');
    expect(evidence.join(' ')).toMatch(/Criticism and interpretation/i);
  });

  it('has no 041 at all — the signal that separates it from Copenhaver', () => {
    expect(originalLanguages(godwin)).toEqual([]);
  });

  it('REFUSES to project into translation_catalogs', () => {
    // A study must never enter the registry as a prior translation. This is the
    // exact row that currently defeats first-translation claims on Kircher.
    const bib = buildBibRecord({ rec: godwin, source: 'loc', rawXml: 'x' });
    expect(bib.work_type).toBe('study');
    expect(projectToCatalogRow(bib)).toBeNull();
  });

  it('does not assert completeness for a non-translation', () => {
    expect(classifyCompleteness(godwin, 'study').completeness).toBe('unknown');
  });

  it('still extracts identifiers, including OCLC from the (OCoLC) prefix', () => {
    const ids = extractIdentifiers(godwin);
    expect(ids.lccn).toBe('2009011796');
    expect(ids.oclc).toContain('317361757');
  });
});

describe('buildBibRecord invariants', () => {
  it('refuses a record with no external identifier', () => {
    // An unre-checkable row is precisely how the existing 24,061-row registry
    // became unauditable — every row lacks an identifier, so nothing can be
    // re-fetched or deduplicated. Fail closed rather than store one.
    const empty = { leader: '', controlfields: {}, datafields: [] };
    expect(() => buildBibRecord({ rec: empty, source: 'loc', rawXml: 'x' }))
      .toThrow(/no external identifier/);
  });

  it('keeps the raw payload so a new field is a re-projection, not a re-fetch', () => {
    const raw = fixture('loc-copenhaver-hermetica.xml');
    const bib = buildBibRecord({ rec: copenhaver, source: 'loc', rawXml: raw });
    expect(bib.raw_marcxml).toBe(raw);
    expect(bib.raw_format).toBe('marcxml');
  });

  it('keys on source + identifier so a re-fetch is idempotent', () => {
    const a = buildBibRecord({ rec: copenhaver, source: 'loc', rawXml: 'x' });
    const b = buildBibRecord({ rec: copenhaver, source: 'loc', rawXml: 'y' });
    expect(a._key).toBe(b._key);
    expect(a._key).toBe('loc:91025703');
  });

  it('records WHY it classified as it did, so a wrong call is auditable', () => {
    const bib = buildBibRecord({ rec: godwin, source: 'loc', rawXml: 'x' });
    expect(bib.work_type_evidence.length).toBeGreaterThan(0);
    expect(bib.completeness_evidence.length).toBeGreaterThan(0);
  });
});

describe('completeness stays conservative', () => {
  // A wrong `complete` demotes a real first-translation badge — historically the
  // #1 failure. A wrong `unknown` merely leaves a claim standing. So partial
  // markers always win, and short extents never reach `complete`.
  const withTitle = (title: string, extent = '320 p.') => ({
    leader: '',
    controlfields: {},
    datafields: [
      { tag: '245', ind1: '0', ind2: '0', subfields: [{ code: 'a', value: title }] },
      { tag: '300', ind1: ' ', ind2: ' ', subfields: [{ code: 'a', value: extent }] },
      { tag: '041', ind1: '1', ind2: ' ', subfields: [{ code: 'h', value: 'lat' }] },
    ],
  });

  it('an explicit "Selections" marker beats a long extent', () => {
    expect(classifyCompleteness(withTitle('The Works: Selections'), 'translation').completeness)
      .toBe('partial');
  });

  it.each(['Excerpts from the Corpus', 'An Anthology of Hermetic Texts', 'Abridged Edition'])(
    'treats %s as partial',
    (title) => {
      expect(classifyCompleteness(withTitle(title), 'translation').completeness).toBe('partial');
    },
  );

  it('refuses to call a pamphlet-length extent complete', () => {
    expect(classifyCompleteness(withTitle('A Treatise', '40 p.'), 'translation').completeness)
      .toBe('unknown');
  });

  it('does not assert complete when there is no extent at all', () => {
    const noExtent = { leader: '', controlfields: {}, datafields: [
      { tag: '245', ind1: '0', ind2: '0', subfields: [{ code: 'a', value: 'A Treatise' }] },
      { tag: '041', ind1: '1', ind2: ' ', subfields: [{ code: 'h', value: 'lat' }] },
    ] };
    expect(classifyCompleteness(noExtent, 'translation').completeness).toBe('unknown');
  });

  it('a multi-volume extent ("2 v.") is not a page count', () => {
    expect(extentPages({ leader: '', controlfields: {}, datafields: [
      { tag: '300', ind1: ' ', ind2: ' ', subfields: [{ code: 'a', value: '2 v. ;' }] },
    ] })).toBeNull();
  });
});

describe('uniform title (work identity — feeds #3258 / #2453)', () => {
  it('returns the 240 uniform title when present, else empty', () => {
    // Neither fixture carries a 240; the accessor must return '' rather than
    // undefined so callers can treat it uniformly.
    expect(uniformTitle(copenhaver)).toBe('');
    expect(uniformTitle({ leader: '', controlfields: {}, datafields: [
      { tag: '240', ind1: '1', ind2: '0', subfields: [{ code: 'a', value: 'De voluptate.' }] },
    ] })).toBe('De voluptate');
  });
});

describe('a throttled response is not an empty result', () => {
  // LoC rate-limits by serving an HTML interstitial with HTTP 200. Parsing that
  // to zero records reads as "no prior translation exists" — a false negative
  // manufactured by throttling, in a system whose whole job is avoiding those.
  it('throws on the LoC IP access-request page rather than returning []', async () => {
    const blockPage = '<!DOCTYPE html>\n<html lang="en"><head><title>LCCN Permalink - IP Access Request Form</title></head><body>ip access request</body></html>';
    await expect(parseMarcXmlRecords(blockPage)).rejects.toThrow(/throttled|access-request/i);
  });

  it('throws on any HTML body where MARC was expected', async () => {
    await expect(parseMarcXmlRecords('<html><body>maintenance</body></html>')).rejects.toThrow(/HTML document/);
  });

  it('still returns [] for genuinely empty input', async () => {
    await expect(parseMarcXmlRecords('')).resolves.toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  flattenIiifValue, readManifestMetadataPairs, labelContains, labelIs, splitImprint,
  isUnknownAuthor, resolveImportAuthor,
} from '@/lib/iiif-manifest-metadata';

/**
 * #6113: a candidate with no author (SAT after #6112) became 'Unknown' although the
 * manifest names one. The fixture is the real BSB v2 manifest for bsb11021950
 * (fetched 2026-10-13, canvases trimmed to two).
 */
const manifest = JSON.parse(readFileSync(path.join(__dirname, '../fixtures/iiif-bsb11021950-v2.json'), 'utf8'));
const pairs = readManifestMetadataPairs(manifest.metadata);

describe('v2 language-tagged labels and values', () => {
  it('flattens to the English value, never the language code', () => {
    // Previously every BSB label read "en / de / zh".
    expect(pairs.map(p => p.label)).not.toContain('en / de / zh');
    expect(pairs.slice(0, 6).map(p => p.label)).toEqual(['Title', 'By', 'Creator', 'Creator', 'Published', 'Date']);
    expect(labelIs(pairs, 'language')).toBe('Chinese');
  });

  it('keeps v3 language maps and plain strings working', () => {
    expect(flattenIiifValue({ en: ['Publisher'] })).toBe('Publisher');
    expect(flattenIiifValue({ none: ['Venezia'] })).toBe('Venezia');
    expect(flattenIiifValue(['a', '<b>b</b>'])).toBe('a / b');
    expect(flattenIiifValue([{ '@language': 'de', '@value': 'Von' }, { '@language': 'fr', '@value': 'Par' }])).toBe('Von');
    expect(flattenIiifValue([{ '@value': 'x' }, { '@language': 'de', '@value': 'y' }])).toBe('x');
  });
});

describe('bibliographic fields from the BSB manifest', () => {
  it('reads By, Creator, Date and the Place : Publisher imprint', () => {
    expect(labelIs(pairs, 'by')).toBe('Huineng ; Fahai bian');
    expect(labelContains(pairs, 'creator', 'author')).toBe('Huineng 638-713');
    // Bracketed date kept as text.
    expect(labelContains(pairs, 'publication date', 'date issued', 'date')).toBe('[1695]');
    expect(splitImprint(labelIs(pairs, 'published'))).toEqual({ place: 'Guangzhou', publisher: 'Hai tong si' });
    expect(labelContains(pairs, 'call number')).toBe('4 L.sin. C 163');
  });

  it('`by` is an exact label match, not a substring one', () => {
    expect(labelIs([{ label: 'Digitised by', value: 'MDZ' }], 'by')).toBeNull();
  });

  it('drops a trailing date from the publisher', () => {
    expect(splitImprint('Venetiis : apud Iuntas, 1569')).toEqual({ place: 'Venetiis', publisher: 'apud Iuntas' });
    expect(splitImprint('no colon here')).toEqual({ place: null, publisher: null });
  });
});

describe('resolveImportAuthor', () => {
  const by = labelIs(pairs, 'by');
  const creator = labelContains(pairs, 'creator', 'author');

  it('never changes a candidate that carries an author', () => {
    expect(resolveImportAuthor('Huineng', by, creator)).toBe('Huineng');
    expect(resolveImportAuthor('Anonymous', by, creator)).toBe('Anonymous');
  });

  it('falls back to By, then Creator, for Unknown/empty candidates', () => {
    for (const c of ['Unknown', 'unknown', '', '  ', undefined, null, 'Unknown author', '[s.n.]']) {
      expect(isUnknownAuthor(c)).toBe(true);
      expect(resolveImportAuthor(c, by, creator)).toBe('Huineng ; Fahai bian');
    }
    expect(resolveImportAuthor('Unknown', null, creator)).toBe('Huineng 638-713');
  });

  it('keeps the placeholder when the manifest has nothing, null when nothing was given', () => {
    expect(resolveImportAuthor('Unknown', null, null)).toBe('Unknown');
    expect(resolveImportAuthor('', null, null)).toBeNull();
  });
});

/**
 * bestEdition ranking (#3888): cited-edition-first, then translation-completeness
 * tier, then role/authority (critical ≥ princeps ≥ source-language edition ≥
 * manuscript ≥ translation), then the legacy tie-breaks. With no opts the ordering
 * must be EXACTLY the legacy one — the resolver is shared by the works-catalog and
 * translation-registry, which pass no context.
 */
import { describe, it, expect } from 'vitest';
import {
  bestEdition,
  classifyEditionRole,
  citedEditionMatch,
  isSourceLanguage,
} from '../../scripts/lib/holdings-resolver.mjs';

// Fully-translated helper — tier 2 unless overridden.
const ed = (over: Record<string, unknown>) => ({
  title: 'Some Edition', language: 'English', year: 1900,
  pages_count: 100, pages_ocr: 100, pages_blank: 0, pages_translated: 100,
  slug: 'some-edition', id: 'x',
  ...over,
});

describe('classifyEditionRole', () => {
  it('is translation without a workLanguage (role inert for legacy callers)', () => {
    expect(classifyEditionRole(ed({ title: 'Critical Edition of X', language: 'Greek' }), undefined)).toBe('translation');
  });
  it('gates form badges on the source language', () => {
    // Aldine printing of a LATIN rendering of a Greek work is not a princeps of the work.
    expect(classifyEditionRole(ed({ title: 'Aldine De Mysteriis', language: 'Latin' }), 'Greek')).toBe('translation');
    expect(classifyEditionRole(ed({ title: 'Aldine De Mysteriis', language: 'Greek' }), 'Greek')).toBe('princeps');
  });
  it('classifies critical / manuscript / plain source text', () => {
    expect(classifyEditionRole(ed({ title: 'Testamentum Salomonis: a critical edition', language: 'Greek' }), 'Greek')).toBe('critical');
    expect(classifyEditionRole(ed({ title: 'Codex Vat. gr. 1809', language: 'Greek' }), 'Greek')).toBe('manuscript');
    expect(classifyEditionRole(ed({ title: 'De Mysteriis', language: 'Greek' }), 'Greek')).toBe('edition');
  });
  it('counts bilingual editions as source-language witnesses', () => {
    expect(isSourceLanguage('Greek-Latin', 'Greek')).toBe(true);
    expect(isSourceLanguage('Latin', 'Greek')).toBe(false);
  });
});

describe('citedEditionMatch', () => {
  const mccown = ed({ title: 'The Testament of Solomon', author: 'Chester Charlton McCown', year: 1922, slug: 'testament-solomon-mccown-1922' });
  it('matches on editor surname', () => {
    expect(citedEditionMatch(mccown, 'Chester Charlton McCown')).toBe(true);
    expect(citedEditionMatch(mccown, 'ed. McCown 1922')).toBe(true);
  });
  it('rejects a year conflict', () => {
    expect(citedEditionMatch(ed({ title: 'Testament of Solomon', author: 'F. C. Conybeare', year: 1898 }), 'McCown 1922')).toBe(false);
  });
  it('drops initials and joiners, never matches on them', () => {
    expect(citedEditionMatch(ed({ title: 'Ed. by A. D. Nock', author: 'Nock' }), 'A. D. Nock')).toBe(true);
    expect(citedEditionMatch(ed({ title: 'Unrelated', author: 'Nobody' }), 'A. D.')).toBe(false);
  });
  it('is false without a citedRef', () => {
    expect(citedEditionMatch(mccown, undefined)).toBe(false);
  });
  it('accepts an array of citation strings, matching any', () => {
    expect(citedEditionMatch(mccown, ['Duling 2021', 'McCown'])).toBe(true);
    expect(citedEditionMatch(mccown, ['Duling 2021'])).toBe(false);
  });
  it('never matches on the work\'s own author/title words', () => {
    const loebGreek = ed({ title: 'Lives of the Sophists and Fragments', author: 'Eunapius', year: 1849 });
    expect(citedEditionMatch(loebGreek, 'Wright, The Lives of the Sophists, by Eunapius', 'Eunapius', 'Lives of the Sophists')).toBe(false);
  });
});

describe('bestEdition — legacy behavior without opts', () => {
  it('prefers completeness tier, then dedicated over collected, then volume', () => {
    const facsimile = ed({ title: 'Big Facsimile', pages_count: 608, pages_ocr: 26, pages_translated: 26 }); // tier 0
    const full = ed({ title: 'Complete Translation', pages_translated: 100 }); // tier 2
    expect(bestEdition([facsimile, full])?.title).toBe('Complete Translation');
    const omnibus = ed({ title: 'Opera Omnia', pages_translated: 100 });
    expect(bestEdition([omnibus, full])?.title).toBe('Complete Translation');
  });
  it('returns null when nothing is readable', () => {
    expect(bestEdition([ed({ pages_translated: 0 })])).toBeNull();
  });
});

describe('bestEdition — #3888 ordering', () => {
  it('the cited edition wins outright when held readable', () => {
    const mccown = ed({ title: 'The Testament of Solomon', author: 'Chester Charlton McCown', year: 1922, language: 'Greek', pages_translated: 60, pages_count: 130 });
    const bigger = ed({ title: 'Testament of Solomon rendered', language: 'English', pages_translated: 100 });
    expect(bestEdition([bigger, mccown], { citedEdition: 'Chester Charlton McCown' })?.author).toBe('Chester Charlton McCown');
  });
  it('within a completeness tier, a critical source-language text beats a loose translation with more pages', () => {
    const critical = ed({ title: 'Critical edition of the Chaldean Oracles', language: 'Greek', pages_translated: 80, pages_count: 100 });
    const loose = ed({ title: 'Oracles Englished', language: 'English', pages_translated: 95, pages_count: 100 });
    expect(bestEdition([loose, critical], { workLanguage: 'Greek' })?.title).toContain('Critical');
  });
  it('but a barely-translated critical text does NOT beat a readable-end-to-end translation (tier gates role)', () => {
    const critical = ed({ title: 'Critical edition', language: 'Greek', pages_translated: 10, pages_count: 600 }); // tier 0
    const full = ed({ title: 'Complete English translation', language: 'English', pages_translated: 200, pages_count: 200 }); // tier 2
    expect(bestEdition([full, critical], { workLanguage: 'Greek' })?.title).toBe('Complete English translation');
  });
  it('source-language edition beats a translation, manuscript sits between', () => {
    const greek = ed({ title: 'De Mysteriis', language: 'Greek' });
    const ms = ed({ title: 'Codex Vat. gr. 100', language: 'Greek' });
    const english = ed({ title: 'On the Mysteries, English', language: 'English' });
    expect(bestEdition([english, ms, greek], { workLanguage: 'Greek' })?.title).toBe('De Mysteriis');
    expect(bestEdition([english, ms], { workLanguage: 'Greek' })?.title).toBe('Codex Vat. gr. 100');
  });
  it('with no opts, role and citation are inert (identical to legacy)', () => {
    const critical = ed({ title: 'Critical edition', language: 'Greek', pages_translated: 80, year: 1920 });
    const loose = ed({ title: 'Loose translation', language: 'English', pages_translated: 95, year: 1950 });
    expect(bestEdition([loose, critical])?.title).toBe('Loose translation'); // more translated pages
  });
});

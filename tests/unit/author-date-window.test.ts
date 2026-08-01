/**
 * Author date-window guards (#2250, #2264, #3434).
 *
 * These are BEHAVIOUR tests: every case calls the real function and asserts the
 * verdict it returns. Deleting the death-side logic, inverting a comparison, or
 * loosening the genre regex all make cases here fail — which is the bar a guard
 * has to clear (see "A test that greps source is not a guard" in CLAUDE.md).
 *
 * The invariant worth protecting is the ASYMMETRY between the two functions:
 *
 *   authorshipPlausible          excludes on the BIRTH side only. A book printed
 *                                after an author's death is a reprint, not a
 *                                misattribution — Boethius carries 55 of them.
 *
 *   posthumousMisattributionLikely  uses the death side, but ONLY together with
 *                                the genre of the containing book. A catalogue is
 *                                not an edition of anything, so a long-dead
 *                                author on one is evidence of mention, not
 *                                authorship (#3434: Khunrath d. 1605 on a 1762
 *                                Habsburg banned-book list).
 *
 * Collapsing those two into one death-side rule would flag every legitimate
 * reprint in the corpus. The `reprintsNeverFlagged` block below is what stops it.
 */
import { describe, it, expect } from 'vitest';

import {
  parseWikidataYear,
  authorshipPlausible,
  posthumousMisattributionLikely,
  isReferenceGenreTitle,
} from '../../scripts/lib/author-date-window.mjs';

describe('parseWikidataYear', () => {
  it('parses full dates, bare years, and zero-padded BCE years', () => {
    expect(parseWikidataYear('1756-01-27')).toBe(1756);
    expect(parseWikidataYear('1498')).toBe(1498);
    expect(parseWikidataYear('-0427')).toBe(-427);
    expect(parseWikidataYear('0080-01-01')).toBe(80);
  });

  it('returns null for missing or unparseable input rather than guessing', () => {
    for (const bad of [null, undefined, '', '   ', 'n.d.', 'circa', '0000']) {
      expect(parseWikidataYear(bad as string)).toBeNull();
    }
  });
});

describe('authorshipPlausible — excludes on the birth side only', () => {
  it('rules out a book printed well before the author was born', () => {
    const r = authorshipPlausible({ bookYear: 1500, birthYear: 1756, margin: 10 });
    expect(r.plausible).toBe(false);
    expect(r.reason).toMatch(/predates author birth/);
  });

  it('tolerates near-birth noise inside the margin', () => {
    expect(authorshipPlausible({ bookYear: 1750, birthYear: 1756, margin: 10 }).plausible).toBe(true);
    expect(authorshipPlausible({ bookYear: 1745, birthYear: 1756, margin: 10 }).plausible).toBe(false);
  });

  it('NEVER excludes on the death side — posthumous editions are normal', () => {
    // A 1925 Boethius (d. 524) is a reprint. If this ever returns false, every
    // reprint in the corpus becomes a false positive.
    const r = authorshipPlausible({ bookYear: 1925, birthYear: 477, deathYear: 524, margin: 10 });
    expect(r.plausible).toBe(true);
  });

  it('abstains when a required year is missing', () => {
    expect(authorshipPlausible({ bookYear: null, birthYear: 1500 }).plausible).toBe(true);
    expect(authorshipPlausible({ bookYear: 1500, birthYear: null }).plausible).toBe(true);
  });
});

describe('isReferenceGenreTitle', () => {
  const CATALOGUES = [
    'Catalogus Librorum A Commissione Aulica Prohibitorum',
    'Catalogus librorum per quinquennium a Commissione Aulica prohibitorum',
    'Catalogue général des livres qui se trouvent chez G. J. Manget. 1809',
    'Catalogo de\'libri che trovansi vendibili nel negozio di Carlo',
    'Verzeichniß von chymischen, alchymischen, physikalischen Büchern',
    'Verzeichniss einiger Rarer Bücher',
    'Index librorum quorundam ex omni elegantiori litteratura',
    'Nachrichten von einer hallischen Bibliothek. 7 = 37/42. Stück. 1751',
    'Allgemeiner Anzeiger der Deutschen',
    'Katalog einer auserlesenen Büchersammlung',
    '[Catalogus librorum] Catalogvs librorvm in omni facultate',
    'Nachtrag zu dem Catalogo Librorum A Commissione Aulica Prohibitorum. 7',
    'Supplementum ad catalogum librorum a commissione aulica prohibitorum',
    'Bibliotheca Heinsiana Sive Catalogus Librorum',
  ];
  it.each(CATALOGUES)('recognises %s', (t) => {
    expect(isReferenceGenreTitle(t)).toBe(true);
  });

  // The regex is start-anchored so it cannot sweep in works that merely cite a
  // catalogue, and must not fire on ordinary works that happen to contain a
  // catalogue-ish word later on.
  const NOT_CATALOGUES = [
    'Amphitheatrum Sapientiae Aeternae',
    'Theatrum Chemicum, Praecipuos Selectorum Auctorum Tractatus',
    'Turba Philosophorum, Das ist, Das Buch von der güldenen Kunst',
    'Vom Hylealischen, Das ist, Pri-materialischen Catholischen Oder Algemeinen',
    'De Igne Magorum Philosophorumque secreto externo et visibili',
    'A treatise on the catalogue of the stars',
    'Aureum Vellus, oder Güldin Schatz und Kunstkammer',
  ];
  it.each(NOT_CATALOGUES)('does not fire on %s', (t) => {
    expect(isReferenceGenreTitle(t)).toBe(false);
  });

  it('treats missing titles as not-a-catalogue rather than throwing', () => {
    expect(isReferenceGenreTitle(null)).toBe(false);
    expect(isReferenceGenreTitle(undefined)).toBe(false);
    expect(isReferenceGenreTitle('')).toBe(false);
  });
});

describe('posthumousMisattributionLikely — death side, gated on genre (#3434)', () => {
  // The real records the issue was filed about.
  const KHUNRATH_DEATH = 1605;
  it.each([
    [1751, 'Nachrichten von einer hallischen Bibliothek. 7 = 37/42. Stück. 1751'],
    [1758, 'Catalogus Librorum per Quinquenium à Commissione aulica prohibitorum'],
    [1762, 'Catalogus Librorum A Commissione Aulica Prohibitorum'],
    [1810, 'Allgemeiner Anzeiger der Deutschen'],
  ])('flags the %i catalogue attributed to Khunrath', (bookYear, title) => {
    const r = posthumousMisattributionLikely({ bookYear, deathYear: KHUNRATH_DEATH, title });
    expect(r.suspect).toBe(true);
    expect(r.reason).toMatch(/after author death/);
  });

  it('flags the other verified cases (Dorn, Ashmole, Fludd)', () => {
    expect(posthumousMisattributionLikely({
      bookYear: 1797, deathYear: 1584, title: 'Verzeichniß des einen Theils der von dem verstorbenen Königl. Leibmedicus',
    }).suspect).toBe(true);
    expect(posthumousMisattributionLikely({
      bookYear: 1809, deathYear: 1692, title: 'Catalogue général des livres qui se trouvent chez G. J. Manget',
    }).suspect).toBe(true);
    expect(posthumousMisattributionLikely({
      bookYear: 1765, deathYear: 1637, title: "Catalogue D'Une Nombreuse Collection De Livres, En Tout Genre",
    }).suspect).toBe(true);
  });

  describe('reprintsNeverFlagged', () => {
    // BOTH conditions are required. Genre without the death gap, or the death gap
    // without the genre, must stay silent — otherwise the corpus's reprints and
    // its legitimate catalogue compilers both become false positives.
    it('does not flag a posthumous reprint of the author\'s own work', () => {
      const r = posthumousMisattributionLikely({
        bookYear: 1925, deathYear: 524, title: 'De consolatione philosophiae',
      });
      expect(r.suspect).toBe(false);
      expect(r.reason).toMatch(/not a reference-genre title/);
    });

    it('does not flag a catalogue compiled by its own living author', () => {
      // Bernardus de Lutzemburgo (d. 1535) genuinely wrote Catalogus haereticorum.
      const r = posthumousMisattributionLikely({
        bookYear: 1529, deathYear: 1535, title: 'Catalogus haereticorum omnium pene qui ad haec usque tempora',
      });
      expect(r.suspect).toBe(false);
      expect(r.reason).toMatch(/within/);
    });

    it('does not flag a 1653 edition of Khunrath\'s own Amphitheatrum', () => {
      const r = posthumousMisattributionLikely({
        bookYear: 1653, deathYear: KHUNRATH_DEATH, title: 'Amphitheatrvm Sapientiae Aeternae, Solius, Verae',
      });
      expect(r.suspect).toBe(false);
    });
  });

  it('respects the margin boundary exactly', () => {
    const title = 'Catalogus Librorum';
    expect(posthumousMisattributionLikely({ bookYear: 1650, deathYear: 1600, title, margin: 50 }).suspect).toBe(false);
    expect(posthumousMisattributionLikely({ bookYear: 1651, deathYear: 1600, title, margin: 50 }).suspect).toBe(true);
  });

  it('abstains when the death year is unknown', () => {
    // Only 1,229 of 3,253 entity-linked author docs have a death year, so
    // abstaining rather than guessing is the common path, not an edge case.
    const r = posthumousMisattributionLikely({
      bookYear: 1762, deathYear: null, title: 'Catalogus Librorum A Commissione Aulica Prohibitorum',
    });
    expect(r.suspect).toBe(false);
    expect(r.reason).toMatch(/no author death year/);
  });

  it('abstains when the book year is unknown', () => {
    expect(posthumousMisattributionLikely({
      bookYear: null, deathYear: 1605, title: 'Catalogus Librorum',
    }).suspect).toBe(false);
  });
});

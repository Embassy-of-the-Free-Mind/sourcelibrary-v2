/**
 * A book's slug IS its public URL, so a malformed one is a malformed page
 * address, not a cosmetic issue.
 *
 * Measured on production 2026-08-01: 85 visible books sat at URLs like
 * /book/-10 and /book/-13, and 29 more had no slug at all and could only be
 * reached as /book/<objectid>. Two causes — an import that bypassed the
 * generator, and generateBookSlug itself returning "-<author>" whenever the
 * title sanitizes to nothing, which is every title written in a non-Latin
 * script. This corpus is full of Greek, Hebrew, Chinese, Japanese, Tibetan
 * and Sanskrit titles, so that path is load-bearing, not theoretical.
 */
import { describe, it, expect } from 'vitest';
import { generateBookSlug, isNonTitle, isPlaceholderSlug, readerPageUrl } from '@/lib/slugify';

describe('generateBookSlug', () => {
  it('builds title-author for the ordinary case', () => {
    expect(generateBookSlug('Atalanta Fugiens', 'Michael Maier')).toBe('atalanta-fugiens-maier');
    expect(generateBookSlug('Tyrocinium chymicum', 'Beguin, Jean')).toBe('tyrocinium-chymicum-beguin');
  });

  it('prefers the English display_title when there is one', () => {
    // The whole reason /book/-10 is repairable: these books already carry a
    // usable English title, it was simply never read.
    // "Miyagawa Isshō" has no comma, so extractLastName takes the final word.
    expect(generateBookSlug('島原の節分図', 'Miyagawa Isshō', 'Setsubun in the Shimabara District'))
      .toBe('setsubun-in-the-shimabara-district-issho');
  });

  it('never emits a leading hyphen when the title is non-Latin', () => {
    // Was "-mousouros" → /book/-mousouros.
    const greek = generateBookSlug('Ἐπιστολαὶ διαφόρων φιλοσόφων', 'Mousouros, Markos (ed.)');
    expect(greek).toBe('mousouros');
    expect(greek.startsWith('-')).toBe(false);

    for (const title of ['青鬼', 'ཐར་པ་ཆེན་པོ', 'كتاب الأسرار', 'Ἑρμοῦ τοῦ Τρισμεγίστου']) {
      const slug = generateBookSlug(title, 'Khunrath, Heinrich');
      expect(slug.startsWith('-')).toBe(false);
      expect(isPlaceholderSlug(slug)).toBe(false);
    }
  });

  it('falls back to untitled only when there is nothing to work with', () => {
    expect(generateBookSlug('青鬼', 'Unknown')).toBe('untitled');
    expect(generateBookSlug('', '')).toBe('untitled');
  });
});

describe('isPlaceholderSlug', () => {
  it('flags the URLs that need repairing', () => {
    expect(isPlaceholderSlug(undefined)).toBe(true);
    expect(isPlaceholderSlug('')).toBe(true);
    expect(isPlaceholderSlug('undefined')).toBe(true);
    expect(isPlaceholderSlug('untitled')).toBe(true);
    expect(isPlaceholderSlug('untitled-7')).toBe(true);
    expect(isPlaceholderSlug('-10')).toBe(true);   // the production class
    expect(isPlaceholderSlug('-13')).toBe(true);
    expect(isPlaceholderSlug('123')).toBe(true);
  });

  it('leaves real slugs alone', () => {
    expect(isPlaceholderSlug('atalanta-fugiens-maier')).toBe(false);
    expect(isPlaceholderSlug('mousouros')).toBe(false);
    // A legitimate slug that merely contains digits, or ends in a dedupe suffix.
    expect(isPlaceholderSlug('de-re-metallica-1556-agricola')).toBe(false);
    expect(isPlaceholderSlug('tyrocinium-chymicum-beguin-5')).toBe(false);
  });
});

describe('readerPageUrl', () => {
  it('uses the slug when there is one', () => {
    expect(readerPageUrl({ slug: 'atalanta-fugiens-maier', id: '6a58f512c6cd8f9871069afb' }, 'p1'))
      .toBe('/book/atalanta-fugiens-maier/page/p1');
  });

  it('falls back to the id so a slugless book still links', () => {
    expect(readerPageUrl({ id: '6a58f512c6cd8f9871069afb' }, 'p1'))
      .toBe('/book/6a58f512c6cd8f9871069afb/page/p1');
  });
});

/**
 * #4389 — 111 visible books published at /book/unknown-1 … /book/unknown-111.
 *
 * The importer slugged an English-title field whose value was the literal
 * string "Unknown". "Unknown" sanitizes to "unknown" — a legal, readable-looking
 * slug — so no fallback branch fired, the dedupe counter did the rest, and the
 * books shipped with perfectly good titles sitting unused one field over.
 *
 * The lesson is the one in .claude/docs/invariants/non-latin-text-operations.md,
 * displaced by one step: an operation whose input means "we cannot judge" must
 * not produce a confident output. Here the unjudgeable input was not an empty
 * string but a sentinel that LOOKS like data.
 */
describe('title sentinels never become the slug (#4389)', () => {
  it('recognises the sentinel family, and only it', () => {
    for (const sentinel of ['Unknown', 'unknown', ' UNKNOWN ', '[unknown]', 'Untitled',
      'No title', 'n/a', 'N/A', '?', '-', 'null', 'undefined', 'Onbekend', 'Sans titre', '']) {
      expect(isNonTitle(sentinel), `"${sentinel}" should read as absent`).toBe(true);
    }
    for (const real of ['Unknown Pleasures', 'The Unknown God', 'Titles of Honour', 'Nada', 'Nihil']) {
      expect(isNonTitle(real), `"${real}" is a real title`).toBe(false);
    }
  });

  it('falls through a sentinel display_title to the real title', () => {
    // The exact production shape: english_title "Unknown", display_title good.
    expect(generateBookSlug("Ninurta's Return to Nibru (ETCSL 1.6.1)", 'Anonymous Sumerian', 'Unknown'))
      .toBe('ninurta-s-return-to-nibru-etcsl-1-6-1-anonymous');
  });

  it('never mints a slug whose body is a sentinel', () => {
    for (const [title, displayTitle] of [['Unknown', null], ['Unknown', 'Unknown'], ['', 'unknown'], ['n/a', '[unknown]']] as Array<[string, string | null]>) {
      const slug = generateBookSlug(title, 'Anonymous Sumerian', displayTitle);
      expect(isPlaceholderSlug(slug), `"${title}"/"${displayTitle}" → ${slug}`).toBe(false);
      expect(slug).toBe('anonymous');
    }
  });

  it('flags the shipped URLs so the repair sweep and the audit can see them', () => {
    expect(isPlaceholderSlug('unknown')).toBe(true);
    expect(isPlaceholderSlug('unknown-1')).toBe(true);
    expect(isPlaceholderSlug('unknown-111')).toBe(true);
    expect(isPlaceholderSlug('no-title')).toBe(true);
    expect(isPlaceholderSlug('n-a')).toBe(true);
    // A numeric dedupe suffix is stripped before the test; a word is not.
    expect(isPlaceholderSlug('unknown-pleasures')).toBe(false);
    expect(isPlaceholderSlug('the-unknown-god-anonymous')).toBe(false);
  });

  it('a title that is only a sentinel does not out-rank the author', () => {
    expect(generateBookSlug('Unknown', 'Mousouros, Markos (ed.)')).toBe('mousouros');
  });
});

describe('unknown authors', () => {
  it('does not suffix a slug with "artist" for "Unknown artist"', () => {
    // /book/…-setsubun-oni-yari-ritual-at-osu-kannon-artist was a real
    // planned slug before this: extractLastName took the last word.
    expect(generateBookSlug('大須観音 節分会', 'Unknown artist', 'Setsubun Oni-yari Ritual at Ōsu Kannon'))
      .toBe('setsubun-oni-yari-ritual-at-osu-kannon');
    expect(generateBookSlug('A Title', 'unknown')).toBe('a-title');
  });

  it('does not read the qualifier of a qualified anonymity marker as a surname', () => {
    // /book/a-balbale-to-inana-sumerian presents a language as the author.
    expect(generateBookSlug('A Balbale to Inana', 'Anonymous Sumerian')).toBe('a-balbale-to-inana-anonymous');
    expect(generateBookSlug('A Hymn', 'Anonymous (Egyptian)')).toBe('a-hymn-anonymous');
    expect(generateBookSlug('A Hymn', 'Anonymous Yucatec Maya scribes')).toBe('a-hymn-anonymous');
  });

  it('still keeps "Anonymous", which is a real attribution in this corpus', () => {
    // Deliberate, and pinned by tests/unit/slugify.test.ts — an anonymous
    // early-modern imprint is not the same claim as "we do not know".
    expect(generateBookSlug('Some Text', 'Anonymous')).toBe('some-text-anonymous');
  });
});

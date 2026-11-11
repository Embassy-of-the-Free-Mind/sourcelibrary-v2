/**
 * PRIOR ART: scripts/lib/ia-date-check.mjs (judges Internet Archive candidate dates and owns `ahToCe`,
 * reused here; it reads IA fields, not a catalogue's free-text `published` string).
 * scripts/maintenance/fix-hijri-bracketed-year.mjs repaired the rows this importer bug already wrote;
 * this module stops the importers writing more.
 *
 * catalogue-year — the CE year to store in `books.year`, given a catalogue's `published` text (#6057).
 *
 * Leiden's Arabic, Persian and Malay manuscripts give the Hijri year first and the CE year in brackets:
 * "[Place of manufacture not identified], 1303 [1885]". Taking the first four-digit number stores 1303,
 * and the reader, the date filters and every period count put an 1885 manuscript in the 14th century.
 *
 * The bracketed year is used only when it agrees with the Hijri year (±2 under ahToCe). When every
 * bracketed year disagrees ("1308 [1820]") the record contradicts itself, so no year is returned: an
 * empty year is better than a wrong one, and the full `published` text still shows. Any other text
 * ("1450 [i.e. 1451]", "Venetiis, 1505") keeps the old behaviour, the first year in the string.
 *
 * Eras other than CE (#6866): a BCE date is stored negative ("c. 2575–2551 BCE" → -2575, as the 530 books
 * already so stored), and a year with an explicit CE/AD gloss wins over the first number, which is often in
 * another era: "9 August in the year of the world 6957 … (= 1449 C.E.)", "AM 5686 [1926 CE]",
 * "2157 [Seleucid era] (1845/1846 CE)". Taken first, those put a Syriac Oktoechos in the year 6957.
 */
import { ahToCe } from './ia-date-check.mjs';

const FIRST_YEAR = /\b(1[0-9]{3}|20[0-2][0-9])\b/;
// A Hijri year (1000–1499 AH = 1592–2077 CE), optionally a range, then a bracket.
const AH_THEN_BRACKET = /\b(1[0-4]\d{2})(?:\s*[-–]\s*1[0-4]\d{2})?\s*\[([^\]]*)\]/;
const BCE = /\d\s*(?:B\.?\s?C\.?(?:\s?E\.?)?)(?![a-z])/i;
const BARE_NEGATIVE = /^\s*-(\d{1,5})\s*$/;
// "1449 C.E.", "1926 CE", "1520 AD", "AD 1520"; a range before the marker gives its start ("c. 100–150 CE",
// "1845/1846 CE"). Checked after BCE, which also ends in "CE".
const CE_AFTER = /\b(\d{1,4})(?:\s*[-–/]\s*\d{1,4})?\s*(?:C\.?\s?E\.?|A\.?\s?D\.?)(?![a-z])/i;
const AD_BEFORE = /\bA\.?\s?D\.?\s*(\d{1,4})\b/;

/** The year an explicit era marker fixes (BCE, a bare "-6000", a CE/AD gloss), or undefined when there is none. */
function eraYear(s) {
  const neg = s.match(BARE_NEGATIVE);
  if (neg) return -Number(neg[1]);
  if (BCE.test(s)) {
    const first = s.match(/\d{1,5}/);
    return first ? -Number(first[0]) : null;
  }
  const ce = s.match(CE_AFTER) || s.match(AD_BEFORE);
  return ce ? Number(ce[1]) : undefined;
}

export function yearFromPublished(text) {
  const s = String(text || '');
  const era = eraYear(s);
  if (era !== undefined) return era;
  const m = s.match(AH_THEN_BRACKET);
  if (m) {
    const ah = Number(m[1]);
    const bracketed = [...m[2].matchAll(/\b(1[5-9]\d{2}|20[0-2]\d)\b/g)].map(x => Number(x[1]));
    // A bracket far later than the first number is a CE gloss on a Hijri year, not an "[i.e.]" correction.
    const ce = bracketed.filter(y => y - ah > 150);
    if (ce.length) {
      const expected = ahToCe(ah);
      return ce.find(y => Math.abs(y - expected) <= 2) ?? null;
    }
  }
  const f = s.match(FIRST_YEAR);
  return f ? parseInt(f[1]) : null;
}

/**
 * The year the catalogue mirror (`books_catalog.year`, via sync-books-catalog.mjs) shows for a book. A stored
 * `books.year` wins unless it is later than this year, which no print date can be. Otherwise `published` is
 * read: an era marker first, then the Hijri rule above, then the mirror's own rule, the first three- or
 * four-digit number that is not later than this year ("ca. 850", "951–1000", and "5706 [1945/46]" → 1945).
 */
export function catalogYear(book, now = new Date()) {
  const thisYear = now.getUTCFullYear();
  if (typeof book?.year === 'number' && book.year <= thisYear) return book.year;
  if (typeof book?.published !== 'string') return null;
  const s = book.published;
  const era = eraYear(s);
  if (era !== undefined) return era;
  if (AH_THEN_BRACKET.test(s)) return yearFromPublished(s);
  for (const m of s.matchAll(/\b([1-9][0-9]{2,3})\b/g)) if (Number(m[1]) <= thisYear) return Number(m[1]);
  return null;
}

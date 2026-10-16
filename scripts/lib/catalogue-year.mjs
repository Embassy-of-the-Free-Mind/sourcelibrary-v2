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
 */
import { ahToCe } from './ia-date-check.mjs';

const FIRST_YEAR = /\b(1[0-9]{3}|20[0-2][0-9])\b/;
// A Hijri year (1000–1499 AH = 1592–2077 CE), optionally a range, then a bracket.
const AH_THEN_BRACKET = /\b(1[0-4]\d{2})(?:\s*[-–]\s*1[0-4]\d{2})?\s*\[([^\]]*)\]/;

export function yearFromPublished(text) {
  const s = String(text || '');
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

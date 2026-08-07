/**
 * Parsing canonical loci out of what the printer actually put on the page.
 *
 * Every input string in the "real shapes" block below was taken from production
 * `<page-num>` values in the pilot editions on 2026-08-07. That matters: the
 * failure mode for this parser is not "throws on garbage" — it is accepting a
 * shelf mark, an accession stamp, or a front-matter roman numeral as a
 * citation, which publishes a locus nobody printed.
 *
 * The negative cases are therefore the important half of this file.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs sibling, no type declarations
import { parseLocusRefs, parseLocusQuery, formatLocus } from '../../scripts/lib/locus-parse.mjs';

describe('parseLocusRefs — shapes observed in production', () => {
  it('a bare Bekker page', () => {
    expect(parseLocusRefs('1104', 'bekker')).toEqual([{ page: 1104, section: null }]);
  });

  it('Bekker page with column', () => {
    expect(parseLocusRefs('198a', 'bekker')).toEqual([{ page: 198, section: 'a' }]);
  });

  it('caret and ordinal superscripts are the same column', () => {
    // The Oxford scans yield all three forms for one printed marker.
    expect(parseLocusRefs('184^a', 'bekker')).toEqual([{ page: 184, section: 'a' }]);
    expect(parseLocusRefs('184ª', 'bekker')).toEqual([{ page: 184, section: 'a' }]);
    expect(parseLocusRefs('184a', 'bekker')).toEqual([{ page: 184, section: 'a' }]);
  });

  it('two references on one leaf', () => {
    expect(parseLocusRefs('198b, 199a', 'bekker')).toEqual([
      { page: 198, section: 'b' },
      { page: 199, section: 'a' },
    ]);
  });

  it('a Stephanus page with section', () => {
    expect(parseLocusRefs('393 b', 'stephanus')).toEqual([{ page: 393, section: 'b' }]);
  });

  it('a range keeps both endpoints and interpolates nothing', () => {
    // Burnet prints "393 e - 394 d" for one leaf. We record where the leaf
    // starts and where it ends; claiming to know where 394a falls inside it
    // would be inventing an anchor nobody printed.
    expect(parseLocusRefs('393 e - 394 d', 'stephanus')).toEqual([
      { page: 393, section: 'e', range_end: { page: 394, section: 'd' } },
    ]);
  });

  it('en-dash ranges parse like hyphens', () => {
    expect(parseLocusRefs('407 e – 408 c', 'stephanus')).toEqual([
      { page: 407, section: 'e', range_end: { page: 408, section: 'c' } },
    ]);
  });
});

describe('parseLocusRefs — what must NOT become a citation', () => {
  it('front-matter roman numerals', () => {
    for (const r of ['iii', 'iv', 'vii', 'xi', 'ix']) {
      expect(parseLocusRefs(r, 'bekker'), r).toEqual([]);
    }
  });

  it('library shelf marks and accession stamps', () => {
    // Real strings from the Historia Animalium and Burnet front matter.
    expect(parseLocusRefs('PA 4279 A2 1900 v. 4', 'stephanus')).toEqual([]);
    expect(parseLocusRefs('590 Ar4 1910', 'bekker')).toEqual([]);
    expect(parseLocusRefs('25 Ap 38', 'bekker')).toEqual([]);
  });

  it('numbers outside the system range', () => {
    // Bekker starts at 184; a page-number of 12 is the book's own pagination.
    expect(parseLocusRefs('12', 'bekker')).toEqual([]);
    expect(parseLocusRefs('9999', 'bekker')).toEqual([]);
  });

  it('a section letter the system does not have', () => {
    // Bekker has columns a and b only. An "e" here means the OCR misread, or
    // the book is not what we think — either way it is not a Bekker locus.
    expect(parseLocusRefs('1103e', 'bekker')).toEqual([]);
    expect(parseLocusRefs('393e', 'stephanus')).toEqual([{ page: 393, section: 'e' }]);
  });

  it('a half-readable range is not half a range', () => {
    // One good end plus one scanning artefact is an unread line, not evidence.
    expect(parseLocusRefs('393 e - ???', 'stephanus')).toEqual([]);
    expect(parseLocusRefs('- 394 d', 'stephanus')).toEqual([{ page: 394, section: 'd' }]);
  });

  it('empty and unknown systems', () => {
    expect(parseLocusRefs('', 'bekker')).toEqual([]);
    expect(parseLocusRefs('1104', 'diels-kranz')).toEqual([]);
  });
});

describe('parseLocusQuery — what a classicist actually types', () => {
  it('accepts a bare reference', () => {
    expect(parseLocusQuery('1103b', 'bekker')).toEqual({ page: 1103, section: 'b' });
  });

  it('drops the line number rather than pretending to resolve it', () => {
    // Anchors are page-and-column. Returning something different for 1103b24
    // than for 1103b would claim a precision we do not have.
    expect(parseLocusQuery('1103b24', 'bekker')).toEqual({ page: 1103, section: 'b' });
  });

  it('strips a system name or work abbreviation', () => {
    expect(parseLocusQuery('Bekker 1103b', 'bekker')).toEqual({ page: 1103, section: 'b' });
    expect(parseLocusQuery('Pol. 1287a28', 'bekker')).toEqual({ page: 1287, section: 'a' });
    expect(parseLocusQuery('Republic 509 d', 'stephanus')).toEqual({ page: 509, section: 'd' });
  });

  it('rejects what it cannot read', () => {
    expect(parseLocusQuery('somewhere in the Ethics', 'bekker')).toBeNull();
    expect(parseLocusQuery('', 'bekker')).toBeNull();
    expect(parseLocusQuery('12', 'bekker')).toBeNull();
  });
});

/**
 * The request path (`src/lib/locus.ts`) duplicates only the QUERY side of the
 * parser, because that is all an API route needs. Duplication is how the four
 * copies of computeEndPages stayed wrong in four places at once (#3696), so the
 * twins are pinned here.
 */
describe('.ts/.mjs twin parity — parseLocusQuery', () => {
  it('both implementations agree on every query form', async () => {
    const ts = await import('@/lib/locus');
    const cases: Array<[string, 'bekker' | 'stephanus']> = [
      ['1103b24', 'bekker'],
      ['Bekker 1103b', 'bekker'],
      ['Pol. 1287a28', 'bekker'],
      ['184a', 'bekker'],
      ['1462', 'bekker'],
      ['12', 'bekker'],
      ['1103e', 'bekker'],
      ['509d', 'stephanus'],
      ['Republic 621 d', 'stephanus'],
      ['somewhere in the Ethics', 'bekker'],
      ['', 'bekker'],
    ];
    for (const [input, system] of cases) {
      expect(ts.parseLocusQuery(input, system), `"${input}" (${system})`).toEqual(
        parseLocusQuery(input, system),
      );
    }
  });

  it('formatLocus agrees', async () => {
    const ts = await import('@/lib/locus');
    for (const [p, s] of [[1103, 'b'], [1104, null], [509, 'd']] as Array<[number, string | null]>) {
      expect(ts.formatLocus(p, s)).toBe(formatLocus(p, s));
    }
  });
});

describe('formatLocus', () => {
  it('round-trips through parseLocusQuery', () => {
    for (const s of ['1103b', '1104', '509d', '184a']) {
      const system = Number(s.replace(/\D/g, '')) >= 184 ? 'bekker' : 'stephanus';
      const parsed = parseLocusQuery(s, system);
      if (parsed) expect(formatLocus(parsed.page, parsed.section)).toBe(s);
    }
  });
});

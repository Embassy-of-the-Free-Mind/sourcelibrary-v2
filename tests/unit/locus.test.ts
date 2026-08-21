/**
 * The acceptance rule for canonical loci (#3661).
 *
 * These fixtures are real strings from the registered editions, not invented
 * shapes — the parser's failure mode is silently dropping a spelling of a column
 * letter it has not seen, and only real payloads catch that. Each `it` names the
 * book it came from.
 */
import { describe, it, expect } from 'vitest';
import {
  parseRefCandidates,
  parseLocusQuery,
  refSortKey,
  formatRef,
  locusWorkKey,
  extractAnchors,
  type LocusPageInput,
} from '@/lib/locus';
import { findWorkByName, findWorkByHead, LOCUS_WORKS } from '@/lib/locus-works';

describe('parseRefCandidates', () => {
  it('reads every rendering of a Bekker column letter', () => {
    // All four occur in the Oxford translation volumes; a parser handling one
    // spelling loses most of the book's anchors.
    expect(parseRefCandidates('184^a')).toEqual([{ page: 184, section: 'a', line: null }]);
    expect(parseRefCandidates('185ᵃ')).toEqual([{ page: 185, section: 'a', line: null }]);
    expect(parseRefCandidates('186<sup>a</sup>')).toEqual([{ page: 186, section: 'a', line: null }]);
    expect(parseRefCandidates('339ª')).toEqual([{ page: 339, section: 'a', line: null }]);
  });

  it('returns both endpoints of a span the leaf covers', () => {
    // Burnet's OCT prints the range the page covers.
    expect(parseRefCandidates('407 e - 408 c')).toEqual([
      { page: 407, section: 'e', line: null },
      { page: 408, section: 'c', line: null },
    ]);
    expect(parseRefCandidates('409 e, 410')).toEqual([
      { page: 409, section: 'e', line: null },
      { page: 410, section: null, line: null },
    ]);
  });

  it('finds nothing numeric in roman front matter or a shelfmark', () => {
    expect(parseRefCandidates('vii')).toEqual([]);
    expect(parseRefCandidates(null)).toEqual([]);
  });

  it('does not read a word initial as a section letter', () => {
    // "1900 v. 4" is a shelfmark line; reading "v" as a section would invent a
    // section that no system has.
    expect(parseRefCandidates('1900 v. 4').map((r) => r.section)).toEqual([null, null]);
  });

  it('keeps a markup boundary as a separator', () => {
    expect(parseRefCandidates('<unclear>553 a, b</unclear>')[0]).toEqual({ page: 553, section: 'a', line: null });
  });

  it('drops a column letter the system cannot have, and keeps the page', () => {
    // Bekker prints two columns, a and b; Stephanus divides a page into five
    // sections, a-e. OCR confuses c/e and b/d, so `1094e` is a misread.
    //
    // Adopted from the parallel implementation in #3713. It corrects ZERO rows
    // in the ten registered editions as of 2026-08-07 — measured, not assumed —
    // so this is preventive: it stops an unreadable letter being published as a
    // precision claim. The page is kept because the digits are separate evidence
    // from the letter; #3713 rejects the whole anchor instead.
    expect(parseRefCandidates('1094e', 'bekker')).toEqual([{ page: 1094, section: null, line: null }]);
    expect(parseRefCandidates('1094b', 'bekker')).toEqual([{ page: 1094, section: 'b', line: null }]);
    expect(parseRefCandidates('328e', 'stephanus')).toEqual([{ page: 328, section: 'e', line: null }]);
    // Without a declared system nothing is dropped — the caller has not said
    // which system it is, and guessing from the letter is the inference #3713's
    // own comment warns against.
    expect(parseRefCandidates('1094e')[0].section).toBe('e');
  });
});

describe('parseLocusQuery', () => {
  it('reads a bare Bekker reference with line', () => {
    expect(parseLocusQuery('1094a8')).toMatchObject({ system: null, work: null, ref: { page: 1094, section: 'a', line: 8 } });
  });

  it('reads a named system', () => {
    expect(parseLocusQuery('Bekker 1447a')).toMatchObject({ system: 'bekker', ref: { page: 1447, section: 'a' } });
    expect(parseLocusQuery('Stephanus 328b')).toMatchObject({ system: 'stephanus', ref: { page: 328, section: 'b' } });
  });

  it('separates a work name from the reference', () => {
    expect(parseLocusQuery('Rep. 328b')).toMatchObject({ work: 'Rep', ref: { page: 328, section: 'b' } });
    expect(parseLocusQuery('Nicomachean Ethics 1103b')).toMatchObject({ work: 'Nicomachean Ethics', ref: { page: 1103, section: 'b' } });
  });

  it('never guesses the system from the number', () => {
    // Bekker and Stephanus ranges overlap almost entirely; inferring from
    // magnitude would answer a Plato citation with an Aristotle leaf.
    expect(parseLocusQuery('328b')?.system).toBeNull();
    expect(parseLocusQuery('1094a')?.system).toBeNull();
  });
});

describe('refSortKey / formatRef', () => {
  it('orders page, then section, then line', () => {
    const k = (p: number, s: string | null, l: number | null) => refSortKey({ page: p, section: s, line: l });
    expect(k(1094, null, null)).toBeLessThan(k(1094, 'a', null));
    expect(k(1094, 'a', 8)).toBeLessThan(k(1094, 'b', 1));
    expect(k(1094, 'b', null)).toBeLessThan(k(1095, null, null));
  });

  it('formats the way a citation is written', () => {
    expect(formatRef({ page: 1094, section: 'a', line: 8 })).toBe('1094a.8');
    expect(formatRef({ page: 1447, section: null, line: null })).toBe('1447');
  });
});

describe('locusWorkKey', () => {
  it('strips a book numeral pair that normalizeHeader cannot', () => {
    // Burnet heads the Republic's rectos with a Greek book letter AND its roman
    // equivalent. Left alone, one dialogue became eleven segments.
    expect(locusWorkKey('ΠΟΛΙΤΕΙΑΣ Α I.')).toBe('ΠΟΛΙΤΕΙΑΣ');
    expect(locusWorkKey('ΝΟΜΩΝ ΙΒ XII.')).toBe('ΝΟΜΩΝ');
  });

  it('rejects a division head', () => {
    expect(locusWorkKey('BOOK IV. 8')).toBeNull();
    expect(locusWorkKey('CHAPTER II')).toBeNull();
    expect(locusWorkKey('PRAEFATIO')).toBeNull();
  });

  it('rejects the author name, including an inflected form', () => {
    // The 1578 Stephanus heads its versos PLATONIS against an author field of
    // "Plato"; the Greek volumes head them ΠΛΑΤΩΝΟΣ. Exact comparison accepted
    // both, and PLATONIS then "contained" the entire volume.
    expect(locusWorkKey('PLATONIS', 'Plato')).toBeNull();
    expect(locusWorkKey('ΠΛΑΤΩΝΟΣ', 'Plato')).toBeNull();
    expect(locusWorkKey('ΑΡΙΣΤΟΤΕΛΟΥΣ', 'Aristotle')).toBeNull();
  });

  it('keeps a real work head', () => {
    expect(locusWorkKey('ΠΕΡΙ ΠΟΙΗΤΙΚΗΣ', 'Aristotle')).toBe('ΠΕΡΙ ΠΟΙΗΤΙΚΗΣ');
    expect(locusWorkKey('HISTORIA ANIMALIUM', 'Aristotle')).toBe('HISTORIA ANIMALIUM');
  });
});

/** Build page inputs for a synthetic edition. */
function pages(rows: Array<[number, string | null, string | null]>): LocusPageInput[] {
  return rows.map(([page_number, header, page_num]) => ({ page_number, header, page_num }));
}

describe('extractAnchors — marginal editions', () => {
  it('keeps the canonical run and drops a chapter number that landed in page-num', () => {
    // The Oxford Physics really does this: the running head is "BOOK I. 5" and
    // the OCR captured the chapter number 5 as the page number. 5 cannot
    // continue a run at 186, and that alone is enough to reject it — no range
    // table needed.
    const { anchors, rejected } = extractAnchors(
      pages([
        [18, 'PHYSICA', '184a'],
        [19, 'PHYSICA', '184b'],
        [20, 'PHYSICA', '185a'],
        [21, 'BOOK I. 5', '5'],
        [22, 'PHYSICA', '186a'],
      ]),
      { author: 'Aristotle' },
    );
    expect(anchors.map((a) => a.ref.page)).toEqual([184, 184, 185, 186]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].page_number).toBe(21);
  });

  it('lets the reference reset between works in one volume', () => {
    // Burnet vol. 4 runs Clitopho 406-410, then the Republic from 327. A single
    // global monotone run would throw the Republic away.
    const { anchors } = extractAnchors(
      pages([
        [19, 'ΚΛΕΙΤΟΦΩΝ', '406'],
        [20, 'ΚΛΕΙΤΟΦΩΝ', '407 e - 408 c'],
        [21, 'ΚΛΕΙΤΟΦΩΝ', '409'],
        [28, 'ΠΟΛΙΤΕΙΑΣ Α I.', '327 c'],
        [29, 'ΠΟΛΙΤΕΙΑΣ Α I.', '328 c'],
        [30, 'ΠΛΑΤΩΝΟΣ', '329 b'],
      ]),
      { author: 'Plato' },
    );
    expect(anchors.filter((a) => a.work_header === 'ΚΛΕΙΤΟΦΩΝ')).toHaveLength(4);
    const republic = anchors.filter((a) => a.work_header === 'ΠΟΛΙΤΕΙΑΣ');
    expect(republic.map((a) => a.ref.page)).toEqual([327, 328, 329]);
    // The author-name verso carries the work forward rather than starting one.
    expect(anchors.every((a) => a.work_header !== 'ΠΛΑΤΩΝΟΣ')).toBe(true);
  });

  it('records both candidates for a leaf at a work boundary', () => {
    // Verified against the scans: Stephanus vol. 2 leaf 339 is printed 327, the
    // Republic's title page; leaf 340 is printed 328 and is Republic text under
    // the generic verso head PLATONIS; leaf 341 is the first recto to say
    // DE REPVB. So leaf 340 inherits MINOS and is the Republic — and until both
    // candidates were recorded, `Republic 328b` missed the very edition the
    // Stephanus numbers are named after.
    const { anchors } = extractAnchors(
      pages([
        [336, 'MINOS', '324'],
        [337, 'MINOS', '325'],
        [338, null, '326'],
        [339, null, '327'],
        [340, 'PLATONIS', '328'],
        [341, 'DE REPVB. LIB. I.', '329'],
        [342, 'PLATONIS', '330'],
        [343, 'DE REPVB. LIB. I.', '331'],
      ]),
      { author: 'Plato' },
    );
    const at328 = anchors.find((a) => a.ref.page === 328);
    expect(at328?.work_header).toBe('MINOS');
    expect(at328?.work_header_alt).toBe('DE REPVB');

    // ...and a leaf in the MIDDLE of a work gets no alternative, so the boundary
    // rule cannot quietly widen every work by two leaves.
    const at330 = anchors.find((a) => a.ref.page === 330);
    expect(at330?.work_header).toBe('DE REPVB');
    expect(at330?.work_header_alt).toBeNull();
  });
});

describe('extractAnchors — frame editions', () => {
  const frameRows = (): Array<[number, string | null, string | null]> => {
    const rows: Array<[number, string | null, string | null]> = [];
    for (let scan = 10; scan <= 40; scan++) rows.push([scan, 'ΗΘΙΚΩΝ ΝΙΚΟΜΑΧΕΙΩΝ', String(scan + 784)]);
    return rows;
  };

  it('measures the offset and fills a leaf its neighbours bracket', () => {
    const rows = frameRows();
    rows[5][2] = null; // one leaf's number unreadable
    const { anchors, report } = extractAnchors(pages(rows), { author: 'Aristotle', frame: true });
    expect(report.frame_offset).toBe(784);
    expect(report.frame).toBe(1);
    const filled = anchors.find((a) => a.basis === 'frame');
    expect(filled?.page_number).toBe(15);
    expect(filled?.ref.page).toBe(799);
  });

  it('does not fill across a gap wider than one leaf', () => {
    const rows = frameRows();
    rows[5][2] = null;
    rows[6][2] = null;
    const { report } = extractAnchors(pages(rows), { author: 'Aristotle', frame: true });
    // Neither leaf has printed neighbours on both sides, so neither is filled.
    // Interpolating across the pair is exactly what #3661's guard forbids.
    expect(report.frame).toBe(0);
  });

  it('drops a printed number that sits off the verified frame', () => {
    // Stephanus vols. 1 and 3 append separately-paginated annotations under
    // their own running head, so those numbers form a valid run of their own and
    // survive the monotone rule. They are printed numbers and they are NOT
    // Stephanus references: publishing them would answer "Stephanus 100" with a
    // page of a 16th-century commentary. 54 anchors are dropped this way in
    // vol. 1 and 130 in vol. 3.
    const rows = frameRows();
    for (let scan = 41; scan <= 50; scan++) rows.push([scan, 'HENRICI STEPHANI', String(scan - 40)]);
    const { anchors, report } = extractAnchors(pages(rows), { author: 'Plato', frame: true });
    expect(report.off_frame).toBeGreaterThan(0);
    expect(anchors.every((a) => a.ref.page - a.page_number === 784)).toBe(true);
    expect(anchors.every((a) => a.work_header !== 'HENRICI STEPHANI')).toBe(true);
  });

  it('rejects a second numbering inside the same work by the run rule alone', () => {
    // When the stray numbers sit under a head that names no work (front matter,
    // an annotation label), they stay inside the enclosing work's segment and the
    // monotone rule rejects them before the frame check ever sees them. Two
    // independent guards, and this one fires first.
    const rows = frameRows();
    rows.push([41, 'ANNOT IN PLAT', '7']);
    rows.push([42, 'ANNOT IN PLAT', '8']);
    const { anchors, rejected } = extractAnchors(pages(rows), { author: 'Aristotle', frame: true });
    expect(rejected.some((r) => r.page_number === 41)).toBe(true);
    expect(anchors.every((a) => a.ref.page - a.page_number === 784)).toBe(true);
  });

  it('publishes nothing when a declared frame has no constant offset', () => {
    const rows: Array<[number, string | null, string | null]> = [];
    for (let scan = 10; scan <= 30; scan++) rows.push([scan, 'ΝΟΜΩΝ', String(scan * 3)]);
    const { anchors, report } = extractAnchors(pages(rows), { author: 'Plato', frame: true });
    expect(report.frame_offset).toBeNull();
    expect(anchors).toHaveLength(0);
    expect(report.rejected).toBeGreaterThan(0);
  });
});

describe('locus work names', () => {
  it('resolves an English name, an abbreviation and a printed head', () => {
    expect(findWorkByName('Republic')?.slug).toBe('republic');
    expect(findWorkByName('rep')?.slug).toBe('republic');
    expect(findWorkByName('Nicomachean Ethics')?.slug).toBe('nicomachean-ethics');
    expect(findWorkByHead('ΠΟΛΙΤΕΙΑΣ', 'stephanus')?.slug).toBe('republic');
    expect(findWorkByHead('DE REPVBL', 'stephanus')?.slug).toBe('republic');
  });

  it('does not confuse the Republic with the Statesman', () => {
    // ΠΟΛΙΤΕΙΑ and ΠΟΛΙΤΙΚΟΣ share a stem; a first-match rule gets this wrong.
    expect(findWorkByHead('ΠΟΛΙΤΙΚΟΣ', 'stephanus')?.slug).toBe('statesman');
    expect(findWorkByHead('ΠΟΛΙΤΙΚΩΝ', 'bekker')?.slug).toBe('politics');
  });

  it('prefers the longer name when one is a prefix of another', () => {
    expect(findWorkByName('hippias major')?.slug).toBe('hippias-major');
  });

  it('carries no page ranges, so a wrong row cannot move a citation', () => {
    // The addressing key is the printed number; this table only supplies names.
    // If a range ever appears here, resolution can start disagreeing with the
    // leaves — see the header of src/lib/locus-works.ts.
    for (const w of LOCUS_WORKS) {
      expect(Object.keys(w).sort()).toEqual(['aliases', 'heads', 'label', 'slug', 'system']);
    }
  });

  it('has no duplicate slugs', () => {
    const slugs = LOCUS_WORKS.map((w) => w.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

/**
 * Parsing canonical loci out of the numbers printed on a scanned page.
 *
 * ## What a locus is, and why scan pages are not one
 *
 * Bekker numbers (Aristotle) and Stephanus numbers (Plato) were fixed in 1831
 * and 1578 so that a citation would survive re-typesetting. `1103b24` means the
 * same words in every edition ever printed. A scan page number means those
 * words in ONE copy, and is shareable with nobody — which is why an MCP client
 * verifying Aristotle quotations had to reconstruct the mapping by hand and
 * then guess at it (#3653 item 2, #3661).
 *
 * ## Two mechanisms that look identical in the data
 *
 * `<page-num>` holds a printed number. That number is one of two very different
 * things, and telling them apart is the whole problem:
 *
 *   A. THE EDITION'S OWN PAGINATION. A locus only when that edition's paging
 *      *is* the citation standard — true for the Bekker 1831 and Stephanus 1578
 *      root editions, false for everything else.
 *   B. MARGINAL CANONICAL REFERENCES printed beside the text, the Oxford/OCT
 *      convention. These ARE loci already and need no fitting.
 *
 * A linear scan-page→printed-number fit separates them, and **scores B worst**,
 * because canonical numbers do not advance at the rate of pages. Historia
 * Animalium fits at 0.009 and is one of the best books in the corpus for this.
 * So this module never infers the mechanism from the numbers. The book declares
 * it (see `scripts/lib/locus-editions.mjs`), because a wrong guess here
 * publishes a fabricated citation, which is worse than publishing none
 * (`.claude/docs/invariants/entity-page-attribution.md`).
 *
 * ## Why the SYSTEM is also declared, never sniffed
 *
 * It is tempting to read the section letter: Bekker uses only columns a/b,
 * Stephanus runs a–e, so an `e` implies Stephanus. That inference is wrong
 * often enough to matter — OCR turns `c` into `e`, and a Bekker page with a
 * misread column would silently become a Plato citation. The system is a
 * property of the edition, which we know from its author, so it is passed in.
 *
 * ## The shapes actually observed
 *
 * Sampled from the pilot editions (2026-08-07). Every one of these is a real
 * string from production `<page-num>`:
 *
 *   "1104"            Bekker root, bare page
 *   "198a"            Oxford Aristotle, page + column
 *   "184^a"           same, caret-marked superscript
 *   "184ª"            same, unicode ordinal
 *   "198b, 199a"      two references on one leaf
 *   "393 b"           Burnet OCT, Stephanus page + section
 *   "393 e - 394 d"   a range spanning the leaf
 *   "iii" / "xi"      front-matter roman numerals — NOT loci
 */

/** Bekker pages run 184a1–1462b18. Stephanus runs 1a–1379e. */
const RANGE = {
  bekker: [184, 1462],
  stephanus: [1, 1400],
};

/** Bekker has two columns; Stephanus has five sections. */
const SECTIONS = {
  bekker: 'ab',
  stephanus: 'abcde',
};

/**
 * Superscript and ordinal markers that printers used for the column letter, and
 * that OCR preserves in several forms. `184^a`, `184ª`, `184a` are one thing.
 */
function normalizeRef(raw) {
  return String(raw)
    .replace(/[ªº]/g, 'a') // ª º — ordinal indicators, always column a
    .replace(/\^/g, '')
    .replace(/–|—/g, '-') // en/em dash → hyphen, so ranges parse
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One printed reference → {page, section} or null.
 *
 * Rejects anything that is not a plain arabic number optionally followed by a
 * single section letter. Roman numerals, library shelf marks ("PA 4279 A2"),
 * accession stamps and reader annotations all fail here, which is the point —
 * front matter is dense with them.
 */
function parseOne(token, system) {
  const m = /^(\d{1,4})\s*([a-e])?$/i.exec(token.trim());
  if (!m) return null;

  const page = Number(m[1]);
  const [lo, hi] = RANGE[system];
  if (page < lo || page > hi) return null;

  const section = m[2] ? m[2].toLowerCase() : null;
  if (section && !SECTIONS[system].includes(section)) return null;

  return { page, section };
}

/**
 * Parse a `<page-num>` payload into every canonical reference it names.
 *
 * Returns `[]` rather than throwing on anything unrecognised: this runs over
 * every page of a scanned book, most of which carry something that is not a
 * locus, and a parser that treats noise as failure would be useless here.
 *
 * A range ("393 e - 394 d") yields its two ENDPOINTS, not the pages between.
 * Interpolating the interior would invent anchors that are not printed
 * anywhere, which is exactly the fabrication this module exists to avoid — the
 * span is recorded on the anchor instead, so a caller can see the page covers
 * a range without us claiming to know where inside it anything falls.
 */
export function parseLocusRefs(pageNumText, system) {
  if (!pageNumText || !RANGE[system]) return [];
  const text = normalizeRef(pageNumText);

  // Split on commas and semicolons first — "198b, 199a" is two references.
  // Then on hyphens, which mark a range across the leaf.
  const out = [];
  for (const chunk of text.split(/[,;]/)) {
    // Empty parts come from a leading or trailing dash — "- 394 d" is a
    // continuation marker for a range that began on the previous leaf, and the
    // number after it is still a perfectly good anchor.
    const parts = chunk.split('-').map((s) => s.trim()).filter(Boolean);

    if (parts.length === 2) {
      const from = parseOne(parts[0], system);
      const to = parseOne(parts[1], system);
      // A range is only trustworthy if BOTH ends parse. One good end and one
      // scanning artefact is not half a range; it is an unread line.
      if (from && to) out.push({ ...from, range_end: to });
      continue;
    }

    // Anything with three or more dash-separated parts is not a reference we
    // recognise — a date, a shelf mark, a hyphenated word bleeding in from the
    // text. Guessing which fragment is the citation is how noise gets published.
    if (parts.length !== 1) continue;

    const one = parseOne(parts[0], system);
    if (one) out.push(one);
  }
  return out;
}

/** "1103b" / "1103" — the canonical string form, for display and lookup. */
export function formatLocus(page, section) {
  return section ? `${page}${section}` : String(page);
}

/**
 * Parse a user-supplied citation into a lookup key.
 *
 * Accepts what a classicist actually types: "1103b24", "Bekker 1103b",
 * "Pol. 1287a28", "509d", "Republic 509 d". The work name and the line number
 * are DISCARDED — deliberately.
 *
 * Line numbers are dropped because we anchor at page-and-column granularity;
 * pretending to resolve `b24` when the anchor is `b` would be a precision claim
 * we cannot support. The caller gets the column and reads it.
 *
 * The work name is dropped because canonical numbers are globally unique within
 * their system: Bekker 1103 is in the Nicomachean Ethics no matter which volume
 * you hold it in. That is what makes locus lookup independent of the work-identity
 * problem in #3653 — the number resolves without knowing which work it names.
 */
export function parseLocusQuery(input, system) {
  if (!input) return null;
  const text = normalizeRef(input)
    // Strip a leading system name or work abbreviation: "Bekker 1103b",
    // "Pol. 1287a28", "Republic 509d".
    .replace(/^[^\d]*/, '')
    .trim();

  const m = /^(\d{1,4})\s*([a-e])?\s*\d*$/i.exec(text);
  if (!m) return null;

  const page = Number(m[1]);
  const [lo, hi] = RANGE[system];
  if (page < lo || page > hi) return null;

  const section = m[2] ? m[2].toLowerCase() : null;
  if (section && !SECTIONS[system].includes(section)) return null;

  return { page, section };
}

export const LOCUS_SYSTEMS = Object.keys(RANGE);

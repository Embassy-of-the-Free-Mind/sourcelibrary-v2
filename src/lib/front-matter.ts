/**
 * Is this leaf front matter — introduction, preface, contents, errata — rather
 * than the body of the work?
 *
 * ## Why
 *
 * Reported through MCP as the single most wasteful failure mode (#3653 item 3):
 * *"Every semantic search on a 400+ page book returned ~45 pages of front matter
 * at match_count 6-12, with real hits buried at match_count 1. One Politics
 * search put the passage I needed at result #52."* And specifically: on the
 * Taylor 1801 *Metaphysics*, a conceptual query returned 50 consecutive hits
 * from scan pages 9–61 — the translator's introduction and the publisher's
 * advertising — and zero from the body. The wanted passage was on page 264.
 *
 * ## What this deliberately does NOT use
 *
 * **`<page-type>` as the PRIMARY signal.** On the Taylor volume one continuous
 * introduction is tagged `text` on most pages and `preface` on a scattered
 * sixteen, so it cannot carry the judgement alone —
 * `text-helpers-and-exports.md` records the general form: a read-time predicate
 * cannot recover a distinction the writer never encoded consistently. It IS
 * used as a third, subordinate signal for structural values only; see
 * STRUCTURAL_PAGE_TYPES below for why that is safe.
 *
 * **Scan-page position.** "The first 60 pages are front matter" is wrong often
 * enough to be dangerous — the Bekker 1831 volume's body starts on scan page 7
 * and it has no front matter at all, so a positional rule would bury 50+ pages
 * of genuine Aristotle. That mistake is not hypothetical: an earlier version of
 * the scenario test in `scripts/audit/mcp-feedback-scenarios.mjs` used exactly
 * that proxy, on exactly that book, and reported a failure that did not exist.
 *
 * ## What it uses instead — the printer's own convention
 *
 * Front matter is paginated in **roman numerals**, by centuries-old typographic
 * convention, precisely so it can be distinguished from the body. That is not a
 * heuristic about content; it is the book declaring its own structure, and the
 * OCR already extracts it into `<page-num>`. The running header does the same
 * job in words (`INTRODUCTION.`, `PREFACE`).
 *
 * Measured against the three books above:
 *
 *   Taylor 1801 Metaphysics  47 roman-numbered pages (scan 12–64), 52 with a
 *                            front-matter header — matching the reporter's
 *                            "9–61" complaint almost exactly
 *   Bekker 1831 vol. 2        0 roman, 0 front-matter headers — correct, it has
 *                            no front matter
 *   Thibault, Académie        1 roman (a late leaf), 0 headers — correct
 *
 * It fires where front matter exists and stays silent where it does not, which
 * is the property a positional rule lacks.
 */

/** A printed page number in roman numerals — i, iv, xxviii, and so on. */
const ROMAN_ONLY = /^[ivxlcdm]{1,12}$/i;

/**
 * Running heads that name a front- or back-matter division. Deliberately short:
 * every entry is a word a book prints at the top of a page to say what the
 * section IS, not a topic it might discuss.
 */
const STRUCTURAL_HEADER =
  /\b(introduction|preface|contents|advertisement|errata|dedication|prolegomena|to the reader|index|bibliograph|colophon|imprimatur)\b/i;

/**
 * `<page-type>` values that name a STRUCTURAL division rather than a subject.
 *
 * I rejected page-type entirely at first, on the Taylor volume where one
 * continuous introduction is typed `text` on most pages and `preface` on a
 * scattered sixteen. That reasoning was too broad. **Its failure mode there is
 * under-reporting, not over-reporting** — when it says `toc` or `index` it is
 * right; when it says `text` on an introduction it has merely told us nothing.
 * A signal that is silent-or-correct can only add coverage.
 *
 * That matters because the two original signals are both conventions of
 * Anglo-American book production. Reported from a live session (#3653): the
 * 1551 Aldine returned 57 pages of binding photographs, Torresano's address to
 * students, the Life of Aristotle from the Suda and the index, and NOT ONE was
 * flagged — its front matter is Greek and Latin, and it is foliated by
 * signature rather than roman numeral. That is precisely the material where the
 * apparatus is longest and the problem worst.
 *
 * `illustration` earns its place because on these scans it is the binding and
 * fore-edge photography — "the spine and corners are bound in plain, light brown
 * leather" — machine-written descriptions of the book as an object, never of its
 * text.
 *
 * DELIBERATELY EXCLUDED: `preface`, `dedication`, `advertisement`. Those are the
 * PROSE types, and prose is where the tagging is unreliable — a body page
 * mistyped `preface` would be demoted on no other evidence. A test pins that
 * exclusion. Every value kept here names a leaf that is structurally not prose,
 * so a mistag has to be gross rather than marginal to cause harm. The prose
 * cases are already covered by the running-head signal above.
 */
const STRUCTURAL_PAGE_TYPES = new Set([
  'toc', 'index', 'title-page', 'errata', 'colophon', 'illustration', 'blank', 'cover',
]);

/**
 * NOTE ON THE NAME. The flag is `is_front_matter` and it now also catches BACK
 * matter — blank endpapers, colophons, library date-due slips — because the
 * structural page-type signal does not care which end of the volume a leaf sits
 * at. On the Bekker volume it fires on pp.1-6 and pp.679-684.
 *
 * The behaviour is right: none of those are body text and none should outrank a
 * real passage. The name is kept because an MCP client already reads it (#3653)
 * and renaming a field an agent depends on costs more than the imprecision does.
 * The tool description says "front matter, blank leaves and binding" so a caller
 * is not misled by the field name alone.
 */
export interface FrontMatterVerdict {
  is_front_matter: boolean;
  /** Which signal fired — surfaced so a caller can judge, not just obey. */
  reason?: 'roman-pagination' | 'structural-header' | 'structural-page-type';
}

/**
 * Judge one page from its OCR. Returns `false` when there is no evidence — the
 * default must be "this is body text", because wrongly demoting real content is
 * the worse error and the reason a positional rule was rejected.
 */
export function frontMatterVerdict(ocr: string | null | undefined): FrontMatterVerdict {
  if (!ocr) return { is_front_matter: false };

  const printed = ocr.match(/<page-num>\s*([^<]{1,12}?)\s*<\/page-num>/)?.[1]?.trim();
  // A bare "i" or "c" is more often a stray letter or a signature mark than a
  // roman numeral, so require either two characters or an unambiguous one.
  if (printed && ROMAN_ONLY.test(printed) && (printed.length > 1 || /^[vx]$/i.test(printed))) {
    return { is_front_matter: true, reason: 'roman-pagination' };
  }

  const header = ocr.match(/<header>\s*([^<]{0,80}?)\s*<\/header>/)?.[1];
  if (header && STRUCTURAL_HEADER.test(header)) {
    return { is_front_matter: true, reason: 'structural-header' };
  }

  // Last, because it is the weakest of the three and must not pre-empt them:
  // a page can be typed `text` and still be an introduction, so a negative here
  // means nothing. A positive on a structural type is reliable.
  const pageType = ocr.match(/<page-type>\s*([^<]{1,30}?)\s*<\/page-type>/)?.[1]?.trim().toLowerCase();
  if (pageType && STRUCTURAL_PAGE_TYPES.has(pageType)) {
    return { is_front_matter: true, reason: 'structural-page-type' };
  }

  return { is_front_matter: false };
}

export function isFrontMatter(ocr: string | null | undefined): boolean {
  return frontMatterVerdict(ocr).is_front_matter;
}

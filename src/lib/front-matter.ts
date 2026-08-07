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
 * **`<page-type>`.** It looks like the right field and it is not reliable. On
 * that very book the same continuous introduction is tagged `text` on most
 * pages and `preface` on a scattered sixteen (pages 13, 14, 15, 18, 22, 31, 34,
 * 35, 41 …). `text-helpers-and-exports.md` records the general form of this:
 * a read-time predicate cannot recover a distinction the writer never encoded
 * consistently.
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

export interface FrontMatterVerdict {
  is_front_matter: boolean;
  /** Which signal fired — surfaced so a caller can judge, not just obey. */
  reason?: 'roman-pagination' | 'structural-header';
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

  return { is_front_matter: false };
}

export function isFrontMatter(ocr: string | null | undefined): boolean {
  return frontMatterVerdict(ocr).is_front_matter;
}

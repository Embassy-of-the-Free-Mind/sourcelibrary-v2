/**
 * Getting the TITLE PAGE out of a book's OCR.
 *
 * Shared by the regex pilot and the model pilot, because finding the page is the
 * half that worked. Everything here is measured against the corpus, not assumed:
 *
 *  - The title page is NOT page 1. Openers are covers, bindings, flyleaves and
 *    blanks; on the #3951 queue most page-1 records carry
 *    `<page-type>blank</page-type>`. Walk forward.
 *  - `pages.ocr` is an OBJECT — the text is `ocr.data`.
 *  - Container tags CARRY ATTRIBUTES (`<image-desc size="large" type=…>`), so a
 *    bare-tag strip leaves the whole description in the prose. That is how
 *    "Small printer's ornament" became an author candidate.
 *  - Title pages hyphenate across line breaks: "GVER- RA DI NICOLO MACHIAVEL-".
 *    Join before collapsing whitespace or the newline is already gone.
 */

/** Strip OCR scaffolding down to the words actually printed on the page. */
export function pageProse(raw) {
  return String(raw ?? '')
    .replace(/<(warning|meta|image-desc|insert|note|margin|vocab|figure)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/([A-Za-zÀ-ÿ])[-‐‑—]\s*\n\s*([A-Za-zÀ-ÿ])/g, '$1$2')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#+\s*/gm, ' ')
    .replace(/[*_`>]+/g, ' ')
    .replace(/->|<-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Title pages are set in capitals and the grammar rules in
 * `title-page-attribution.mjs` are all case-shaped (`GENITIVE_HEAD` has no `i`
 * flag, so "PONTANI" can never match a genitive ending). Only the REGEX pass
 * needs this; a model reads capitals fine and should be given the page as printed.
 */
export function softenCaps(s) {
  return String(s).replace(/\b[A-ZÀ-Ý][A-ZÀ-Ý'’À-Þ]{2,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());
}

export const pageType = (raw) =>
  (String(raw ?? '').match(/<page-type>\s*([^<]+)/i) || [])[1]?.trim().toLowerCase() || null;

const TITLE_TYPES = new Set(['title-page', 'titlepage', 'title page', 'half-title']);

/** First page the OCR itself calls a title page; else the first real prose page. */
export function pickTitlePage(pages) {
  const byNum = [...pages].sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));
  for (const p of byNum) {
    const raw = p.ocr?.data ?? p.ocr?.text ?? '';
    if (TITLE_TYPES.has(pageType(raw))) return { page_number: p.page_number, prose: pageProse(raw), via: 'page-type' };
  }
  for (const p of byNum) {
    const raw = p.ocr?.data ?? p.ocr?.text ?? '';
    const t = pageType(raw);
    if (t === 'blank' || t === 'illustration' || t === 'frontispiece') continue;
    const prose = pageProse(raw);
    if (prose.length >= 40) return { page_number: p.page_number, prose, via: 'first-prose' };
  }
  return null;
}

/** Fetch and pick, given an open `pages` collection and a book. */
export async function titlePageOf(pagesCol, book, maxPage = 14) {
  const key = book.id ?? book._id?.toString();
  const ps = await pagesCol.find(
    { book_id: key, page_number: { $gte: 1, $lte: maxPage } },
    { projection: { page_number: 1, 'ocr.data': 1, 'ocr.text': 1 } },
  ).toArray();
  if (!ps.length) return null;
  return pickTitlePage(ps);
}

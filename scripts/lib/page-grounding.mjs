/**
 * page-grounding.mjs — build the PAGE TEXT CONTEXT block fed to the image
 * captioner so it identifies an illustration's SUBJECT from the page's own
 * transcription instead of guessing from the book's topic (#2707).
 *
 * Principle: subject identity of a figurative scene is a text-grounded fact,
 * not a pixel fact. The OCR pass already read the caption/labels printed beside
 * the picture; this surfaces them to the vision pass with an explicit authority
 * hierarchy so a neighbour's topic can never override what's labelled on THIS
 * page (the "wrestlers → gymnosophists" failure).
 *
 * Authority, high → low:
 *   1. <image-desc> labelled ON this page (all of them, in order)
 *   2. this page's <summary>
 *   3. nearest substantive neighbour page (only when text-dense around the image)
 *   4. the book summary (last resort — only for a plate isolated among blanks)
 *
 * Text input is ~free next to the image, so we supplement generously; but when
 * an illustration sits among blank pages there are no useful neighbours, so we
 * fall back to the book summary rather than padding the prompt with blanks.
 *
 * TS twin: `src/lib/page-grounding.ts` (keep in sync; guard test
 * `tests/unit/page-grounding.test.ts` pins both).
 */

// Mirror of SKIP_MARKUP_RULES in src/lib/image-extraction-filter.ts — drop
// drop-caps, stamps, ornaments etc. so they don't pose as the illustration.
const TRIVIAL_RULES = [
  { type: 'symbol', significance: '*' },
  { type: 'stamp', significance: '*' },
  { type: 'ornament', significance: '*' },
  { type: 'blank', significance: '*' },
  { type: 'exlibris', significance: '*' },
  { type: 'bookplate', significance: '*' },
  { type: 'decorative', significance: 'low' },
  { type: "printer's mark", significance: 'low' },
  { type: 'photograph', significance: 'low' },
  { type: 'photographic', significance: 'low' },
];

/** A page with < this many stripped body chars is "sparse" (likely a plate or blank). */
export const SUBSTANTIVE_CHARS = 200;

const IMG_DESC_RE = /<image-desc([^>]*)>([\s\S]*?)<\/image-desc>/gi;
const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/i;

function isTrivial(type, sig) {
  return TRIVIAL_RULES.some(
    (r) => r.type === type && (r.significance === '*' || r.significance === sig),
  );
}

/** All non-trivial <image-desc> descriptions, in document order. Reads the
 *  first source that carries any (OCR usually; translation as fallback). */
export function extractImageDescs(...sources) {
  for (const src of sources) {
    if (!src) continue;
    const out = [];
    for (const m of src.matchAll(IMG_DESC_RE)) {
      const attrs = m[1] || '';
      const type = (attrs.match(/type="([^"]+)"/) || [])[1] || null;
      const sig = (attrs.match(/significance="([^"]+)"/) || [])[1] || null;
      const desc = (m[2] || '').trim();
      if (!desc) continue;
      if (isTrivial(type, sig)) continue;
      out.push(desc);
    }
    if (out.length) return out;
  }
  return [];
}

function firstSummary(...sources) {
  for (const src of sources) {
    if (!src) continue;
    const m = src.match(SUMMARY_RE);
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

/** Strip all tags and collapse whitespace — the page's readable body text. */
export function strippedBody(text) {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Build the grounding block.
 *
 * @param {object}   p
 * @param {string}   [p.ocr]          this page's ocr.data
 * @param {string}   [p.translation]  this page's translation.data
 * @param {number}   [p.pageNumber]   this page's page_number (for neighbour distance)
 * @param {Array<{page_number:number, ocr?:string, translation?:string}>} [p.neighbors]
 *                                    nearby pages (need NOT be illustration pages)
 * @param {string}   [p.bookSummary]  book-level summary, isolated-plate fallback
 * @param {number}   [p.radius]       neighbour search radius in pages (default 3)
 * @returns {string} grounding text (prefixed with a newline) or '' if nothing to add
 */
export function buildPageGrounding({
  ocr,
  translation,
  pageNumber,
  neighbors = [],
  bookSummary = '',
  radius = 3,
} = {}) {
  const imageDescs = extractImageDescs(ocr, translation);
  const pageSummary = firstSummary(translation, ocr);
  const localBody = strippedBody(ocr || translation);

  // Nearest neighbour with substantive text within radius (skip blanks).
  let neighborLine = '';
  if (typeof pageNumber === 'number' && neighbors.length) {
    const near = neighbors
      .filter((n) => typeof n.page_number === 'number' && n.page_number !== pageNumber)
      .map((n) => ({
        dist: Math.abs(n.page_number - pageNumber),
        signed: n.page_number - pageNumber,
        page_number: n.page_number,
        summary: firstSummary(n.translation, n.ocr),
        body: strippedBody(n.ocr || n.translation),
      }))
      .filter((n) => n.dist <= radius && (n.summary || n.body.length >= SUBSTANTIVE_CHARS))
      .sort((a, b) => a.dist - b.dist)[0];
    if (near) {
      const txt = near.summary || near.body.slice(0, 400);
      const rel = near.signed < 0 ? `${near.dist} page(s) before` : `${near.dist} page(s) after`;
      neighborLine = `Nearby text (page ${near.page_number}, ${rel}): ${txt}`;
    }
  }

  // Isolated plate: little local text AND no usable neighbour → lean on the book.
  const isolated = localBody.length < SUBSTANTIVE_CHARS && !neighborLine;

  const lines = [];
  if (imageDescs.length === 1) {
    lines.push(
      `Illustration labelled/transcribed ON this page (highest authority — describe THIS subject): ${imageDescs[0]}`,
    );
  } else if (imageDescs.length > 1) {
    lines.push(
      'Illustrations labelled/transcribed ON this page (highest authority — match each to what you see, in order):',
    );
    imageDescs.forEach((d, i) => lines.push(`  ${i + 1}. ${d}`));
  }
  if (pageSummary) lines.push(`Page summary: ${pageSummary}`);
  if (neighborLine) lines.push(neighborLine);
  if (isolated && bookSummary) {
    lines.push(
      `Book context (last resort only — lower authority than anything above; never use it to override a label on this image): ${bookSummary.slice(0, 500)}`,
    );
  }

  // Nothing structured — fall back to raw page text, then the book summary.
  if (lines.length === 0) {
    const txt = localBody.slice(0, 1200);
    if (txt) lines.push(`Page text (transcribed): ${txt}`);
    else if (bookSummary) lines.push(`Book context (no page text available): ${bookSummary.slice(0, 500)}`);
  }

  if (lines.length === 0) return '';
  return (
    "\nPAGE TEXT CONTEXT — grounded in the page's own transcription. Identify the " +
    "illustration's SUBJECT from this text; the book's general topic is background " +
    'only and must NEVER override a caption or label that appears on this page:\n' +
    lines.join('\n') +
    '\n'
  );
}

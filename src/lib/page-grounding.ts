/**
 * page-grounding.ts — TS twin of `scripts/lib/page-grounding.mjs`.
 *
 * Builds the PAGE TEXT CONTEXT block fed to the image captioner so it identifies
 * an illustration's SUBJECT from the page's own transcription instead of the
 * book's topic (#2707). See the `.mjs` twin for the full rationale and the
 * authority hierarchy. Keep the two in sync — the guard test
 * `tests/unit/page-grounding.test.ts` pins both.
 */

// Mirror of SKIP_MARKUP_RULES in image-extraction-filter.ts.
const TRIVIAL_RULES: ReadonlyArray<{ type: string; significance: string }> = [
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

/** A page with < this many stripped body chars is "sparse" (plate or blank). */
export const SUBSTANTIVE_CHARS = 200;

const IMG_DESC_RE = /<image-desc([^>]*)>([\s\S]*?)<\/image-desc>/gi;
const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/i;

function isTrivial(type: string | null, sig: string | null): boolean {
  return TRIVIAL_RULES.some(
    (r) => r.type === type && (r.significance === '*' || r.significance === sig),
  );
}

/** All non-trivial <image-desc> descriptions, in document order. */
export function extractImageDescs(...sources: Array<string | null | undefined>): string[] {
  for (const src of sources) {
    if (!src) continue;
    const out: string[] = [];
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

function firstSummary(...sources: Array<string | null | undefined>): string {
  for (const src of sources) {
    if (!src) continue;
    const m = src.match(SUMMARY_RE);
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

/** Strip all tags and collapse whitespace — the page's readable body text. */
export function strippedBody(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface GroundingNeighbor {
  page_number: number;
  ocr?: string | null;
  translation?: string | null;
}

export interface BuildPageGroundingArgs {
  ocr?: string | null;
  translation?: string | null;
  pageNumber?: number;
  neighbors?: GroundingNeighbor[];
  bookSummary?: string;
  radius?: number;
}

export function buildPageGrounding({
  ocr,
  translation,
  pageNumber,
  neighbors = [],
  bookSummary = '',
  radius = 3,
}: BuildPageGroundingArgs = {}): string {
  const imageDescs = extractImageDescs(ocr, translation);
  const pageSummary = firstSummary(translation, ocr);
  const localBody = strippedBody(ocr || translation);

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
      .filter((n) => n.dist <= radius && (!!n.summary || n.body.length >= SUBSTANTIVE_CHARS))
      .sort((a, b) => a.dist - b.dist)[0];
    if (near) {
      const txt = near.summary || near.body.slice(0, 400);
      const rel = near.signed < 0 ? `${near.dist} page(s) before` : `${near.dist} page(s) after`;
      neighborLine = `Nearby text (page ${near.page_number}, ${rel}): ${txt}`;
    }
  }

  const isolated = localBody.length < SUBSTANTIVE_CHARS && !neighborLine;

  const lines: string[] = [];
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

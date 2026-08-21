/**
 * Scripts-side twin of src/lib/image-extraction-filter.ts.
 *
 * Parity-pinned by tests/unit/image-extraction-filter-parity.test.ts —
 * change both sides together.
 *
 * Exists so batch scripts can apply the SAME "would the extraction worker
 * keep this page?" test the app applies, without a fourth hand-rolled copy.
 * (scripts/workers/image-extract-worker.mjs and pipeline-orchestrator.mjs
 * still carry their own inline copies; folding those in is a separate change.)
 */

export const SKIP_MARKUP_RULES = [
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

export const IMAGE_CANDIDATE_PAGE_TYPES = [
  'illustration',
  'diagram',
  'map',
  'frontispiece',
  'mixed',
  'title-page',
];

export function shouldSkipPageByMarkup(ocrData) {
  if (!ocrData) return false;
  if (ocrData.includes('<detected-images>')) return false;
  const tags = [...ocrData.matchAll(/<image-desc([^>]*)>/g)];
  if (tags.length === 0) return false;
  for (const m of tags) {
    const type = m[1].match(/type="([^"]+)"/)?.[1];
    const sig = m[1].match(/significance="([^"]+)"/)?.[1];
    const matched = SKIP_MARKUP_RULES.find(
      r => r.type === type && (r.significance === '*' || r.significance === sig),
    );
    if (!matched) return false;
  }
  return true;
}

export function extractImageDescTags(ocrData) {
  if (!ocrData) return [];
  const tags = [];
  const re = /<image-desc([^>]*)>([\s\S]*?)<\/image-desc>/g;
  for (const m of ocrData.matchAll(re)) {
    const attrs = m[1];
    tags.push({
      type: attrs.match(/type="([^"]+)"/)?.[1] ?? null,
      significance: attrs.match(/significance="([^"]+)"/)?.[1] ?? null,
      size: attrs.match(/size="([^"]+)"/)?.[1] ?? null,
      description: m[2].trim(),
    });
  }
  return tags;
}

/**
 * Trivial-markup skip filter for image extraction.
 *
 * Mirrors logic in scripts/workers/image-extract-worker.mjs and
 * scripts/workers/pipeline-orchestrator.mjs (keep all three in sync).
 *
 * A page can be skipped when every <image-desc> tag in its OCR text has
 * been classified by the OCR phase as one of the SKIP_MARKUP_RULES entries
 * — i.e. drop caps, library stamps, printer's ornaments, framing rules.
 */

export type SkipRule = { type: string; significance: '*' | 'low' | 'high' };

export const SKIP_MARKUP_RULES: readonly SkipRule[] = [
  { type: 'symbol', significance: '*' },
  { type: 'stamp', significance: '*' },
  { type: 'ornament', significance: '*' },
  { type: 'blank', significance: '*' },
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

export function shouldSkipPageByMarkup(ocrData: string | null | undefined): boolean {
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

export type ImageDescTag = {
  type: string | null;
  significance: string | null;
  size: string | null;
  description: string;
};

export function extractImageDescTags(ocrData: string | null | undefined): ImageDescTag[] {
  if (!ocrData) return [];
  const tags: ImageDescTag[] = [];
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

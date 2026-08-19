/**
 * gallery-image-types.mjs — the `gallery_images.type` vocabulary (.mjs twin).
 *
 * See `src/lib/gallery-image-types.ts` for the full rationale (#3419). Keep the
 * vocabulary and the coercion rules identical across both; the guard test
 * `tests/unit/gallery-image-types.test.ts` pins them against each other.
 */

/** @type {ReadonlySet<string>} */
export const VALID_IMAGE_TYPES = new Set([
  'woodcut', 'diagram', 'chart', 'illustration', 'symbol', 'table', 'map',
  'decorative', 'emblem', 'engraving', 'portrait', 'frontispiece', 'musical_score',
  'exlibris', 'bookplate', 'unknown',
]);

/**
 * Coerce a candidate type to something the field is allowed to hold.
 *
 *   - absent / null / empty  -> null        nothing was asserted
 *   - a valid token          -> the token
 *   - anything else          -> 'unknown'   a type WAS asserted; we can't use it
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function coerceImageType(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (VALID_IMAGE_TYPES.has(trimmed)) return trimmed;

  const normalized = trimmed.toLowerCase().replace(/[.,;:]+$/, '');
  if (VALID_IMAGE_TYPES.has(normalized)) return normalized;

  return 'unknown';
}

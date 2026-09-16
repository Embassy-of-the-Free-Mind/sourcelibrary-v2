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

/**
 * A detection the gallery should not hold, whatever its quality score.
 *
 * The extraction prompt has told the model to SKIP ornaments, borders, printer's
 * marks and initials since PR #450 — and the model ignores it a few times per
 * book, labelling a drop cap `decorative` at quality 0.5–0.75. Nothing after the
 * prompt checked: the three gallery writers admit on `gallery_quality >= 0.5`
 * alone, and the OCR-tag skip (`SKIP_MARKUP_RULES`) reads `type`/`significance`
 * attributes the `<image-desc>` tags mostly do not carry. Measured 2026-09-16:
 * 6,253 gallery rows described as an initial, 5,992 of them under 5% of the page;
 * 7,265 rows typed `decorative`, of which 6,141 are under 5% — initials, manicules,
 * tailpieces, running-head ornaments (#4780 widened rounds, Paracelsus 'P').
 *
 * The rule is SMALL and (typed decorative or described as an initial). A large
 * decorative — a historiated initial with a scene, a full-page border — stays:
 * those are the woodcuts a reader searches the gallery for.
 *
 * Keep identical to the TS twin; `tests/unit/gallery-image-types.test.ts` pins it.
 */
export const TRIVIAL_MAX_AREA = 0.05;
const INITIAL_WORDS = /\b(initial|initials|drop[- ]caps?|lettrine|versal)\b/i;

/**
 * @param {{ type?: unknown, description?: unknown, bbox?: { width?: unknown, height?: unknown } | null } | null | undefined} img
 * @returns {boolean}
 */
export function isTrivialGalleryDetection(img) {
  if (!img || !img.bbox) return false;
  const w = Number(img.bbox.width), h = Number(img.bbox.height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
  if (w * h >= TRIVIAL_MAX_AREA) return false;
  const type = coerceImageType(img.type);
  const desc = typeof img.description === 'string' ? img.description : '';
  return type === 'decorative' || INITIAL_WORDS.test(desc);
}

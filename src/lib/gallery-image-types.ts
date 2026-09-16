/**
 * The `gallery_images.type` vocabulary — one definition, and the coercion that
 * keeps non-values out of the field (#3419).
 *
 * ## Why this file exists
 *
 * The field is supposed to hold one of a small set of tokens. It held 113 distinct
 * values, 96 of which were chunks of the extraction model's raw response — up to
 * 4,152 characters, including the model's own visible deliberation:
 *
 *     "diagramBase64: diagram; bbox: [0.01, 0.03, 0.98, 0.94] (covers all three
 *      leaves) - wait, the type must be exactly one of the list. I will use 'diagram'."
 *
 * The model reasoned about which enum value to pick, and the reasoning was stored
 * *as* the enum value. This is the same reasoning-as-output class already documented
 * for OCR in `CLAUDE.md` (`pages.ocr.data` holding `-> wait, ... is on the same line
 * as`, PR #3273), reappearing in a different writer. The lesson generalises: a field
 * that must hold one of N values needs validation at WRITE time, because the model
 * will occasionally narrate instead of answer, and nothing downstream can tell
 * narration from a value.
 *
 * The vocabulary itself is not new — it was already written out, twice and verbatim,
 * in `src/lib/types/prompts/defaults.ts` and `src/app/api/gallery/image/[id]/route.ts`.
 * Both of those validated correctly. The extraction path simply never consulted them,
 * which is why the guard now lives at the shared document builder that every
 * extraction writer passes through rather than in any one writer.
 *
 * Keep in sync with the `scripts/lib/gallery-image-types.mjs` twin.
 */

/**
 * The canonical vocabulary. Sourced from the two pre-existing validators, which
 * agreed with each other exactly.
 *
 * Note this is WIDER than the enum offered in the extraction prompt
 * (`src/lib/image-extraction.ts`), which lists ten. `chart`, `table`, `illustration`,
 * `bookplate`, `decorative` and `unknown` are all live in production and legitimate —
 * so validating against the prompt's list would reject good data. If you narrow this
 * set, re-measure the corpus first.
 */
export const VALID_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'woodcut', 'diagram', 'chart', 'illustration', 'symbol', 'table', 'map',
  'decorative', 'emblem', 'engraving', 'portrait', 'frontispiece', 'musical_score',
  'exlibris', 'bookplate', 'unknown',
]);

/**
 * Coerce a candidate type to something the field is allowed to hold.
 *
 * The three-way result is deliberate, and answers the open question in #3419 about
 * whether `null` should become `unknown`:
 *
 *   - absent / null / empty  -> `null`      nothing was asserted
 *   - a valid token          -> the token
 *   - anything else          -> `'unknown'` a type WAS asserted; we just can't use it
 *
 * Collapsing the first and third cases would throw away a real distinction — "the
 * detector said nothing" and "the detector said something unusable" are different
 * facts, and only the second one is evidence that a prompt or model needs attention.
 *
 * Trailing-punctuation near-misses (`"diagram,"`) are repaired rather than discarded:
 * they are the same value wearing a comma, and there were three such families in
 * production. Anything beyond that is not guessed at.
 */
export function coerceImageType(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (VALID_IMAGE_TYPES.has(trimmed)) return trimmed;

  // Cheap, bounded repair: lowercase and strip trailing punctuation. This recovers
  // `"diagram,"` and `"Diagram."` without opening the door to substring guessing —
  // a 4KB blob that merely CONTAINS the word "diagram" still fails, and should.
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
 * Keep identical to the .mjs twin; `tests/unit/gallery-image-types.test.ts` pins it.
 */
export const TRIVIAL_MAX_AREA = 0.05;
const INITIAL_WORDS = /\b(initial|initials|drop[- ]caps?|lettrine|versal)\b/i;

export interface TrivialCandidate {
  type?: unknown;
  description?: unknown;
  bbox?: { width?: unknown; height?: unknown } | null;
}

export function isTrivialGalleryDetection(img: TrivialCandidate | null | undefined): boolean {
  if (!img || !img.bbox) return false;
  const w = Number(img.bbox.width), h = Number(img.bbox.height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
  if (w * h >= TRIVIAL_MAX_AREA) return false;
  const type = coerceImageType(img.type);
  const desc = typeof img.description === 'string' ? img.description : '';
  return type === 'decorative' || INITIAL_WORDS.test(desc);
}

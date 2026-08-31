/**
 * JS twin of the OCR-result parsers in `src/lib/types/prompts/defaults.ts` (#4443).
 *
 * Why a separate copy: pipeline scripts run as plain `.mjs` and cannot import the
 * `@/`-aliased TS module. Same reason as `scripts/lib/page-image-url.mjs`, and the
 * same guarantee — `tests/unit/ocr-result-parse.test.ts` runs both implementations
 * over one fixture corpus and fails if they disagree, so an edit to either side
 * breaks CI instead of drifting.
 *
 * Before this file existed, six scripts each carried a private copy that imported
 * nothing:
 *
 *   scripts/batch/collect-batch-results.mjs     scripts/split-book.mjs
 *   scripts/batch/collect-multipage-ocr.mjs     scripts/workers/batch-collector.mjs
 *   scripts/batch/realtime-ocr.mjs              scripts/batch/realtime-reocr-efm.mjs
 *
 * They had drifted into five mutually incompatible behaviours — two screened the
 * model's page type against separately-stale vocabularies, four screened it not at
 * all, and one had lost the `i` flag. Because the failure mode is *missing
 * metadata* rather than an error, nothing ever went red. These are the collectors
 * that read batch output we have already spent money to generate.
 *
 * `parseDetectedImages` joined in #4456 — five of those scripts carried a parser
 * for an `<image>`-sub-tag format the prompt never asked for. See its docblock.
 *
 * KEEP IN LOCKSTEP WITH `src/lib/types/prompts/defaults.ts`.
 */
import { VALID_IMAGE_TYPES } from './gallery-image-types.mjs';

/**
 * Bump in `defaults.ts`; this mirrors it. Pinned by the parity test.
 *
 * NOTE for collectors: this is the version of the prompt *this checkout* would
 * send, not the version any given batch job was submitted with. To stamp
 * `ocr.prompt_version` on a collected page, read it off the job record — a job
 * submitted months ago did not use this prompt, and stamping it with today's
 * value fabricates provenance.
 */
export const PROMPT_VERSION = 'v6.1.2026-05';

/** Page-type vocabulary accepted from the model. Mirrors VALID_PAGE_TYPES in defaults.ts. */
export const VALID_PAGE_TYPES = new Set([
  'title-page', 'frontispiece', 'dedication', 'preface', 'toc', 'index',
  'errata', 'colophon', 'appendix', 'blank', 'illustration', 'diagram', 'map', 'text',
  'digitizer-insert', 'exlibris', 'bookplate',
]);

/**
 * Extract <page-type> from OCR text. Returns undefined if not found or invalid.
 *
 * `validate: false` returns whatever the model emitted (trimmed, lower-cased)
 * without screening it against VALID_PAGE_TYPES. That is not a preference — it is
 * what four batch collectors have always done, and the two vocabularies genuinely
 * disagree: the OCR prompt offers `musical-score`, `table` and `cover`, none of
 * which VALID_PAGE_TYPES lists. Flipping those callers to validating would
 * silently stop three prompt-sanctioned types from being recorded, so the
 * divergence is a parameter rather than a fork. See #4455 for the gap itself.
 *
 * Unlike the TS canonical this tolerates a non-string argument, because
 * `split-book.mjs` passes `page.ocr`, which is null on an un-OCR'd page.
 */
export function extractPageType(ocrText, { validate = true } = {}) {
  const match = ocrText?.match(/<page-type>([\s\S]*?)<\/page-type>/i);
  if (!match) return undefined;
  const type = match[1].trim().toLowerCase();
  if (!validate) return type || undefined;
  return VALID_PAGE_TYPES.has(type) ? type : undefined;
}

/** Extract <columns>N</columns> from OCR text. Returns undefined if not found or 1. */
export function extractColumns(ocrText) {
  const match = ocrText?.match(/<columns>\s*(\d+)\s*<\/columns>/i);
  if (!match) return undefined;
  const n = parseInt(match[1], 10);
  return n > 1 ? n : undefined;
}

/** Extract <script>printed|handwritten|mixed</script> from OCR text. */
export function extractScriptType(ocrText) {
  const match = ocrText?.match(/<script>([\s\S]*?)<\/script>/i);
  if (!match) return undefined;
  const type = match[1].trim().toLowerCase();
  if (type === 'handwritten' || type === 'mixed' || type === 'printed') return type;
  return undefined;
}

/**
 * Parse the `<detected-images>` JSON block into DetectedImage-shaped objects.
 * Returns `[]` when the block is absent, is not a JSON array, or fails to parse.
 *
 * ## Why this one arrived a release late (#4456)
 *
 * #4443 consolidated the other four parsers and deliberately skipped this one,
 * because the five scripts-side copies were not forks of the canonical — they
 * walked `<image>…</image>` sub-tags with `<description>`/`<type>`/`<bbox>`
 * children, a shape no OCR prompt in this repo has ever asked for. The current
 * prompt asks for a JSON array, so JSON is what the model emits, so the XML
 * walkers matched nothing and returned `[]` on every page they were handed.
 * Every call site guarded with `if (detectedImages.length > 0)`, so nothing was
 * written and nothing errored: the collectors simply never recorded a detected
 * image, for as long as they have existed.
 *
 * No XML fallback is kept, and no fallback is needed. Measured 2026-08-31 over
 * EVERY page in `pages` holding a `<detected-images>` block — 31,210 of them, a
 * full scan rather than a sample — exactly 0 were `<image>`-shaped. A fallback
 * would be a fallback for output that was never produced, and it would put a
 * branch in this file that the TS canonical does not have, which is the drift the
 * parity test exists to prevent. Re-measure with
 * `scripts/audit/detected-images-parse-gap.mjs --full` before reintroducing one.
 *
 * Note the two shapes also disagreed about the *schema they wrote*: the walkers
 * emitted `bbox: {x1,y1,x2,y2}` in pixels plus a `subject` array, and no
 * `detection_source`/`detected_at`. The canonical writes fractional
 * `{x,y,width,height}` and stamps provenance. Since the walkers never wrote a
 * row, there is no legacy pixel-bbox data from this path to migrate — but do not
 * reintroduce the pixel shape: `detected_images.bbox` is read as fractional
 * (see `.claude/docs/invariants/image-quality-and-bboxes.md`).
 *
 * @param {string} ocrText
 * @returns {Array<Record<string, unknown>>}
 */
export function parseDetectedImages(ocrText) {
  const match = ocrText?.match(/<detected-images>([\s\S]*?)<\/detected-images>/i);
  if (!match) return [];

  try {
    const raw = JSON.parse(match[1].trim());
    if (!Array.isArray(raw)) return [];

    const now = new Date();
    return raw
      .filter((img) => img && typeof img.description === 'string')
      .map((img) => {
        const result = {
          description: img.description,
          detection_source: 'ocr_tag',
          detected_at: now,
        };

        if (typeof img.type === 'string' && VALID_IMAGE_TYPES.has(img.type)) {
          result.type = img.type;
        }

        if (img.bbox && typeof img.bbox === 'object') {
          const b = img.bbox;
          if (typeof b.x === 'number' && typeof b.y === 'number' &&
              typeof b.width === 'number' && typeof b.height === 'number') {
            result.bbox = { x: b.x, y: b.y, width: b.width, height: b.height };
          }
        }

        if (typeof img.gallery_quality === 'number') {
          result.gallery_quality = Math.max(0, Math.min(1, img.gallery_quality));
        }

        if (typeof img.museum_rationale === 'string') {
          result.gallery_rationale = img.museum_rationale;
        }

        if (typeof img.confidence === 'number') {
          result.confidence = img.confidence;
        }

        if (typeof img.museum_description === 'string') {
          result.museum_description = img.museum_description;
        }

        if (img.metadata && typeof img.metadata === 'object') {
          const m = img.metadata;
          result.metadata = {};
          if (Array.isArray(m.subjects)) result.metadata.subjects = m.subjects.filter((s) => typeof s === 'string');
          if (Array.isArray(m.figures)) result.metadata.figures = m.figures.filter((s) => typeof s === 'string');
          if (Array.isArray(m.symbols)) result.metadata.symbols = m.symbols.filter((s) => typeof s === 'string');
          if (typeof m.style === 'string') result.metadata.style = m.style;
          if (typeof m.technique === 'string') result.metadata.technique = m.technique;
        }

        return result;
      });
  } catch {
    // Malformed JSON — not unusual from AI output
    return [];
  }
}

/**
 * Parse a multi-page OCR response into a Map of pageId → OCR text.
 *
 * `lenient: true` is the batch-collector dialect, and it differs in four ways that
 * all exist for one reason — a truncated Gemini batch response drops the final
 * `</page>`, and the strict parser silently discards that page's text even though
 * we already paid to generate it:
 *   1. accepts any whitespace in `<page   id="…">`, not one literal space;
 *   2. does not require `</page>` — a block runs to the next `<page id=` or EOF;
 *   3. strips a trailing `</page>` left over from (2);
 *   4. omits pages whose content is empty after trimming.
 * Callers on the request path keep the strict default.
 */
export function parseMultiPageOcr(text, { lenient = false } = {}) {
  const results = new Map();
  if (lenient) {
    const regex = /<page\s+id="([^"]+)">([\s\S]*?)(?=<page\s+id="|$)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const content = match[2].trim().replace(/<\/page>\s*$/, '').trim();
      if (content) results.set(match[1], content);
    }
    return results;
  }
  const regex = /<page id="([^"]+)">([\s\S]*?)<\/page>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.set(match[1], match[2].trim());
  }
  return results;
}

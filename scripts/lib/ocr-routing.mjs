/**
 * PRIOR ART: scripts/lib/translate-core.mjs — holds the same policy for the
 * TRANSLATION phase (getTranslateModelForBook) and is documented as "the one
 * door" for translation writes. It does not cover OCR, and the OCR side had
 * grown two private copies of the allowlist instead
 * (scripts/workers/pipeline-orchestrator.mjs, scripts/migration/backfill-ocr-near-complete.mjs),
 * neither importable by a test because the orchestrator runs `run()` on import.
 * This module is the importable OCR-side door those copies now share.
 *
 * ocr-routing — which Gemini model OCRs a given book.
 *
 * There were three live copies of this policy (TS for API routes/Lambda, the
 * orchestrator's private copy, a migration script's private copy) and the
 * parity test could only see two of them. The unwatched pair drifted: both
 * carried `malay`/`ms`/`msa`, which the canonical list excludes on purpose,
 * so Malay books were OCR'd on lite (wrong) and translated on flash (right).
 *
 * So this module does not keep an allowlist of its own: it imports the
 * canonical one from translate-core.mjs. OCR and translation are the same
 * question — "can flash-lite read this script?" — and a second list is a
 * second thing to forget. If OCR ever needs to diverge from translation,
 * that is a deliberate change and the parity test below must say so.
 *
 * Parity across every remaining implementation is pinned by
 * tests/unit/translate-core-parity.test.ts.
 */

import { LATIN_SCRIPT_LANGUAGES, MODEL_FLASH, MODEL_LITE } from './translate-core.mjs';

// Re-exported under OCR-phase names so call sites read honestly. There is one
// pair of models, not two — these ARE translate-core's constants.
export const OCR_MODEL_FLASH = MODEL_FLASH;
export const OCR_MODEL_LITE = MODEL_LITE;

/**
 * THE model routing for OCR. Mirrors getModelForBook in
 * src/lib/types/ai-models.ts and getTranslateModelForBook in translate-core.mjs.
 *
 * - BPH books: full flash (high-quality manuscripts)
 * - Non-Latin scripts: full flash (flash-lite hallucinates)
 * - Latin-script European languages: flash-lite (50% cheaper)
 * - Unknown/null language: full flash (safer default)
 */
export function getOcrModelForBook(book) {
  if (book?.image_source?.provider === 'bph') return OCR_MODEL_FLASH;
  const lang = (book?.language || '').toLowerCase().trim();
  if (!lang || !LATIN_SCRIPT_LANGUAGES.has(lang)) return OCR_MODEL_FLASH;
  return OCR_MODEL_LITE;
}

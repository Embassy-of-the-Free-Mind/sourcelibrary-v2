/**
 * PRIOR ART: scripts/lib/translate-core.mjs — held the same policy for the
 * TRANSLATION phase (getTranslateModelForBook) until the two split in #4759, and
 * is documented as "the one door" for translation writes. It does not cover OCR, and the OCR side had
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
import { toLanguageCodes, codeFamily } from './language-normalize.mjs';

// Re-exported under OCR-phase names so call sites read honestly. There is one
// pair of models, not two — these ARE translate-core's constants.
export const OCR_MODEL_FLASH = MODEL_FLASH;
export const OCR_MODEL_LITE = MODEL_LITE;

/**
 * OCR_LITE_ONLY — the deliberate divergence the header comment reserves.
 *
 * Derek, 2026-09-11: "OCR should only be flash-lite batch, in the meantime."
 * The August usage log showed the OCR lane dominated by gemini-3-flash-preview
 * rows (BPH, non-Latin/unknown language, and recitation tier 2 all route there)
 * at ~2x the input price, while the spend dial is $5/day. Until the dial is
 * raised, every batch OCR submission uses flash-lite, and the recitation ladder
 * skips its flash-preview tier (tier 3, MinerU, is not a Gemini model and is
 * unaffected). Translation routing is untouched — this is OCR only.
 *
 * Default ON. Set OCR_LITE_ONLY=0 in the orchestrator's environment (Hetzner
 * crontab / .env) to restore script-aware routing without a deploy.
 * tests/unit/translate-core-parity.test.ts pins both behaviours.
 */
export const OCR_LITE_ONLY = process.env.OCR_LITE_ONLY !== '0';

/**
 * The one exception to OCR_LITE_ONLY: Greek reads on flash (#5575).
 *
 * Derek, 2026-10-02, on the DECISIONS-PENDING row "Read Greek and Chinese OCR
 * with Flash again (Batch)": yes for new pages and for the visible and held
 * Greek backlog; NOT for the hidden Greek backlog (~1.8M pp), which waits for
 * #4884 because many books catalogued Greek are Latin on the page. Chinese was
 * taken out of scope the same day, pending PaddleOCR-VL vs Flash on non-Siku
 * Quanshu pages (#5574) — do not add it here without that comparison.
 * Evidence: Greek median CER 6.6% on flash vs 11% on lite, 176 referenced
 * books; cost basis on #5575 (~2x per page on Batch).
 *
 * The test reads only fields the router already reads or that every book row
 * carries — no new field:
 * - the FIRST language of `books.language` is in the Greek family, read through
 *   the pinned normaliser's closed vocabulary (toLanguageCodes / codeFamily,
 *   the code API `routing_lane` will use): "Greek", "grc", "Byzantine Greek",
 *   "Modern Greek" and "Greek, Latin" qualify; "Latin, Greek" (a Latin book
 *   with Greek in it) and "Judeo-Greek" (Hebrew script) do not;
 * - and the book is visible, or was created on or after the decision date
 *   ("new pages"). A HIDDEN book created before it is the unapproved backlog
 *   and stays on lite. Held books keep their hold (no worker selects them); a
 *   visible held book reads on flash when it is released.
 *
 * A caller that does not project `visible` and `created_at` falls back to lite:
 * the cheap direction. Every projection that feeds getOcrModelForBook carries
 * `language`, `image_source.provider`, `visible` and `created_at`.
 */
export const GREEK_FLASH_FROM = new Date('2026-10-02T00:00:00Z');

export function isGreekFlashOcrBook(book) {
  const first = toLanguageCodes(book?.language).codes[0];
  if (!first || codeFamily(first) !== 'grc') return false;
  if (book?.visible === true) return true;
  const created = book?.created_at ? new Date(book.created_at) : null;
  return !!created && !Number.isNaN(created.getTime()) && created >= GREEK_FLASH_FROM;
}

/** Model for the recitation escalation tier that used to be flash-preview. */
export function ocrEscalationModel() {
  return OCR_LITE_ONLY ? OCR_MODEL_LITE : OCR_MODEL_FLASH;
}

/**
 * THE model routing for OCR. Mirrors getModelForBook in
 * src/lib/types/ai-models.ts — except under OCR_LITE_ONLY (above), when every
 * book routes to flash-lite but the Greek exception (isGreekFlashOcrBook).
 *
 * It does NOT mirror translation routing any more. Since #4759,
 * getTranslateModelForBook (translate-core.mjs) sends non-Latin scripts to
 * flash-lite too: the hallucination evidence behind the carve-out below is
 * about reading IMAGES (vision), and translation reads text. The two policies
 * diverge on purpose — do not re-sync them in either direction without new
 * evidence. tests/unit/translate-core-parity.test.ts pins the split.
 *
 * - BPH books: full flash (high-quality manuscripts)
 * - Non-Latin scripts: full flash (flash-lite hallucinates when visual decoding is hard, #1726)
 * - Latin-script European languages: flash-lite (50% cheaper)
 * - Unknown/null language: full flash (safer default)
 */
export function getOcrModelForBook(book, { liteOnly = OCR_LITE_ONLY } = {}) {
  if (liteOnly) return isGreekFlashOcrBook(book) ? OCR_MODEL_FLASH : OCR_MODEL_LITE;
  if (book?.image_source?.provider === 'bph') return OCR_MODEL_FLASH;
  const lang = (book?.language || '').toLowerCase().trim();
  if (!lang || !LATIN_SCRIPT_LANGUAGES.has(lang)) return OCR_MODEL_FLASH;
  return OCR_MODEL_LITE;
}

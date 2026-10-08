// PRIOR ART: en-ocr-reference-5124.mjs:694 tests finishReason against the same refusal set, inline,
// for one runner's outcome label; ocr-error-classes.py (#5572) calls any output under 30 folded
// characters a "refusal" — a misread on the Greek strata (Greek letters only) and on Japanese leaves
// where Gemini returns a genuinely empty STOP. Neither reads the run's meter, and neither is
// importable by benchmark-score.mjs and benchmark-dashboard-data.mjs together.
/**
 * refusals.mjs — was an empty OCR output a REFUSAL (the engine declined the page) or a blank read?
 *
 * The run's own record decides: benchmark-run-api.mjs appends one row per attempt to
 * <root>/<stratum>/out/<engine>/_meter.jsonl with Gemini's finishReason; the LAST row per slug is
 * the one whose text is on disk (a resumed run re-runs empty pages). Only where an API engine left
 * no meter row is a refusal inferred — from a ZERO-BYTE output on a page with a substantial
 * reference — and the result says so (`source: 'inferred'`).
 */
import fs from 'fs';
import path from 'path';

// Gemini finishReasons that mean "declined", and the runners' own 'refusal' (lib/runners.mjs).
export const REFUSAL_REASONS = /^(RECITATION|PROHIBITED_CONTENT|SAFETY|BLOCKLIST|SPII|IMAGE_SAFETY|refusal)$/i;
// Engines that can refuse at all. A local engine's empty output is a blank read, never a refusal.
export const API_ENGINE = /^(gemini|claude|gpt|o\d|mistral)/i;
// "a page that has a substantial reference" (#5581): enough reference text that an empty read is
// not a plausible answer.
export const MIN_REF_CHARS = 200;

/** slug → last meter row, or null when the engine directory has no meter. */
export function readMeter(engineDir) {
  const f = path.join(engineDir, '_meter.jsonl');
  if (!fs.existsSync(f)) return null;
  const m = new Map();
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row && row.slug) m.set(row.slug, row);
  }
  return m;
}

/**
 * { refused, source, finish_reason } for one page × engine.
 *   meterRow  last meter row for the slug, or undefined
 *   rawText   the output file's text (null when the engine never ran the page)
 *   refChars  reference length in characters, or 0 when the page has none
 */
export function refusalOf({ engine, meterRow, rawText, refChars = 0 }) {
  if (rawText == null) return { refused: false, source: null, finish_reason: null };
  if (meterRow) {
    const fr = meterRow.finishReason || null;
    // A refusal that still returned text is a partial read, not a declined page.
    return { refused: !!fr && REFUSAL_REASONS.test(fr) && !rawText.trim(), source: 'finishReason', finish_reason: fr };
  }
  if (API_ENGINE.test(engine) && rawText.length === 0 && refChars >= MIN_REF_CHARS) return { refused: true, source: 'inferred', finish_reason: null };
  return { refused: false, source: null, finish_reason: null };
}

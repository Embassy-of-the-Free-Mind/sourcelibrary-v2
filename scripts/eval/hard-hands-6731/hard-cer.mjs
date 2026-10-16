/**
 * PRIOR ART: lib/metrics.mjs `normalizeForScript` + `windowedErrorRate` (the scorer, used unchanged; SCRIPT_DEFS.greek
 * and SCRIPT_DEFS.hebrew are its folds); lib/sefaria-fit.mjs `cleanSegment` (Sefaria markup → text, footnotes dropped
 * with their content); lib/edition-window.mjs `stripTags` (house metadata blocks dropped). syriac-pareto-6295/
 * syriac-cer.mjs is the fixture-pinned scorer pattern this follows; it is Syriac-only.
 *
 * hard-cer.mjs — the #6731 scorer (PREREGISTRATION-hard-hands-6731.md): page CER of a read against a reference
 * PASSAGE (an edition span for Greek, a Sefaria span for Rashi pages). Fitting alignment: the read's text before
 * and after the passage is free (headers, other blocks on the page), text inside it is charged. CER capped at 1.
 * The Hebrew def adds only the Sefaria markup step in front of SCRIPT_DEFS.hebrew; no script's fold changes.
 * Pinned by scripts/eval/fixtures/hebrew/*.json through tests/unit/hard-hands-cer.test.ts (#5123).
 */
import { normalizeForScript, windowedErrorRate } from '../lib/metrics.mjs';
import { cleanSegment } from '../../lib/sefaria-fit.mjs';
import { stripTags } from '../lib/edition-window.mjs';

export const HARD_CER_VERSION = 'hard-cer/1';

/** A read or reference → the scored letters of `script`, words space-separated (SCRIPT_DEFS fold). */
export function normRead(text, script) {
  return normalizeForScript(stripTags(String(text || '')), script);
}

/** Sefaria segment text (HTML, footnote markers, inline footnotes) → Hebrew letters as the scorer sees them. */
export function normSefaria(text) {
  return normalizeForScript(cleanSegment(text), 'hebrew');
}

/** { cer, ref_letters, read_letters } — `refIsSefaria` cleans Sefaria markup on the reference first. */
export function hardCer(read, reference, script, { refIsSefaria = false } = {}) {
  const ref = refIsSefaria ? normSefaria(reference) : normRead(reference, script);
  const hyp = normRead(read, script);
  const w = windowedErrorRate(ref, hyp);
  return { cer: Math.min(1, w.windowedCer), ref_letters: w.windowUnits, read_letters: hyp.replace(/ /g, '').length };
}

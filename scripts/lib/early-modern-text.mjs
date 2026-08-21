/**
 * Early-modern typography helpers for OCR correction.
 *
 * WHY: layout OCR engines (MinerU) do not understand pre-1820 typography. The
 * dominant artefact is the long s (ſ) being read as "f" — "firft finne" for
 * "first sinne", "Herefy and Atheifme" for "Heresy and Atheisme". The MinerU
 * worker's quality gate screens for run-together text and short output; it does
 * NOT catch letter substitution, so mangled pre-1820 pages pass it silently and
 * reach readers looking like confident OCR.
 *
 * These helpers give the correction lane a deterministic normalisation step and
 * a detector that can refuse to write text still carrying the artefact — never
 * trust the model to have followed the instruction (measured: it normalised on
 * two pages of a three-page sample and emitted raw ſ on the third).
 */

/** Long s and its ligatures → modern equivalents. Deterministic, lossless for reading. */
export function normalizeLongS(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/ſ/g, 's')   // ſ LATIN SMALL LETTER LONG S
    .replace(/ﬅ/g, 'st')  // ﬅ LONG S T ligature
    .replace(/ﬆ/g, 'st'); // ﬆ ST ligature
}

/**
 * Words that are only plausible as long-s misreads. Deliberately conservative:
 * every entry is a real early-modern word whose "f" spelling is not an English
 * word, so a hit is evidence of the artefact rather than of period spelling.
 *
 * NOT included: "fame" (a real word — "the fame time" is a misread but "fame"
 * alone is legitimate), "fo", "fon". Those need context, and a noisy detector
 * gets bypassed.
 */
const LONG_S_ARTEFACTS = [
  'firft', 'moft', 'muft', 'juft', 'laft', 'beft', 'worft',
  'fhall', 'fhould', 'fhe', 'fuch', 'fome', 'felf', 'fince',
  'thefe', 'thofe', 'whofe', 'houfe', 'caufe', 'becaufe', 'ufe',
  'confecration', 'diftribution', 'afpiring', 'herefy', 'atheifme',
  'philofopher', 'philofophy', 'majefty', 'perfon', 'prefent', 'poffeft',
  'obfervance', 'facrifices', 'bufineffe',
  'expreffe', 'invefted', 'afcribed', 'prieft', 'pofterity',
];
// Deliberately absent, and they must stay absent — each is an ordinary English
// word, so listing it turns a correct page into a rejected one:
//   infinite, anxiety, fire, reft ("reft" is archaic English for "bereft").
// A gate that rejects good pages gets bypassed, which is worse than no gate.
const ARTEFACT_RE = new RegExp(`\\b(${LONG_S_ARTEFACTS.join('|')})\\b`, 'gi');

/**
 * Count long-s artefacts remaining in a text.
 * Returns { count, samples } — samples for the operator to eyeball.
 */
export function detectLongSArtefacts(text) {
  if (typeof text !== 'string' || !text) return { count: 0, samples: [] };
  const raw = (text.match(/ſ/g) || []).length;      // literal ſ still present
  const subs = text.match(ARTEFACT_RE) || [];
  const samples = [...new Set(subs.map(s => s.toLowerCase()))].slice(0, 8);
  return { count: raw + subs.length, samples, rawLongS: raw, substitutions: subs.length };
}

/**
 * Is this text acceptable to write as corrected OCR?
 * Rejects when the "correction" still carries the artefact it was meant to fix.
 *
 * @param {string} corrected
 * @param {string} original - the pre-correction text, for a relative check
 */
export function isCorrectionAcceptable(corrected, original) {
  if (typeof corrected !== 'string' || corrected.trim().length === 0) {
    return { ok: false, reason: 'empty output' };
  }
  const after = detectLongSArtefacts(corrected);
  if (after.count === 0) return { ok: true, reason: 'clean' };

  const before = detectLongSArtefacts(original || '');
  // Allow a residue only if it is a large improvement AND small in absolute terms;
  // otherwise the model did not do the job and we must not overwrite.
  if (before.count > 0 && after.count <= Math.min(2, before.count * 0.1)) {
    return { ok: true, reason: `residual ${after.count} (from ${before.count})` };
  }
  return {
    ok: false,
    reason: `long-s artefacts remain: ${after.count} (was ${before.count}) e.g. ${after.samples.join(', ')}`,
  };
}

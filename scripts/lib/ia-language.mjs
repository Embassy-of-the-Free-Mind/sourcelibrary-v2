/**
 * IA's own language signals, in priority order, for plain-node importers.
 *
 * PRIOR ART: src/lib/resolve-language.ts is the full contract (#2184/#2185) and
 * src/app/api/import/ia/route.ts already applies it — passing IA's `ocr_detected_lang` ABOVE its
 * catalogued `metadata.language`, both above the caller. There is no mjs twin of that resolver, and
 * building one is not free: it depends on `displayLanguage` from src/lib/language-utils.ts, which
 * DISAGREES with scripts/lib/language-normalize.mjs on period-qualified names — displayLanguage
 * strips the qualifier ("Middle High German" -> "High german"), normalizeLanguageToken keeps it. A
 * twin would have to settle that first. So this file deliberately does the smaller, checkable thing:
 * extract IA's two signals, normalise them with the existing pinned twin, and apply the same
 * precedence for the one case the direct importers face.
 *
 * WHY IT EXISTS. Every direct IA importer asserts a HARDCODED language and never looks at the
 * source: `founding-tail-direct.mjs` writes `language: s.lang` with `field_provenance:
 * {language:'caller'}`, which is literally accurate — caller only, no empirical signal. Of 17 scripts
 * that fetch archive.org/metadata, none read its language. Meanwhile the route flips that precedence
 * on purpose, because a caller passing the WORK's language silently overrode IA's record that a scan
 * was a 20th-c. Russian translation (#2184).
 *
 * Measured 2026-09-09 on a 124-book wave: IA publishes `ocr_detected_lang` for 42 of them; 5
 * disagreed with the catalogued value and the OCR was right every time — Novalis Fragmente stored
 * English (German), La Bruyère's Les Caractères English (French), Papyrus de Turin Italian (French),
 * Caeremoniale Episcoporum English (Latin), Greek Papyri in the BM English (Greek). It is not
 * cosmetic: getModelForBook() (src/lib/types/ai-models.ts) routes OCR by language, so a
 * mis-catalogued book buys the wrong model for its whole run.
 *
 * `language` is the EDITION's language, never the work's — see
 * .claude/docs/invariants/language-fields.md. A caller value that loses to a source signal is a
 * work hint and belongs in `original_language`, which is what the route does and what this returns.
 */
import { normalizeLanguageToken } from './language-normalize.mjs';

const first = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * IA's language claims, most empirical first. `ocr_detected_lang` is IA's own OCR reading the pages;
 * `language` is its catalogue record. Order matters and is the whole point.
 */
export function iaLanguageSignals(meta = {}) {
  return [
    { source: 'ia_ocr_detected', value: normalizeLanguageToken(first(meta.ocr_detected_lang)) },
    { source: 'ia_metadata', value: normalizeLanguageToken(first(meta.language)) },
  ].filter((s) => s.value);
}

/**
 * Resolve an edition's language for a direct IA import.
 *
 * Precedence, matching src/lib/resolve-language.ts: the first usable SOURCE signal wins; the caller
 * is the fallback. On disagreement the source wins the manifestation and the caller is demoted to
 * `original_language` (a work hint), with `conflict` set so nothing auto-publishes on it.
 *
 * @param {object} meta            IA `metadata` block
 * @param {string|null} caller     the importer's hardcoded language, if any
 * @returns {{language: string|null, original_language: string|null, conflict: boolean,
 *            chosen_from: string, provenance: object}}
 */
export function resolveIaLanguage(meta = {}, caller = null) {
  const signals = iaLanguageSignals(meta);
  const callerLang = normalizeLanguageToken(caller);
  const pick = signals[0] || null;

  const claims = [];
  if (callerLang) claims.push({ source: 'caller', value: callerLang });
  for (const s of signals) {
    if (!claims.some((c) => c.source === s.source && c.value === s.value)) claims.push(s);
  }

  let language = null, original_language = null, conflict = false, chosen_from = 'none';
  if (pick && callerLang && pick.value !== callerLang) {
    language = pick.value;
    original_language = callerLang;   // the caller was describing the work, not this printing
    conflict = true;
    chosen_from = pick.source;
  } else if (pick) {
    language = pick.value;
    chosen_from = pick.source;
  } else if (callerLang) {
    language = callerLang;
    chosen_from = 'caller';
  }

  return {
    language,
    original_language,
    conflict,
    chosen_from,
    provenance: {
      source: 'import', value: language, chosen_from, claims,
      ...(conflict ? { conflict: true } : {}),
      date: new Date().toISOString(),
    },
  };
}

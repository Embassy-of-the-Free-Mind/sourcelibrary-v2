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
import { normalizeLanguageToken, languageCode, languageRow, sameLanguage, sameLanguageFamily } from './language-normalize.mjs';

const first = (v) => (Array.isArray(v) ? v[0] : v);
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter(Boolean);

/**
 * Tesseract's script names (what IA publishes in `ocr_detected_script`) and the ISO 15924 codes of
 * the language table, folded to one key per writing system. Han, kana and hangul are one group on
 * purpose: IA reports a Chinese book as `Japanese` and a Korean one as `Han` often enough that the
 * distinction carries nothing here.
 */
const SCRIPT_GROUP = {
  latin: 'Latn', fraktur: 'Latn', vietnamese: 'Latn', latn: 'Latn',
  greek: 'Grek', grek: 'Grek',
  cyrillic: 'Cyrl', cyrl: 'Cyrl', cyrs: 'Cyrl',
  arabic: 'Arab', arab: 'Arab',
  hebrew: 'Hebr', hebr: 'Hebr',
  han: 'CJK', hans: 'CJK', hant: 'CJK', japanese: 'CJK', katakana: 'CJK', hiragana: 'CJK',
  hangul: 'CJK', hani: 'CJK', jpan: 'CJK', kore: 'CJK',
  devanagari: 'Deva', deva: 'Deva',
  bengali: 'Beng', beng: 'Beng', tamil: 'Taml', taml: 'Taml', telugu: 'Telu', telu: 'Telu',
  kannada: 'Knda', knda: 'Knda', malayalam: 'Mlym', mlym: 'Mlym', gujarati: 'Gujr', gujr: 'Gujr',
  gurmukhi: 'Guru', guru: 'Guru', sinhala: 'Sinh', sinh: 'Sinh',
  thai: 'Thai', tibetan: 'Tibt', tibt: 'Tibt', khmer: 'Khmr', khmr: 'Khmr', myanmar: 'Mymr', mymr: 'Mymr',
  syriac: 'Syrc', syrc: 'Syrc', armenian: 'Armn', armn: 'Armn', georgian: 'Geor', geor: 'Geor',
  ethiopic: 'Ethi', ethi: 'Ethi',
};
const scriptGroup = (name) => SCRIPT_GROUP[String(name || '').toLowerCase()] || null;

/**
 * Why IA's `ocr_detected_lang` cannot be relied on for this item, or null when nothing says so.
 *
 * `ocr_detected_lang` is a language detector run over IA's OWN OCR output, so where that OCR failed
 * (a script it has no model for, lithography, handwriting, hieroglyphs) the detector is classifying
 * noise, and it does so at `ocr_detected_lang_conf: 1.0000` (#4582: Sethe's hieroglyphic *Urkunden*
 * stored as Kyrgyz; six Latin classics likewise; de Goeje's Arabic geographers as Latin). The
 * confidence field cannot tell the two apart. Two things on the same record can:
 *
 *   1. the value is not a language the vocabulary knows. The detector's long tail (`an` Aragonese,
 *      `ky`, `lb`, `ga`, `qu`, `dz`...) is where noise and unfamiliar Latin land;
 *   2. the detected language is written in a script IA's OCR did not see on the pages
 *      (`ru` over `Latin`/`Fraktur`, `la` over `Arabic`).
 *
 * Measured 2026-10-11 on the books that carry an `ia_ocr_detected` claim AND a later page-level
 * verdict (n=114): rule 1 fired on 54, the detected value was wrong on 47 and unchecked on the
 * other 7 (page detection kept the same unknown code); rule 2 fired on 50, wrong on 49. Of the 10
 * neither rule touched, 6 were right. A count of scripts ("six scripts on one lithograph") was
 * tried and dropped: 3+ scripts was right 6 times and wrong 3.
 *
 * It answers null (no doubt) whenever it cannot judge: no script published, a script name it does
 * not know, or a language printed in more than one script (Sanskrit, Egyptian, Yiddish).
 */
export function iaOcrLanguageDoubt(meta = {}) {
  const raw = first(meta.ocr_detected_lang);
  if (raw == null || !normalizeLanguageToken(raw)) return null;
  const code = languageCode(raw);
  if (!code) return `"${String(raw).trim()}" is not a language in the vocabulary`;
  const row = languageRow(code);
  const want = row && !row.ambiguous_script ? scriptGroup(row.script) : null;
  const seen = list(meta.ocr_detected_script);
  if (!want || !seen.length) return null;
  const groups = seen.map(scriptGroup);
  if (groups.includes(null) || groups.includes(want)) return null;
  return `detected ${row.name} but the OCR saw only ${seen.join(', ')} script`;
}

/**
 * IA's language claims, most empirical first. `ocr_detected_lang` is IA's own OCR reading the pages;
 * `language` is its catalogue record. Order matters and is the whole point.
 */
export function iaLanguageSignals(meta = {}) {
  const doubt = iaOcrLanguageDoubt(meta);
  return [
    { source: 'ia_ocr_detected', value: normalizeLanguageToken(first(meta.ocr_detected_lang)), ...(doubt ? { doubt } : {}) },
    { source: 'ia_metadata', value: normalizeLanguageToken(first(meta.language)) },
  ].filter((s) => s.value);
}

/**
 * Resolve an edition's language for a direct IA import.
 *
 * Precedence, matching src/lib/resolve-language.ts: the first usable SOURCE signal wins; the caller
 * is the fallback. On disagreement the source wins the manifestation and the caller is demoted to
 * `original_language` (a work hint), with `conflict` set so nothing auto-publishes on it.
 * A signal carrying a `doubt` (see iaOcrLanguageDoubt) is never chosen and never makes a conflict:
 * the catalogue, then the caller, decide, and with neither the language is left unset. It is still
 * recorded, under `provenance.doubted`, with the reason.
 *
 * @param {object} meta            IA `metadata` block
 * @param {string|null} caller     the importer's hardcoded language, if any
 * @returns {{language: string|null, original_language: string|null, conflict: boolean,
 *            chosen_from: string, provenance: object}}
 */
export function resolveIaLanguage(meta = {}, caller = null) {
  const signals = iaLanguageSignals(meta);
  const callerLang = normalizeLanguageToken(caller);
  const pick = signals.find((s) => !s.doubt) || null;
  const doubted = signals.filter((s) => s.doubt).map((s) => ({ source: s.source, value: s.value, why: s.doubt }));

  const claims = [];
  if (callerLang) claims.push({ source: 'caller', value: callerLang });
  for (const s of signals) {
    if (!claims.some((c) => c.source === s.source && c.value === s.value)) claims.push({ source: s.source, value: s.value });
  }

  let language = null, original_language = null, conflict = false, chosen_from = 'none';
  // Agreement by name family ("Old French" ~ "French") or by the table ("Egyptian hieroglyphs" ~
  // `egy`), as src/lib/resolve-language.ts does: the same language in other words is not a conflict.
  const agrees = pick && callerLang && (sameLanguageFamily(pick.value, callerLang) || sameLanguage(pick.value, callerLang));
  if (pick && callerLang && !agrees) {
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
      ...(doubted.length ? { doubted } : {}),
      date: new Date().toISOString(),
    },
  };
}

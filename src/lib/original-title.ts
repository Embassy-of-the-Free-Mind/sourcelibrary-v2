// The original (source-language) title should stand in its own script.
// - A title written in a non-Latin script (Chinese, Devanagari, Arabic,
//   Hebrew, Greek, Cyrillic, …) should NOT be romanized or glossed inline;
//   drop a trailing romanization/translation parenthetical when present so
//   e.g. "道藏 (Daozang - Taoist Canon)" reads simply as "道藏".
// - A title in a Latin-alphabet language (English/French/German/Latin/…) is
//   italicised, following bibliographic convention.

// Scripts that are NOT the Latin alphabet. Presence of any of these ⇒ the
// title stands in its own script and shouldn't be italicised.
const NON_LATIN_RE = /[Ͱ-ϿЀ-ԯ԰-֏֐-׿؀-ۿ܀-ݏऀ-ॿঀ-෿฀-๿ༀ-࿿ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿ꥠ-꥿가-퟿豈-﫿]/;

export function isNonLatinScript(s: string | null | undefined): boolean {
  return !!s && NON_LATIN_RE.test(s);
}

/**
 * Return the original title in its own script. For a non-Latin title carrying
 * a trailing Latin-script romanization / gloss in parentheses, strip the
 * parenthetical. Latin-script titles are returned unchanged (their
 * parentheticals are usually part of the real title).
 */
export function cleanOriginalTitle(title: string | null | undefined): string {
  const t = (title || '').trim();
  if (!isNonLatinScript(t)) return t;
  // One trailing (...) or （...） whose contents are Latin/romanization only.
  const m = t.match(/^(.*\S)\s*[\(（]([^）)]*)[\)）]\s*$/);
  if (m && !isNonLatinScript(m[2])) return m[1].trim();
  return t;
}

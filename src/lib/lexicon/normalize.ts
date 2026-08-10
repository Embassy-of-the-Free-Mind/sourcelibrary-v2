/**
 * Latin orthography normalization for dictionary lookup.
 *
 * Both sides of every comparison — dictionary headwords at import time and
 * reader words at query time — MUST go through the same function. Never
 * normalize only one side (see lesson: a guard must normalize both sides).
 *
 * Two tiers:
 *  - normalizeLatin: safe, near-lossless canonical key (diacritics, ligatures,
 *    u/v, i/j, case). Used as the primary lookup key.
 *  - looseKey: additionally collapses ae/oe → e, which early modern printing
 *    (coelum/caelum, foemina/femina) makes necessary. Lossier; used only as a
 *    fallback tier so strict matches always win.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeLatin(word: string): string {
  return (
    word
      .normalize('NFD')
      // Early modern contraction marks, BEFORE stripping combining chars.
      // A tilde/macron over a vowel is a suspended nasal in early modern
      // print: word-final → m ("Latinorū" → latinorum, "Cōsortiū" →
      // consortium's final -um), mid-word tilde → m before labials
      // ("cõbibo" → combibo) else n ("Sapiētia" → sapientia). Mid-word
      // MACRONS are left to the generic strip — in dictionary orthography
      // they mark length, not contraction. U+0303 = tilde, U+0304 = macron.
      .replace(/([aeiouAEIOU])[̃̄](?=[^\p{L}̀-ͯ]|$)/gu, '$1m')
      .replace(/([aeiouAEIOU])̃(?=[̀-ͯ]*[bpmBPM])/gu, '$1m')
      .replace(/([aeiouAEIOU])̃/gu, '$1n')
      .replace(COMBINING_MARKS, '') // remaining macrons, breves, accents
      .toLowerCase()
      .replace(/æ/g, 'ae')
      .replace(/œ/g, 'oe')
      .replace(/ſ/g, 's') // long s surviving in OCR
      .replace(/j/g, 'i')
      .replace(/v/g, 'u')
      .replace(/w/g, 'uu')
      // early modern tilde contractions: õ = om/on etc. NFD splits the tilde
      // off as U+0303 (stripped above), so the base vowel survives; nothing
      // more to do here, but the char class below drops any leftovers.
      .replace(/[^a-z]/g, '')
  );
}

/** Lossier key: early modern ae/oe/e and y/i conflation. */
export function looseKey(normalized: string): string {
  return normalized.replace(/ae/g, 'e').replace(/oe/g, 'e').replace(/y/g, 'i');
}

/**
 * Strip punctuation and line-break hyphenation from a raw OCR token before
 * normalization. Keeps internal letters only; returns '' for non-words.
 */
export function cleanOcrToken(token: string): string {
  return token
    .replace(/[­­-]\s*$/g, '') // trailing hyphen (line break)
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '') // surrounding punctuation
    .trim();
}

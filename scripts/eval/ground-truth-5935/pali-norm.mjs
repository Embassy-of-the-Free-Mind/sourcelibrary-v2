// Pali body-text normalisation for #5935 (shared by pali.mjs and floor.mjs).
// PRIOR ART: lib.mjs foldPali (roman only, keeps niggahita as ṃ); this adds the apparatus strip and the
// Devanagari / Sinhala folds the VRI streams need.
import { bodyText } from './lib.mjs';

// The printed apparatus (lines opening with a superscript note number) and the note markers are not
// body text; PTS prints them at the foot of the page and our OCR keeps them untagged.
const SUP = /[¹²³⁴⁵⁶⁷⁸⁹⁰⁻]/g;
export const dropApparatus = (t) => String(t || '').split('\n').filter((l) => !/^\s*[¹²³⁴⁵⁶⁷⁸⁹⁰*†]/.test(l)).join('\n').replace(SUP, '');
// Niggahita is written ṃ (VRI), ṁ, ŋ or plain m across editions: folded to m. Circumflex long vowels → macron.
export const SCRIPTS = {
  romn: { re: /\p{Script=Latin}/u, fold: (t) => t.normalize('NFC').toLowerCase().replace(/[ṁŋṃ]/g, 'm').replace(/m̐/g, 'm').replace(/â/g, 'ā').replace(/î/g, 'ī').replace(/û/g, 'ū').replace(/[^\p{L}]/gu, '') },
  deva: { re: /\p{Script=Devanagari}/u, fold: (t) => t.normalize('NFC').replace(/[^\p{Script=Devanagari}]/gu, '').replace(/[।॥०-९]/g, '') },
  sinh: { re: /\p{Script=Sinhala}/u, fold: (t) => t.normalize('NFC').replace(/[^\p{Script=Sinhala}]/gu, '').replace(/[෴]/g, '') },
};
export const scriptOf = (t) => {
  const c = { romn: 0, deva: 0, sinh: 0 };
  for (const ch of String(t).slice(0, 4000)) for (const [k, v] of Object.entries(SCRIPTS)) if (v.re.test(ch)) c[k]++;
  const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return best[1] >= 100 ? best[0] : null;
};
export const normPali = (t, sc) => SCRIPTS[sc].fold(dropApparatus(bodyText(t)));

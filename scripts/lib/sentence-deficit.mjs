// Sentence deficit — page-error taxonomy class T9, quiet omission below the truncation threshold (#5151).
//
// PRIOR ART: scripts/lib/page-integrity.mjs truncationRatio() — compares LENGTHS and flags only a
// translation far shorter than its source; a lost clause, five lines or a footnote leave the length
// inside its band. block-drift.mjs moves text between pages; it does not count sentences. Kept in its
// own module (from the 2026-09-25 quick-wins WIP, commit 4d6bf99e2) so it merges independently of
// the other taxonomy detectors in page-integrity.mjs.
import { sourceProse, translationProse } from './block-drift.mjs';
import { decodeEntities, sourceLanguageCount, NON_PROSE_TYPES } from './page-integrity.mjs';

const proseOf = sourceProse;
const trProseOf = translationProse;
const HAN_OR_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export const SENT_MIN_SOURCE = 6;      // source sentences below which the ratio is noise
export const SENT_DEFICIT_FLAG = 0.6;  // translation sentences / source sentences at or under this
const ABBREV = new Set(['cap', 'lib', 'fol', 'pag', 'col', 'vol', 'tom', 'etc', 'vid', 'cf', 'ib', 'ibid', 'id', 'loc', 'cit', 'op', 'sc', 'viz', 'num', 'sect', 'art', 'quaest', 'dist', 'dr', 'mr', 'mrs', 'st', 'no', 'nr', 'ed', 'tr', 'ch', 'vs', 'ps', 'gen', 'ex', 'lev', 'deut', 'matt', 'joh', 'apoc', 'ff', 'seq', 'sq', 'sqq']);

/**
 * Sentence count of a prose text. A terminator is . ! ? (plus ; and · in Greek, ׃ in Hebrew,
 * 。！？ in CJK, ॥ in Devanagari) followed by a space and an upper-case letter, a digit, an
 * opening quote/bracket, or the end of the text. A period after a one-letter token, a digit, or a
 * known abbreviation ("cap. 3.", "S. Paulus") does not end a sentence. Returns null for a text
 * whose script has no sentence marks it can read (Tibetan shad is a clause mark; unpointed Hebrew
 * prayer books carry none) — the caller treats null as unjudgeable.
 */
export function sentenceCount(text) {
  const t = decodeEntities(String(text || '')).replace(/\s+/g, ' ').trim();
  if (!t) return 0;
  if (/[\p{Script=Tibetan}]/u.test(t.slice(0, 200))) return null;
  let n = 0;
  const cjk = /[。！？॥]/g;
  let m; while ((m = cjk.exec(t))) n++;
  if (n && HAN_OR_KANA.test(t.slice(0, 200))) return n;
  const re = /([\p{L}\p{N}]+)([.!?;·׃])["'”’)\]]*(?=\s+["'“‘(\[]?[\p{Lu}\p{N}\p{Script=Hebrew}\p{Script=Arabic}]|\s*$)/gu;
  const greek = /\p{Script=Greek}/u.test(t.slice(0, 400));
  while ((m = re.exec(t))) {
    const word = m[1], mark = m[2];
    if ((mark === ';' || mark === '·') && !greek) continue;
    if (mark === '.') {
      const w = word.toLowerCase();
      if (w.length === 1 && /\p{L}/u.test(w)) continue;
      if (/^\p{N}+$/u.test(w)) continue;
      if (ABBREV.has(w)) continue;
    }
    n++;
  }
  return n;
}

/**
 * Sentences in the source against sentences in the translation, per page and — where both texts
 * break into the same number of paragraphs — per paragraph, reporting the worst paragraph. A
 * screen for T9 (a clause, five lines, a footnote gone between two fluent sentences): a loss too
 * small for truncationRatio() but large enough to remove whole sentences. Translators split and
 * join sentences freely, so the ratio is noisy by design; the walk quotes its precision from the
 * hand-read, not from the threshold.
 *
 * UNJUDGEABLE: no translation, NON_PROSE type, a multilingual source, a source under
 * SENT_MIN_SOURCE sentences, or a script whose sentence marks cannot be read.
 */
export function sentenceDeficit({ ocr, tr, type }) {
  if (!tr || !String(tr).trim()) return { judged: false, why: 'no-translation' };
  if (NON_PROSE_TYPES.has(type)) return { judged: false, why: 'non-prose' };
  if (sourceLanguageCount(ocr) > 1) return { judged: false, why: 'multilingual-source' };
  const src = proseOf(ocr), out = trProseOf(tr);
  const s = sentenceCount(src), o = sentenceCount(out);
  if (s == null || o == null) return { judged: false, why: 'unreadable-script' };
  if (s < SENT_MIN_SOURCE) return { judged: false, why: 'few-sentences' };
  const ratio = +(o / s).toFixed(3);
  const r = { judged: true, src: s, tr: o, ratio, flag: ratio <= SENT_DEFICIT_FLAG };
  const sp = src.split(/\n\s*\n/).filter(x => x.trim()), op = out.split(/\n\s*\n/).filter(x => x.trim());
  if (sp.length > 1 && sp.length === op.length) {
    let worst = null;
    for (let i = 0; i < sp.length; i++) {
      const a = sentenceCount(sp[i]), b = sentenceCount(op[i]);
      if (a == null || b == null || a < 4) continue;
      const pr = b / a;
      if (!worst || pr < worst.ratio) worst = { paragraph: i, src: a, tr: b, ratio: +pr.toFixed(3) };
    }
    if (worst) { r.paragraphs = sp.length; r.worst = worst; r.flag = r.flag || worst.ratio <= SENT_DEFICIT_FLAG; }
  }
  return r;
}
